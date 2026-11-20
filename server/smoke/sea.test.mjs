// Runs the built single executable, not the sources. Build it first with
// `npm run build:sea --prefix server`. Every run uses a private home directory,
// an empty search path and a read-only copy of the bundle in a directory whose
// name has spaces and non-ASCII characters.
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { constants } from 'node:fs';
import { cp, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const built = fileURLToPath(new URL('../../dist/sea/', import.meta.url));
const lock = JSON.parse(await readFile(new URL('../toolchain.lock.json', import.meta.url), 'utf8'));
const copy = { recursive: true, mode: constants.COPYFILE_FICLONE };

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

async function stage(layout, { emulator = false } = {}) {
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
  if (emulator) await syntheticEmulator(resources);
  await run('chmod', ['-R', 'a-w', bundle]);
  const before = await listing(bundle);
  // No Node.js, npm, Python or Git can be found through this search path.
  const env = { HOME: home, TMPDIR: temp, PATH: join(root, 'no such directory'), SLED_SERVER_NO_BROWSER: '1' };
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
    root, home, cwd, temp, executable, resources, env, command, hostState,
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
  assert.deepEqual(files.filter(name => name.endsWith('.test.mjs')), []);
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
  const staged = await stage('application', { emulator: true });
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
    if (JSON.parse(await readFile(join(built, 'resources', 'runtime-manifest.json'), 'utf8')).emulator) {
      assert.equal(host.state, 'online');
    } else {
      assert.equal(host.state, 'failed');
      assert.equal(host.problem.component, 'emulator');
    }
    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});
