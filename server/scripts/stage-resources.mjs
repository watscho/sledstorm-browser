// Copy the game runtime into a resource directory: always the web client,
// and the emulator files when this checkout has been bootstrapped and built
// (docs/setup.md). Nothing is downloaded or compiled here.
import { access, cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { readJson, repoRoot, sha256File } from './lib.mjs';

const exists = path => access(path).then(() => true, () => false);

export async function stageResources(target) {
  await cp(join(repoRoot, 'web'), join(target, 'web'), { recursive: true, filter: source => !source.endsWith('.test.mjs') });

  const lockPath = join(repoRoot, 'emulator.lock.json');
  const corePath = join(repoRoot, '.cache', 'emulator-network-core.data');
  const buildPath = join(repoRoot, '.cache', 'emulator-native-build.json');
  const vendor = join(repoRoot, 'vendor', 'emulatorjs');
  const names = Object.keys((await readJson(lockPath)).files);
  const sources = [corePath, buildPath, ...names.map(name => join(vendor, name))];
  if (!(await Promise.all(sources.map(exists))).every(Boolean)) return { emulator: null };

  const emulator = join(target, 'emulator');
  await mkdir(emulator, { recursive: true });
  await cp(lockPath, join(emulator, 'emulator.lock.json'));
  await cp(corePath, join(emulator, 'network-core.data'));
  await cp(buildPath, join(emulator, 'native-build.json'));
  for (const name of names) {
    await mkdir(dirname(join(emulator, 'emulatorjs', name)), { recursive: true });
    await cp(join(vendor, name), join(emulator, 'emulatorjs', name));
  }
  return { emulator: { lock: await sha256File(lockPath), coreData: await sha256File(corePath),
    nativeBuild: await sha256File(buildPath) } };
}
