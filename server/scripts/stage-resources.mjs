// Copy the runtime into a resource directory: always the web client, the
// panel's page, the pinned tunnel program and the pinned browser, and the
// emulator files when this checkout has been bootstrapped and built
// (docs/setup.md). Nothing is compiled here.
import { access, chmod, constants, cp, mkdir } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pinnedChromium } from './fetch-chromium.mjs';
import { pinnedCloudflared } from './fetch-cloudflared.mjs';
import { readJson, repoRoot, sha256File } from './lib.mjs';

const exists = path => access(path).then(() => true, () => false);

/** How an application bundle is copied: its relative links stay as they are, and unchanged files share their blocks. */
export const bundleCopy = { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE };

/** The files of the panel's page: the ones that the control listener serves (`PANEL_FILES` in src/host-server.ts). */
const PANEL_FILES = ['index.html', 'panel.css', 'session.js', 'view.js', 'controller.js', 'panel.js'];

/**
 * Copies the panel's page from `source`, the repository's `admin` folder, into the resource directory
 * `target`: the files of the page by name, so that its tests and whatever else lies in the folder stay out.
 */
export async function stagePanel(target, source = join(repoRoot, 'admin')) {
  await mkdir(join(target, 'admin'), { recursive: true });
  for (const name of PANEL_FILES) await cp(join(source, name), join(target, 'admin', name));
}

export async function stageResources(target) {
  // Tests and their fixtures are not part of the client.
  await cp(join(repoRoot, 'web'), join(target, 'web'),
    { recursive: true, filter: source => !source.endsWith('.test.mjs') && !source.endsWith('.fixtures.json') });
  await stagePanel(target);

  const program = await pinnedCloudflared();
  let cloudflared = null;
  if (program) {
    await mkdir(join(target, 'bin'), { recursive: true });
    await cp(program.path, join(target, 'bin', 'cloudflared'));
    await chmod(join(target, 'bin', 'cloudflared'), 0o755);
    cloudflared = { version: program.version, archiveSha256: program.archiveSha256, binarySha256: program.binarySha256 };
  }

  const browser = await pinnedChromium();
  let chromium = null;
  if (browser) {
    await cp(browser.application, join(target, 'chromium', 'Chromium.app'), bundleCopy);
    chromium = { version: browser.version, position: browser.position, commit: browser.commit,
      archiveSha256: browser.archiveSha256, executableSha256: browser.executableSha256, frameworkSha256: browser.frameworkSha256 };
  }

  const lockPath = join(repoRoot, 'emulator.lock.json');
  const corePath = join(repoRoot, '.cache', 'emulator-network-core.data');
  const buildPath = join(repoRoot, '.cache', 'emulator-native-build.json');
  const vendor = join(repoRoot, 'vendor', 'emulatorjs');
  const names = Object.keys((await readJson(lockPath)).files);
  const sources = [corePath, buildPath, ...names.map(name => join(vendor, name))];
  if (!(await Promise.all(sources.map(exists))).every(Boolean)) return { emulator: null, cloudflared, chromium };

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
    nativeBuild: await sha256File(buildPath) }, cloudflared, chromium };
}
