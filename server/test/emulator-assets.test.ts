import assert from 'node:assert/strict';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { loadEmulatorAssets, MissingAssetsError } from '../src/emulator-assets.ts';
import { lock, nativeBuild, scratch, stageAssets } from './fixtures.ts';

test('a complete tree loads', async t => {
  const root = await stageAssets(await scratch(t, 'assets'));
  const assets = await loadEmulatorAssets(root);
  assert.equal(assets.webRoot, join(root, 'web'));
  assert.equal(assets.emulatorRoot, join(root, 'emulator', 'emulatorjs'));
  assert.equal(assets.coreData, join(root, 'emulator', 'network-core.data'));
  assert.deepEqual(assets.identity, { core: lock.files['cores/pcsx_rearmed-wasm.data'], adapter: 'pcsx-frame-gate-v3',
    native: nativeBuild.files });
  // The gateway's list for each disc policy: only the shared one passes the archive.
  for (const mode of ['local', 'shared'] as const) {
    const paths = assets.assetPaths(mode);
    for (const path of ['/', '/app.js', '/session-info', '/network-core.data', '/emulator/loader.js',
      '/emulator/cores/pcsx_rearmed-wasm.data']) assert.ok(paths.has(path), `${mode} ${path}`);
    assert.equal(paths.has('/disc.zip'), mode === 'shared', mode);
    assert.ok(!paths.has('/api/status'));
  }

  assert.equal(assets.hardwareRenderer, false);
  await mkdir(join(root, 'web', 'generated'));
  await writeFile(join(root, 'web', 'generated', 'enge-hardware.js'), 'export {};\n');
  assert.equal((await loadEmulatorAssets(root)).hardwareRenderer, true);
});

test('each missing piece is named', async t => {
  for (const piece of ['web/index.html', 'emulator/emulator.lock.json', 'emulator/native-build.json',
    'emulator/network-core.data', 'emulator/emulatorjs/loader.js', 'emulator/emulatorjs/cores/pcsx_rearmed-wasm.data']) {
    const root = await stageAssets(await scratch(t, 'assets'));
    await rm(join(root, piece));
    await assert.rejects(loadEmulatorAssets(root), error => {
      assert.ok(error instanceof MissingAssetsError, String(error));
      assert.ok(error.message.includes(piece), `${piece}: ${error.message}`);
      return true;
    });
  }
});

test('a damaged lock or build record is reported, not trusted', async t => {
  for (const [piece, content] of [['emulator/emulator.lock.json', 'not json'], ['emulator/emulator.lock.json', '{"files":[]}'],
    ['emulator/emulator.lock.json', '{"files":{"loader.js":"x"}}'], ['emulator/native-build.json', '{}']] as const) {
    const root = await stageAssets(await scratch(t, 'assets'));
    await writeFile(join(root, piece), content);
    await assert.rejects(loadEmulatorAssets(root), error => {
      assert.ok(error instanceof MissingAssetsError, String(error));
      assert.ok(error.message.includes(piece), `${piece}: ${error.message}`);
      return true;
    });
  }
});
