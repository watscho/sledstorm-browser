import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { copyFile, mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { promisify } from 'node:util';
import { brotliDecompressSync, gunzipSync } from 'node:zlib';
import { readJson, repoRoot, run, sha256File } from './lib.mjs';

const exec = promisify(execFile);
const cache = join(repoRoot, '.cache', 'p6-notices');
const lockFile = join(repoRoot, 'packaging', 'macos', 'notices.lock.json');
const creditsName = 'Chromium-credits.html';
const localNotices = {
  'SledStorm-LICENSE.txt': 'LICENSE',
  'THIRD_PARTY_NOTICES.md': 'THIRD_PARTY_NOTICES.md',
  'ws-LICENSE.txt': 'docs/licenses/ws-LICENSE.txt',
  'PeriBluGaming-NOTICE-LICENSE.txt': 'docs/licenses/port-LICENSE.txt',
};

async function downloadNotice(name, url, sha256) {
  const file = join(cache, name);
  if (await sha256File(file).catch(() => null) === sha256) return file;
  const staging = await mkdtemp(join(cache, 'fetch-'));
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(180_000) });
    if (!response.ok || !response.body) throw new Error(`Could not fetch ${name}: HTTP ${response.status}.`);
    const incoming = join(staging, name);
    await pipeline(Readable.fromWeb(response.body), createWriteStream(incoming));
    if (await sha256File(incoming) !== sha256) throw new Error(`Checksum mismatch for ${name}.`);
    await rename(incoming, file);
    return file;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

async function chromiumCredits(pin) {
  const file = join(cache, creditsName);
  if (await sha256File(file).catch(() => null) === pin.sha256) return file;
  const archive = await downloadNotice(pin.archive, pin.url, pin.archiveSha256);
  const { stdout: pak } = await exec('/usr/bin/unzip', ['-p', archive, '*/Resources/resources.pak'],
    { encoding: 'buffer', maxBuffer: 40 * 1024 * 1024 });
  // Chromium DataPack v5. Each six-byte entry is a resource ID and offset.
  if (pak.length < 12 || pak.readUInt32LE(0) !== 5) throw new Error('Unsupported Chromium resource pack.');
  const count = pak.readUInt16LE(8);
  if (pak.length < 12 + 6 * (count + 1)) throw new Error('Truncated Chromium resource pack.');
  for (let index = 0; index < count; index++) {
    const entry = 12 + 6 * index;
    if (pak.readUInt16LE(entry) !== pin.resourceId) continue;
    const compressed = pak.subarray(pak.readUInt32LE(entry + 2), pak.readUInt32LE(entry + 8));
    const bytes = compressed[0] === 0x1e && compressed[1] === 0x9b
      ? brotliDecompressSync(compressed.subarray(8)) : gunzipSync(compressed);
    if (createHash('sha256').update(bytes).digest('hex') !== pin.sha256) break;
    await writeFile(file, bytes);
    return file;
  }
  throw new Error('The pinned Chromium credits resource did not match.');
}

export async function stageMacosNotices(resources, manifest) {
  const { texts, chromiumCredits: credits } = await readJson(lockFile);
  const paths = [texts['Node-LICENSE.txt'].url, texts['cloudflared-LICENSE.txt'].url, texts['Chromium-LICENSE.txt'].url];
  const pins = [`/v${manifest.node.version}/`, `/${manifest.cloudflared.version}/`, `/${manifest.chromium.commit}/`];
  if (paths.some((url, index) => !url.includes(pins[index])) || manifest.chromium.commit !== credits.chromiumCommit) {
    throw new Error('Update the notice pins for the bundled runtime versions.');
  }
  const directory = join(resources, 'licenses');
  await mkdir(directory);
  await mkdir(cache, { recursive: true });
  const sources = Object.fromEntries(Object.entries(localNotices).map(([name, source]) => [name, join(repoRoot, source)]));
  for (const [name, pin] of Object.entries(texts)) sources[name] = await downloadNotice(name, pin.url, pin.sha256);
  sources[creditsName] = await chromiumCredits(credits);
  sources['EmulatorJS-LICENSE.txt'] = join(resources, 'emulator', 'emulatorjs', 'LICENSE');
  for (const [name, source] of Object.entries(sources)) await copyFile(source, join(directory, name));
  const coreLicense = await run('/usr/bin/unzip', ['-p', join(resources, 'emulator', 'network-core.data'), 'license.txt']);
  if (!coreLicense) throw new Error('The prepared core is missing its license.');
  await writeFile(join(directory, 'emulator-core-license.txt'), `${coreLicense}\n`);
  const names = [...Object.keys(sources), 'emulator-core-license.txt'];
  return Object.fromEntries(await Promise.all(names.map(async name => [name, await sha256File(join(directory, name))])));
}
