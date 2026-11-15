// Assemble the draft macOS application bundle around the single executable.
// The signature is ad-hoc: enough to run on the build machine, not a release.
import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSea, bundleIdentifier } from './build-sea.mjs';
import { applicationName, distRoot, executableName, repoRoot, run } from './lib.mjs';

// The oldest macOS that the pinned Node.js binary declares in its load commands.
const minimumSystem = '13.5';

export async function packageMacos() {
  if (process.platform !== 'darwin') throw new Error('The macOS application bundle is assembled on macOS.');
  const sea = await buildSea();
  const declared = /minos (\S+)/.exec(await run('otool', ['-l', sea.executable]))?.[1];
  if (declared !== minimumSystem)
    throw new Error(`The executable needs macOS ${declared}; update the minimum system version (${minimumSystem}).`);

  const application = join(distRoot, 'macos', `${applicationName}.app`);
  await rm(application, { recursive: true, force: true });
  const contents = join(application, 'Contents');
  await mkdir(join(contents, 'MacOS'), { recursive: true });
  await cp(sea.executable, join(contents, 'MacOS', executableName));
  await cp(sea.resources, join(contents, 'Resources'), { recursive: true });
  const template = await readFile(join(repoRoot, 'packaging', 'macos', 'Info.plist'), 'utf8');
  const values = { NAME: applicationName, EXECUTABLE: executableName, IDENTIFIER: bundleIdentifier,
    VERSION: sea.manifest.app.version, MINIMUM_SYSTEM: minimumSystem };
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
