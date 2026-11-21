// A stand-in for the dedicated browser in tests. It answers the DevTools
// commands that the runtime sends over the private pipes (descriptor 3 in,
// descriptor 4 out) and then plays the worker's part against the Netplay relay:
//   node fake-browser.mjs --script-file <json file> <browser switches…>
// The script file holds { record, netplayPort, launches: [{…}, {…}] }; without a
// netplayPort it takes the one in SLED_SERVER_NETPLAY_PORT, which a packaged
// server under test passes on. Each
// launch appends a `start` line (with its switches and two environment variables) to the record file, and a `navigate` line
// once it is told which page to open. A save that it is started with is 5.9 MB
// of text; the `navigate` line keeps its length and its SHA-256 as `snapshot`.
// It takes the script entry of its
// position; later launches reuse the last entry. Entry fields:
// neverConnect, neverListen, listenAfterMs (how long it takes to listen),
// exitAfterMs (after it listens, or after the
// navigation when it never will), ignoreTerm, failCommand, silent (answers no command),
// garbage (answers the first command with something that is not a message).
// Like the real browser, it exits when its command pipe closes.
import { createHash } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { Socket } from 'node:net';
import { WebSocket } from 'ws';

const argv = process.argv.slice(2);
const script0 = JSON.parse(readFileSync(argv[argv.indexOf('--script-file') + 1], 'utf8'));
const { record, launches = [{}] } = script0;
const netplayPort = script0.netplayPort ?? (Number(process.env.SLED_SERVER_NETPLAY_PORT) || undefined);
const args = argv.slice(argv.indexOf('--script-file') + 2);
let earlier = 0;
try {
  earlier = readFileSync(record, 'utf8').split('\n').filter(Boolean).filter(line => JSON.parse(line).event === 'start').length;
} catch { /* The first launch. */ }
const note = entry => appendFileSync(record, `${JSON.stringify({ pid: process.pid, ...entry })}\n`);
note({ event: 'start', args, env: { HOME: process.env.HOME ?? null, BREAKPAD_DUMP_LOCATION: process.env.BREAKPAD_DUMP_LOCATION ?? null } });
const script = launches[Math.min(earlier, launches.length - 1)];

if (script.ignoreTerm) process.on('SIGTERM', () => {});
const leaveLater = () => {
  if (script.exitAfterMs !== undefined) setTimeout(() => process.exit(0), script.exitAfterMs);
};

let setup;
function work(url) {
  if (netplayPort === undefined || script.neverConnect) return leaveLater();
  const open = (request, receive) => {
    const socket = new WebSocket(`ws://127.0.0.1:${netplayPort}`, { origin: new URL(url).origin });
    socket.on('error', () => {});
    socket.once('open', () => socket.send(JSON.stringify(request)));
    socket.on('message', (data, binary) => { if (!binary) receive?.(data.toString(), socket); });
  };
  open({ role: 'worker', room: setup.room, token: setup.workerKey }, (message, socket) => {
    if (message.startsWith('{')) {
      if (script.neverListen) return leaveLater();
      const listen = () => {
        socket.send('listening');
        leaveLater();
      };
      if (script.listenAfterMs === undefined) listen();
      else setTimeout(listen, script.listenAfterMs);
    } else {
      // A ticket: accept that player's stream, as the emulator's Netplay host does.
      open({ role: 'accept', room: setup.room, ticket: message });
    }
  });
}

// Sockets, not file streams: a file read of a pipe blocks a worker thread, and the process then cannot exit.
const output = new Socket({ fd: 4, readable: false, writable: true });
const input = new Socket({ fd: 3, readable: true, writable: false });
input.setEncoding('utf8');
let data = '';
input.on('data', chunk => {
  data += chunk;
  for (let end; (end = data.indexOf('\0')) >= 0;) {
    const { id, method, params } = JSON.parse(data.slice(0, end));
    data = data.slice(end + 1);
    if (script.silent) continue;
    if (script.garbage) {
      output.write('hello, not a message\0');
      continue;
    }
    if (method === script.failCommand) {
      output.write(`${JSON.stringify({ id, error: { message: 'Refused by the stand-in' } })}\0`);
      continue;
    }
    let result = {};
    if (method === 'Target.createTarget') result = { targetId: 'target' };
    if (method === 'Target.attachToTarget') result = { sessionId: 'session' };
    if (method === 'Page.addScriptToEvaluateOnNewDocument')
      setup = JSON.parse(params.source.slice(params.source.indexOf('=') + 1));
    if (method === 'Page.navigate') {
      const { snapshot, ...rest } = setup;
      note({ event: 'navigate', url: params.url, setup: snapshot === undefined ? rest
        : { ...rest, snapshot: { length: snapshot.length, sha256: createHash('sha256').update(snapshot).digest('hex') } } });
      work(params.url);
    }
    output.write(`${JSON.stringify({ id, result })}\0`);
  }
});
input.on('error', () => process.exit(0));
input.on('end', () => process.exit(0));
