import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { once } from 'node:events';
import { appendFile, chmod, rm, truncate, writeFile } from 'node:fs/promises';
import { connect, createServer, type AddressInfo, type Server } from 'node:net';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { writeConfig, type DiscPolicy } from '../src/config-store.ts';
import { createHostService } from '../src/host-service.ts';
import { lock, nativeBuild, scratchPaths, writeGame } from './fixtures.ts';

async function hold(port: number): Promise<Server> {
  const server = createServer();
  server.listen(port, '127.0.0.1');
  await once(server, 'listening');
  return server;
}

async function freePort(): Promise<number> {
  const server = await hold(0);
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, 'close');
  return port;
}

const refused = (port: number) => new Promise<boolean>(resolve => {
  const socket = connect(port, '127.0.0.1');
  socket.once('connect', () => {
    socket.destroy();
    resolve(false);
  });
  socket.once('error', () => resolve(true));
});

async function service(t: TestContext, { policy = 'shared-allowed' as DiscPolicy | null, accessToken = undefined as string | undefined } = {}) {
  const paths = await scratchPaths(t, 'host');
  const folder = await writeGame(join(paths.root, 'Игра folder'));
  if (policy) await writeConfig(paths, { version: 1, gameFolder: folder, discPolicy: policy });
  const gamePort = await freePort();
  const netplayPort = await freePort();
  const lines: string[] = [];
  const host = createHostService({ paths, log: line => lines.push(line), gamePort, netplayPort, accessToken });
  t.after(() => host.stop());
  return { paths, folder, gamePort, netplayPort, host, lines };
}

test('an unconfigured server needs setup', async t => {
  const { host, gamePort } = await service(t, { policy: null });
  assert.deepEqual(host.status(), { state: 'idle', problem: null, game: null, localUrl: null, gatewayPort: null, tunnel: 'off' });
  assert.deepEqual(await host.start(), { state: 'needs_setup', game: null, localUrl: null, gatewayPort: null, tunnel: 'off',
    problem: { component: 'config', message: 'Choose the game folder and the disc policy to start hosting.' } });
  assert.ok(await refused(gamePort), 'nothing listens before setup');
});

test('a damaged configuration needs setup', async t => {
  const { host, paths } = await service(t);
  await writeFile(join(paths.dataRoot, 'config.json'), 'not json');
  const status = await host.start();
  assert.equal(status.state, 'needs_setup');
  assert.equal(status.problem?.component, 'config');
  assert.match(String(status.problem?.message), /damaged/);
});

test('local-only waits for a later stage', async t => {
  const { host } = await service(t, { policy: 'local-only' });
  assert.deepEqual((await host.start()).problem, { component: 'config',
    message: "Rooms that use each player's own game files are not available in this build yet. Choose shared-allowed to host." });
  assert.equal(host.status().state, 'needs_setup');
});

test('missing emulator assets fail the emulator component', async t => {
  const { host, paths, gamePort } = await service(t);
  await rm(join(paths.resourceRoot, 'emulator'), { recursive: true });
  const status = await host.start();
  assert.equal(status.state, 'failed');
  assert.equal(status.problem?.component, 'emulator');
  assert.match(String(status.problem?.message), /emulator\/emulator\.lock\.json/);
  assert.ok(await refused(gamePort));
});

test('a folder without a disc fails game data', async t => {
  const { host, folder } = await service(t);
  await rm(join(folder, 'Game.cue'));
  assert.deepEqual((await host.start()).problem, { component: 'game-data', message: 'Expected exactly one CUE file in the game folder.' });
  assert.equal(host.status().state, 'failed');
});

test('a configured server comes online', async t => {
  const { host, gamePort, netplayPort, lines } = await service(t);
  const status = await host.start();
  assert.equal(status.state, 'online', JSON.stringify(status.problem));
  assert.equal(status.problem, null);
  assert.equal(status.localUrl, `http://127.0.0.1:${gamePort}/`);
  assert.equal(status.tunnel, 'off');
  assert.equal(status.game?.tracks, 2);
  assert.equal(status.game?.pal, false);

  const info = await (await fetch(`${status.localUrl}session-info`)).json() as Record<string, unknown> & { archive: { sha256: string; size: number } };
  assert.deepEqual(Object.keys(info), ['disc', 'pal', 'archive', 'discMode', 'roomCheck', 'core', 'adapter', 'native']);
  assert.deepEqual({ ...info, disc: null, archive: null }, { disc: null, pal: false, archive: null, discMode: 'shared', roomCheck: true,
    core: lock.files['cores/pcsx_rearmed-wasm.data'], adapter: 'pcsx-frame-gate-v3', native: nativeBuild.files });
  assert.match(String(info.disc), /^[a-f0-9]{64}$/);
  assert.equal(status.game?.archiveBytes, info.archive.size);

  const archive = Buffer.from(await (await fetch(`${status.localUrl}disc.zip`)).arrayBuffer());
  assert.equal(archive.length, info.archive.size);
  assert.equal(createHash('sha256').update(archive).digest('hex'), info.archive.sha256);
  assert.match(await (await fetch(String(status.localUrl))).text(), /Synthetic client/);

  // The relay answers the game origin only.
  const relay = new WebSocket(`ws://127.0.0.1:${netplayPort}`, { origin: `http://127.0.0.1:${gamePort}` });
  await once(relay, 'open');
  relay.send(JSON.stringify({ role: 'check', room: 'a'.repeat(24), token: 'b'.repeat(64) }));
  assert.equal((await once(relay, 'close'))[0], 1008);
  const foreign = new WebSocket(`ws://127.0.0.1:${netplayPort}`, { origin: 'http://127.0.0.1:1' });
  assert.match(String((await once(foreign, 'error'))[0]), /401/);

  // The gateway is up and asks for its access link.
  assert.ok(Number.isInteger(status.gatewayPort) && status.gatewayPort! > 0);
  assert.equal((await fetch(`http://127.0.0.1:${status.gatewayPort}/disc.zip`)).status, 401);

  assert.ok(!/[a-f0-9]{40,}/.test(JSON.stringify(host.status())), 'the status holds no credential');
  assert.ok(!lines.some(line => /[a-f0-9]{40,}/.test(line)), 'the log holds no credential');
  assert.ok(lines.length > 0);
});

test('a changed disc is reported to the host, once, and a new start recovers', async t => {
  const { host, folder, lines } = await service(t);
  const { localUrl } = await host.start();
  await appendFile(join(folder, 'Track 01.bin'), 'x');
  assert.equal((await fetch(`${localUrl}disc.zip`)).status, 503);
  assert.equal((await fetch(`${localUrl}disc.zip`, { method: 'HEAD' })).status, 503);
  assert.equal((await fetch(`${localUrl}disc.zip`)).status, 503);
  assert.equal(host.status().state, 'degraded');
  assert.deepEqual(host.status().problem, { component: 'game-data',
    message: 'The game files changed after they were prepared. Quit the server and open it again.' });
  assert.equal(lines.filter(line => line.includes('game files changed')).length, 1, 'logged once, not per request');
  assert.equal((await fetch(`${localUrl}session-info`)).status, 200, 'the rest of the game origin keeps working');

  const recovered = await host.start();
  assert.equal(recovered.state, 'online');
  assert.equal(recovered.problem, null);
  assert.equal((await fetch(`${localUrl}disc.zip`)).status, 200);
});

test('a busy game port fails the runtime and leaves nothing listening', async t => {
  const { host, gamePort, netplayPort } = await service(t);
  const holder = await hold(gamePort);
  t.after(() => holder.close());
  assert.deepEqual((await host.start()).problem, { component: 'runtime',
    message: `Port ${gamePort} is in use by another program. Sled Storm needs it for the local game page. Quit that program, then start the server again.` });
  assert.equal(host.status().state, 'failed');
  assert.equal(host.status().localUrl, null);
  assert.ok(holder.listening, 'the other program keeps its port');
  assert.ok(await refused(netplayPort));
});

test('a busy Netplay port releases the game port', async t => {
  const { host, gamePort, netplayPort } = await service(t);
  const holder = await hold(netplayPort);
  t.after(() => holder.close());
  assert.deepEqual((await host.start()).problem, { component: 'netplay',
    message: `Port ${netplayPort} is in use by another program. Sled Storm needs it for multiplayer. Quit that program, then start the server again.` });
  assert.ok(holder.listening);
  assert.ok(await refused(gamePort), 'the game port is released again');
});

test('concurrent starts share one stack, stop is idempotent and start works again', async t => {
  const { host, gamePort, netplayPort } = await service(t);
  const [first, second] = await Promise.all([host.start(), host.start()]);
  assert.equal(first.state, 'online');
  assert.equal(second.state, 'online');
  assert.equal((await host.start()).state, 'online', 'starting an online server changes nothing');

  await Promise.all([host.stop(), host.stop()]);
  await host.stop();
  assert.deepEqual(host.status(), { state: 'idle', problem: null, game: null, localUrl: null, gatewayPort: null, tunnel: 'off' });
  assert.ok(await refused(gamePort));
  assert.ok(await refused(netplayPort));

  assert.equal((await host.start()).state, 'online');
  assert.equal((await fetch(`http://127.0.0.1:${gamePort}/session-info`)).status, 200);
});

test('stop ends open game connections', async t => {
  const { host, gamePort, netplayPort } = await service(t);
  const status = await host.start();
  const relay = new WebSocket(`ws://127.0.0.1:${netplayPort}`, { origin: `http://127.0.0.1:${gamePort}` });
  await once(relay, 'open');
  const public_ = new WebSocket(`ws://127.0.0.1:${status.gatewayPort}/netplay`, { origin: `http://127.0.0.1:${status.gatewayPort}` });
  public_.on('error', () => {});
  const closed = once(relay, 'close');
  await Promise.race([host.stop(), new Promise((_resolve, reject) => setTimeout(() => reject(new Error('stop hung')), 5000).unref())]);
  await closed;
  assert.equal(host.status().state, 'idle');
});

test('a port that another program holds on all interfaces counts as busy', async t => {
  for (const address of ['0.0.0.0', '::']) {
    for (const component of ['runtime', 'netplay'] as const) {
      const { host, gamePort, netplayPort } = await service(t);
      const holder = createServer();
      holder.listen(component === 'runtime' ? gamePort : netplayPort, address);
      await once(holder, 'listening');
      t.after(() => holder.close());
      const status = await host.start();
      assert.equal(status.state, 'failed', `${component} on ${address}`);
      assert.equal(status.problem?.component, component);
      assert.match(String(status.problem?.message), /^Port \d+ is in use by another program\./);
      assert.ok(holder.listening);
      assert.ok(await refused(component === 'runtime' ? netplayPort : gamePort), 'the other port is not left listening');
    }
  }
});

test('stop interrupts a start instead of waiting for it', async t => {
  const { host, folder, gamePort, lines } = await service(t);
  // Two sparse gibibytes take seconds to hash twice.
  await truncate(join(folder, 'Track 01.bin'), 2 * 1024 ** 3);
  const starting = host.start();
  while (host.status().state !== 'preparing') await delay(5);
  await delay(50);
  const asked = performance.now();
  await host.stop();
  const waited = Math.round(performance.now() - asked);
  assert.ok(waited < 1000, `stop took ${waited} ms`);
  assert.equal((await starting).state, 'idle');
  assert.equal(host.status().state, 'idle');
  assert.ok(!lines.some(line => line.includes('is ready')), 'the interrupted start never came online');
  assert.ok(await refused(gamePort));
});

test('the last of interleaved start and stop requests wins', async t => {
  const { host, gamePort } = await service(t);
  assert.equal((await host.start()).state, 'online');

  const stopped = host.stop();
  const started = host.start();
  assert.equal((await started).state, 'online', 'stop, then start: the answer and the server agree');
  await stopped;
  assert.equal(host.status().state, 'online');
  assert.equal((await fetch(`http://127.0.0.1:${gamePort}/session-info`)).status, 200);

  await Promise.all([host.stop(), host.start(), host.stop()]);
  assert.equal(host.status().state, 'idle', 'stop, start, stop ends stopped');
  assert.ok(await refused(gamePort));

  const results = await Promise.all([host.start(), host.stop(), host.start()]);
  assert.equal(results[2].state, 'online', 'start, stop, start ends online');
  assert.equal(host.status().state, 'online');
});

test('the status handed out is a snapshot', async t => {
  const { host } = await service(t, { policy: null });
  const before = host.status();
  assert.throws(() => { (before as { state: string }).state = 'online'; });
  assert.equal(host.status().state, 'idle');
});

test('the gateway forwards authorized requests to the game origin and the relay', async t => {
  const token = 'f'.repeat(48);
  const { host } = await service(t, { accessToken: token });
  const status = await host.start();
  const gateway = `http://127.0.0.1:${status.gatewayPort}`;
  const cookie = `sled_access=${token}`;
  assert.equal((await fetch(`${gateway}/access/${token}`, { redirect: 'manual' })).status, 302);

  const info = await fetch(`${gateway}/session-info`, { headers: { cookie } });
  assert.equal(info.status, 200);
  assert.equal(info.headers.get('x-invite-path'), `/access/${token}`);
  const local = await (await fetch(`${status.localUrl}session-info`)).json() as { archive: { sha256: string } };
  assert.deepEqual(await info.json(), local);

  const archive = Buffer.from(await (await fetch(`${gateway}/disc.zip`, { headers: { cookie } })).arrayBuffer());
  assert.equal(createHash('sha256').update(archive).digest('hex'), local.archive.sha256);
  assert.equal((await fetch(`${gateway}/api/status`, { headers: { cookie } })).status, 403, 'only listed game paths pass');

  const socket = new WebSocket(`ws://127.0.0.1:${status.gatewayPort}/netplay`, { origin: gateway, headers: { cookie } });
  await once(socket, 'open');
  socket.send(JSON.stringify({ role: 'check', room: 'a'.repeat(24), token: 'b'.repeat(64) }));
  const [code, reason] = await once(socket, 'close');
  assert.equal(code, 1008);
  assert.match(String(reason), /no longer available/);
});

test('an unexpected file error is reported without the user\'s paths', async t => {
  const { host, folder, lines, paths } = await service(t);
  await chmod(join(folder, 'Game.cue'), 0o000);
  try {
    assert.deepEqual((await host.start()).problem, { component: 'game-data', message: 'The game files could not be read.' });
  } finally {
    await chmod(join(folder, 'Game.cue'), 0o600);
  }
  assert.ok(lines.some(line => line.includes('EACCES')), 'the log names the error code');
  assert.ok(!lines.some(line => line.includes(folder) || line.includes(paths.root)), 'the log names no folder');
});
