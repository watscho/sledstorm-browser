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
import { appendFile, cp, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { connect, createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, relative } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { parseInvitation } from '../../web/invitation.js';
import { roomIdentity } from '../../web/room-identity.js';
import { identityKey } from '../../web/save-file.js';
import { fileURLToPath, pathToFileURL } from 'node:url';
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

/** `build`, when given, stands in the manifest for the checksum of the server's code: the copy is then a build of other code. */
async function stage(layout, { emulator = false, tunnel = 'none', browser = emulator ? 'fake' : 'none', build } = {}) {
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
  if (build !== undefined) {
    const file = join(resources, 'runtime-manifest.json');
    const manifest = JSON.parse(await readFile(file, 'utf8'));
    await writeFile(file, `${JSON.stringify({ ...manifest, server: { sha256: build } }, null, 2)}\n`);
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
  return stdout.split('\n').filter(line => line.includes(root.slice(-6)) && /SledStormServer serve(?: --launcher)?$/.test(line))
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

    assert.deepEqual(await staged.command('--native-quit'), { event: 'stopped', pid });
    await untilGone(pid);
    await assert.rejects(stat(join(data, 'instance.json')), 'the record is removed on a clean stop');
    assert.deepEqual(await staged.command('status'), { running: false });
    assert.deepEqual(await staged.command('quit'), { event: 'not-running' }, 'a repeated quit is harmless');
    assert.deepEqual(await staged.command('--native-quit'), { event: 'not-running' });
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

test('the bundle carries the panel and no test files', async () => {
  assert.deepEqual((await readdir(join(built, 'resources', 'admin'), { recursive: true })).sort(),
    ['controller.js', 'index.html', 'panel.css', 'panel.js', 'session.js', 'view.js']);
});

test('HOST-01: a second launch gets a new one-time token for the same server', async () => {
  const staged = await stage('application');
  let pid;
  try {
    // In place of the system's program that opens an address: it writes down what it was given. The switch
    // that keeps a launch from opening a browser stays set, so a build that does not know the stand-in opens nothing.
    const record = join(staged.root, 'opened.txt');
    const opener = join(staged.root, 'stand-in open');
    await writeFile(opener, `#!/bin/sh\nprintf '%s\\n' "$#" "$@" >> '${record}'\n`, { mode: 0o755 });
    const env = { ...staged.env, SLED_SERVER_OPENER: opener };
    const launch = async () => (await run(staged.executable, [], { cwd: staged.cwd, env })).stdout;

    const outputs = [await launch(), await launch()];
    const [first, second] = outputs.map(output => JSON.parse(output));
    pid = first.pid;
    assert.match(first.url, /^http:\/\/127\.0\.0\.1:\d+\/$/);
    assert.deepEqual([first.event, second], ['started', { event: 'reused', pid, url: first.url }]);
    assert.deepEqual(await servers(staged), [pid], 'one server');

    const opened = (await readFile(record, 'utf8')).trim().split('\n');
    assert.deepEqual(opened.filter((_line, index) => index % 2 === 0), ['1', '1'], 'each launch opened one address');
    const tokens = [opened[1], opened[3]].map(url => new RegExp(`^${first.url}#bootstrap=([a-f0-9]{64})$`).exec(url)?.[1]);
    assert.ok(tokens[0] && tokens[1], 'each address is the panel\'s, with a one-time token');
    assert.notEqual(tokens[0], tokens[1]);

    // The page that the address leads to, from the bundle.
    const page = await fetch(first.url);
    assert.equal(page.status, 200);
    assert.match(page.headers.get('content-security-policy'), /^default-src 'none'; script-src 'self';/);
    assert.match(await page.text(), /<script type="module" src="\/panel\.js"><\/script>/);
    for (const name of ['panel.js', 'session.js', 'view.js', 'controller.js', 'panel.css'])
      assert.equal((await fetch(new URL(name, first.url))).status, 200, name);
    for (const name of ['session.test.mjs', 'page.test.mjs']) assert.equal((await fetch(new URL(name, first.url))).status, 404, name);

    // Each token opens one session, as the page does it, and each tab's session is its own.
    const trade = bootstrap => fetch(new URL('/api/session', first.url),
      { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bootstrap }) });
    const sessions = [];
    for (const bootstrap of tokens) {
      const answer = await trade(bootstrap);
      assert.equal(answer.status, 201);
      sessions.push((await answer.json()).session);
      const again = await trade(bootstrap);
      assert.equal(again.status, 401, 'the same address opened again is refused');
      assert.deepEqual(await again.json(), { error: 'This link to the panel has expired. Open Sled Storm Server again.' });
    }
    assert.notEqual(sessions[0], sessions[1]);
    for (const session of sessions) {
      const status = await fetch(new URL('/api/status', first.url), { headers: { authorization: `Bearer ${session}` } });
      assert.equal(status.status, 200);
      assert.equal((await status.json()).pid, pid);
    }

    const log = await readFile(join(staged.home, 'Library', 'Logs', 'Sled Storm Server', 'server.log'), 'utf8');
    for (const secret of [...tokens, ...sessions])
      assert.ok(!log.includes(secret) && !outputs.join('').includes(secret), 'neither the log nor the launcher\'s output holds a token or a session');

    // Closing a page is nothing the server hears of: it runs until it is told to quit, here by a tab's session.
    const quit = await fetch(new URL('/api/host/quit', first.url), { method: 'POST', headers: { authorization: `Bearer ${sessions[1]}` } });
    assert.equal(quit.status, 202);
    await untilGone(pid);
    assert.deepEqual(await staged.command('status'), { running: false });
    await staged.unchanged();
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('the window receives a fresh one-time session address without invoking the browser opener', async () => {
  const staged = await stage('application', { emulator: true });
  try {
    staged.env.SLED_SERVER_OPENER = '/no-such-browser-opener';
    const gamePort = await freePort();
    const netplayPort = await freePort();
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(gamePort), SLED_SERVER_NETPLAY_PORT: String(netplayPort) });
    const folder = await syntheticDisc(join(staged.root, 'game'));
    await staged.command('configure', '--game-folder', folder, '--disc-policy', 'local-only');
    const first = await staged.command('--native-panel');
    const again = await staged.command('--native-panel');
    const { pid, url, host } = await staged.command('status');
    assert.equal(host.state, 'idle', 'opening the chooser does not start hosting');
    assert.equal(first.openAtLaunch, false);
    assert.equal(again.openAtLaunch, false);
    assert.notEqual(first.address, again.address);
    for (const { address } of [first, again]) {
      const panel = new URL(address);
      const bootstrap = /^#bootstrap=([a-f0-9]{64})$/.exec(panel.hash)?.[1];
      assert.ok(bootstrap);
      assert.equal(new URL('/', panel).href, url);
      const session = await fetch(new URL('/api/session', panel), { method: 'POST',
        headers: { 'content-type': 'application/json' }, body: JSON.stringify({ bootstrap }) });
      assert.equal(session.status, 201);
      const { session: credential } = await session.json();
      const solo = await fetch(new URL('/api/solo/start', panel), { method: 'POST', headers: { authorization: `Bearer ${credential}` } });
      assert.equal(solo.status, 200);
      const { url: game } = await solo.json();
      assert.equal(game, `http://127.0.0.1:${gamePort}/solo`);
      assert.match(await (await fetch(game)).text(), /data-launcher="mac"/);
      assert.equal((await fetch(`${game}/disc.zip`, { method: 'HEAD' })).status, 200);
      assert.ok(await refused(netplayPort));
    }
    assert.deepEqual(await servers(staged), [pid]);
  } finally {
    await staged.command('quit');
    await staged.remove();
  }
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
    // With the access cookie, the gateway passes the chunk routes under shared-allowed (D92, D95).
    const cookie = { cookie: `sled_access=${access}` };
    const manifest = await fetch(`http://127.0.0.1:${host.gatewayPort}/game-data/manifest`, { headers: cookie });
    assert.equal(manifest.status, 200);
    assert.deepEqual(await manifest.json(), { version: 1, disc: info.disc, pal: info.pal, archive: info.archive });
    const chunk = await fetch(`http://127.0.0.1:${host.gatewayPort}/game-data/${info.archive.sha256}/chunks/0`, { headers: cookie });
    assert.equal(chunk.status, 200);
    assert.equal(chunk.headers.get('content-length'), null, 'a chunk streams through the tunnel');
    assert.equal(createHash('sha256').update(Buffer.from(await chunk.arrayBuffer())).digest('hex'), info.archive.chunks[0]);

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

test('a playable bundle carries the WebGL2 race renderer and records its digest', async t => {
  const resources = join(built, 'resources');
  const manifest = JSON.parse(await readFile(join(resources, 'runtime-manifest.json'), 'utf8'));
  if (!manifest.emulator) return t.skip('This build has no prepared emulator.');
  const renderer = await readFile(join(resources, 'web', 'generated', 'enge-hardware.js'), 'utf8');
  assert.match(renderer, /^\/\* eNGE [0-9a-f]{40}\n\nMIT License/);
  assert.match(renderer, /export function createRenderer\(/);
  assert.equal(manifest.emulator.webgl2, createHash('sha256').update(renderer).digest('hex'));
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

    // A quit asks about the player, as a stop does, and `--force` is the answer.
    assert.deepEqual(await refusedCommand(staged, 'quit'),
      { code: 1, said: 'Players are in the room: 1 connected, 0 away with a controller kept. Add --force to quit anyway.' });
    assert.ok(alive(pid), 'a refused quit leaves the server running');
    assert.deepEqual(await refusedCommand(staged, 'quit', '--now'), { code: 2, said: 'Usage: SledStormServer quit [--force]' });
    const confirmation = await staged.command('--native-quit');
    assert.equal(confirmation.event, 'confirmation-required');
    assert.equal(confirmation.message, 'Players are in the room: 1 connected, 0 away with a controller kept.');
    assert.match(confirmation.instance, /^[a-f0-9]{16}$/);
    const otherInstance = (confirmation.instance[0] === '0' ? '1' : '0') + confirmation.instance.slice(1);
    assert.equal((await refusedCommand(staged, '--native-quit', otherInstance)).code, 1);
    assert.ok(alive(pid), 'a quit without confirmation for this instance leaves it running');
    assert.deepEqual(await staged.command('--native-quit', confirmation.instance), { event: 'stopped', pid });
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

test('a new game for the packaged server\'s room keeps its links', async () => {
  const staged = await stage('application', { emulator: true, tunnel: 'fake' });
  let pid;
  const sockets = [];
  try {
    const gamePort = await freePort();
    const netplayPort = await freePort();
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(gamePort), SLED_SERVER_NETPLAY_PORT: String(netplayPort) });
    await staged.command('configure', '--game-folder', await syntheticDisc(join(staged.root, 'game')), '--disc-policy', 'shared-allowed');
    ({ pid } = await staged.command());
    const { host } = await staged.hostState('online', 'failed', 'needs_setup');
    assert.deepEqual({ state: host.state, room: host.room }, { state: 'online', room: 'open' }, JSON.stringify(host.problem));
    const links = await staged.command('invitation');
    const player = await joinRoom(netplayPort, gamePort, links.localUrl);
    sockets.push(player.socket);
    assert.equal((await player.answer).type, 'ready');

    assert.deepEqual(await refusedCommand(staged, 'new-game'), { code: 1,
      said: 'Players are in the room: 1 connected, 0 away with a controller kept. A new game disconnects them. Add --force to start one anyway.' });
    assert.deepEqual(await refusedCommand(staged, 'new-game', '--now'), { code: 2, said: 'Usage: SledStormServer new-game [--force]' });
    const asked = await staged.command('new-game', '--force');
    assert.equal(asked.event, 'new-game');
    assert.equal(await player.closed, 'The host started a new game. Open the invitation again to join.');
    const emulators = async () => (await staged.browserLaunches()).filter(entry => entry.event === 'start');
    await until('a second emulator', async () => (await emulators()).length === 2);
    await until('the room is open again', async () => (await staged.command('status')).host.room === 'open');
    const navigations = (await staged.browserLaunches()).filter(entry => entry.event === 'navigate');
    assert.equal(navigations.length, 2);
    assert.equal(navigations[1].setup.room, navigations[0].setup.room, 'the same room');
    assert.deepEqual(await staged.command('invitation'), links, 'the links stay');
    const again = await joinRoom(netplayPort, gamePort, links.localUrl);
    sockets.push(again.socket);
    assert.equal((await again.answer).type, 'ready', 'the same link joins the new game');
    const serverLog = await readFile(join(staged.home, 'Library', 'Logs', 'Sled Storm Server', 'server.log'), 'utf8');
    assert.ok(serverLog.includes('The host started a new game.'), serverLog);
    for (const secret of [player.room, player.token])
      assert.ok(!serverLog.includes(secret) && !JSON.stringify(asked).includes(secret), 'neither the log nor the answer names the room');

    assert.deepEqual(await staged.command('quit', '--force'), { event: 'stopped', pid });
    await untilGone(pid);
    await staged.unchanged();
  } finally {
    for (const socket of sockets) socket.terminate();
    for (const entry of await staged.browserLaunches()) if (alive(entry.pid)) process.kill(entry.pid, 'SIGKILL');
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('the diagnostic report of the packaged server names no folder and no secret', async () => {
  const staged = await stage('application', { emulator: true, tunnel: 'fake' });
  let pid;
  try {
    const folder = await syntheticDisc(join(staged.root, 'My Games', 'Sled Storm диск'));
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(await freePort()), SLED_SERVER_NETPLAY_PORT: String(await freePort()) });
    await staged.command('configure', '--game-folder', folder, '--disc-policy', 'shared-allowed');
    ({ pid } = await staged.command());
    const { host } = await staged.hostState('online', 'failed', 'needs_setup');
    assert.equal(host.state, 'online', JSON.stringify(host.problem));
    const { url } = await staged.command('invitation');
    const { token, instance } = JSON.parse(await readFile(join(staged.home, 'Library', 'Application Support', 'Sled Storm Server', 'instance.json'), 'utf8'));
    // The log holds none of these (D19). A line that does is written here by hand, as a later fault could write one.
    const log = join(staged.home, 'Library', 'Logs', 'Sled Storm Server', 'server.log');
    await appendFile(log, `2026-11-21T00:00:00.000Z Seeded ${folder} ${token} ${url}\n`);
    const link = new URL(url);
    const secrets = [folder, staged.home, staged.root, token, instance, link.hostname, link.hash.slice(1), link.pathname.split('/')[2]];
    const manifest = JSON.parse(await readFile(join(built, 'resources', 'runtime-manifest.json'), 'utf8'));

    const report = await staged.command('diagnostics');
    for (const secret of secrets) assert.ok(!JSON.stringify(report).includes(secret), 'the report holds a folder or a secret');
    assert.deepEqual(report.manifest, manifest, 'the manifest of the build');
    assert.equal(report.manifest.node.version, lock.node.version);
    assert.equal(report.version, manifest.app.version);
    assert.deepEqual(report.parts, { web: true, emulator: true, browser: true, tunnel: true, panel: true });
    assert.deepEqual({ state: report.host.state, room: report.host.room }, { state: 'online', room: 'open' });
    assert.equal(report.config.gameFolder, true);
    assert.ok(report.log.lines.some(line => line.endsWith(' Seeded <game folder> <hex> https://<public host>/access/<hex>#<fragment>')),
      JSON.stringify(report.log.lines.slice(-5)));

    // Without a server the command makes the report itself, from the same log.
    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
    await untilGone(pid);
    const alone = await staged.command('diagnostics');
    assert.deepEqual({ host: alone.host, startedAt: alone.startedAt }, { host: null, startedAt: null });
    assert.ok(alone.log.lines.at(-1).endsWith(' Stopped.'), alone.log.lines.at(-1));
    for (const secret of secrets) assert.ok(!JSON.stringify(alone).includes(secret), 'the report holds a folder or a secret');
    await staged.unchanged();
  } finally {
    for (const entry of await staged.browserLaunches()) if (alive(entry.pid)) process.kill(entry.pid, 'SIGKILL');
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('a launch of another build replaces an idle server, and leaves one with players', async () => {
  // Two copies of the application for one user, with one place for their data. The second is a build of other code.
  const first = await stage('application', { emulator: true });
  const second = await stage('application', { emulator: true, build: 'e'.repeat(64) });
  const pids = [];
  const sockets = [];
  try {
    const gamePort = await freePort();
    const netplayPort = await freePort();
    Object.assign(first.env, { SLED_SERVER_GAME_PORT: String(gamePort), SLED_SERVER_NETPLAY_PORT: String(netplayPort) });
    Object.assign(second.env, first.env);
    await first.command('configure', '--game-folder', await syntheticDisc(join(first.root, 'game')), '--disc-policy', 'shared-allowed');
    const older = await first.command();
    pids.push(older.pid);
    const { host } = await first.hostState('degraded', 'online', 'failed');
    assert.equal(host.room, 'open', JSON.stringify(host.problem));

    // Nobody is in its room: the first build's server quits before the second one's starts.
    const replaced = await second.command();
    pids.push(replaced.pid);
    assert.deepEqual(replaced, { event: 'replaced', pid: replaced.pid, url: replaced.url });
    assert.notEqual(replaced.pid, older.pid);
    assert.ok(!alive(older.pid), 'the older server was gone before the new one started');
    assert.deepEqual([...await servers(first), ...await servers(second)], [replaced.pid], 'one server');
    const log = await readFile(join(first.home, 'Library', 'Logs', 'Sled Storm Server', 'server.log'), 'utf8');
    assert.ok(log.includes('Stopping: quit request.'), 'the older server quit on request');

    // A launch of the same build uses it.
    assert.deepEqual(await second.command(), { event: 'reused', pid: replaced.pid, url: replaced.url });

    // A player is in the room of the second build's server: a launch of the first build leaves it running.
    await until('the room is open', async () => (await second.command('status')).host.room === 'open');
    const player = await joinRoom(netplayPort, gamePort, (await second.command('invitation')).localUrl);
    sockets.push(player.socket);
    assert.equal((await player.answer).type, 'ready');
    assert.deepEqual(await first.command(), { event: 'reused', pid: replaced.pid, url: replaced.url, otherBuild: true });
    assert.ok(alive(replaced.pid));
    assert.equal(player.socket.readyState, WebSocket.OPEN, 'the player is still in the room');
    assert.deepEqual([...await servers(first), ...await servers(second)], [replaced.pid]);

    assert.deepEqual(await second.command('quit', '--force'), { event: 'stopped', pid: replaced.pid });
    await untilGone(replaced.pid);
    await first.unchanged();
    await second.unchanged();
  } finally {
    for (const socket of sockets) socket.terminate();
    for (const staged of [first, second])
      for (const entry of await staged.browserLaunches()) if (alive(entry.pid)) process.kill(entry.pid, 'SIGKILL');
    for (const pid of pids) if (alive(pid)) process.kill(pid, 'SIGKILL');
    await first.remove();
    await second.remove();
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

    // The player is still in the room.
    assert.deepEqual(await staged.command('quit', '--force'), { event: 'stopped', pid });
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

/** A command that is expected to fail: its exit code and what it said on standard error. */
async function refusedCommand(staged, ...args) {
  try {
    await run(staged.executable, args, { cwd: staged.cwd, env: staged.env });
  } catch (error) {
    return { code: error.code, said: String(error.stderr).trim() };
  }
  throw new Error(`${args.join(' ')} was expected to fail`);
}

test('the packaged server starts and stops hosting on request and keeps running', async () => {
  // No tunnel program in this copy: the room opens, and the public address is what is missing.
  const staged = await stage('application', { emulator: true });
  let pid;
  const sockets = [];
  try {
    assert.deepEqual(await refusedCommand(staged, 'start'), { code: 1, said: 'The server is not running.' });
    assert.deepEqual(await refusedCommand(staged, 'stop'), { code: 1, said: 'The server is not running.' });
    const gamePort = await freePort();
    const netplayPort = await freePort();
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(gamePort), SLED_SERVER_NETPLAY_PORT: String(netplayPort) });
    await staged.command('configure', '--game-folder', await syntheticDisc(join(staged.root, 'game')), '--disc-policy', 'shared-allowed');
    ({ pid } = await staged.command());
    let { host } = await staged.hostState('degraded', 'online', 'failed', 'needs_setup');
    assert.deepEqual({ state: host.state, room: host.room, players: host.players, component: host.problem?.component },
      { state: 'degraded', room: 'open', players: { connected: 0, reserved: 0 }, component: 'tunnel' });
    const first = (await staged.command('invitation')).localUrl;

    const stopping = await staged.command('stop');
    assert.deepEqual(Object.keys(stopping), ['event', 'host']);
    assert.equal(stopping.event, 'stopping');
    ({ host } = await staged.hostState('idle'));
    assert.deepEqual({ room: host.room, players: host.players, localUrl: host.localUrl, problem: host.problem },
      { room: 'off', players: null, localUrl: null, problem: null });
    assert.ok(await refused(gamePort) && await refused(netplayPort), 'nothing is hosted');
    assert.deepEqual(await servers(staged), [pid], 'the server itself runs on');
    assert.deepEqual(await refusedCommand(staged, 'invitation'), { code: 1, said: 'No room is open.' });
    assert.equal((await staged.command('stop')).host.state, 'idle', 'a stop with nothing to stop is accepted');

    assert.equal((await staged.command('start')).event, 'starting');
    ({ host } = await staged.hostState('degraded', 'online', 'failed', 'needs_setup'));
    assert.deepEqual({ state: host.state, room: host.room }, { state: 'degraded', room: 'open' }, JSON.stringify(host.problem));
    const second = (await staged.command('invitation')).localUrl;
    assert.notEqual(new URL(second).hash, new URL(first).hash, 'hosting that was stopped and started has a new room');
    assert.equal((await staged.command('start')).event, 'starting', 'a start with nothing to start is accepted');
    assert.equal((await staged.command('invitation')).localUrl, second, 'and leaves the room as it is');

    // With a player in the room, a stop must say so.
    const player = await joinRoom(netplayPort, gamePort, second);
    sockets.push(player.socket);
    assert.equal((await player.answer).type, 'ready');
    assert.deepEqual((await staged.command('status')).host.players, { connected: 1, reserved: 0 });
    assert.deepEqual(await refusedCommand(staged, 'stop'),
      { code: 1, said: 'Players are in the room: 1 connected, 0 away with a controller kept. Add --force to stop it anyway.' });
    assert.deepEqual(await refusedCommand(staged, 'stop', '--now'), { code: 2, said: 'Usage: SledStormServer stop [--force]' });
    assert.equal((await staged.command('status')).host.room, 'open', 'a refused stop stops nothing');
    assert.equal(player.socket.readyState, WebSocket.OPEN);

    // The game files change under the room. The start that the status then asks for would close the
    // room and open another, so with a player in it that start must say so too.
    await appendFile(join(staged.root, 'game', 'Track 01.bin'), 'x');
    assert.equal((await fetch(`http://127.0.0.1:${gamePort}/disc.zip`)).status, 503);
    assert.equal((await staged.command('status')).host.problem.component, 'game-data');
    assert.deepEqual(await refusedCommand(staged, 'start'), { code: 1, said: 'Players are in the room: 1 connected, 0 away with a controller kept. '
      + 'This start closes their room and opens a new one. Add --force to start anyway.' });
    assert.deepEqual(await refusedCommand(staged, 'start', '--now'), { code: 2, said: 'Usage: SledStormServer start [--force]' });
    assert.equal((await staged.command('invitation')).localUrl, second, 'a refused start leaves the room as it is');
    assert.equal(player.socket.readyState, WebSocket.OPEN);

    assert.equal((await staged.command('stop', '--force')).event, 'stopping');
    await staged.hostState('idle');
    assert.equal(await player.closed, 'Dedicated server stopped');
    assert.deepEqual(await servers(staged), [pid]);

    const serverLog = await readFile(join(staged.home, 'Library', 'Logs', 'Sled Storm Server', 'server.log'), 'utf8');
    for (const secret of [new URL(first).hash.slice(1), new URL(second).hash.slice(1), player.room, player.token])
      assert.ok(!serverLog.includes(secret) && !JSON.stringify(host).includes(secret), 'neither the log nor the status names a room');
    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
    await untilGone(pid);
    await staged.unchanged();
  } finally {
    for (const socket of sockets) socket.terminate();
    for (const entry of await staged.browserLaunches()) if (alive(entry.pid)) process.kill(entry.pid, 'SIGKILL');
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('a server whose configuration says no auto start is idle until asked', async () => {
  const staged = await stage('bare', { emulator: true });
  let pid;
  try {
    const gamePort = await freePort();
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(gamePort), SLED_SERVER_NETPLAY_PORT: String(await freePort()) });
    const folder = await syntheticDisc(join(staged.root, 'game'));
    await staged.command('configure', '--game-folder', folder, '--disc-policy', 'shared-allowed');
    // The switch is the panel's; no command sets it. The file is the host's own.
    const file = join(staged.home, 'Library', 'Application Support', 'Sled Storm Server', 'config.json');
    const saved = JSON.parse(await readFile(file, 'utf8'));
    assert.equal(saved.autoStart, true);
    await writeFile(file, JSON.stringify({ ...saved, autoStart: false }));
    // The command for the folder leaves the switch as it found it.
    await staged.command('configure', '--game-folder', folder, '--disc-policy', 'shared-allowed');
    assert.equal(JSON.parse(await readFile(file, 'utf8')).autoStart, false);

    ({ pid } = await staged.command());
    // Long enough for a start to have shown itself: the synthetic disc is prepared in a moment.
    await delay(1500);
    const { host } = await staged.command('status');
    assert.deepEqual({ state: host.state, room: host.room, localUrl: host.localUrl, problem: host.problem },
      { state: 'idle', room: 'off', localUrl: null, problem: null });
    assert.ok(await refused(gamePort), 'nothing is hosted');
    const log = join(staged.home, 'Library', 'Logs', 'Sled Storm Server', 'server.log');
    assert.ok(!(await readFile(log, 'utf8')).includes('Preparing the game files.'), 'no start was tried');

    assert.equal((await staged.command('start')).event, 'starting');
    const started = await staged.hostState('degraded', 'online', 'failed', 'needs_setup');
    assert.deepEqual({ state: started.host.state, room: started.host.room }, { state: 'degraded', room: 'open' }, JSON.stringify(started.host.problem));
    assert.equal((await fetch(`http://127.0.0.1:${gamePort}/session-info`)).status, 200);
    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
    await untilGone(pid);
  } finally {
    for (const entry of await staged.browserLaunches()) if (alive(entry.pid)) process.kill(entry.pid, 'SIGKILL');
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

/** A request with its path as written: nothing normalizes it on the way out. */
function raw(port, method, path, headers) {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, method, path, headers }, incoming => {
      let body = '';
      incoming.setEncoding('utf8');
      incoming.on('data', chunk => { body += chunk; });
      incoming.on('end', () => resolve({ status: incoming.statusCode, text: body + JSON.stringify(incoming.headers) }));
    });
    outgoing.on('error', reject);
    outgoing.end(method === 'GET' || method === 'HEAD' ? undefined : '{"force":true}');
  });
}

test('AUTH-01: nothing asked through the gateway of the packaged server reaches its control listener', async () => {
  const staged = await stage('application', { emulator: true, tunnel: 'fake' });
  let pid;
  try {
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(await freePort()), SLED_SERVER_NETPLAY_PORT: String(await freePort()) });
    await staged.command('configure', '--game-folder', await syntheticDisc(join(staged.root, 'game')), '--disc-policy', 'shared-allowed');
    const launched = await staged.command();
    pid = launched.pid;
    const { host } = await staged.hostState('online', 'failed', 'needs_setup');
    assert.equal(host.state, 'online', JSON.stringify(host.problem));
    const controlPort = new URL(launched.url).port;
    const record = join(staged.home, 'Library', 'Application Support', 'Sled Storm Server', 'instance.json');
    const { token, instance } = JSON.parse(await readFile(record, 'utf8'));
    const access = /\/access\/([a-f0-9]{48})#/.exec((await staged.command('invitation')).url)[1];
    const cookie = { cookie: `sled_access=${access}` };
    assert.equal((await raw(host.gatewayPort, 'GET', '/session-info', cookie)).status, 200, 'the gateway serves the game');

    // As a command would ask the control listener, credential and all, but through the public door.
    const command = { authorization: `Bearer ${token}`, host: `127.0.0.1:${controlPort}`, 'content-type': 'application/json' };
    for (const route of ['/api/status', '/api/invitation', '/api/config', '/api/session/bootstrap', '/api/host/start', '/api/room/stop', '/api/host/quit',
      '/api/game-folder/pick']) {
      for (const path of [route, route.replace('/api/', '/%61pi/'), route.replace('/api/', '/api%2F'), `/${route}`, `/.${route}`, `/web/..${route}`]) {
        for (const method of ['GET', 'POST', 'PUT']) {
          const outside = await raw(host.gatewayPort, method, path, command);
          const inside = await raw(host.gatewayPort, method, path, { ...command, ...cookie });
          assert.deepEqual([outside.status, inside.status], [401, 403], `${method} ${path}`);
          for (const { text } of [outside, inside])
            assert.ok(!text.includes(instance) && !text.includes(token) && !text.includes('"instance"'), `${method} ${path}`);
        }
      }
    }
    // The panel's page is not a part of the game.
    for (const path of ['/panel.js', '/session.js', '/view.js', '/controller.js', '/panel.css']) {
      assert.equal((await raw(host.gatewayPort, 'GET', path, cookie)).status, 403, path);
      assert.equal((await raw(controlPort, 'GET', path, {})).status, 200, path);
    }

    // Nothing was stopped, started or quit by any of it.
    const after = await staged.command('status');
    assert.deepEqual({ running: after.running, pid: after.pid, state: after.host.state, room: after.host.room, gatewayPort: after.host.gatewayPort },
      { running: true, pid, state: 'online', room: 'open', gatewayPort: host.gatewayPort });
    const log = await readFile(join(staged.home, 'Library', 'Logs', 'Sled Storm Server', 'server.log'), 'utf8');
    assert.ok(!log.includes('Stopping') && !log.includes('is stopped') && !log.includes(token), 'the log tells of no stop and holds no credential');
    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
    await untilGone(pid);
    await staged.unchanged();
  } finally {
    for (const entry of await staged.browserLaunches()) if (alive(entry.pid)) process.kill(entry.pid, 'SIGKILL');
    for (const program of await staged.tunnelPrograms()) if (alive(program)) process.kill(program, 'SIGKILL');
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('the packaged server hosts under local-only, and its gateway gives no disc away', async () => {
  const staged = await stage('application', { emulator: true, tunnel: 'fake' });
  let pid;
  const sockets = [];
  try {
    const gamePort = await freePort();
    const netplayPort = await freePort();
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(gamePort), SLED_SERVER_NETPLAY_PORT: String(netplayPort) });
    const folder = await syntheticDisc(join(staged.root, 'game'));
    assert.deepEqual(await staged.command('configure', '--game-folder', folder, '--disc-policy', 'local-only'),
      { event: 'configured', gameFolder: folder, discPolicy: 'local-only', tracks: 2, restartRequired: false });
    ({ pid } = await staged.command());
    const { host } = await staged.hostState('online', 'failed', 'needs_setup');
    assert.deepEqual({ state: host.state, room: host.room }, { state: 'online', room: 'open' }, JSON.stringify(host.problem));

    // The room's emulator runs on the loopback origin, which still serves the disc under this policy (D72).
    const origin = `http://127.0.0.1:${gamePort}`;
    const [, navigate] = await staged.browserLaunches();
    assert.equal(navigate.url, `${origin}/`);
    const info = await (await fetch(`${origin}/session-info`)).json();
    assert.equal(info.discMode, 'shared');
    const archive = Buffer.from(await (await fetch(`${origin}/disc.zip`)).arrayBuffer());
    assert.equal(createHash('sha256').update(archive).digest('hex'), info.archive.sha256);

    // The links are those of any room, and a player on this computer joins with the local one.
    const { url, localUrl } = await staged.command('invitation');
    assert.equal(new URL(url).hash, new URL(localUrl).hash);
    const player = await joinRoom(netplayPort, gamePort, localUrl);
    sockets.push(player.socket);
    assert.equal((await player.answer).type, 'ready');

    // Through the public gateway, with its access cookie: the same session info, marked local, and no disc.
    const access = /\/access\/([a-f0-9]{48})#/.exec(url)[1];
    const cookie = { cookie: `sled_access=${access}` };
    const through = await fetch(`http://127.0.0.1:${host.gatewayPort}/session-info`, { headers: cookie });
    assert.equal(through.status, 200);
    assert.equal(through.headers.get('x-sled-disc'), 'local');
    assert.deepEqual(await through.json(), info);
    for (const method of ['GET', 'HEAD'])
      for (const path of ['/disc.zip', '/disc.zip?v=1', '/%64isc.zip', '/DISC.ZIP', '/./disc.zip', '/emulator/../disc.zip', '/game-data/manifest',
        `/game-data/${info.archive.sha256}/chunks/0`])
        assert.equal((await raw(host.gatewayPort, method, path, cookie)).status, 403, `${method} ${path}`);
    assert.equal((await raw(host.gatewayPort, 'GET', '/disc.zip', {})).status, 401, 'without the cookie the gateway asks for its link');

    // The bundle carries the page that obeys the gateway, and the panel that no longer refuses this policy.
    const page = await raw(host.gatewayPort, 'GET', '/local-disc.js', cookie);
    assert.equal(page.status, 200);
    assert.match(page.text, /export function sessionDiscMode/);
    // The guest's page takes the discs the server takes, by the rules they share (D75).
    const sheet = await raw(host.gatewayPort, 'GET', '/disc-sheet.js', cookie);
    assert.equal(sheet.status, 200);
    assert.match(sheet.text, /export function cueTrackNames/);
    // A guest may choose one ZIP of the disc, which the page reads and checks itself (DATA-03, DATA-04).
    const reader = await raw(host.gatewayPort, 'GET', '/disc-zip.js', cookie);
    assert.equal(reader.status, 200);
    assert.match(reader.text, /export async function discFromZip/);
    // The guest chooses where the disc comes from: their own files or a saved ZIP under this policy (D87).
    const source = await raw(host.gatewayPort, 'GET', '/disc-source.js', cookie);
    assert.equal(source.status, 200);
    assert.match(source.text, /export async function copyDisc/);
    const lobby = (await raw(host.gatewayPort, 'GET', '/', cookie)).text;
    assert.match(lobby, /name="disc-source"/);
    assert.match(lobby, /id="disc-files"[^>]*accept="\.cue,\.bin"/);
    assert.match(lobby, /id="disc-zip"[^>]*accept="\.zip"/);
    assert.match((await raw(host.gatewayPort, 'GET', '/app.js', cookie)).text, /sessionDiscMode\(info, response\.headers\.get\('X-Sled-Disc'\)\)/);
    const panel = await readFile(join(staged.resources, 'admin', 'index.html'), 'utf8');
    assert.ok(!panel.includes('cannot host') && panel.includes('choose their own game files or a saved ZIP'), 'the panel describes the policy');

    assert.deepEqual(await staged.command('quit', '--force'), { event: 'stopped', pid });
    await untilGone(pid);
    await staged.unchanged();
  } finally {
    for (const socket of sockets) socket.terminate();
    for (const entry of await staged.browserLaunches()) if (alive(entry.pid)) process.kill(entry.pid, 'SIGKILL');
    for (const program of await staged.tunnelPrograms()) if (alive(program)) process.kill(program, 'SIGKILL');
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

/** Asks the control listener of a launched server as a command of this user would, with the credential of its record. */
async function control(staged, url, method, path) {
  const record = join(staged.home, 'Library', 'Application Support', 'Sled Storm Server', 'instance.json');
  const { token } = JSON.parse(await readFile(record, 'utf8'));
  const answer = await fetch(new URL(path, url), { method, headers: { authorization: `Bearer ${token}` } });
  return { status: answer.status, body: await answer.json() };
}

test('the game folder is chosen through the dialog\'s stand-in, and a cancel changes nothing', async () => {
  const staged = await stage('application');
  let pid;
  try {
    const folder = await syntheticDisc(join(staged.root, 'game "folder" 雪'));
    // In place of the system's dialog: it writes down what it was run with, and answers with the folder
    // of a file, or as a dialog that was canceled while there is no such file.
    const dialog = join(staged.root, 'stand-in dialog');
    const record = join(staged.root, 'dialogs.txt');
    const answer = join(staged.root, 'dialog-answer.txt');
    await writeFile(dialog, `#!/bin/sh\nprintf '%s\\n' "$#" "$@" >> '${record}'\nif [ -f '${answer}' ]; then /bin/cat '${answer}'; `
      + 'else echo "0:17: execution error: User canceled. (-128)" >&2; exit 1; fi\n', { mode: 0o755 });
    staged.env.SLED_SERVER_FOLDER_DIALOG = dialog;
    const launched = await staged.command();
    pid = launched.pid;
    const pick = () => control(staged, launched.url, 'POST', '/api/game-folder/pick');
    const file = join(staged.home, 'Library', 'Application Support', 'Sled Storm Server', 'config.json');
    const nothing = { gameFolder: null, discPolicy: null, autoStart: true, roomOptions: { progress: 'all', camera: true }, problem: null };

    assert.deepEqual(await pick(), { status: 200, body: { picked: false, config: nothing } });
    await assert.rejects(readFile(file), { code: 'ENOENT' }, 'a cancel writes no configuration');

    await writeFile(answer, `${folder}/\n`);
    assert.deepEqual(await pick(), { status: 200, body: { picked: true, config: { ...nothing, gameFolder: folder } } });
    assert.equal(JSON.parse(await readFile(file, 'utf8')).gameFolder, folder);

    await rm(answer);
    assert.deepEqual(await pick(), { status: 200, body: { picked: false, config: { ...nothing, gameFolder: folder } } });
    assert.equal(JSON.parse(await readFile(file, 'utf8')).gameFolder, folder, 'a cancel keeps the folder that was chosen before');

    // Three dialogs, each run with the fixed script and nothing else.
    const script = ['4', '-e', 'tell me to activate', '-e',
      'POSIX path of (choose folder with prompt "Choose the folder that holds your Sled Storm disc")'];
    assert.deepEqual((await readFile(record, 'utf8')).trim().split('\n'), [...script, ...script, ...script]);

    // The folder leaves the server in the answers about the configuration only.
    const log = await readFile(join(staged.home, 'Library', 'Logs', 'Sled Storm Server', 'server.log'), 'utf8');
    assert.ok(!log.includes(folder) && !JSON.stringify(await staged.command('status')).includes(folder), 'neither the log nor the status names the folder');
    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
    await staged.unchanged();
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('a server that may show nothing has no folder dialog', async () => {
  // Every staged copy is launched with the switch that keeps a launch from opening a browser. Without a
  // stand-in for the dialog, such a server shows none: no smoke test can put a window on the screen.
  const staged = await stage('application');
  let pid;
  try {
    assert.equal(staged.env.SLED_SERVER_NO_BROWSER, '1');
    const launched = await staged.command();
    pid = launched.pid;
    assert.deepEqual(await control(staged, launched.url, 'POST', '/api/game-folder/pick'),
      { status: 503, body: { error: 'The folder dialog is not available.' } });
    assert.deepEqual(await staged.command('quit'), { event: 'stopped', pid });
  } finally {
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});

test('the first run, as the page asks for it: a folder from the dialog, a policy, the options, a start, the invitation, a new game, the report, a stop and a quit', async () => {
  const staged = await stage('application', { emulator: true, tunnel: 'fake' });
  let pid;
  let reading = true;
  try {
    const gamePort = await freePort();
    const netplayPort = await freePort();
    Object.assign(staged.env, { SLED_SERVER_GAME_PORT: String(gamePort), SLED_SERVER_NETPLAY_PORT: String(netplayPort) });
    const folder = await syntheticDisc(join(staged.root, 'game folder'));
    // In place of the browser and of the system's dialog: one writes down the address that it was given, the other answers with the folder.
    const opened = join(staged.root, 'opened.txt');
    const opener = join(staged.root, 'stand-in open');
    await writeFile(opener, `#!/bin/sh\nprintf '%s\\n' "$1" >> '${opened}'\n`, { mode: 0o755 });
    const dialog = join(staged.root, 'stand-in dialog');
    await writeFile(dialog, `#!/bin/sh\nprintf '%s/\\n' '${folder}'\n`, { mode: 0o755 });
    Object.assign(staged.env, { SLED_SERVER_OPENER: opener, SLED_SERVER_FOLDER_DIALOG: dialog });

    // A double click on a new installation. Nothing was configured by a command.
    const launched = await staged.command();
    pid = launched.pid;
    const bootstrap = /#bootstrap=([a-f0-9]{64})$/.exec((await readFile(opened, 'utf8')).trim())?.[1];
    assert.ok(bootstrap, 'the browser was given the address of the page with its token');

    // The page's own modules, from the bundle. Only the document is missing: what would be written into it is kept here.
    const module = name => import(pathToFileURL(join(staged.resources, 'admin', name)).href);
    const { openSession } = await module('session.js');
    const { createPanel } = await module('controller.js');
    const reach = (path, init) => fetch(new URL(path, launched.url), init);
    const session = await openSession({ fetch: reach, storage: null, bootstrap });
    assert.match(session, /^[a-f0-9]{64}$/);
    const sent = [];
    const copied = [];
    const views = [];
    const files = [];
    const panel = createPanel({
      async ask(path, init = {}) {
        if (init.method) sent.push(init.body ? `${init.method} ${path} ${init.body}` : `${init.method} ${path}`);
        const answer = await reach(path, { ...init, headers: { ...init.headers, Authorization: `Bearer ${session}` } });
        const text = await answer.text();
        try { return { status: answer.status, body: JSON.parse(text) }; } catch { return { status: answer.status, body: null }; }
      },
      render: view => { views.push(view); },
      // The page reads once a second; here the next reading is due at once, until the test is over.
      wait: () => (reading ? delay(50) : new Promise(() => {})),
      clipboard: async text => { copied.push(text); },
      lost: () => assert.fail('the server knows the session'),
      save: (name, text) => { files.push({ name, text }); },
    });
    void panel.run();
    // A view that the page shows on its way there may say less: a reading before the start at launch finds the host at rest.
    const shows = async (headline, sentence) => {
      const shown = view => view?.headline === headline && (sentence === undefined || view.sentence === sentence);
      for (let attempt = 0; !shown(views.at(-1)); attempt++) {
        if (attempt > 400) throw new Error(`The page never showed "${headline}": ${JSON.stringify(views.at(-1))}`);
        await delay(25);
      }
      return views.at(-1);
    };
    const parts = ({ headline, sentence, setup, start, stop, players }) => ({ headline, sentence, setup, start, stop, players });
    const off = { shown: true, enabled: false };

    // The start at launch found nothing to host, and the page asks for the setup.
    const asksForSetup = 'Choose the game folder and the disc policy to start hosting.';
    assert.deepEqual(parts(await shows('Needs setup', asksForSetup)), { headline: 'Needs setup', sentence: asksForSetup,
      setup: { unfinished: true, folder: null, policy: null, locked: false }, start: { shown: true, enabled: false }, stop: { ...off, label: 'Stop Server' },
      players: '0' });
    assert.deepEqual([views.at(-1).application, views.at(-1).invite, views.at(-1).openGame, views.at(-1).autoStart],
      ['Sled Storm Server', { url: null, note: null }, null, { checked: true, enabled: true }]);

    await panel.chooseFolder();
    assert.deepEqual(parts(views.at(-1)), { headline: 'Needs setup', sentence: null, setup: { unfinished: true, folder, policy: null, locked: false },
      start: { shown: true, enabled: false }, stop: { ...off, label: 'Stop Server' }, players: '0' });
    await panel.setPolicy('shared-allowed');
    assert.deepEqual(parts(views.at(-1)), { headline: 'Stopped', sentence: null, setup: { unfinished: false, folder, policy: 'shared-allowed', locked: false },
      start: { shown: true, enabled: true }, stop: { ...off, label: 'Stop Server' }, players: '0' });
    await panel.setOptions({ camera: false });
    assert.deepEqual([views.at(-1).sentence, views.at(-1).options], [null,
      { progress: 'all', camera: false, locked: false, note: 'Unlocked content and separate cameras need the verified PAL disc.' }]);

    await panel.start();
    const online = await shows('Online');
    assert.deepEqual(parts(online), { headline: 'Online', sentence: null, setup: { unfinished: false, folder, policy: 'shared-allowed', locked: true },
      start: off, stop: { shown: true, enabled: true, label: 'Stop Server' }, players: '0' });
    assert.equal(online.game, 'Unrecognized disc, 2 tracks, 0 MB');
    // The synthetic disc is not the verified one: its room plays with the original progression and a shared camera.
    assert.deepEqual(online.options, { progress: 'all', camera: false, locked: true, note: 'This disc plays with the original progression and a shared camera.' });
    assert.deepEqual(online.newGame, { shown: true, enabled: true, label: 'New game' });
    // Both links, to the same room: one for the guests, one for this computer.
    assert.match(online.invite.url, /^https:\/\/[a-z0-9.-]+\/access\/[a-f0-9]{48}#/);
    assert.ok(online.openGame.startsWith(`http://127.0.0.1:${gamePort}/#`), 'the game opens on this computer');
    assert.equal(new URL(online.invite.url).hash, new URL(online.openGame).hash);
    assert.equal(online.invite.note, null);
    assert.equal(await panel.copyInvite(), true);
    assert.deepEqual(copied, [online.invite.url]);
    // The link for this computer leads into the room.
    const player = await joinRoom(netplayPort, gamePort, online.openGame);
    assert.equal((await player.answer).type, 'ready');
    await until('the player is in the room', async () => (await staged.command('status')).host.players.connected === 1);

    // A new game with the player in the room: the server's refusal is the page's question, and the second press says force.
    await panel.newGame();
    assert.deepEqual([views.at(-1).sentence, views.at(-1).newGame],
      ['Players are in the room: 1 connected, 0 away with a controller kept. A new game disconnects them. Start one anyway?',
        { shown: true, enabled: true, label: 'New game anyway' }]);
    await panel.newGame();
    assert.equal(views.at(-1).sentence, 'A new game is starting in the same room. The links stay the same.');
    assert.equal(await player.closed, 'The host started a new game. Open the invitation again to join.');
    player.socket.terminate();
    await until('the player has left', async () => (await staged.command('status')).host.players.connected === 0);
    await until('the next session of the room is open', async () => (await staged.command('status')).host.room === 'open');
    const read = views.length;
    await until('the page has read the room again', async () => views.length > read + 1);
    assert.deepEqual([views.at(-1).invite.url, views.at(-1).openGame], [online.invite.url, online.openGame], 'the links stay');

    // The diagnostic report, as the page saves it, names no folder and no secret.
    await panel.saveDiagnostics();
    assert.equal(files.length, 1);
    assert.match(files[0].name, /^sled-storm-server-diagnostics-\d{4}-\d{2}-\d{2}\.json$/);
    const diagnostics = JSON.parse(files[0].text);
    assert.deepEqual([diagnostics.application, diagnostics.host.state, diagnostics.config.gameFolder], ['Sled Storm Server', 'online', true]);
    const publicLink = new URL(online.invite.url);
    for (const secret of [bootstrap, session, folder, publicLink.hostname, publicLink.hash.slice(1), publicLink.pathname.split('/')[2]])
      assert.ok(!files[0].text.includes(secret), 'the saved report holds a folder or a secret');

    await panel.stop();
    const stopped = await shows('Stopped');
    assert.deepEqual(parts(stopped), { headline: 'Stopped', sentence: null, setup: { unfinished: false, folder, policy: 'shared-allowed', locked: false },
      start: { shown: true, enabled: true }, stop: { ...off, label: 'Stop Server' }, players: '0' });
    assert.deepEqual([stopped.invite, stopped.openGame, stopped.game], [{ url: null, note: null }, null, null]);
    assert.equal((await staged.command('status')).host.state, 'idle');
    assert.ok(await refused(gamePort) && await refused(netplayPort), 'nothing is hosted');

    await panel.quit();
    const { setup, quit, ...last } = views.at(-1);
    assert.deepEqual([last.headline, last.sentence, setup, quit], ['Not connected', 'The server has quit. Open Sled Storm Server to start it again.', null, null]);
    await untilGone(pid);
    assert.deepEqual(await staged.command('status'), { running: false });
    for (const program of await staged.tunnelPrograms()) await untilGone(program);
    for (const entry of await staged.browserLaunches()) await untilGone(entry.pid);
    // What the page asked for, in its order. Everything else was a reading.
    assert.deepEqual(sent, ['POST /api/game-folder/pick', 'PUT /api/config {"discPolicy":"shared-allowed"}',
      'PUT /api/config {"roomOptions":{"progress":"all","camera":false}}', 'POST /api/host/start', 'POST /api/room/new-game',
      'POST /api/room/new-game {"force":true}', 'POST /api/diagnostics/export', 'POST /api/room/stop', 'POST /api/host/quit']);

    const log = await readFile(join(staged.home, 'Library', 'Logs', 'Sled Storm Server', 'server.log'), 'utf8');
    for (const secret of [bootstrap, session, folder, new URL(online.openGame).hash.slice(1)])
      assert.ok(!log.includes(secret), 'the log holds no token, no session, no folder and no room');
    await staged.unchanged();
  } finally {
    reading = false;
    for (const entry of await staged.browserLaunches()) if (alive(entry.pid)) process.kill(entry.pid, 'SIGKILL');
    for (const program of await staged.tunnelPrograms()) if (alive(program)) process.kill(program, 'SIGKILL');
    if (pid && alive(pid)) process.kill(pid, 'SIGKILL');
    await staged.remove();
  }
});
