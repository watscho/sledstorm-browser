import { open, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { run } from './lib.mjs';

const machoMagic = new Set(['cffaedfe', 'feedfacf', 'cafebabe', 'cafebabf', 'bebafeca', 'bfbafeca']);

export async function isMachO(path) {
  const file = await open(path);
  try {
    const header = Buffer.alloc(4);
    const { bytesRead } = await file.read(header);
    return bytesRead === header.length && machoMagic.has(header.toString('hex'));
  } finally {
    await file.close();
  }
}

function versionParts(version) {
  const [major, minor, patch = 0] = version.split('.').map(Number);
  return major * 1_000_000 + minor * 1_000 + patch;
}

/** The newest deployment target among the actual Mach-O files shipped in the app. */
export async function macosMinimum(contents) {
  let minimum = null;
  const entries = await readdir(contents, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    if (!await isMachO(path)) continue;
    const header = await run('/usr/bin/vtool', ['-arch', 'arm64', '-show-build', path]);
    const version = /^\s*(?:minos|version) (\d+\.\d+(?:\.\d+)?)$/m.exec(header)?.[1];
    if (!version) throw new Error(`Cannot read the arm64 deployment target of ${entry.name}.`);
    if (minimum === null || versionParts(version) > versionParts(minimum)) minimum = version;
  }
  if (minimum === null) throw new Error('The application has no macOS executables.');
  return minimum;
}
