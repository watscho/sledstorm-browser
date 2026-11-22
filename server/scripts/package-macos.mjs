// Assemble the macOS window and its server helper, then sign the bundle ad hoc.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSea, bundleIdentifier } from './build-sea.mjs';
import { applicationName, distRoot, executableName, repoRoot, run } from './lib.mjs';
import { macosMinimum } from './macos-minimum.mjs';
import { stageMacosNotices } from './macos-notices.mjs';
import { bundleCopy } from './stage-resources.mjs';

export const applicationIcon = 'AppIcon.icns';

export async function packageMacos({ candidate = false } = {}) {
  if (process.platform !== 'darwin') throw new Error('The macOS application bundle is assembled on macOS.');
  const sea = await buildSea({ candidate });
  if (candidate && (!sea.manifest.chromium || !sea.manifest.cloudflared || !sea.manifest.emulator)) {
    throw new Error('A candidate requires the pinned Chromium, cloudflared and prepared emulator.');
  }

  const application = join(distRoot, 'macos', `${applicationName}.app`);
  await rm(application, { recursive: true, force: true });
  const contents = join(application, 'Contents');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  const helpers = join(contents, 'Helpers');
  await mkdir(helpers, { recursive: true });
  await cp(sea.executable, join(helpers, executableName));
  // The browser inside the resources is an application bundle of its own; its links must stay relative.
  const resources = join(contents, 'Resources');
  const packaging = join(repoRoot, 'packaging', 'macos');
  await run('/usr/bin/xcrun', ['swiftc', '-parse-as-library', '-target', 'arm64-apple-macos15.0', '-O',
    '-module-cache-path', join(distRoot, 'swift-module-cache'),
    join(packaging, 'ServerWindow.swift'), '-o', join(contents, 'MacOS', executableName)]);
  await cp(sea.resources, resources, bundleCopy);
  await cp(join(packaging, applicationIcon), join(resources, applicationIcon));
  const minimumSystem = await macosMinimum(contents);
  sea.manifest.macosMinimum = minimumSystem;
  if (candidate) sea.manifest.notices = await stageMacosNotices(resources, sea.manifest);
  await writeFile(join(resources, 'runtime-manifest.json'), `${JSON.stringify(sea.manifest, null, 2)}\n`);
  const template = await readFile(join(packaging, 'Info.plist'), 'utf8');
  const values = { NAME: applicationName, EXECUTABLE: executableName, IDENTIFIER: bundleIdentifier,
    ICON: applicationIcon, VERSION: sea.manifest.app.version, MINIMUM_SYSTEM: minimumSystem };
  await writeFile(join(contents, 'Info.plist'), template.replace(/@([A-Z_]+)@/g, (_match, key) => {
    if (!(key in values)) throw new Error(`Unknown Info.plist placeholder ${key}`);
    return values[key];
  }));

  // Sign last: the bundle must not change after it is sealed.
  await run('codesign', ['--force', '--sign', '-', application]);
  await run('codesign', ['--verify', '--deep', '--strict', application]);
  return { application };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { application } = await packageMacos();
  console.log(`Assembled ${relative(repoRoot, application)} with an ad-hoc signature.`);
}
