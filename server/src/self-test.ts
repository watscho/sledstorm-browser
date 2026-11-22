// Checks that this executable can do what the host runtime needs: find its
// resources, write only to user data, serve HTTP, carry Netplay WebSockets
// through the existing gateway and relay modules, and own child processes.
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { join } from 'node:path';
import { isSea } from 'node:sea';
import { WebSocket } from 'ws';
import { defaultConfig } from './config-store.ts';
import { diagnosticReport } from './diagnostics.ts';
import { startHostServer } from './host-server.ts';
import type { SmokeGuestSetup } from './internal.ts';
import { createPublicGateway, createRetroArchRelay, listeningPort } from './network.ts';
import { startOwnedProcess } from './owned-process.ts';
import { ensureWritableRoots, type Paths } from './paths.ts';
import { selfCommand } from './self.ts';
import { appVersion } from './version.ts';

interface Check {
  name: string;
  ok: boolean;
  ms: number;
  detail?: unknown;
  error?: string;
}

function expect(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function within<T>(ms: number, work: Promise<T>): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const expired = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out after ${ms} ms`)), ms);
  });
  return Promise.race([work, expired]).finally(() => clearTimeout(timer));
}

function call(port: number, method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, method, path, headers }, incoming => {
      let body = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk: string) => { body += chunk; });
      incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

/** Queues every message so that none is lost between two awaits. */
function inbox(socket: WebSocket): (match: (text: string, binary: boolean) => boolean) => Promise<Buffer> {
  const queue: { data: Buffer; binary: boolean }[] = [];
  let wake: (() => void) | undefined;
  socket.on('message', (data, binary) => {
    queue.push({ data: data as Buffer, binary });
    wake?.();
  });
  return async match => {
    for (;;) {
      const index = queue.findIndex(({ data, binary }) => match(data.toString(), binary));
      if (index >= 0) return queue.splice(index, 1)[0]!.data;
      await new Promise<void>(resolve => { wake = resolve; });
    }
  };
}

async function checkResources(paths: Paths): Promise<unknown> {
  const manifest = JSON.parse(await readFile(join(paths.resourceRoot, 'runtime-manifest.json'), 'utf8')) as {
    schema?: number; app?: { version?: string }; node?: { version?: string };
  };
  expect(manifest.schema === 1, 'Unknown runtime manifest schema');
  expect(manifest.app?.version === appVersion, `The manifest is for version ${manifest.app?.version}, this executable is ${appVersion}`);
  expect(!isSea() || manifest.node?.version === process.versions.node,
    `The manifest pins Node.js ${manifest.node?.version}, this executable embeds ${process.versions.node}`);
  return { resourceRoot: paths.resourceRoot, manifestVersion: manifest.app.version, manifestNode: manifest.node?.version };
}

async function checkWritableRoots(paths: Paths): Promise<unknown> {
  await ensureWritableRoots(paths);
  for (const root of [paths.dataRoot, paths.cacheRoot, paths.logRoot]) {
    const probe = join(root, `self-test-${process.pid}.tmp`);
    await writeFile(probe, 'ok', { mode: 0o600 });
    expect(await readFile(probe, 'utf8') === 'ok', `Could not read back ${probe}`);
    await rm(probe);
  }
  await rm(await mkdtemp(join(paths.tempRoot, 'sled-self-test-')), { recursive: true });
  return { dataRoot: paths.dataRoot, cacheRoot: paths.cacheRoot, logRoot: paths.logRoot, tempRoot: paths.tempRoot };
}

async function checkHttp(paths: Paths): Promise<unknown> {
  let quits = 0;
  // Read through a function: the compiler must not assume the count stays unchanged across requests.
  const quitCount = () => quits;
  // The self-test hosts nothing, so its listener has nothing to start, to stop or to configure, and its report no host.
  const control = { start: () => null, stop: () => null, quit: () => null, newGame: () => null,
    config: async () => ({ gameFolder: null, discPolicy: null, autoStart: true, roomOptions: { progress: 'all' as const, camera: true }, problem: null }),
    configure: async () => ({ status: 409 as const, error: 'The self-test keeps no configuration.' }),
    pickFolder: async () => ({ status: 503 as const, error: 'The self-test shows no dialog.' }),
    diagnostics: ({ version, startedAt }: { version: string; startedAt: string }) =>
      diagnosticReport({ paths, version, status: null, config: { config: defaultConfig, problem: null }, now: new Date(), startedAt }),
    close: () => {} };
  const host = await startHostServer({ version: appVersion, panelRoot: join(paths.resourceRoot, 'admin'), onQuit: () => { quits += 1; }, status: () => ({}),
    invitation: () => ({ url: null, localUrl: null }), control });
  try {
    const bearer = { authorization: `Bearer ${host.token}` };
    const status = await call(host.port, 'GET', '/api/status', bearer);
    expect(status.status === 200 && (JSON.parse(status.body) as { instance?: string }).instance === host.instance,
      'The authorized status request failed');
    expect((await call(host.port, 'GET', '/api/status')).status === 401, 'Status must require the credential');
    expect((await call(host.port, 'GET', '/api/status', { ...bearer, host: 'attacker.example' })).status === 403,
      'A rebound host name must be refused');
    expect((await call(host.port, 'POST', '/api/host/quit', { ...bearer, origin: 'https://attacker.example' })).status === 403,
      'A foreign origin must be refused');
    for (const path of ['/', '/panel.css', '/session.js', '/view.js', '/controller.js', '/panel.js'])
      expect((await call(host.port, 'GET', path)).status === 200, `The panel's page must load: ${path}`);
    expect(quitCount() === 0, 'Refused requests must not reach the quit handler');
    expect((await call(host.port, 'POST', '/api/host/quit', bearer)).status === 202, 'The quit request must be accepted');
    for (let attempt = 0; quitCount() === 0 && attempt < 50; attempt++) await new Promise(resolve => setTimeout(resolve, 10));
    expect(quitCount() === 1, 'The quit request must reach the server exactly once');
    return { port: host.port };
  } finally {
    await host.close();
  }
}

async function checkNetplayRelay(): Promise<unknown> {
  const hex = (bytes: number) => randomBytes(bytes).toString('hex');
  const relay = createRetroArchRelay({ port: 0 });
  await once(relay, 'listening');
  const access = hex(24);
  // The relay still accepts only the launcher origin on port 8000; nothing has to listen there.
  const gateway = createPublicGateway({ port: 0, upstream: 8000, netplay: listeningPort(relay),
    accessToken: access, maxPayload: 8 * 1024 * 1024 });
  const sockets: WebSocket[] = [];
  try {
    await once(gateway, 'listening');
    const address = `127.0.0.1:${listeningPort(gateway)}`;
    const setup: SmokeGuestSetup = { url: `ws://${address}/netplay`, origin: `http://${address}`,
      cookie: `sled_access=${access}`, room: hex(12), token: hex(32), identity: hex(32) };
    const connect = () => {
      const socket = new WebSocket(setup.url, { origin: setup.origin, headers: { cookie: setup.cookie }, perMessageDeflate: false });
      sockets.push(socket);
      return socket;
    };
    const join = { room: setup.room, token: setup.token, identity: setup.identity };

    const host = connect();
    const atHost = inbox(host);
    await once(host, 'open');
    host.send(JSON.stringify({ role: 'host', roster: true, ...join }));
    const ready = JSON.parse((await atHost(text => text.includes('"ready"'))).toString()) as { slot?: number };
    expect(ready.slot === 0, 'The relay must give the host controller 0');
    host.send('{"type":"synchronized"}');
    await atHost(text => text.includes('"roster"')
      && (JSON.parse(text) as { seats: { status: string }[] }).seats[0]?.status === 'connected');

    // The guest is a second process of this same executable.
    let echoed!: () => void;
    const echo = new Promise<void>(resolve => { echoed = resolve; });
    const { command, args } = selfCommand(['internal', 'smoke-guest', JSON.stringify(setup)]);
    const starting = startOwnedProcess({
      name: 'Netplay guest', command, args, startupMs: 10_000,
      ready: line => line.includes('"event":"ready"'),
      onLine: line => { if (line.includes('"event":"echo"') && line.includes('host-to-guest')) echoed(); },
    });
    starting.catch(() => { /* Reported by the await below. */ });
    const ticket = (await atHost((text, binary) => !binary && /^[a-f0-9]{48}$/.test(text))).toString();
    const stream = connect();
    const atStream = inbox(stream);
    await once(stream, 'open');
    stream.send(JSON.stringify({ role: 'accept', ticket, ...join }));
    const guest = await starting;
    try {
      const packet = await atStream((_text, binary) => binary);
      expect(packet.toString() === 'guest-to-host', 'The guest packet must reach the host stream unchanged');
      stream.send(Buffer.from('host-to-guest'));
      await echo;
      const stopped = await guest.stop(3000);
      expect(!stopped.forced && stopped.code === 0, 'The guest process must stop when asked');
      return { gatewayPort: listeningPort(gateway), relayPort: listeningPort(relay), guestPid: guest.pid };
    } finally {
      await guest.stop(0);
    }
  } finally {
    for (const socket of sockets) socket.terminate();
    for (const client of relay.clients) client.terminate();
    gateway.close();
    relay.close();
  }
}

async function checkForcedStop(): Promise<unknown> {
  const { command, args } = selfCommand(['internal', 'smoke-stubborn']);
  const child = await startOwnedProcess({ name: 'Stubborn child', command, args, startupMs: 10_000,
    ready: line => line.includes('"event":"ready"') });
  const stopped = await child.stop(300);
  expect(stopped.forced && stopped.signal === 'SIGKILL', 'A child that ignores SIGTERM must be killed');
  let gone = false;
  try { process.kill(child.pid, 0); } catch { gone = true; }
  expect(gone, 'The killed child must be gone');
  return { pid: child.pid, signal: stopped.signal };
}

export async function selfTest(paths: Paths): Promise<number> {
  const checks: Check[] = [];
  const check = async (name: string, body: () => Promise<unknown>) => {
    const started = performance.now();
    try {
      const detail = await within(20_000, body());
      checks.push({ name, ok: true, ms: Math.round(performance.now() - started), detail });
    } catch (error) {
      checks.push({ name, ok: false, ms: Math.round(performance.now() - started),
        error: error instanceof Error ? error.stack ?? error.message : String(error) });
    }
  };
  await check('resources', () => checkResources(paths));
  await check('writable-roots', () => checkWritableRoots(paths));
  await check('http', () => checkHttp(paths));
  await check('netplay-relay', checkNetplayRelay);
  await check('forced-stop', checkForcedStop);
  const ok = checks.every(entry => entry.ok);
  console.log(JSON.stringify({
    ok, version: appVersion, sea: isSea(), node: process.versions.node,
    platform: `${process.platform}-${process.arch}`, execPath: process.execPath, cwd: process.cwd(),
    searchPath: process.env.PATH ?? null, checks,
  }, null, 2));
  return ok ? 0 : 1;
}
