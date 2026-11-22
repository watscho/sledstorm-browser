// The diagnostic report that the owner saves from the panel or prints with a
// command. It must name no folder and no secret, even when the log holds one.
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import type { HostConfig } from '../src/config-store.ts';
import { diagnosticReport, readLogTail, scrubLine } from '../src/diagnostics.ts';
import type { HostStatus } from '../src/host-service.ts';
import { scratch, scratchPaths, writeGame } from './fixtures.ts';

test('the filter takes out folders, tokens, public names and fragments', () => {
  const home = '/Users/Ада Lovelace';
  const folder = `${home}/Игры/Мой Sled Storm`;
  assert.notEqual(folder.normalize('NFD'), folder, 'a letter of the folder has another normal form');
  const secrets = { folder, home };
  assert.equal(scrubLine(`Prepared ${folder}/Game.cue in 3 s.`, secrets), 'Prepared <game folder>/Game.cue in 3 s.');
  assert.equal(scrubLine(`A profile under ${home}/Library/Caches.`, secrets), 'A profile under ~/Library/Caches.');
  // The home folder is a prefix of the saved one: nothing of the folder's path may be left behind it.
  assert.equal(scrubLine(`${folder} and ${home}`, secrets), '<game folder> and ~');
  // The folder as an address spells it, and in the other normal form of its letters.
  assert.equal(scrubLine(`file://${encodeURI(folder)}/Game.cue`, secrets), 'file://<game folder>/Game.cue');
  assert.equal(scrubLine(`Read ${folder.normalize('NFD')}.`, secrets), 'Read <game folder>.');

  // Every run of sixteen or more hexadecimal digits, and none shorter.
  assert.equal(scrubLine(`instance ${'a1'.repeat(8)}, token ${'F'.repeat(64)}, code 0123456789abcde`, secrets),
    'instance <hex>, token <hex>, code 0123456789abcde');
  assert.equal(scrubLine('Started in 1234567890123456 ms.', secrets), 'Started in <hex> ms.');

  assert.equal(scrubLine('The tunnel quiet-river-lamp.trycloudflare.com is up.', secrets), 'The tunnel <public host> is up.');
  assert.equal(scrubLine('No trycloudflare.com name yet.', secrets), 'No trycloudflare.com name yet.', 'the service itself is no secret');
  assert.equal(scrubLine('Open http://127.0.0.1:8000/#cm9vbQ==+/x then http://127.0.0.1:5000/#bootstrap=abc', secrets),
    'Open http://127.0.0.1:8000/#<fragment> then http://127.0.0.1:5000/#<fragment>');
  assert.equal(scrubLine('Room #2 is not an address.', secrets), 'Room #2 is not an address.');

  // Two kinds on one line: the invitation for guests.
  const invitation = `https://a-b-c.trycloudflare.com/access/${'e'.repeat(48)}#${Buffer.from('{"room":"x"}').toString('base64')}`;
  assert.equal(scrubLine(`Link "${invitation}" for ${folder}`, secrets), 'Link "https://<public host>/access/<hex>#<fragment>" for <game folder>');

  // Without a saved folder, or with a home folder that is the root, nothing else is taken.
  assert.equal(scrubLine(`${folder}`, { folder: null, home }), '~/Игры/Мой Sled Storm');
  assert.equal(scrubLine('/Users/x/a', { folder: null, home: '/' }), '/Users/x/a');
});

test('the filter takes a long line in linear time, and a run of 513 or more characters without a space goes whole', () => {
  const secrets = { folder: null, home: '/Users/someone' };
  // Each of these took seconds when every start of the line was matched to its end.
  const started = performance.now();
  for (const unit of ['/', 'a', 'a.', 'http://'])
    assert.equal(scrubLine(unit.repeat(Math.ceil(65536 / unit.length)), secrets), '<long text>', unit);
  assert.ok(performance.now() - started < 1000, `the filter took ${Math.round(performance.now() - started)} ms`);
  // The cut lies above every address that the server writes: an invitation keeps its address and loses its fragment.
  const link = `http://127.0.0.1:8000/#${'x'.repeat(480)}`;
  assert.equal(scrubLine(`Open ${link} now`, secrets), 'Open http://127.0.0.1:8000/#<fragment> now');
  assert.equal(scrubLine(`Open ${link}${'y'.repeat(10)} now`, secrets), 'Open <long text> now');
});

test('the tail of the log is its last whole lines, within the bound', async t => {
  const root = await scratch(t, 'log tail');
  const file = join(root, 'server.log');
  assert.deepEqual(await readLogTail(file), [], 'a missing log has no lines');
  await writeFile(file, '');
  assert.deepEqual(await readLogTail(file), []);

  const numbered = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, index) => `line ${from + index}`);
  await writeFile(file, `${numbered(1, 300).join('\n')}\n`);
  assert.deepEqual(await readLogTail(file), numbered(101, 300));
  assert.deepEqual(await readLogTail(file, { lines: 5 }), numbered(296, 300));

  // A bound in bytes cuts the oldest line it reaches, and that line is left out whole.
  await writeFile(file, Array.from({ length: 1000 }, (_, index) => `${String(index).padStart(4, '0')} ${'x'.repeat(94)}`).join('\n'));
  const tail = await readLogTail(file, { bytes: 1050 });
  assert.equal(tail.length, 10);
  assert.equal(tail.at(-1), `0999 ${'x'.repeat(94)}`, 'a last line without its newline is still a line');
  assert.ok(tail.every(line => line.length === 99), 'no line is cut');

  // A line that is longer than the bound is not given at all.
  await writeFile(file, `${'y'.repeat(5000)}\n`);
  assert.deepEqual(await readLogTail(file, { bytes: 1000 }), []);

  // Bytes that are not UTF-8 are replaced, and so is a letter whose first bytes the bound cut off.
  await writeFile(file, Buffer.concat([Buffer.from('ok\nbad '), Buffer.from([0xff, 0xfe]), Buffer.from(' end\nдиск\n')]));
  assert.deepEqual(await readLogTail(file), ['ok', 'bad �� end', 'диск']);
  await writeFile(file, Buffer.from('дд\nok\n'));
  assert.deepEqual(await readLogTail(file, { bytes: 5 }), ['ok']);
});

const manifest = { schema: 1, app: { name: 'Sled Storm Server', version: '9.9.9' }, platform: 'darwin-arm64',
  node: { version: '26.13.1', binarySha256: '1'.repeat(64) }, server: { sha256: 'd'.repeat(64) },
  cloudflared: { version: '2026.10.7' }, chromium: { version: '158.0.8127.0' } };

const online: HostStatus = { state: 'online', problem: null, game: { pal: false, archiveBytes: 1234, tracks: 2 },
  localUrl: 'http://127.0.0.1:8000/', gatewayPort: 8005, tunnel: 'online', mirror: 'online', room: 'open',
  players: { connected: 1, reserved: 0 }, roomOptions: { progress: 'original', camera: false } };

test('a report holds no secret even when the log does', async t => {
  const paths = await scratchPaths(t, 'diagnostics');
  // The user's home folder holds the game folder and the server's own folders.
  const home = paths.root;
  const folder = await writeGame(join(home, 'Игры', 'Sled Storm диск'));
  const token = randomBytes(32).toString('hex');
  const fragment = Buffer.from(JSON.stringify({ room: 'r', token })).toString('base64');
  const invitation = `https://quiet-river-lamp.trycloudflare.com/access/${'e'.repeat(48)}#${fragment}`;
  await writeFile(join(paths.logRoot, 'server.log'), [
    `2026-11-21T10:00:00.000Z Ready on 127.0.0.1:50123, instance ${'ab'.repeat(8)}, version 9.9.9.`,
    `2026-11-21T10:00:01.000Z Seeded ${folder} ${token} ${invitation}`,
    `2026-11-21T10:00:02.000Z A profile under ${home}/Library/Caches.`,
  ].join('\n'));
  await writeFile(join(paths.resourceRoot, 'runtime-manifest.json'), JSON.stringify(manifest));
  await mkdir(join(paths.resourceRoot, 'chromium', 'Chromium.app', 'Contents', 'MacOS'), { recursive: true });
  await writeFile(join(paths.resourceRoot, 'chromium', 'Chromium.app', 'Contents', 'MacOS', 'Chromium'), '');
  const status: HostStatus = { ...online, state: 'degraded',
    problem: { component: 'room', message: `The room could not be started (${folder} went away). Start the server again.` } };
  const config: HostConfig = { version: 1, gameFolder: folder, discPolicy: 'shared-allowed', autoStart: false,
    roomOptions: { progress: 'original', camera: false } };

  const report = await diagnosticReport({ paths, version: '9.9.9', status, config: { config, problem: null },
    now: new Date('2026-11-21T10:00:30.500Z'), startedAt: '2026-11-21T10:00:00.000Z', home });
  const text = JSON.stringify(report);
  for (const secret of [folder, home, token, fragment, 'quiet-river-lamp', 'e'.repeat(48), 'ab'.repeat(8)])
    assert.ok(!text.includes(secret), `the report holds ${secret}`);

  assert.deepEqual({ application: report.application, version: report.version, generatedAt: report.generatedAt,
    startedAt: report.startedAt, uptimeSeconds: report.uptimeSeconds },
  { application: 'Sled Storm Server', version: '9.9.9', generatedAt: '2026-11-21T10:00:30.500Z', startedAt: '2026-11-21T10:00:00.000Z',
    uptimeSeconds: 30 });
  assert.deepEqual({ platform: report.system.platform, arch: report.system.arch, node: report.system.node },
    { platform: process.platform, arch: process.arch, node: process.versions.node });
  assert.equal(typeof report.system.release, 'string');
  assert.deepEqual(report.manifest, manifest, 'the manifest of the build, as it is');
  assert.deepEqual(report.parts, { web: true, emulator: true, browser: true, tunnel: false, panel: false });
  assert.deepEqual(report.host, { ...status, problem: { component: 'room',
    message: 'The room could not be started (<game folder> went away). Start the server again.' } });
  assert.deepEqual(report.config, { gameFolder: true, discPolicy: 'shared-allowed', autoStart: false,
    roomOptions: { progress: 'original', camera: false }, problem: null });
  assert.deepEqual(report.log, { lines: [
    '2026-11-21T10:00:00.000Z Ready on 127.0.0.1:50123, instance <hex>, version 9.9.9.',
    '2026-11-21T10:00:01.000Z Seeded <game folder> <hex> https://<public host>/access/<hex>#<fragment>',
    '2026-11-21T10:00:02.000Z A profile under ~/Library/Caches.',
  ], problem: null });

  // A huge log gives a bounded report.
  await writeFile(join(paths.logRoot, 'server.log'), `${Array.from({ length: 5000 }, (_, index) => `${index} ${'z'.repeat(300)}`).join('\n')}\n`);
  const bounded = await diagnosticReport({ paths, version: '9.9.9', status, config: { config, problem: null },
    now: new Date('2026-11-21T10:00:30.500Z'), startedAt: '2026-11-21T10:00:00.000Z', home });
  assert.ok(bounded.log.lines.length > 0 && bounded.log.lines.length <= 200);
  assert.equal(bounded.log.lines.at(-1), `4999 ${'z'.repeat(300)}`);
  assert.ok(JSON.stringify(bounded).length < 80_000, `${JSON.stringify(bounded).length} characters`);
});

test('a report without a manifest, a log or a server says so', async t => {
  const paths = await scratchPaths(t, 'diagnostics');
  const config: HostConfig = { version: 1, gameFolder: null, discPolicy: null, autoStart: true, roomOptions: { progress: 'all', camera: true } };
  const problem = 'The configuration file is damaged. Choose the game folder again.';
  // A command makes the report itself when no server runs: nothing is hosted, and nothing has started.
  const report = await diagnosticReport({ paths, version: '9.9.9', status: null, config: { config, problem },
    now: new Date('2026-11-21T10:00:00.000Z'), startedAt: null, home: paths.root });
  assert.equal(report.manifest, null);
  assert.deepEqual({ host: report.host, startedAt: report.startedAt, uptimeSeconds: report.uptimeSeconds },
    { host: null, startedAt: null, uptimeSeconds: null });
  assert.deepEqual(report.config, { gameFolder: false, discPolicy: null, autoStart: true, roomOptions: { progress: 'all', camera: true }, problem });
  assert.deepEqual(report.log, { lines: [], problem: null }, 'a missing log is no problem: nothing was written yet');

  // A manifest that is not JSON is no manifest, and a log that cannot be read is said to be so.
  await writeFile(join(paths.resourceRoot, 'runtime-manifest.json'), 'not json');
  await mkdir(join(paths.logRoot, 'server.log'));
  const damaged = await diagnosticReport({ paths, version: '9.9.9', status: online, config: { config, problem: null },
    now: new Date('2026-11-21T10:00:00.000Z'), startedAt: '2026-11-21T10:00:00.000Z', home: paths.root });
  assert.equal(damaged.manifest, null);
  assert.deepEqual(damaged.log, { lines: [], problem: 'The log could not be read.' });
});
