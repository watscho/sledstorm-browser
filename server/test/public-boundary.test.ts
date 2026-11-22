// AUTH-01: nothing that comes in through the public gateway, or through its
// mirror listener, reaches the control listener. The gateway forwards a fixed
// list of the game's paths to the game origin and nothing else, so these
// tests pass as long as that holds: a failure here is a finding.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { request } from 'node:http';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { writeConfig } from '../src/config-store.ts';
import type { HostControl } from '../src/host-control.ts';
import { startHostServer } from '../src/host-server.ts';
import { createHostService } from '../src/host-service.ts';
import { panelRoot, scratchPaths, standInBrowser, standInReport, writeGame } from './fixtures.ts';

const fakeCloudflared = fileURLToPath(new URL('./fake-cloudflared.mjs', import.meta.url));

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, 'close');
  return port;
}

interface Answer {
  status: number;
  body: string;
  headers: string;
}

function call(port: number, method: string, path: string, headers: Record<string, string> = {}, sent?: string): Promise<Answer> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, method, path, headers }, incoming => {
      let body = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk: string) => { body += chunk; });
      incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body, headers: JSON.stringify(incoming.headers) }));
    });
    outgoing.on('error', reject);
    outgoing.end(sent);
  });
}

/** What a WebSocket client is answered with, when the answer is not a socket. */
function upgrade(port: number, path: string, headers: Record<string, string>): Promise<number | 'socket'> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
    socket.once('open', () => {
      socket.terminate();
      resolve('socket');
    });
    socket.once('unexpected-response', (outgoing, incoming) => {
      outgoing.destroy();
      resolve(incoming.statusCode ?? 0);
    });
    socket.once('error', reject);
  });
}

/** Every route of the control listener, and the two that later stages add. */
/** In the headers of an answer, as `call` keeps them: the mark that the control listener puts on every answer of its own. */
const OWN_ANSWER = /"cross-origin-resource-policy":"same-origin"/;

const ROUTES = ['/api/status', '/api/invitation', '/api/config', '/api/session', '/api/session/bootstrap', '/api/host/start',
  '/api/host/quit', '/api/room/stop', '/api/room/new-game', '/api/game-folder/pick', '/api/diagnostics/export'];

/** The ways a route may be spelled to slip past a list of paths. The last one names the control listener itself. */
const spellings = (route: string, controlPort: number) => [route, route.replace('/api/', '/%61pi/'), route.replace('/api/', '/api%2F'),
  `/${route}`, `/.${route}`, `/web/..${route}`, `/..${route}`, `${route}?x=1`, `http://127.0.0.1:${controlPort}${route}`];

test('nothing public reaches the control listener', { timeout: 60_000 }, async t => {
  // The real host: the game origin, the room with a stand-in for its browser, the gateway, and
  // two tunnels of a stand-in program, so that the mirror listener is known by its port.
  const paths = await scratchPaths(t, 'boundary');
  const folder = await writeGame(join(paths.root, 'Игра folder'));
  await writeConfig(paths, { version: 1, gameFolder: folder, discPolicy: 'shared-allowed', autoStart: true, roomOptions: { progress: 'all', camera: true } });
  const gamePort = await freePort();
  const netplayPort = await freePort();
  const access = 'f'.repeat(48);
  const record = join(paths.root, 'tunnel-launches.jsonl');
  const browser = await standInBrowser(paths.root, { netplayPort });
  const lines: string[] = [];
  const hosting = createHostService({ paths, log: line => lines.push(line), gamePort, netplayPort, accessToken: access,
    tunnels: { command: { command: process.execPath, args: [fakeCloudflared, '--script', JSON.stringify({ record, launches: [{}] })] },
      timing: { readyMs: 2000, probeMs: 2000, pollMs: 20, lostMs: 200, restartDelaysMs: [30, 30], stableMs: 60_000, graceMs: 500 } },
    worker: { browser: browser.program, graceMs: 500, room: { restartDelaysMs: [30, 30] } } });
  t.after(() => Promise.race([hosting.stop(), delay(10_000, undefined, { ref: false })]));

  // The control listener of the same process. Whatever it is asked for is written down.
  const asked: string[] = [];
  const control: HostControl = {
    start() {
      asked.push('start');
      return null;
    },
    stop() {
      asked.push('stop');
      return null;
    },
    quit() {
      asked.push('may quit');
      return null;
    },
    newGame() {
      asked.push('new-game');
      return null;
    },
    async config() {
      asked.push('config');
      return { gameFolder: folder, discPolicy: 'shared-allowed', autoStart: true, roomOptions: { progress: 'all', camera: true }, problem: null };
    },
    async configure() {
      asked.push('configure');
      return { status: 409, error: 'This test changes nothing.' };
    },
    async pickFolder() {
      asked.push('pick');
      return { status: 409, error: 'This test shows no dialog.' };
    },
    async diagnostics(about) {
      asked.push('diagnostics');
      return standInReport(about);
    },
    close() {},
  };
  const host = await startHostServer({ version: '9.9.9', panelRoot, onQuit: () => { asked.push('quit'); }, control,
    status: () => {
      asked.push('status');
      return hosting.status();
    },
    invitation: () => {
      asked.push('invitation');
      return { url: hosting.invitation(), localUrl: hosting.localInvitation() };
    } });
  t.after(() => host.close());

  const status = await hosting.start();
  assert.deepEqual({ state: status.state, room: status.room, tunnel: status.tunnel }, { state: 'online', room: 'open', tunnel: 'online' },
    JSON.stringify(status.problem));
  const gateway = status.gatewayPort!;
  for (let attempt = 0; hosting.status().mirror !== 'online' && attempt < 400; attempt++) await delay(20);
  const launches = (await readFile(record, 'utf8')).split('\n').filter(Boolean).map(line => JSON.parse(line) as { kind: string; args: string[] });
  const mirror = Number(new URL(launches.find(launch => launch.kind === 'mirror')!.args[2]!).port);
  assert.ok(mirror > 0 && mirror !== gateway && mirror !== host.port);

  // The control listener works, and has a session to steal.
  const command = { authorization: `Bearer ${host.token}` };
  const minted = await call(host.port, 'POST', '/api/session/bootstrap', command);
  const { bootstrap } = JSON.parse(minted.body) as { bootstrap: string };
  const opened = await call(host.port, 'POST', '/api/session', { 'content-type': 'application/json' }, minted.body);
  const { session } = JSON.parse(opened.body) as { session: string };
  assert.equal((await call(host.port, 'GET', '/api/status', { authorization: `Bearer ${session}` })).status, 200);
  for (const answer of [minted, opened, await call(host.port, 'GET', '/api/status'), await call(host.port, 'POST', '/api/host/quit', { host: 'rebound.example' })])
    assert.match(answer.headers, OWN_ANSWER, `the control listener marks its ${answer.status}`);
  assert.deepEqual(asked.splice(0), ['status']);

  const cookie = { cookie: `sled_access=${access}` };
  const itself = { host: `127.0.0.1:${host.port}` };
  const origin = { origin: `http://127.0.0.1:${host.port}` };
  const json = { 'content-type': 'application/json' };
  // Without the gateway's cookie and with it; with the control credential, a panel session, and the
  // control listener's own name and origin, as a request to that listener would carry them.
  const disguises: Record<string, string>[] = [{}, command, { authorization: `Bearer ${session}` }, itself, { ...command, ...itself, ...origin },
    { ...command, ...json }];
  const secrets = [host.instance, host.token, session, bootstrap, '"instance"', '"session"', '"bootstrap"', folder, paths.root];
  let requests = 0;
  const refused = async (port: number, method: string, path: string, headers: Record<string, string>, allowed: number[]) => {
    const answer = await call(port, method, path, headers, method === 'GET' ? undefined : '{"force":true,"bootstrap":"x"}');
    requests += 1;
    const told = `${method} ${path} ${JSON.stringify(Object.keys(headers))} on port ${port}: ${answer.status} ${answer.body.slice(0, 80)}`;
    assert.ok(allowed.includes(answer.status), told);
    // Every answer of the control listener carries this header, and nothing else in the stack sets it:
    // an answer without it did not come from there, whatever its status.
    assert.ok(!OWN_ANSWER.test(answer.headers), `${told}: answered by the control listener`);
    for (const secret of secrets) assert.ok(!answer.body.includes(secret) && !answer.headers.includes(secret), told);
  };
  for (const route of ROUTES) {
    for (const path of spellings(route, host.port)) {
      for (const method of ['GET', 'POST', 'PUT']) {
        for (const disguise of disguises) {
          await refused(gateway, method, path, disguise, [400, 401]);
          await refused(gateway, method, path, { ...disguise, ...cookie }, [400, 403]);
        }
        // The mirror listener answers no request at all, and the game origin knows only the game's files.
        await refused(mirror, method, path, { ...command, ...cookie }, [403]);
        await refused(gamePort, method, path, command, [400, 403, 404, 405]);
      }
    }
  }
  // The panel's page is the control listener's alone.
  for (const path of ['/panel.js', '/session.js', '/view.js', '/controller.js', '/panel.css', '/index.html', '/admin/panel.js']) {
    await refused(gateway, 'GET', path, cookie, [403]);
    await refused(gateway, 'GET', path, {}, [401]);
    await refused(mirror, 'GET', path, cookie, [403]);
  }
  assert.ok(requests > 3000, `${requests} requests`);

  // A WebSocket client gets a socket for the game's relay only: no route of the control listener gives one.
  const page = { ...cookie, origin: `http://127.0.0.1:${gateway}` };
  for (const route of ROUTES) {
    for (const path of [route, route.replace('/api/', '/%61pi/'), `/${route}`, `/netplay/..${route}`]) {
      assert.equal(await upgrade(gateway, path, { ...page, ...command }), 403, path);
      assert.equal(await upgrade(gateway, path, command), 403, path);
      assert.equal(await upgrade(mirror, path, { ...page, ...command, 'x-forwarded-proto': 'https' }), 403, path);
    }
  }
  assert.deepEqual(asked, [], 'the control listener was asked for nothing');
  assert.equal(hosting.status().state, 'online');

  // What does leave the server for a guest: the invitation and the session info. Neither says how to control it.
  const links = await call(host.port, 'GET', '/api/invitation', command);
  assert.equal(links.status, 200);
  const { url, localUrl } = JSON.parse(links.body) as { url: string; localUrl: string };
  assert.match(url, new RegExp(`^https://synthetic-\\d+\\.trycloudflare\\.com/access/${access}#[A-Za-z0-9+/=]+$`));
  assert.equal(new URL(localUrl).origin, `http://127.0.0.1:${gamePort}`);
  const decoded = Buffer.from(new URL(url).hash.slice(1), 'base64').toString('utf8');
  const info = await call(gateway, 'GET', '/session-info', cookie);
  const local = await call(gamePort, 'GET', '/session-info');
  assert.deepEqual([info.status, local.status], [200, 200]);
  const controlPort = `:${host.port}`;
  for (const [name, text] of Object.entries({ url, localUrl, decoded, info: info.body + info.headers, local: local.body + local.headers })) {
    for (const secret of [host.instance, host.token, session, bootstrap, folder, paths.root, controlPort])
      assert.ok(!text.includes(secret), `${name} must not carry ${secret === controlPort ? 'the port of the control listener' : 'a secret'}`);
  }
  assert.ok(!lines.join('\n').includes(host.token) && !lines.join('\n').includes(session), 'the log holds no credential');
});
