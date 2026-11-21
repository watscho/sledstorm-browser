// A stand-in for cloudflared in tests. It serves the two metrics routes the
// tunnel supervisor reads and follows a script given on its command line:
//   node fake-cloudflared.mjs --script '{"record":"<file>","launches":[{…},{…}]}' tunnel --metrics 127.0.0.1:<port> …
// Each launch appends a line to the record file and takes the script entry
// of its position; later launches reuse the last entry. A launch with
// `--protocol http2` is the mirror and follows `mirror` when the script has
// one. Entry fields:
// readyAfterMs, neverReady, lostAfterMs, exitAfterMs, exitCode, badHostname,
// litterHome (leave a directory in the home that cannot be removed).
import { appendFileSync, chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';

const argv = process.argv.slice(2);
const { record, launches = [{}], mirror } = JSON.parse(argv[argv.indexOf('--script') + 1]);
const args = argv.slice(argv.indexOf('--script') + 2);
const kind = args[args.indexOf('--protocol') + 1] === 'http2' ? 'mirror' : 'primary';
const list = kind === 'mirror' && mirror ? mirror : launches;
let earlier = 0;
try {
  earlier = readFileSync(record, 'utf8').split('\n').filter(Boolean).filter(line => JSON.parse(line).kind === kind).length;
} catch { /* The first launch. */ }
appendFileSync(record, `${JSON.stringify({ kind, pid: process.pid, args, home: process.env.HOME, env: Object.keys(process.env).sort() })}\n`);
const script = list[Math.min(earlier, list.length - 1)];

if (script.litterHome) {
  mkdirSync(`${process.env.HOME}/kept`);
  writeFileSync(`${process.env.HOME}/kept/file`, 'x');
  chmodSync(`${process.env.HOME}/kept`, 0o000);
}

const started = Date.now();
const age = () => Date.now() - started;
const ready = () => !script.neverReady && age() >= (script.readyAfterMs ?? 0)
  && !(script.lostAfterMs !== undefined && age() >= script.lostAfterMs);
const hostname = script.badHostname ?? `synthetic-${process.pid}.trycloudflare.com`;
const [host, port] = args[args.indexOf('--metrics') + 1].split(':');

createServer((request, response) => {
  if (request.url === '/ready') {
    const ok = ready();
    response.writeHead(ok ? 200 : 503, { 'content-type': 'application/json' })
      .end(JSON.stringify({ status: ok ? 200 : 503, readyConnections: ok ? 1 : 0 }));
  } else if (request.url === '/quicktunnel') {
    response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ hostname }));
  } else {
    response.writeHead(404).end();
  }
}).listen(Number(port), host);

// Like the real program, it names its address on its error output.
console.error(`Your quick Tunnel has been created! Visit it at https://${hostname}`);
if (script.exitAfterMs !== undefined) setTimeout(() => process.exit(script.exitCode ?? 1), script.exitAfterMs);
process.on('SIGTERM', () => process.exit(0));
