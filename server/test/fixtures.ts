// Synthetic resources and game folders shared by several test files. None of
// this is game data: tracks are random bytes and emulator files are stubs.
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { ensureWritableRoots, type Paths } from '../src/paths.ts';

export async function scratch(t: TestContext, label: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), `sled ${label} тест `)));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

export const lock = { files: { 'loader.js': 'a'.repeat(64), 'cores/pcsx_rearmed-wasm.data': 'b'.repeat(64) } };
export const nativeBuild = { files: { 'pcsx_rearmed_libretro.wasm': 'c'.repeat(64) }, patches: {} };

/** A complete resource root with stub files. */
export async function stageAssets(resourceRoot: string): Promise<string> {
  const emulator = join(resourceRoot, 'emulator');
  await mkdir(join(resourceRoot, 'web'), { recursive: true });
  await mkdir(join(emulator, 'emulatorjs', 'cores'), { recursive: true });
  await writeFile(join(resourceRoot, 'web', 'index.html'), '<!doctype html><title>Synthetic client</title>');
  await writeFile(join(resourceRoot, 'web', 'app.js'), 'export {};\n');
  await writeFile(join(emulator, 'emulator.lock.json'), JSON.stringify(lock));
  await writeFile(join(emulator, 'native-build.json'), JSON.stringify(nativeBuild));
  await writeFile(join(emulator, 'network-core.data'), 'synthetic core');
  await writeFile(join(emulator, 'emulatorjs', 'loader.js'), '// synthetic loader\n');
  await writeFile(join(emulator, 'emulatorjs', 'cores', 'pcsx_rearmed-wasm.data'), 'synthetic archive');
  return resourceRoot;
}

/** A CUE and two tracks of random bytes. */
export async function writeGame(folder: string): Promise<string> {
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'Track 01.bin'), randomBytes(4000));
  await writeFile(join(folder, 'Трек 02.bin'), randomBytes(2500));
  await writeFile(join(folder, 'Game.cue'),
    'FILE "Track 01.bin" BINARY\r\n  TRACK 01 MODE2/2352\r\nFILE "Трек 02.bin" BINARY\r\n  TRACK 02 AUDIO\r\n');
  return folder;
}

/** Paths under a scratch directory, with staged assets as the resource root. */
export async function scratchPaths(t: TestContext, label: string): Promise<Paths & { root: string }> {
  const root = await scratch(t, label);
  const paths = { resourceRoot: await stageAssets(join(root, 'resources')), dataRoot: join(root, 'data'),
    cacheRoot: join(root, 'cache'), logRoot: join(root, 'logs'), tempRoot: join(root, 'temporary') };
  await ensureWritableRoots(paths);
  await mkdir(paths.tempRoot, { recursive: true });
  return { ...paths, root };
}
