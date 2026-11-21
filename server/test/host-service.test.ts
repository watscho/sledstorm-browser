import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { appendFile, chmod, mkdir, readdir, readFile, rm, truncate, writeFile } from 'node:fs/promises';
import { connect, createServer, type AddressInfo, type Server } from 'node:net';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { writeConfig, type DiscPolicy } from '../src/config-store.ts';
import { createHostService, type HostService } from '../src/host-service.ts';
import { roomIdentity, type RoomIdentityInput } from '../src/network.ts';
import { identityKey } from '../../web/save-file.js';
import type { RoomTiming } from '../src/room.ts';
import { parseInvitation } from '../../web/invitation.js';
import type { TunnelOptions } from '../src/tunnel.ts';
import { lock, nativeBuild, scratchPaths, standInBrowser, validState, writeGame } from './fixtures.ts';

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

const fakeCloudflared = fileURLToPath(new URL('./fake-cloudflared.mjs', import.meta.url));

/** How a test wants its tunnels: none, the shipped program, or the scripted stand-in. */
type TunnelSetup = null | 'shipped' | { launches?: object[]; mirror?: object[]; probe?: TunnelOptions['probe']; timing?: TunnelOptions['timing'] };

async function until(description: string, done: () => boolean | Promise<boolean>, ms = 8000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!await done()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting until ${description}`);
    await delay(10);
  }
}

const gone = (pid: number) => {
  try { process.kill(pid, 0); return false; } catch { return true; }
};

/** How a test wants its emulator worker: none, the shipped browser, or the scripted stand-in. */
type WorkerSetup = null | 'shipped' | { launches?: object[]; graceMs?: number; program?: string; startupMs?: number; room?: Partial<RoomTiming> };

async function service(t: TestContext, { policy = 'shared-allowed' as DiscPolicy | null, accessToken = undefined as string | undefined,
  tunnel = null as TunnelSetup, worker = null as WorkerSetup } = {}) {
  const paths = await scratchPaths(t, 'host');
  const folder = await writeGame(join(paths.root, 'Игра folder'));
  if (policy) await writeConfig(paths, { version: 1, gameFolder: folder, discPolicy: policy });
  const gamePort = await freePort();
  const netplayPort = await freePort();
  const lines: string[] = [];
  const record = join(paths.root, 'tunnel-launches.jsonl');
  const tunnels = tunnel === null ? null : tunnel === 'shipped' ? undefined : {
    command: { command: process.execPath, args: [fakeCloudflared, '--script',
      JSON.stringify({ record, launches: tunnel.launches ?? [{}], mirror: tunnel.mirror })] },
    probe: tunnel.probe,
    timing: { readyMs: 2000, probeMs: 2000, pollMs: 20, lostMs: 200, restartDelaysMs: [30, 30], stableMs: 60_000, graceMs: 500,
      ...tunnel.timing },
  };
  const standIn = worker && worker !== 'shipped' ? await standInBrowser(paths.root, { netplayPort, launches: worker.launches }) : null;
  const host = createHostService({ paths, log: line => lines.push(line), gamePort, netplayPort, accessToken, tunnels,
    worker: worker === null ? null : standIn && worker !== 'shipped'
      ? { browser: worker.program ?? standIn.program, graceMs: worker.graceMs ?? 500, startupMs: worker.startupMs,
        room: { restartDelaysMs: [30, 30], ...worker.room } } : undefined });
  // Bounded: a stop that hangs is a failure to report, not a run to wait for.
  t.after(() => Promise.race([host.stop(), delay(10_000)]));
  const browserEvents = async () => standIn ? standIn.events() : [];
  const launches = async () => (await readFile(record, 'utf8').catch(() => '')).split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as { kind: 'primary' | 'mirror'; pid: number; args: string[] });
  return { paths, folder, gamePort, netplayPort, host, lines, launches, browserEvents };
}

test('an unconfigured server needs setup', async t => {
  const { host, gamePort } = await service(t, { policy: null });
  assert.deepEqual(host.status(), { state: 'idle', problem: null, game: null, localUrl: null, gatewayPort: null, tunnel: 'off', mirror: 'off', room: 'off' });
  assert.deepEqual(await host.start(), { state: 'needs_setup', game: null, localUrl: null, gatewayPort: null, tunnel: 'off', mirror: 'off', room: 'off',
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
  assert.deepEqual(host.status(), { state: 'idle', problem: null, game: null, localUrl: null, gatewayPort: null, tunnel: 'off', mirror: 'off', room: 'off' });
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

const token = 'f'.repeat(48);
const cookie = { cookie: `sled_access=${token}` };

test('a server with a tunnel comes online and hands out the private link', async t => {
  const { host, lines, gamePort, launches } = await service(t, { accessToken: token, tunnel: {} });
  const status = await host.start();
  assert.equal(status.state, 'online', JSON.stringify(status.problem));
  assert.equal(status.tunnel, 'online');
  await until('the mirror is online', () => host.status().mirror === 'online');
  const link = String(host.invitation());
  assert.match(link, new RegExp(`^https://synthetic-\\d+\\.trycloudflare\\.com/access/${token}$`));
  const info = await fetch(`http://127.0.0.1:${gamePort}/session-info`);
  assert.equal(`${info.headers.get('x-invite-origin')}${info.headers.get('x-invite-path')}`, link);
  for (const text of [JSON.stringify(host.status()), lines.join('\n')])
    assert.ok(!text.includes('trycloudflare') && !text.includes(token) && !/synthetic-\d+/.test(text), text);

  const [primary, mirror] = [(await launches()).find(launch => launch.kind === 'primary')!, (await launches()).find(launch => launch.kind === 'mirror')!];
  assert.deepEqual(primary.args.slice(0, 3), ['tunnel', '--url', `http://127.0.0.1:${status.gatewayPort}`]);
  assert.equal(primary.args[primary.args.indexOf('--protocol') + 1], 'auto');
  assert.notEqual(mirror.args[2], primary.args[2], 'the mirror exposes its own listener');
  assert.notEqual(mirror.args[2], `http://127.0.0.1:${gamePort}`);
});

test('the address is not handed out before the tunnel is online', async t => {
  let pass: (() => void) | undefined;
  const { host, gamePort } = await service(t, { tunnel: { probe: (_origin, signal) => new Promise<void>((resolve, reject) => {
    pass = resolve;
    signal.addEventListener('abort', () => reject(signal.reason));
  }) } });
  const starting = host.start();
  await until('the probe runs', () => pass !== undefined);
  assert.equal(host.status().state, 'starting');
  assert.equal(host.status().tunnel, 'starting');
  assert.equal(host.status().localUrl, `http://127.0.0.1:${gamePort}/`, 'the local page is already there');
  assert.equal(host.invitation(), null);
  const info = await fetch(`http://127.0.0.1:${gamePort}/session-info`);
  assert.equal(info.status, 200);
  assert.equal(info.headers.get('x-invite-origin'), null);
  pass!();
  assert.equal((await starting).state, 'online');
  assert.notEqual(host.invitation(), null);
});

test('a tunnel that fails leaves the local game working and the host degraded', async t => {
  const { host, gamePort } = await service(t, { tunnel: { launches: [{ neverReady: true }], timing: { readyMs: 150, restartDelaysMs: [] } } });
  const status = await host.start();
  assert.equal(status.state, 'degraded');
  assert.equal(status.tunnel, 'failed');
  assert.deepEqual(status.problem, { component: 'tunnel',
    message: 'The public address is not available. The game still works on this computer.' });
  assert.equal(host.invitation(), null);
  assert.equal((await fetch(`http://127.0.0.1:${gamePort}/session-info`)).status, 200);
});

test('a tunnel that dies gets a new address and the link changes', async t => {
  const { host } = await service(t, { accessToken: token, tunnel: { launches: [{ exitAfterMs: 500 }, {}] } });
  assert.equal((await host.start()).state, 'online');
  const first = host.invitation();
  const seen = new Set<string>();
  await until('a new link is handed out', () => {
    const link = host.invitation();
    seen.add(`${host.status().state}/${host.status().tunnel}/${link === null ? 'no link' : link === first ? 'first link' : 'new link'}`);
    return link !== null && link !== first;
  });
  assert.ok(seen.has('degraded/retrying/no link'), [...seen].join(', '));
  assert.ok(![...seen].some(entry => entry.startsWith('degraded') && !entry.endsWith('no link')), 'no link while the address is down');
  assert.equal(host.status().state, 'online');
  assert.equal(host.status().problem, null);
});

test('a mirror that cannot start does not hold up the host', async t => {
  const { host, launches } = await service(t, { accessToken: token, tunnel: { mirror: [{ exitAfterMs: 0 }], timing: { restartDelaysMs: [20] } } });
  const status = await host.start();
  assert.equal(status.state, 'online');
  await until('the mirror has been tried several times', async () => (await launches()).filter(launch => launch.kind === 'mirror').length >= 4);
  assert.equal(host.status().mirror, 'retrying', 'the mirror keeps trying, as the launcher did');
  assert.equal(host.status().state, 'online', 'the mirror never degrades the host');
  const info = await fetch(`http://127.0.0.1:${status.gatewayPort}/session-info`, { headers: cookie });
  assert.equal(info.status, 200);
  assert.equal(info.headers.get('x-sled-netplay-mirror-origin'), null);
});

test('the mirror address reaches the gateway only while the mirror is online', async t => {
  const { host } = await service(t, { accessToken: token, tunnel: {} });
  const status = await host.start();
  await until('the mirror is online', () => host.status().mirror === 'online');
  const info = await fetch(`http://127.0.0.1:${status.gatewayPort}/session-info`, { headers: cookie });
  const mirror = String(info.headers.get('x-sled-netplay-mirror-origin'));
  assert.match(mirror, /^https:\/\/synthetic-\d+\.trycloudflare\.com$/);
  assert.ok(!String(host.invitation()).startsWith(mirror), 'the mirror has an address of its own');
});

test('stop ends both tunnel programs', async t => {
  const { host, launches } = await service(t, { tunnel: {} });
  await host.start();
  await until('the mirror is online', () => host.status().mirror === 'online');
  const running = await launches();
  assert.deepEqual(running.map(launch => launch.kind).sort(), ['mirror', 'primary']);
  assert.ok(running.every(launch => !gone(launch.pid)));
  await host.stop();
  assert.ok(running.every(launch => gone(launch.pid)), 'no tunnel program outlives the server');
  assert.equal(host.status().tunnel, 'off');
  assert.equal(host.status().mirror, 'off');
  assert.equal(host.invitation(), null);
});

test('a build without the tunnel program says so', async t => {
  const { host, gamePort } = await service(t, { tunnel: 'shipped' });
  const status = await host.start();
  assert.equal(status.state, 'degraded');
  assert.equal(status.tunnel, 'failed');
  assert.deepEqual(status.problem, { component: 'tunnel', message: 'This build has no tunnel program.' });
  assert.equal((await fetch(`http://127.0.0.1:${gamePort}/session-info`)).status, 200);
});

test('a new start retries the public address and leaves the local game running', async t => {
  const { host, gamePort, netplayPort, launches } = await service(t, { tunnel: { launches: [{ neverReady: true }, {}],
    timing: { readyMs: 150, restartDelaysMs: [] } } });
  assert.equal((await host.start()).state, 'degraded');
  const player = new WebSocket(`ws://127.0.0.1:${netplayPort}`, { origin: `http://127.0.0.1:${gamePort}` });
  await once(player, 'open');
  let closed = false;
  player.once('close', () => { closed = true; });

  const status = await host.start();
  assert.equal(status.state, 'online');
  assert.equal(status.problem, null);
  assert.notEqual(host.invitation(), null);
  await delay(50);
  assert.equal(closed, false, 'the connection of a local player survives the retry');
  assert.equal((await launches()).filter(launch => launch.kind === 'primary').length, 2);
  player.terminate();
});

test('a mirror that fails at first comes back', async t => {
  const { host } = await service(t, { accessToken: token,
    tunnel: { mirror: [{ exitAfterMs: 0 }, { exitAfterMs: 0 }, { exitAfterMs: 0 }, {}], timing: { restartDelaysMs: [20] } } });
  const status = await host.start();
  assert.equal(status.state, 'online');
  await until('the mirror is online', () => host.status().mirror === 'online');
  const info = await fetch(`http://127.0.0.1:${status.gatewayPort}/session-info`, { headers: cookie });
  assert.match(String(info.headers.get('x-sled-netplay-mirror-origin')), /^https:\/\/synthetic-\d+\.trycloudflare\.com$/);
});

const OWN_ROOM = 'This server has one room. Open the game with its invitation link.';
const roomFailed = (reason: string) => `The room could not be started (${reason}). Quit the server and open it again.`;

/**
 * One connection to the relay from the game page's origin. `answer` resolves to the first answer, or to
 * why there was none; `inbox` keeps every answer that is text.
 */
function connectRoom(t: TestContext, { netplayPort, gamePort }: { netplayPort: number; gamePort: number }, request: object) {
  const socket = new WebSocket(`ws://127.0.0.1:${netplayPort}`, { origin: `http://127.0.0.1:${gamePort}` });
  t.after(() => socket.terminate());
  const inbox: Record<string, unknown>[] = [];
  socket.on('message', (data, binary) => { if (!binary) inbox.push(JSON.parse(String(data)) as Record<string, unknown>); });
  const closed = new Promise<string>(resolve => {
    socket.once('close', (_code, reason) => resolve(reason.toString()));
    socket.once('error', error => resolve(String(error)));
  });
  const answer = Promise.race([
    once(socket, 'message').then(([data]) => JSON.parse(String(data)) as Record<string, unknown>),
    closed.then(reason => ({ closed: reason }) as Record<string, unknown>),
  ]);
  socket.once('open', () => socket.send(JSON.stringify(request)));
  return { socket, answer, closed, inbox };
}

/**
 * What a player's page does with the server's link: it reads the room from it, works out its own
 * identity from the session info, and joins as a guest.
 */
async function joinRoom(t: TestContext, served: { host: HostService; netplayPort: number; gamePort: number }, change: object = {}) {
  const link = served.host.localInvitation();
  assert.ok(link, 'the server has a room');
  const { room, token, progress, camera, nativeCamera } = parseInvitation(new URL(link).hash);
  const info = await (await fetch(`http://127.0.0.1:${served.gamePort}/session-info`)).json() as RoomIdentityInput;
  const identity = await roomIdentity({ ...info, bios: 'HLE', options: { progress, camera, nativeCamera } });
  return { room, token, ...connectRoom(t, served, { role: 'guest', room, token, identity, ...change }) };
}

test('session info marks the host as dedicated, after the build identity', async t => {
  const { host } = await service(t, { worker: {} });
  const status = await host.start();
  assert.equal(status.state, 'online', JSON.stringify(status.problem));
  const info = await (await fetch(`${status.localUrl}session-info`)).json() as Record<string, unknown>;
  assert.deepEqual(Object.keys(info), ['disc', 'pal', 'archive', 'discMode', 'roomCheck', 'core', 'adapter', 'native', 'dedicated', 'serverRoom']);
  assert.equal(info.dedicated, true);
  // The page reads this to leave out what a player cannot do in a room that is the server's.
  assert.equal(info.serverRoom, true);
});

test('the room is open before any player, and the first one gets controller 1', { timeout: 20_000 }, async t => {
  const served = await service(t, { worker: {} });
  const { host, gamePort, paths, browserEvents } = served;
  const status = await host.start();
  assert.deepEqual({ state: status.state, room: status.room }, { state: 'online', room: 'open' }, JSON.stringify(status.problem));
  const [start, navigate] = await browserEvents();
  assert.equal(navigate!.url, `http://127.0.0.1:${gamePort}/`);
  assert.ok(start!.args.includes('--remote-debugging-pipe') && start!.args.includes('--use-mock-keychain'));
  assert.ok(start!.args.some(argument => argument.startsWith(`--user-data-dir=${paths.profileRoot}/`)), 'the profile is in the server\'s own place');
  const answer = await (await joinRoom(t, served)).answer;
  assert.deepEqual({ type: answer.type, slot: answer.slot, owner: answer.owner }, { type: 'ready', slot: 0, owner: true }, JSON.stringify(answer));
  assert.equal((await browserEvents()).filter(entry => entry.event === 'start').length, 1, 'a player starts no emulator');
});

test('the invitation names the server\'s room, and works on this computer without a public address', async t => {
  const { host, gamePort, lines } = await service(t, { worker: {} });
  assert.equal(host.localInvitation(), null, 'no room before the start');
  const status = await host.start();
  assert.equal(host.invitation(), null, 'no public address');
  const link = new URL(String(host.localInvitation()));
  assert.equal(link.origin + link.pathname, `http://127.0.0.1:${gamePort}/`);
  const invitation = parseInvitation(link.hash);
  // The synthetic disc is not the verified one, so the room has the original progression and no separate cameras.
  assert.deepEqual({ v: invitation.v, progress: invitation.progress, camera: invitation.camera, nativeCamera: invitation.nativeCamera },
    { v: 8, progress: 'original', camera: false, nativeCamera: undefined });
  assert.match(invitation.room, /^[a-f0-9]{24}$/);
  assert.match(invitation.token, /^[a-f0-9]{64}$/);
  for (const secret of [invitation.room, invitation.token, link.hash.slice(1)])
    assert.ok(!lines.join('\n').includes(secret) && !JSON.stringify(status).includes(secret), 'neither the log nor the status names the room');
  await host.stop();
  assert.equal(host.localInvitation(), null);
});

test('the public invitation carries the same room', { timeout: 20_000 }, async t => {
  const { host } = await service(t, { worker: {}, tunnel: {}, accessToken: 'a'.repeat(48) });
  assert.equal((await host.start()).state, 'online');
  const local = new URL(String(host.localInvitation()));
  const link = String(host.invitation());
  assert.match(link, /^https:\/\/synthetic-\d+\.trycloudflare\.com\/access\/a{48}#/);
  assert.equal(new URL(link).hash, local.hash);
});

test('a player cannot make the server start a room, and one whose game differs is not let in', { timeout: 20_000 }, async t => {
  const served = await service(t, { worker: {} });
  await served.host.start();
  const request = { role: 'create', room: randomBytes(12).toString('hex'), token: randomBytes(32).toString('hex'), identity: 'e'.repeat(64), progress: 'all' };
  assert.deepEqual(await connectRoom(t, served, request).answer, { closed: OWN_ROOM });
  assert.deepEqual(await connectRoom(t, served, { ...request, role: 'host' }).answer, { closed: OWN_ROOM });
  assert.deepEqual(await (await joinRoom(t, served, { identity: 'e'.repeat(64) })).answer, { closed: 'Disc, BIOS or emulator differs from the room' });
  assert.equal((await served.browserEvents()).filter(entry => entry.event === 'start').length, 1);
  assert.equal((await (await joinRoom(t, served)).answer).type, 'ready', 'the room is untouched');
});

test('stopping the host ends the room, its worker and the profile', { timeout: 20_000 }, async t => {
  const served = await service(t, { worker: {} });
  const { host, paths, browserEvents } = served;
  await host.start();
  const player = await joinRoom(t, served);
  assert.equal((await player.answer).type, 'ready');
  const [start] = await browserEvents();
  await host.stop();
  // No waiting here: the stop itself has waited.
  assert.ok(gone(start!.pid));
  assert.deepEqual(await readdir(paths.profileRoot), []);
  assert.equal(await player.closed, 'Dedicated server stopped');
  assert.equal(host.status().room, 'off');
});

test('stopping the host while the room starts leaves nothing, and is not taken for a failure', { timeout: 20_000 }, async t => {
  const { host, paths, lines, browserEvents } = await service(t, { worker: { launches: [{ silent: true }] } });
  const starting = host.start();
  await until('the browser runs', async () => (await browserEvents()).length === 1);
  assert.equal(host.status().state, 'starting');
  const [start] = await browserEvents();
  await host.stop();
  await starting;
  assert.ok(gone(start!.pid));
  assert.deepEqual(await readdir(paths.profileRoot), []);
  assert.ok(!lines.some(line => line.includes('could not start')), lines.join('\n'));
});

test('a lost emulator is followed by a new session in the same room', { timeout: 20_000 }, async t => {
  const served = await service(t, { worker: { launches: [{ exitAfterMs: 200 }, {}] } });
  const { host, lines, browserEvents } = served;
  assert.equal((await host.start()).room, 'open');
  const link = host.localInvitation();
  const first = await joinRoom(t, served);
  assert.equal((await first.answer).type, 'ready');
  // The player hears why, whichever of the worker's two connections the relay sees end first.
  assert.match(await first.closed, /^Dedicated emulator (stopped|disconnected)$/);
  await until('the second emulator runs', async () => (await browserEvents()).filter(entry => entry.event === 'start').length === 2);
  await until('the room is open again', () => host.status().state === 'online' && host.status().room === 'open');
  assert.ok(lines.some(line => /^The room ended \(Dedicated emulator (stopped|disconnected)\)/.test(line)), lines.join('\n'));
  assert.equal(host.localInvitation(), link, 'the invitation is the same');
  assert.equal((await (await joinRoom(t, served)).answer).slot, 0, 'a new session with four free controllers');
});

test('an emulator that cannot start leaves the host degraded with the room named, and the local page up', { timeout: 20_000 }, async t => {
  const scratchRoot = await scratchPaths(t, 'broken browser');
  const program = join(scratchRoot.root, 'not a program');
  await writeFile(program, 'This has the executable bit and nothing to execute.\n', { mode: 0o755 });
  const served = await service(t, { worker: { program } });
  const { host, lines, paths } = served;
  const starting = host.start();
  await until('the room has its name', () => host.localInvitation() !== null);
  const { room, token } = parseInvitation(new URL(String(host.localInvitation())).hash);
  const status = await starting;
  assert.deepEqual({ state: status.state, room: status.room, problem: status.problem },
    { state: 'degraded', room: 'failed', problem: { component: 'room', message: roomFailed('Could not start the dedicated emulator') } });
  assert.equal((await fetch(String(status.localUrl))).status, 200, 'the page is still served');
  assert.equal(lines.filter(line => line === 'Starting an emulator worker.').length, 3, 'one try and two more');
  assert.ok(lines.some(line => /^An emulator worker could not start: [A-Z]+$/.test(line)), lines.join('\n'));
  assert.ok(!lines.join('\n').includes(scratchRoot.root), 'the log names no path');
  assert.deepEqual(await readdir(paths.profileRoot), [], 'the failed starts left no profile');
  // A room that has given up is not handed out, and its guests are not told to wait for it.
  assert.equal(host.localInvitation(), null);
  assert.match(String((await connectRoom(t, served, { role: 'check', room, token }).answer).closed), /no longer available/);
});

test('a room whose first emulator fails opens with the next one', { timeout: 20_000 }, async t => {
  const served = await service(t, { worker: { launches: [{ failCommand: 'Page.navigate' }, {}] } });
  const status = await served.host.start();
  assert.deepEqual({ state: status.state, room: status.room, problem: status.problem }, { state: 'online', room: 'open', problem: null });
  assert.equal((await (await joinRoom(t, served)).answer).type, 'ready');
});

test('an emulator that never listens is given up within its deadline', { timeout: 20_000 }, async t => {
  // Long enough for the stand-in to be running when the deadline passes, so that there is a browser to end.
  const { host, paths, browserEvents } = await service(t, { worker: { launches: [{ neverConnect: true }], startupMs: 1200, room: { restartDelaysMs: [] } } });
  const asked = performance.now();
  const status = await host.start();
  assert.ok(performance.now() - asked < 5000, 'the deadline holds');
  assert.deepEqual({ state: status.state, room: status.room, message: status.problem?.message },
    { state: 'degraded', room: 'failed', message: roomFailed('Dedicated emulator did not start') });
  const [start] = await browserEvents();
  assert.ok(start, 'the browser had started');
  await until('its browser is gone', () => gone(start.pid));
  await until('its profile is removed', async () => (await readdir(paths.profileRoot)).length === 0);
});

test('a worker that ignores the stop is killed', { timeout: 20_000 }, async t => {
  const { host, paths, browserEvents } = await service(t, { worker: { launches: [{ ignoreTerm: true }], graceMs: 200 } });
  assert.equal((await host.start()).room, 'open');
  const [start] = await browserEvents();
  const asked = performance.now();
  await host.stop();
  assert.ok(performance.now() - asked < 3000, 'the stop is bounded');
  assert.ok(gone(start!.pid));
  assert.deepEqual(await readdir(paths.profileRoot), []);
});

test('a build without the browser cannot host', async t => {
  const { host, gamePort, netplayPort } = await service(t, { worker: 'shipped' });
  assert.deepEqual(await host.start(), { state: 'failed', game: null, localUrl: null, gatewayPort: null, tunnel: 'off', mirror: 'off', room: 'off',
    problem: { component: 'emulator', message: 'This build is missing the emulator browser.' } });
  assert.ok(await refused(gamePort) && await refused(netplayPort), 'nothing listens');
});

test('profiles left by a killed server are removed at the next start', async t => {
  const { host, paths } = await service(t, { worker: { launches: [{ silent: true }] } });
  await mkdir(join(paths.profileRoot, 'sled-netplay-stale', 'Default'), { recursive: true });
  await writeFile(join(paths.profileRoot, 'sled-netplay-stale', 'Default', 'Cookies'), 'left behind');
  void host.start();
  await until('the room is starting', () => host.status().state === 'starting' && host.status().localUrl !== null);
  assert.ok(!(await readdir(paths.profileRoot)).includes('sled-netplay-stale'));
});

test('an old profile that cannot be removed does not stop hosting', async t => {
  const { host, paths, lines } = await service(t, { worker: {} });
  const stuck = join(paths.profileRoot, 'sled-netplay-stale', 'Default');
  await mkdir(stuck, { recursive: true });
  await writeFile(join(stuck, 'Cookies'), 'left behind');
  await chmod(stuck, 0o500);
  try {
    const status = await host.start();
    assert.equal(status.state, 'online', JSON.stringify(status.problem));
    assert.ok(lines.some(line => /^Old browser profiles could not be removed: [A-Z]+$/.test(line)), lines.join('\n'));
  } finally {
    await chmod(stuck, 0o700);
  }
});

test('a new session still starts after the profile folder was cleared away', { timeout: 20_000 }, async t => {
  const served = await service(t, { worker: { launches: [{ exitAfterMs: 400 }, {}] } });
  const { host, paths, browserEvents } = served;
  assert.equal((await host.start()).room, 'open');
  await rm(paths.profileRoot, { recursive: true, force: true, maxRetries: 3 });
  await until('the second emulator runs', async () => (await browserEvents()).filter(entry => entry.event === 'start').length === 2);
  await until('the room is open again', () => host.status().room === 'open');
  assert.equal((await (await joinRoom(t, served)).answer).type, 'ready');
});

test('profiles left by a killed server are removed even when hosting cannot start', async t => {
  const { host, paths } = await service(t, { policy: null, worker: {} });
  await mkdir(join(paths.profileRoot, 'sled-netplay-stale', 'Default'), { recursive: true });
  await writeFile(join(paths.profileRoot, 'sled-netplay-stale', 'Default', 'Cookies'), 'left behind');
  assert.equal((await host.start()).state, 'needs_setup');
  assert.deepEqual(await readdir(paths.profileRoot), []);
});

test('an emulator that outlives its session does not take the next session with it', { timeout: 30_000 }, async t => {
  // The first browser never listens and ignores its stop, so it is killed long after the next session has opened.
  // The startup deadline is the same for the healthy second browser, so it is generous enough for a busy machine.
  const served = await service(t, { worker: { launches: [{ neverListen: true, ignoreTerm: true }, {}], startupMs: 1500, graceMs: 3000,
    room: { restartDelaysMs: [100] } } });
  const { host, browserEvents } = served;
  assert.equal((await host.start()).room, 'open');
  const starts = (await browserEvents()).filter(entry => entry.event === 'start');
  assert.equal(starts.length, 2);
  assert.ok(!gone(starts[0]!.pid), 'the old browser is still there when the new session opens');
  await until('the old browser is killed', () => gone(starts[0]!.pid));
  await delay(100);
  assert.deepEqual({ state: host.status().state, room: host.status().room }, { state: 'online', room: 'open' });
  assert.equal((await (await joinRoom(t, served)).answer).type, 'ready', 'the room can be joined');
  assert.ok(await Promise.race([host.stop().then(() => true), delay(4000).then(() => false)]), 'the stop returns');
  assert.ok(gone(starts[1]!.pid));
});

type Served = Awaited<ReturnType<typeof service>>;
const NOT_STARTED = 'The saved game could not be started. The room is unchanged.';
const starts = async (served: Served) => (await served.browserEvents()).filter(entry => entry.event === 'start');

/** One player, seated, synchronized and alone, as a page is once its game runs: the owner of the room. */
async function soloPlayer(t: TestContext, served: Served) {
  const player = await joinRoom(t, served, { roster: true });
  const ready = await player.answer as { type?: string; slot: number; seatKey: string; restore?: boolean };
  assert.equal(ready.type, 'ready', JSON.stringify(ready));
  player.socket.send('{"type":"synchronized"}');
  await until('the player is connected', () => player.inbox.some(message => message.type === 'roster'
    && (message.seats as { status: string }[])[ready.slot]?.status === 'connected'));
  return { ...player, ready };
}

/**
 * Loads a save as that player, as the page does: on a connection of its own, with the identity key of
 * its save library, worked out from the session info, and the save itself once the room asks for it.
 */
async function loadSave(t: TestContext, served: Served, player: { room: string; token: string; ready: { seatKey: string } }, state: Buffer) {
  const info = await (await fetch(`http://127.0.0.1:${served.gamePort}/session-info`)).json() as { disc: string; core: string; adapter: string };
  const save = identityKey({ disc: info.disc, core: info.core, adapter: info.adapter, bios: 'hle' }) as string;
  const request = connectRoom(t, served, { role: 'restore', room: player.room, token: player.token, seatKey: player.ready.seatKey, save });
  void request.answer.then(answer => { if (answer.type === 'restore' && answer.state === 'send') request.socket.send(state); });
  return { ...request, save, disc: info.disc };
}

test('a player alone loads a save through the host: two emulators run for a moment, one remains, and the links are the same', { timeout: 30_000 }, async t => {
  const served = await service(t, { worker: { launches: [{}, { listenAfterMs: 3000 }] }, tunnel: {}, accessToken: 'a'.repeat(48) });
  const { host, lines, paths, browserEvents } = served;
  assert.deepEqual({ state: (await host.start()).state, room: host.status().room }, { state: 'online', room: 'open' });
  const links = { url: host.invitation(), localUrl: host.localInvitation() };
  assert.ok(links.url && links.localUrl);
  const player = await soloPlayer(t, served);
  assert.equal(player.ready.restore, true, 'the room says that it loads saves');

  const state = validState();
  const request = await loadSave(t, served, player, state);
  await until('the second emulator is started', async () => (await starts(served)).length === 2);
  await until('the room says that it starts', () => request.inbox.some(message => message.state === 'starting'));
  const [first, second] = await starts(served);
  assert.ok(!gone(first!.pid) && !gone(second!.pid), 'the emulator that runs keeps the room until the new one listens');
  assert.deepEqual({ state: host.status().state, room: host.status().room, problem: host.status().problem },
    { state: 'online', room: 'restoring', problem: null });
  assert.deepEqual({ url: host.invitation(), localUrl: host.localInvitation() }, links);
  assert.equal(player.socket.readyState, WebSocket.OPEN, 'the game goes on until then');

  assert.equal(await request.closed, 'Saved game loaded');
  assert.deepEqual(request.inbox.map(message => message.state), ['send', 'starting', 'done']);
  assert.equal(await player.closed, 'Saved game loaded');
  await until('the first emulator is gone', () => gone(first!.pid));
  await until('its profile is removed', async () => (await readdir(paths.profileRoot)).length === 1);
  assert.ok(!gone(second!.pid));
  const text = state.toString('base64');
  assert.deepEqual((await browserEvents()).filter(entry => entry.event === 'navigate').map(entry => entry.setup.snapshot),
    [undefined, { length: text.length, sha256: createHash('sha256').update(text).digest('hex') }], 'only the second emulator starts with the save');
  // Until its player is back the room takes nobody else, and it is the same room under the same links.
  assert.deepEqual({ state: host.status().state, room: host.status().room }, { state: 'online', room: 'restoring' });
  assert.deepEqual({ url: host.invitation(), localUrl: host.localInvitation() }, links);
  assert.deepEqual(await (await joinRoom(t, served)).answer, { closed: 'The room is loading a saved game. Try again in a moment.' });

  const back = await (await joinRoom(t, served, { previousSeatKey: player.ready.seatKey, roster: true })).answer;
  assert.deepEqual({ type: back.type, slot: back.slot, owner: back.owner, seatKey: back.seatKey },
    { type: 'ready', slot: 0, owner: true, seatKey: player.ready.seatKey }, JSON.stringify(back));
  assert.deepEqual({ state: host.status().state, room: host.status().room }, { state: 'online', room: 'open' });
  assert.deepEqual({ url: host.invitation(), localUrl: host.localInvitation() }, links);
  assert.equal((await starts(served)).length, 2, 'one emulator for the room and one for the save');
  assert.equal(lines.filter(line => line === 'The room is open.').length, 1, 'the room never ended');
  assert.deepEqual(lines.filter(line => /saved game/.test(line)), ['The room is loading a saved game.', 'The load of the saved game is over.']);
  assert.equal((await (await joinRoom(t, served)).answer).slot, 1, 'and others can join again');
});

test('a save that cannot start leaves the room open and the host online', { timeout: 30_000 }, async t => {
  const served = await service(t, { worker: { launches: [{}, { failCommand: 'Page.navigate' }] } });
  const { host, lines, paths } = served;
  assert.equal((await host.start()).room, 'open');
  const link = host.localInvitation();
  const player = await soloPlayer(t, served);
  const request = await loadSave(t, served, player, validState());
  assert.equal(await request.closed, NOT_STARTED);
  assert.deepEqual({ state: host.status().state, room: host.status().room, problem: host.status().problem },
    { state: 'online', room: 'open', problem: null });
  assert.equal(host.localInvitation(), link);
  const [first, second] = await starts(served);
  assert.ok(second, 'the emulator for the save was tried');
  await until('the emulator that could not start is gone', () => gone(second.pid));
  await until('and its profile with it', async () => (await readdir(paths.profileRoot)).length === 1);
  assert.ok(!gone(first!.pid), 'the emulator that runs is untouched');
  assert.equal(player.socket.readyState, WebSocket.OPEN, 'the player is still in the game');
  assert.deepEqual(lines.filter(line => /^The (room|load) /.test(line)), ['The room is open.', 'The room is loading a saved game.', 'The load of the saved game is over.']);
  assert.ok(lines.some(line => line.startsWith('An emulator worker could not start: ')), lines.join('\n'));
  assert.equal((await (await joinRoom(t, served)).answer).slot, 1, 'the room takes other players as before');
});

test('the status of a room that is loading a save names no room and no key', { timeout: 30_000 }, async t => {
  const served = await service(t, { worker: {} });
  const { host, lines, browserEvents } = served;
  await host.start();
  const player = await soloPlayer(t, served);
  const state = validState();
  // Marked, so that a piece of the save would be recognized anywhere.
  randomBytes(64).copy(state, 1024);
  const request = await loadSave(t, served, player, state);
  assert.equal(await request.closed, 'Saved game loaded');
  const status = host.status();
  assert.deepEqual(status, { ...status, state: 'online', room: 'restoring', problem: null });
  const keys = (await browserEvents()).filter(entry => entry.event === 'navigate').map(entry => entry.setup.workerKey);
  assert.equal(keys.length, 2);
  const secrets = [player.room, player.token, player.ready.seatKey, request.save, request.disc, ...keys,
    state.subarray(1024, 1088).toString('base64').slice(4, 60)];
  for (const secret of secrets)
    assert.ok(!lines.join('\n').includes(secret) && !JSON.stringify(status).includes(secret), 'neither the log nor the status names it');
});

test('a new start while a save is loading does not wait for the load to end', { timeout: 30_000 }, async t => {
  const served = await service(t, { worker: {}, tunnel: { launches: [{ neverReady: true }, {}], timing: { readyMs: 150, restartDelaysMs: [] } } });
  const { host } = served;
  assert.equal((await host.start()).problem?.component, 'tunnel');
  const player = await soloPlayer(t, served);
  const request = await loadSave(t, served, player, validState());
  assert.equal(await request.closed, 'Saved game loaded');
  assert.deepEqual({ state: host.status().state, room: host.status().room }, { state: 'degraded', room: 'restoring' });
  // The player of the load stays away, so the room is restoring for as long as its controller is kept.
  const asked = performance.now();
  const status = await host.start();
  assert.ok(performance.now() - asked < 10_000, 'the retry of the public address is all that is waited for');
  assert.deepEqual({ state: status.state, room: status.room, problem: status.problem }, { state: 'online', room: 'restoring', problem: null });
});
