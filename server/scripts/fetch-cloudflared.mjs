// Fetch the pinned cloudflared that ships as the tunnel program. The archive
// and the binary inside it are both verified against server/toolchain.lock.json:
// the publisher states the binary's SHA-256 in its release notes, and the
// archive's SHA-256 is the digest of the release asset.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { readJson, repoRoot, run, serverRoot, sha256File } from './lib.mjs';

/** Null on a platform without a pinned archive. */
export async function pinnedCloudflared() {
  const { cloudflared } = await readJson(join(serverRoot, 'toolchain.lock.json'));
  const platform = `${process.platform}-${process.arch}`;
  const archive = cloudflared.archives[platform];
  if (!archive) return null;
  const toolchain = join(repoRoot, '.cache', 'toolchain');
  const home = join(toolchain, `cloudflared-${cloudflared.version}-${platform}`);
  const binary = join(home, 'cloudflared');
  const result = { path: binary, version: cloudflared.version, platform, archive: archive.file,
    archiveSha256: archive.sha256, binarySha256: archive.binarySha256 };
  if (await sha256File(binary).catch(() => null) === archive.binarySha256) return result;

  await mkdir(toolchain, { recursive: true });
  // A fresh, empty directory holds the download until it has been verified.
  const staging = await mkdtemp(join(toolchain, 'fetch-'));
  try {
    const download = join(staging, archive.file);
    const response = await fetch(archive.url);
    if (!response.ok || !response.body) throw new Error(`Download failed with HTTP ${response.status}`);
    const hash = createHash('sha256');
    const digest = new Transform({ transform(chunk, _encoding, done) { hash.update(chunk); done(null, chunk); } });
    await pipeline(Readable.fromWeb(response.body), digest, createWriteStream(download));
    const actual = hash.digest('hex');
    if (actual !== archive.sha256) throw new Error(`${archive.file} has SHA-256 ${actual}, expected ${archive.sha256}`);
    const extracted = join(staging, 'extracted');
    await mkdir(extracted);
    await run('tar', ['-xzf', download, '-C', extracted, 'cloudflared']);
    const inside = await sha256File(join(extracted, 'cloudflared'));
    if (inside !== archive.binarySha256) throw new Error(`cloudflared has SHA-256 ${inside}, expected ${archive.binarySha256}`);
    const version = await run(join(extracted, 'cloudflared'), ['--version']);
    if (!version.includes(` ${cloudflared.version} `)) throw new Error(`Fetched cloudflared reports: ${version}`);
    await writeFile(join(extracted, 'stamp.json'), JSON.stringify({ archiveSha256: archive.sha256, binarySha256: inside }));
    await rm(home, { recursive: true, force: true });
    await rename(extracted, home);
    return result;
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const program = await pinnedCloudflared();
  console.log(program ? `cloudflared ${program.version} for ${program.platform}: ${program.path}` : 'No pinned cloudflared for this platform.');
}
