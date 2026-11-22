// The prebuilt game runtime inside the read-only resource root: the web
// client, the pinned EmulatorJS files and the prepared core. The packaged
// server never builds or patches any of it; it only checks that it is there.
import { access, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { emulatorAssetPaths } from './network.ts';

export interface EmulatorAssets {
  webRoot: string;
  emulatorRoot: string;
  coreData: string;
  hardwareRenderer: boolean;
  /** Paths the public gateway may serve: in its `shared` mode the archive is one of them, in its `local` mode it is not. */
  assetPaths(mode: 'local' | 'shared'): Set<string>;
  identity: { core: string; adapter: 'pcsx-frame-gate-v3'; native: Record<string, string> };
}

export class MissingAssetsError extends Error {}

const exists = (path: string) => access(path).then(() => true, () => false);
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

export async function loadEmulatorAssets(resourceRoot: string): Promise<EmulatorAssets> {
  const need = async (piece: string) => {
    if (!await exists(join(resourceRoot, piece))) throw new MissingAssetsError(`This build is missing a runtime file: ${piece}.`);
  };
  const json = async (piece: string): Promise<unknown> => {
    await need(piece);
    try { return JSON.parse(await readFile(join(resourceRoot, piece), 'utf8')); }
    catch { throw new MissingAssetsError(`This build has a damaged runtime file: ${piece}.`); }
  };
  const damaged = (piece: string) => new MissingAssetsError(`This build has a damaged runtime file: ${piece}.`);

  await need('web/index.html');
  const lock = await json('emulator/emulator.lock.json');
  const files = record(lock) ? lock.files : null;
  const core = record(files) ? files['cores/pcsx_rearmed-wasm.data'] : null;
  if (!record(files) || typeof core !== 'string'
      || !Object.entries(files).every(([name, hash]) => /^[\w.-]+(\/[\w.-]+)*$/.test(name) && !name.split('/').includes('..')
        && typeof hash === 'string' && /^[a-f0-9]{64}$/.test(hash)))
    throw damaged('emulator/emulator.lock.json');
  const build = await json('emulator/native-build.json');
  const native = record(build) ? build.files : null;
  if (!record(native) || !Object.values(native).every(hash => typeof hash === 'string'))
    throw damaged('emulator/native-build.json');
  await need('emulator/network-core.data');
  for (const name of Object.keys(files)) await need(`emulator/emulatorjs/${name}`);

  const webRoot = join(resourceRoot, 'web');
  return {
    webRoot,
    emulatorRoot: join(resourceRoot, 'emulator', 'emulatorjs'),
    coreData: join(resourceRoot, 'emulator', 'network-core.data'),
    hardwareRenderer: await exists(join(webRoot, 'generated', 'enge-hardware.js')),
    assetPaths: mode => {
      const assets = emulatorAssetPaths({ files: files as Record<string, string> }, mode);
      assets.delete('/session-client.js');
      assets.delete('/frame-sync.js');
      return assets;
    },
    identity: { core, adapter: 'pcsx-frame-gate-v3', native: native as Record<string, string> },
  };
}
