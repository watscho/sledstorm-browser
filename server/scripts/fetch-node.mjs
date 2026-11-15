// Fetch the pinned Node.js runtime that becomes the single executable.
// The archive is verified against server/toolchain.lock.json before use.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { readJson, repoRoot, run, serverRoot, sha256File } from './lib.mjs';

export async function pinnedNode() {
  const { node } = await readJson(join(serverRoot, 'toolchain.lock.json'));
  const platform = `${process.platform}-${process.arch}`;
  const archive = node.archives[platform];
  if (!archive) throw new Error(`No pinned Node.js archive for ${platform}`);
  const toolchain = join(repoRoot, '.cache', 'toolchain');
  const home = join(toolchain, archive.file.replace(/\.tar\.gz$/, ''));
  const binary = join(home, 'node');
  const stampPath = join(home, 'stamp.json');
  const result = sha256 => ({ path: binary, version: node.version, platform, archive: archive.file,
    archiveSha256: archive.sha256, binarySha256: sha256 });

  try {
    const stamp = await readJson(stampPath);
    if (stamp.archiveSha256 === archive.sha256 && stamp.binarySha256 === await sha256File(binary))
      return result(stamp.binarySha256);
  } catch { /* Not fetched yet, or the cached copy does not match the pin. */ }

  await mkdir(toolchain, { recursive: true });
  // A fresh, empty directory holds the download until it has been verified.
  const staging = await mkdtemp(join(toolchain, 'fetch-'));
  try {
    const download = join(staging, archive.file);
    const response = await fetch(new URL(archive.file, node.dist));
    if (!response.ok || !response.body) throw new Error(`Download failed with HTTP ${response.status}`);
    const hash = createHash('sha256');
    const digest = new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); done(null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), digest, createWriteStream(download));
    const actual = hash.digest('hex');
    if (actual !== archive.sha256)
      throw new Error(`${archive.file} has SHA-256 ${actual}, expected ${archive.sha256}`);
    const extracted = join(staging, 'extracted');
    await mkdir(extracted);
    await run('tar', ['-xzf', download, '-C', extracted, '--strip-components', '2',
      `${archive.file.replace(/\.tar\.gz$/, '')}/bin/node`]);
    const version = await run(join(extracted, 'node'), ['--version']);
    if (version !== `v${node.version}`) throw new Error(`Fetched Node.js reports ${version}`);
    const binarySha256 = await sha256File(join(extracted, 'node'));
    await writeFile(join(extracted, 'stamp.json'), JSON.stringify({ archiveSha256: archive.sha256, binarySha256 }));
    await rm(home, { recursive: true, force: true });
    await rename(extracted, home);
    return result(binarySha256);
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const node = await pinnedNode();
  console.log(`Node.js ${node.version} for ${node.platform}: ${node.path}`);
}
