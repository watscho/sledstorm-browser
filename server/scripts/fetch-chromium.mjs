// Fetch the pinned Chromium that ships as the emulator's browser. It is a
// build from the Chromium project's own continuous build store, taken as it
// is. That store publishes no SHA-256 and promises no retention, so
// server/toolchain.lock.json holds the checksums computed when the build was
// chosen, and the verified archive is kept beside the unpacked browser: a
// later build on this machine does not need the store.
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { mkdir, mkdtemp, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { readJson, repoRoot, run, serverRoot, sha256File } from './lib.mjs';

/** Null on a platform without a pinned archive. */
export async function pinnedChromium() {
  const { chromium } = await readJson(join(serverRoot, 'toolchain.lock.json'));
  const platform = `${process.platform}-${process.arch}`;
  const archive = chromium.archives[platform];
  if (!archive) return null;
  const toolchain = join(repoRoot, '.cache', 'toolchain');
  const home = join(toolchain, `chromium-${archive.position}-${platform}`);
  const kept = join(toolchain, `chromium-${archive.position}-${platform}.zip`);
  const application = join(home, 'Chromium.app');
  const executable = join(application, archive.executable);
  const hashed = async file => await sha256File(file).catch(() => null);
  /** The launcher is a small stub and the framework holds the browser; both must be the pinned ones. */
  const pinnedFiles = async root => await hashed(join(root, archive.executable)) === archive.executableSha256
    && await hashed(join(root, archive.framework)) === archive.frameworkSha256;
  await mkdir(toolchain, { recursive: true });

  let archiveFrom = 'kept';
  if (await hashed(kept) !== archive.sha256) {
    archiveFrom = 'download';
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
      await rename(download, kept);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }

  let unpacked = 'kept';
  // The stamp is written last, so a browser with a stamp was unpacked whole.
  if ((await readJson(join(home, 'stamp.json')).catch(() => null))?.archiveSha256 !== archive.sha256 || !await pinnedFiles(application)) {
    unpacked = 'fresh';
    const staging = await mkdtemp(join(toolchain, 'fetch-'));
    try {
      // ditto keeps the symbolic links and the permissions of an application bundle.
      const extracted = join(staging, 'extracted');
      await run('/usr/bin/ditto', ['-x', '-k', kept, extracted]);
      const fresh = join(extracted, archive.application);
      if (!await pinnedFiles(fresh)) throw new Error('The unpacked Chromium is not the pinned build.');
      const version = await run(join(fresh, archive.executable), ['--version']);
      if (!version.split(' ').includes(chromium.version)) throw new Error(`Fetched Chromium reports: ${version}`);
      const next = join(staging, 'home');
      await mkdir(next);
      await rename(fresh, join(next, 'Chromium.app'));
      await writeFile(join(next, 'stamp.json'), JSON.stringify({ archiveSha256: archive.sha256 }));
      await rm(home, { recursive: true, force: true });
      await rename(next, home);
    } finally {
      await rm(staging, { recursive: true, force: true });
    }
  }
  return { application, executable, version: chromium.version, position: archive.position, commit: archive.commit, platform,
    archive: kept, archiveApplication: archive.application, archiveSha256: archive.sha256, executableSha256: archive.executableSha256,
    frameworkSha256: archive.frameworkSha256, archiveFrom, unpacked };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const browser = await pinnedChromium();
  console.log(browser
    ? `Chromium ${browser.version} (${browser.position}) for ${browser.platform}: ${browser.application} (archive: ${browser.archiveFrom}, browser: ${browser.unpacked})`
    : 'No pinned Chromium for this platform.');
}
