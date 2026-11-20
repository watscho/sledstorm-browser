import assert from 'node:assert/strict';
import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import test, { type TestContext } from 'node:test';
import { defaultConfig, readConfig, writeConfig, type HostConfig } from '../src/config-store.ts';
import { configure } from '../src/control.ts';
import { scratchPaths, writeGame } from './fixtures.ts';

const configured: HostConfig = { version: 1, gameFolder: '/games/Sled Storm диск', discPolicy: 'shared-allowed' };

function capture(t: TestContext) {
  const out = t.mock.method(console, 'log', () => {});
  const errors = t.mock.method(console, 'error', () => {});
  return {
    printed: () => out.mock.calls.map(call => JSON.parse(String(call.arguments[0])) as Record<string, unknown>),
    complaints: () => errors.mock.calls.map(call => String(call.arguments[0])),
  };
}

test('a missing file gives the defaults without a problem', async t => {
  const paths = await scratchPaths(t, 'config');
  assert.deepEqual(defaultConfig, { version: 1, gameFolder: null, discPolicy: null });
  assert.deepEqual(await readConfig(paths), { config: defaultConfig, problem: null });
});

test('a written configuration reads back and is private', async t => {
  const paths = await scratchPaths(t, 'config');
  await writeConfig(paths, configured);
  assert.deepEqual(await readConfig(paths), { config: configured, problem: null });
  assert.equal((await stat(join(paths.dataRoot, 'config.json'))).mode & 0o777, 0o600);
  assert.deepEqual(await readdir(paths.dataRoot), ['config.json'], 'no temporary or backup file is left');
  await writeConfig(paths, { ...configured, discPolicy: 'local-only' });
  assert.equal((await readConfig(paths)).config.discPolicy, 'local-only');
  assert.deepEqual(await readdir(paths.dataRoot), ['config.json'], 'replacing a healthy file keeps no backup');
});

test('a file from version 1 without optional keys is healthy', async t => {
  const paths = await scratchPaths(t, 'config');
  await writeFile(join(paths.dataRoot, 'config.json'), '{"version":1}');
  assert.deepEqual(await readConfig(paths), { config: defaultConfig, problem: null });
});

test('damaged content is reported and kept', async t => {
  const paths = await scratchPaths(t, 'config');
  const file = join(paths.dataRoot, 'config.json');
  for (const content of ['', 'not json', '[]', 'null', '{"gameFolder":null,"discPolicy":null}',
    '{"version":1,"gameFolder":7,"discPolicy":null}', '{"version":1,"gameFolder":"relative/path","discPolicy":null}',
    '{"version":1,"gameFolder":null,"discPolicy":"everything"}', '{"version":0}']) {
    await writeFile(file, content);
    const { config, problem } = await readConfig(paths);
    assert.deepEqual(config, defaultConfig, content);
    assert.match(String(problem), /damaged/, content);
    assert.equal(await readFile(file, 'utf8'), content, 'reading never changes the file');
  }
});

test('a newer version is reported and kept', async t => {
  const paths = await scratchPaths(t, 'config');
  const file = join(paths.dataRoot, 'config.json');
  await writeFile(file, '{"version":2,"gameFolder":"/games/x","rooms":[]}');
  const { config, problem } = await readConfig(paths);
  assert.deepEqual(config, defaultConfig);
  assert.match(String(problem), /newer version/);
  assert.equal(await readFile(file, 'utf8'), '{"version":2,"gameFolder":"/games/x","rooms":[]}');
});

test('writing over a damaged file keeps it as config.json.bad', async t => {
  const paths = await scratchPaths(t, 'config');
  await writeFile(join(paths.dataRoot, 'config.json'), 'not json');
  await writeConfig(paths, configured);
  assert.equal(await readFile(join(paths.dataRoot, 'config.json.bad'), 'utf8'), 'not json');
  assert.deepEqual(await readConfig(paths), { config: configured, problem: null });
});

test('configure stores a valid folder and policy', async t => {
  const paths = await scratchPaths(t, 'config');
  const folder = await writeGame(join(paths.root, 'My Games', 'Sled Storm диск'));
  const output = capture(t);
  assert.equal(await configure(paths, ['--game-folder', relative(process.cwd(), folder), '--disc-policy', 'shared-allowed']), 0);
  assert.deepEqual(output.printed(), [{ event: 'configured', gameFolder: folder, discPolicy: 'shared-allowed', tracks: 2,
    restartRequired: false }]);
  assert.deepEqual(await readConfig(paths), { config: { version: 1, gameFolder: folder, discPolicy: 'shared-allowed' }, problem: null });
});

test('configure refuses a folder without a disc, a missing option and an unknown policy', async t => {
  const paths = await scratchPaths(t, 'config');
  const folder = await writeGame(join(paths.root, 'game'));
  const empty = join(paths.root, 'empty');
  await mkdir(empty);
  const output = capture(t);
  for (const argv of [['--game-folder', empty, '--disc-policy', 'shared-allowed'], ['--game-folder', folder],
    ['--disc-policy', 'local-only'], ['--game-folder', folder, '--disc-policy', 'public'],
    ['--game-folder', folder, '--disc-policy', 'local-only', '--verbose', 'yes'], ['--game-folder']])
    assert.equal(await configure(paths, argv), 2, argv.join(' '));
  assert.equal(output.complaints()[0], 'Expected exactly one CUE file in the game folder.');
  assert.match(output.complaints()[1]!, /^Usage: SledStormServer configure /);
  assert.deepEqual(output.printed(), []);
  assert.deepEqual(await readdir(paths.dataRoot), [], 'a refused request writes nothing');
});
