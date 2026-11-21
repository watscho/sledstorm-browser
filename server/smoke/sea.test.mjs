// Runs the built single executable, not the sources. Build it first with
// `npm run build:sea --prefix server`. Every run uses a private home directory,
// an empty search path and a read-only copy of the bundle in a directory whose
// name has spaces and non-ASCII characters.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { cp, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { parseInvitation } from '../../web/invitation.js';
import { roomIdentity } from '../../web/room-identity.js';
import { identityKey } from '../../web/save-file.js';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const built = fileURLToPath(new URL('../../dist/sea/', import.meta.url));
const lock = JSON.parse(await readFile(new URL('../toolchain.lock.json', import.meta.url), 'utf8'));
const copy = { recursive: true, mode: constants.COPYFILE_FICLONE };
const fakeCloudflared = fileURLToPath(new URL('../test/fake-cloudflared.mjs', import.meta.url));
const fakeBrowser = fileURLToPath(new URL('../../research/network/fake-browser.mjs', import.meta.url));

await stat(join(built, 'SledStormServer')).catch(() => {
  throw new Error('The single executable is missing. Run: npm run build:sea --prefix server');
});

async function listing(root) {
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    const { size, mtimeMs } = await stat(path);
    files.push(`${relative(root, path)} ${size} ${mtimeMs}`);
  }
  return files.sort();
}

/** Stub emulator files: enough for the server to host, never a real emulator. */
async function syntheticEmulator(resources) {
  const emulator = join(resources, 'emulator');
  await mkdir(join(emulator, 'emulatorjs', 'cores'), { recursive: true });
  await writeFile(join(emulator, 'emulator.lock.json'),
    JSON.stringify({ files: { 'loader.js': 'a'.repeat(64), 'cores/pcsx_rearmed-wasm.data': 'b'.repeat(64) } }));
  await writeFile(join(emulator, 'native-build.json'), JSON.stringify({ files: { 'core.wasm': 'c'.repeat(64) } }));
  await writeFile(join(emulator, 'network-core.data'), 'synthetic core');
  await writeFile(join(emulator, 'emulatorjs', 'loader.js'), '// synthetic loader\n');
  await writeFile(join(emulator, 'emulatorjs', 'cores', 'pcsx_rearmed-wasm.data'), 'synthetic archive');
}

/** A CUE and two tracks of random bytes. */
async function syntheticDisc(folder) {
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'Track 01.bin'), randomBytes(70_000));
  await writeFile(join(folder, 'Трек 02.bin'), randomBytes(30_000));
  await writeFile(join(folder, 'Game.cue'), 'FILE "Track 01.bin" BINARY\n  TRACK 01 MODE2/2352\nFILE "Трек 02.bin" BINARY\n  TRACK 02 AUDIO\n');
  return folder;
}

async function freePort() {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address();
  server.close();
  await once(server, 'close');
  return port;
}

const refused = port => new Promise(resolve => {
  const socket = connect(port, '127.0.0.1');
  socket.once('connect', () => {
    socket.destroy();
    resolve(false);
  });
  socket.once('error', () => resolve(true));
});

async function stage(layout, { emulator = false, tunnel = 'none', browser = emulator ? 'fake' : 'none' } = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'sled smoke тест 雪 ')));
  const home = join(root, 'home folder');
  const cwd = join(root, 'elsewhere');
  const temp = join(root, 'temporary');
  for (const directory of [home, cwd, temp]) await mkdir(directory);
  let bundle, executable, resources;
  if (layout === 'application') {
    bundle = join(root, 'Sled Storm Server.app');
    executable = join(bundle, 'Contents', 'MacOS', 'SledStormServer');
    resources = join(bundle, 'Contents', 'Resources');
    await mkdir(join(bundle, 'Contents', 'MacOS'), { recursive: true });
    await cp(join(built, 'SledStormServer'), executable, copy);
    await cp(join(built, 'resources'), resources, copy);
  } else {
    bundle = join(root, 'bundle');
    executable = join(bundle, 'SledStormServer');
    resources = join(bundle, 'resources');
    await cp(built, bundle, copy);
  }
  // A staged copy keeps nothing that the build took from this checkout or from the network. The tests
  // bring stand-ins: no smoke test may run a real emulator, open a real tunnel or run a page in a real browser.
  await rm(join(resources, 'emulator'), { recursive: true, force: true });
  if (emulator) await syntheticEmulator(resources);
  await rm(join(resources, 'bin'), { recursive: true, force: true });
  await rm(join(resources, 'chromium'), { recursive: true, force: true });
  const browserScript = join(root, 'browser-script.json');
  const browserRecord = join(root, 'browser-launches.jsonl');
  if (browser === 'fake') {
    const program = join(resources, 'chromium', 'Chromium.app', 'Contents', 'MacOS');
    await mkdir(program, { recursive: true });
    await writeFile(join(program, 'Chromium'),
      `#!/bin/sh\nexec '${process.execPath}' '${fakeBrowser}' --script-file '${browserScript}' "$@"\n`, { mode: 0o755 });
    // The stand-in plays the room's worker; it takes the relay's port from the server's environment.
    await writeFile(browserScript, JSON.stringify({ record: browserRecord }));
  }
  const record = join(root, 'tunnel-launches.jsonl');
  if (tunnel === 'fake') {
    await mkdir(join(resources, 'bin'));
    await writeFile(join(resources, 'bin', 'cloudflared'),
      `#!/bin/sh\nexec '${process.execPath}' '${fakeCloudflared}' --script '${JSON.stringify({ record, launches: [{}] })}' "$@"\n`, { mode: 0o755 });
  }
  await run('chmod', ['-R', 'a-w', bundle]);
  const before = await listing(bundle);
  // No Node.js, npm, Python or Git can be found through this search path.
  const env = { HOME: home, TMPDIR: temp, PATH: join(root, 'no such directory'), SLED_SERVER_NO_BROWSER: '1' };
  // The stand-in's address does not exist, so the public probe is switched off with it.
  if (tunnel === 'fake') env.SLED_SERVER_TUNNEL_PROBE = 'off';
  const tunnelPrograms = async () => (await readFile(record, 'utf8').catch(() => '')).split('\n').filter(Boolean)
    .map(line => JSON.parse(line).pid);
  /** What the stand-in browser does; it reads this when it is started. */
  const browserPlan = plan => writeFile(browserScript, JSON.stringify({ record: browserRecord, ...plan }));
  const browserLaunches = async () => (await readFile(browserRecord, 'utf8').catch(() => '')).split('\n').filter(Boolean)
    .map(line => JSON.parse(line));
  const command = async (...args) => JSON.parse((await run(executable, args, { cwd, env })).stdout);
  /** Polls until the host reaches one of the given states. */
  const hostState = async (...states) => {
    for (let attempt = 0; attempt < 100; attempt++) {
      const status = await command('status');
      if (states.includes(status.host?.state)) return status;
      await delay(100);
    }
    throw new Error(`The host never reached ${states.join(' or ')}`);
  };
  return {
    root, home, cwd, temp, executable, resources, env, command, hostState, tunnelPrograms, browserPlan, browserLaunches,
    async unchanged() {
      assert.deepEqual(await listing(bundle), before, 'the bundle must stay untouched');
      assert.deepEqual(await readdir(cwd), [], 'nothing may be written to the working directory');
    },
    async remove() {
      await run('chmod', ['-R', 'u+w', root]);
      await rm(root, { recursive: true, force: true });
    },
  };
}

const alive = pid => {
  try { process.kill(pid, 0); return true; } catch { return false; }
};

async function untilGone(pid) {
  for (let attempt = 0; alive(pid) && attempt < 100; attempt++) await delay(50);
  assert.ok(!alive(pid), `process ${pid} must be gone`);
}

// ps escapes non-ASCII bytes, so servers are matched by the random ASCII suffix
// of their staging directory instead of the whole path.
async function servers({ root }) {
  const { stdout } = await run('/bin/ps', ['-axwwo', 'pid=,command=']);
  return stdout.split('\n').filter(line => line.includes(root.slice(-6)) && line.endsWith('SledStormServer serve'))
    .map(line => Number.parseInt(line, 10));
}

for (const layout of ['bare', 'application']) {
  test(`SEA-01 to SEA-03: the ${layout} executable passes its self-test without a toolchain`, async () => {
    const staged = await stage(layout);
    try {
      const report = await staged.command('self-test');
      assert.equal(report.ok, true, JSON.stringify(report.checks.filter(check => !check.ok), null, 2));
      assert.equal(report.sea, true, 'this must be the single executable, not a Node.js script');
      assert.equal(report.node, lock.node.version);
      assert.equal(report.execPath, staged.executable);
      assert.equal(report.cwd, staged.cwd);
      assert.equal(report.searchPath, staged.env.PATH);
      assert.deepEqual(report.checks.map(check => check.name),
        ['resources', 'writable-roots', 'http', 'netplay-relay', 'forced-stop']);
      const detail = name => report.checks.find(check => check.name === name).detail;
      assert.equal(detail('resources').resourceRoot, staged.resources);
      const roots = detail('writable-roots');
      for (const root of [roots.dataRoot, roots.cacheRoot, roots.logRoot])
        assert.ok(root.startsWith(join(staged.home, 'Library')), root);
      assert.equal(await realpath(roots.tempRoot), staged.temp);
      await staged.unchanged();
    } finally {
      await staged.remove();
    }
  });
}

test('launch starts one detached server, a second launch reuses it, quit stops it', async () => {
  const staged = await stage('application');
  let pid;
  try {
    const first = await staged.command();
    pid = first.pid;
    assert.equal(first.event, 'started');
    assert.match(first.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);

    // A real HTTP exchange between this process and the executable.
    const page = await fetch(first.url);
    assert.equal(page.status, 200);
    assert.match(await page.text(), /Sled Storm Server/);
    assert.equal((await fetch(new URL('/api/status', first.url))).status, 401, 'the API needs the credential');

    const status = await staged.command('status');
    assert.equal(status.running, true);
    assert.equal(status.pid, pid);
    assert.equal(status.url, first.url);

    const second = await staged.command();
    assert.deepEqual(second, { event: 'reused', pid, url: first.url });
    assert.deepEqual(await servers(staged), [pid]);

    const data = join(staged.home, 'Library', 'Application Support', 'Sled Storm Server');
    assert.equal((await stat(join(data, 'instance.json'))).mode & 0o777, 0o600);
    const log = await readFile(join(staged.home, 'Library', 'Logs', 'Sled Storm Server', 'server.log'), 'utf8');
    const { token } = JSON.parse(await readFile(join(data, 'instance.json'), 'utf8'));
    assert.ok(!log.includes(token), 'the credential must not be logged');

    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
    await untilGone(pid);
    await assert.rejects(stat(join(data, 'instance.json')), 'the record is removed on a clean stop');
    assert.deepEqual(await staged.command('status'), { running: false });
    assert.deepEqual(await staged.command('quit'), { event: 'not-running' }, 'a repeated quit is harmless');
    await staged.unchanged();
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('concurrent launches end with exactly one server', async () => {
  const staged = await stage('bare');
  let pid;
  try {
    const results = await Promise.all(Array.from({ length: 6 }, () => staged.command()));
    pid = results[0].pid;
    assert.deepEqual([...new Set(results.map(result => result.pid))], [pid]);
    assert.equal(results.filter(result => result.event === 'started').length, 1);
    await delay(300);
    assert.deepEqual(await servers(staged), [pid], 'the losing servers have exited');
    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
    await untilGone(pid);
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('a crashed server is not trusted from its record, and SIGTERM stops a server cleanly', async () => {
  const staged = await stage('bare');
  let pid;
  try {
    const crashed = await staged.command();
    process.kill(crashed.pid, 'SIGKILL');
    await untilGone(crashed.pid);
    const record = join(staged.home, 'Library', 'Application Support', 'Sled Storm Server', 'instance.json');
    assert.equal(JSON.parse(await readFile(record, 'utf8')).pid, crashed.pid, 'the crash left a stale record');
    assert.deepEqual(await staged.command('status'), { running: false });

    const replacement = await staged.command();
    pid = replacement.pid;
    assert.equal(replacement.event, 'started');
    assert.notEqual(pid, crashed.pid);
    assert.equal(JSON.parse(await readFile(record, 'utf8')).pid, pid);

    process.kill(pid, 'SIGTERM');
    await untilGone(pid);
    await assert.rejects(stat(record), 'SIGTERM removes the record like a quit request');
    await staged.unchanged();
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('the bundle carries the web client and no test files', async () => {
  const files = await readdir(join(built, 'resources', 'web'), { recursive: true });
  for (const name of ['index.html', 'app.js', 'style.css', join('shaders', 'crt-lottes.glsl')])
    assert.ok(files.includes(name), name);
  assert.deepEqual(files.filter(name => name.endsWith('.test.mjs') || name.endsWith('.fixtures.json')), []);
  assert.ok(files.includes('room-identity.js'));
});

test('an unconfigured server reports that it needs setup', async () => {
  const staged = await stage('application');
  let pid;
  try {
    ({ pid } = await staged.command());
    const { host } = await staged.hostState('needs_setup', 'failed', 'online');
    assert.equal(host.state, 'needs_setup');
    assert.equal(host.problem.component, 'config');
    assert.equal(host.localUrl, null);
    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('a configured server serves the game origin from the user\'s folder', async () => {
  const staged = await stage('application', { emulator: true, tunnel: 'fake' });
  let pid;
  try {
    const folder = await syntheticDisc(join(staged.root, 'My Games', 'Sled Storm диск'));
    const gamePort = await freePort();
    const netplayPort = await freePort();
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(gamePort), SLED_SERVER_NETPLAY_PORT: String(netplayPort) });
    assert.deepEqual(await staged.command('configure', '--game-folder', folder, '--disc-policy', 'shared-allowed'),
      { event: 'configured', gameFolder: folder, discPolicy: 'shared-allowed', tracks: 2, restartRequired: false });

    ({ pid } = await staged.command());
    const { host } = await staged.hostState('online', 'failed', 'needs_setup');
    assert.equal(host.state, 'online', JSON.stringify(host.problem));
    const origin = `http://127.0.0.1:${gamePort}`;
    assert.equal(host.localUrl, `${origin}/`);
    assert.deepEqual(host.game, { pal: false, archiveBytes: host.game.archiveBytes, tracks: 2 });
    assert.equal(host.tunnel, 'online');

    assert.equal(host.room, 'open', 'the room is there before any player');
    // The private links leave the server through the authorized command only.
    const { url, localUrl } = await staged.command('invitation');
    const [, access, fragment] = /^https:\/\/synthetic-\d+\.trycloudflare\.com\/access\/([a-f0-9]{48})#([A-Za-z0-9+/=]+)$/.exec(url);
    assert.equal(localUrl, `${origin}/#${fragment}`, 'the same room, on this computer');
    const serverLog = await readFile(join(staged.home, 'Library', 'Logs', 'Sled Storm Server', 'server.log'), 'utf8');
    for (const secret of ['trycloudflare', access, fragment])
      assert.ok(!serverLog.includes(secret) && !JSON.stringify(host).includes(secret), 'neither the log nor the status holds a part of the link');

    const page = await fetch(host.localUrl);
    assert.equal(page.status, 200);
    assert.equal(page.headers.get('cross-origin-opener-policy'), 'same-origin');
    assert.equal(page.headers.get('cross-origin-embedder-policy'), 'require-corp');
    assert.match(await page.text(), /<script type="module" src="\/app\.js/);
    assert.equal((await fetch(`${origin}/app.js?v=1`)).headers.get('content-type'), 'text/javascript; charset=utf-8');

    const info = await (await fetch(`${origin}/session-info`)).json();
    assert.equal(info.discMode, 'shared');
    assert.equal(info.archive.size, host.game.archiveBytes);
    const archive = Buffer.from(await (await fetch(`${origin}/disc.zip`)).arrayBuffer());
    assert.equal(createHash('sha256').update(archive).digest('hex'), info.archive.sha256);
    assert.equal((await fetch(`http://127.0.0.1:${host.gatewayPort}/session-info`)).status, 401, 'the gateway wants its access link');

    const cache = join(staged.home, 'Library', 'Caches', 'Sled Storm Server', 'game-data');
    assert.deepEqual(await readdir(cache), ['archive.json'], 'the cache holds a stamp, not a copy of the disc');
    assert.ok((await stat(join(cache, 'archive.json'))).size < 4096);

    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
    await untilGone(pid);
    assert.ok(await refused(gamePort) && await refused(netplayPort), 'both ports are free again');
    await staged.unchanged();
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('a build without the emulator says so instead of hosting', async () => {
  const staged = await stage('bare');
  let pid;
  try {
    const folder = await syntheticDisc(join(staged.root, 'game'));
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(await freePort()), SLED_SERVER_NETPLAY_PORT: String(await freePort()) });
    await staged.command('configure', '--game-folder', folder, '--disc-policy', 'shared-allowed');
    ({ pid } = await staged.command());
    const { host } = await staged.hostState('online', 'failed', 'needs_setup');
    assert.equal(host.state, 'failed');
    assert.equal(host.problem.component, 'emulator');
    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('a build with the emulator but without its browser says so instead of hosting', async () => {
  const staged = await stage('application', { emulator: true, browser: 'none' });
  let pid;
  try {
    const gamePort = await freePort();
    const netplayPort = await freePort();
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(gamePort), SLED_SERVER_NETPLAY_PORT: String(netplayPort) });
    await staged.command('configure', '--game-folder', await syntheticDisc(join(staged.root, 'game')), '--disc-policy', 'shared-allowed');
    ({ pid } = await staged.command());
    const { host } = await staged.hostState('online', 'degraded', 'failed', 'needs_setup');
    assert.equal(host.state, 'failed');
    assert.deepEqual(host.problem, { component: 'emulator', message: 'This build is missing the emulator browser.' });
    assert.ok(await refused(gamePort) && await refused(netplayPort), 'nothing listens');
    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('the bundle carries the pinned cloudflared', async () => {
  const program = join(built, 'resources', 'bin', 'cloudflared');
  assert.ok((await stat(program)).mode & 0o111, 'the tunnel program is executable');
  const pin = lock.cloudflared.archives['darwin-arm64'];
  assert.equal(createHash('sha256').update(await readFile(program)).digest('hex'), pin.binarySha256);
  assert.ok((await run(program, ['--version'])).stdout.includes(lock.cloudflared.version));
  const manifest = JSON.parse(await readFile(join(built, 'resources', 'runtime-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.cloudflared, { version: lock.cloudflared.version, archiveSha256: pin.sha256, binarySha256: pin.binarySha256 });
});

test('the bundle carries the pinned Chromium', async () => {
  const pin = lock.chromium.archives['darwin-arm64'];
  const application = join(built, 'resources', 'chromium', 'Chromium.app');
  const executable = join(application, pin.executable);
  // The browser is not run here, not even for its version: the fetch step did that once, before it wrote
  // the stamp that the manifest repeats.
  assert.ok((await stat(executable)).mode & 0o111, 'the browser is executable');
  const manifest = JSON.parse(await readFile(join(built, 'resources', 'runtime-manifest.json'), 'utf8'));
  assert.deepEqual(manifest.chromium, { version: lock.chromium.version, position: pin.position, commit: pin.commit,
    archiveSha256: pin.sha256, executableSha256: pin.executableSha256, frameworkSha256: pin.frameworkSha256 });
  // The launcher is a small stub and the framework holds the browser; the staged copies are the pinned ones.
  const sha256 = async path => {
    const hash = createHash('sha256');
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    return hash.digest('hex');
  };
  assert.equal(await sha256(executable), pin.executableSha256);
  assert.equal(await sha256(join(application, pin.framework)), pin.frameworkSha256);
  // The framework is reached through relative links. A copy that followed them, or pointed them
  // back at the build directory, would not be the browser that was fetched.
  const current = join(application, 'Contents', 'Frameworks', 'Chromium Framework.framework', 'Versions', 'Current');
  assert.ok((await lstat(current)).isSymbolicLink());
  assert.equal(await readlink(current), lock.chromium.version);
});

test('a server without a tunnel program hosts locally and says so', async () => {
  const staged = await stage('bare', { emulator: true });
  let pid;
  try {
    const gamePort = await freePort();
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(gamePort), SLED_SERVER_NETPLAY_PORT: String(await freePort()) });
    await staged.command('configure', '--game-folder', await syntheticDisc(join(staged.root, 'game')), '--disc-policy', 'shared-allowed');
    ({ pid } = await staged.command());
    const { host } = await staged.hostState('online', 'degraded', 'failed');
    assert.equal(host.state, 'degraded');
    assert.deepEqual(host.problem, { component: 'tunnel', message: 'This build has no tunnel program.' });
    assert.equal((await fetch(`http://127.0.0.1:${gamePort}/session-info`)).status, 200);
    assert.equal((await staged.command('invitation')).url, null, 'no link for guests without a public address');
    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('neither quit nor a killed server leaves a tunnel program behind', async () => {
  const staged = await stage('application', { emulator: true, tunnel: 'fake' });
  let pid;
  let programs = [];
  try {
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(await freePort()), SLED_SERVER_NETPLAY_PORT: String(await freePort()) });
    await staged.command('configure', '--game-folder', await syntheticDisc(join(staged.root, 'game')), '--disc-policy', 'shared-allowed');

    ({ pid } = await staged.command());
    await staged.hostState('online');
    for (let attempt = 0; (await staged.tunnelPrograms()).length < 2 && attempt < 100; attempt++) await delay(50);
    programs = await staged.tunnelPrograms();
    assert.equal(programs.length, 2, 'the primary and the mirror');
    assert.ok(programs.every(alive));
    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
    for (const program of programs) await untilGone(program);

    ({ pid } = await staged.command());
    await staged.hostState('online');
    for (let attempt = 0; (await staged.tunnelPrograms()).length < 4 && attempt < 100; attempt++) await delay(50);
    programs = (await staged.tunnelPrograms()).slice(2);
    assert.equal(programs.length, 2);
    process.kill(pid, 'SIGKILL');
    await untilGone(pid);
    for (const program of programs) await untilGone(program);
  } finally {
    for (const program of programs) if (alive(program)) process.kill(program, 'SIGKILL');
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

/**
 * One connection to the relay from the game page's origin. `answer` resolves to the first answer, or to why
 * there was none; `inbox` keeps every answer that is text, and `closed` resolves to the reason of the end.
 */
function connectRoom(netplayPort, gamePort, request) {
  const socket = new WebSocket(`ws://127.0.0.1:${netplayPort}`, { origin: `http://127.0.0.1:${gamePort}` });
  const inbox = [];
  socket.on('message', (data, binary) => { if (!binary) inbox.push(JSON.parse(String(data))); });
  const closed = new Promise(resolve => {
    socket.once('close', (_code, reason) => resolve(String(reason)));
    socket.once('error', error => resolve(String(error)));
  });
  const answer = new Promise(resolve => {
    socket.once('message', data => resolve(JSON.parse(String(data))));
    void closed.then(reason => resolve({ closed: reason }));
  });
  socket.once('open', () => socket.send(JSON.stringify(request)));
  return { socket, answer, inbox, closed };
}

/** What a player's page does with the server's link: it reads the room, works out its own identity, and joins. */
async function joinRoom(netplayPort, gamePort, link, change = {}) {
  const { room, token, progress, camera, nativeCamera } = parseInvitation(new URL(link).hash);
  const info = await (await fetch(`http://127.0.0.1:${gamePort}/session-info`)).json();
  const identity = await roomIdentity({ ...info, bios: 'HLE', options: { progress, camera, nativeCamera } });
  return { room, token, info, ...connectRoom(netplayPort, gamePort, { role: 'guest', room, token, identity, ...change }) };
}

async function until(description, done) {
  for (let attempt = 0; !await done(); attempt++) {
    if (attempt > 200) throw new Error(`Timed out waiting until ${description}`);
    await delay(25);
  }
}

/** A state of the right size that carries the marks the format check looks for. Not a game. */
function validState() {
  const bytes = Buffer.alloc(4_456_472);
  bytes.write('RASTATE', 0);
  bytes.write('STv4 PCSXra f29871d', 16);
  bytes.writeUInt32LE(1, 0x29934d);
  return bytes;
}

test('the packaged server opens its room before any player, seats the first one, and quit ends its worker', async () => {
  const staged = await stage('application', { emulator: true, tunnel: 'fake' });
  let pid;
  const sockets = [];
  let workers = [];
  try {
    const gamePort = await freePort();
    const netplayPort = await freePort();
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(gamePort), SLED_SERVER_NETPLAY_PORT: String(netplayPort) });
    await staged.command('configure', '--game-folder', await syntheticDisc(join(staged.root, 'game')), '--disc-policy', 'shared-allowed');
    ({ pid } = await staged.command());
    const { host } = await staged.hostState('online', 'failed', 'needs_setup');
    assert.deepEqual({ state: host.state, room: host.room }, { state: 'online', room: 'open' }, JSON.stringify(host.problem));
    assert.equal((await (await fetch(`${host.localUrl}session-info`)).json()).dedicated, true);
    const [start, navigate] = await staged.browserLaunches();
    workers = [start.pid];
    assert.equal(navigate.url, `http://127.0.0.1:${gamePort}/`);
    const profiles = join(staged.home, 'Library', 'Caches', 'Sled Storm Server', 'browser-profiles');
    assert.ok(start.args.some(argument => argument.startsWith(`--user-data-dir=${profiles}/`)), 'the profile is in the cache');
    assert.ok(!start.args.some(argument => argument.startsWith('--remote-debugging-port')), 'no debugging port is opened');

    // The room was not asked for by anyone. A player joins it with the link; nobody can ask for another.
    const { url, localUrl } = await staged.command('invitation');
    assert.equal(new URL(url).hash, new URL(localUrl).hash);
    const player = await joinRoom(netplayPort, gamePort, localUrl);
    sockets.push(player.socket);
    const answer = await player.answer;
    assert.deepEqual({ type: answer.type, slot: answer.slot, owner: answer.owner }, { type: 'ready', slot: 0, owner: true }, JSON.stringify(answer));
    const refused = connectRoom(netplayPort, gamePort, { role: 'create', room: randomBytes(12).toString('hex'),
      token: randomBytes(32).toString('hex'), identity: 'e'.repeat(64), progress: 'all' });
    sockets.push(refused.socket);
    assert.deepEqual(await refused.answer, { closed: 'This server has one room. Open the game with its invitation link.' });
    assert.equal((await staged.browserLaunches()).filter(entry => entry.event === 'start').length, 1, 'no second emulator');

    const serverLog = await readFile(join(staged.home, 'Library', 'Logs', 'Sled Storm Server', 'server.log'), 'utf8');
    assert.ok(serverLog.includes('The room is open.'));
    for (const secret of [player.room, player.token, navigate.setup.workerKey])
      assert.ok(!serverLog.includes(secret) && !JSON.stringify(host).includes(secret), 'neither the log nor the status names the room');

    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
    await untilGone(pid);
    assert.ok(!alive(start.pid), 'the worker ended before the server did');
    assert.deepEqual(await readdir(profiles), []);
    await staged.unchanged();
  } finally {
    for (const socket of sockets) socket.terminate();
    for (const worker of workers) if (alive(worker)) process.kill(worker, 'SIGKILL');
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('a killed server leaves no worker, and the next start removes the profile it left', async () => {
  const staged = await stage('bare', { emulator: true, tunnel: 'fake' });
  let pid;
  let workers = [];
  try {
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(await freePort()), SLED_SERVER_NETPLAY_PORT: String(await freePort()) });
    await staged.command('configure', '--game-folder', await syntheticDisc(join(staged.root, 'game')), '--disc-policy', 'shared-allowed');
    ({ pid } = await staged.command());
    await staged.hostState('online');
    const [start] = await staged.browserLaunches();
    workers = [start.pid];

    process.kill(pid, 'SIGKILL');
    await untilGone(pid);
    // The stand-in ends when its pipes close, as the real browser was measured to do.
    await untilGone(start.pid);
    const profiles = join(staged.home, 'Library', 'Caches', 'Sled Storm Server', 'browser-profiles');
    assert.equal((await readdir(profiles)).length, 1, 'a killed server cannot remove the profile');

    ({ pid } = await staged.command());
    await staged.hostState('online');
    const launches = (await staged.browserLaunches()).filter(entry => entry.event === 'start');
    workers = launches.map(entry => entry.pid);
    assert.equal(launches.length, 2, 'the next server opened its own room');
    assert.equal((await readdir(profiles)).length, 1, 'only the profile of the room that runs now');
    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
    await untilGone(pid);
    assert.deepEqual(await readdir(profiles), []);
  } finally {
    for (const worker of workers) if (alive(worker)) process.kill(worker, 'SIGKILL');
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('a server without a public address still gives the link for this computer', async () => {
  const staged = await stage('bare', { emulator: true });
  let pid;
  try {
    const gamePort = await freePort();
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(gamePort), SLED_SERVER_NETPLAY_PORT: String(await freePort()) });
    assert.equal((await run(staged.executable, ['invitation'], { cwd: staged.cwd, env: staged.env }).catch(error => error)).stderr.trim(),
      'The server is not running.');
    await staged.command('configure', '--game-folder', await syntheticDisc(join(staged.root, 'game')), '--disc-policy', 'shared-allowed');
    ({ pid } = await staged.command());
    const { host } = await staged.hostState('degraded', 'online', 'failed');
    assert.deepEqual({ room: host.room, component: host.problem?.component }, { room: 'open', component: 'tunnel' });
    const { url, localUrl } = await staged.command('invitation');
    assert.equal(url, null);
    assert.ok(localUrl.startsWith(`http://127.0.0.1:${gamePort}/#`));
    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('a saved game is loaded into the room of the packaged server and the invitation stays the same', async () => {
  const staged = await stage('application', { emulator: true, tunnel: 'fake' });
  let pid;
  const sockets = [];
  let workers = [];
  const starts = async () => (await staged.browserLaunches()).filter(entry => entry.event === 'start');
  try {
    const gamePort = await freePort();
    const netplayPort = await freePort();
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(gamePort), SLED_SERVER_NETPLAY_PORT: String(netplayPort) });
    await staged.command('configure', '--game-folder', await syntheticDisc(join(staged.root, 'game')), '--disc-policy', 'shared-allowed');
    ({ pid } = await staged.command());
    const { host } = await staged.hostState('online', 'failed', 'needs_setup');
    assert.deepEqual({ state: host.state, room: host.room }, { state: 'online', room: 'open' }, JSON.stringify(host.problem));
    workers = (await starts()).map(entry => entry.pid);
    const links = await staged.command('invitation');
    assert.ok(links.url && links.localUrl);

    // One player, synchronized and alone, as a page is once its game runs.
    const player = await joinRoom(netplayPort, gamePort, links.localUrl, { roster: true });
    sockets.push(player.socket);
    const ready = await player.answer;
    assert.deepEqual({ type: ready.type, slot: ready.slot, owner: ready.owner, restore: ready.restore },
      { type: 'ready', slot: 0, owner: true, restore: true }, JSON.stringify(ready));
    player.socket.send('{"type":"synchronized"}');
    await until('the player is connected', () => player.inbox.some(message => message.type === 'roster' && message.seats[0].status === 'connected'));

    // The page asks on a connection of its own, with the key of its save library, and sends the save when asked.
    const save = identityKey({ disc: player.info.disc, core: player.info.core, adapter: player.info.adapter, bios: 'hle' });
    const state = validState();
    const request = connectRoom(netplayPort, gamePort, { role: 'restore', room: player.room, token: player.token, seatKey: ready.seatKey, save });
    sockets.push(request.socket);
    assert.deepEqual(await request.answer, { type: 'restore', state: 'send' });
    request.socket.send(state);
    assert.equal(await request.closed, 'Saved game loaded');
    assert.deepEqual(request.inbox.map(message => message.state), ['send', 'starting', 'done']);
    assert.equal(await player.closed, 'Saved game loaded');

    // A second emulator was started with the save, and the first one ended.
    const [first, second, ...more] = await starts();
    workers = [first.pid, second.pid];
    assert.deepEqual(more, []);
    await untilGone(first.pid);
    assert.ok(alive(second.pid));
    const text = state.toString('base64');
    const navigations = (await staged.browserLaunches()).filter(entry => entry.event === 'navigate');
    assert.deepEqual(navigations.map(entry => entry.setup.snapshot),
      [undefined, { length: text.length, sha256: createHash('sha256').update(text).digest('hex') }]);
    assert.deepEqual(navigations.map(entry => entry.setup.room), [player.room, player.room], 'both under the name of the one room');

    // The room is the same one. It takes nobody else until its player is back.
    assert.deepEqual(await staged.command('invitation'), links);
    const during = (await staged.command('status')).host;
    assert.deepEqual({ state: during.state, room: during.room, problem: during.problem }, { state: 'online', room: 'restoring', problem: null });
    const back = await joinRoom(netplayPort, gamePort, links.localUrl, { previousSeatKey: ready.seatKey, roster: true });
    sockets.push(back.socket);
    const again = await back.answer;
    assert.deepEqual({ type: again.type, slot: again.slot, owner: again.owner, seatKey: again.seatKey },
      { type: 'ready', slot: 0, owner: true, seatKey: ready.seatKey }, JSON.stringify(again));
    const after = (await staged.command('status')).host;
    assert.deepEqual({ state: after.state, room: after.room }, { state: 'online', room: 'open' });
    assert.deepEqual(await staged.command('invitation'), links);

    const serverLog = await readFile(join(staged.home, 'Library', 'Logs', 'Sled Storm Server', 'server.log'), 'utf8');
    assert.ok(serverLog.includes('The room is loading a saved game.') && serverLog.includes('The load of the saved game is over.'), serverLog);
    assert.equal(serverLog.split('The room is open.').length, 2, 'the room was opened once');
    for (const secret of [player.room, player.token, ready.seatKey, save, player.info.disc, ...navigations.map(entry => entry.setup.workerKey)])
      assert.ok(!serverLog.includes(secret) && !JSON.stringify(during).includes(secret), 'neither the log nor the status names it');

    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
    await untilGone(pid);
    assert.ok(!alive(second.pid), 'the worker ended before the server did');
    assert.deepEqual(await readdir(join(staged.home, 'Library', 'Caches', 'Sled Storm Server', 'browser-profiles')), []);
    await staged.unchanged();
  } finally {
    for (const socket of sockets) socket.terminate();
    for (const worker of workers) if (alive(worker)) process.kill(worker, 'SIGKILL');
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});
