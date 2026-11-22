// Copy the runtime into a resource directory: always the web client, the
// panel's page, the pinned tunnel program and the pinned browser, and the
// emulator files when this checkout has been bootstrapped and built
// (docs/setup.md). Nothing is compiled here.
import { access, chmod, constants, cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { pinnedChromium } from './fetch-chromium.mjs';
import { pinnedCloudflared } from './fetch-cloudflared.mjs';
import { readJson, repoRoot, run, sha256File } from './lib.mjs';

const exists = path => access(path).then(() => true, () => false);

/** How an application bundle is copied: its relative links stay as they are, and unchanged files share their blocks. */
export const bundleCopy = { recursive: true, verbatimSymlinks: true, mode: constants.COPYFILE_FICLONE };

/** The files of the panel's page: the ones that the control listener serves (`PANEL_FILES` in src/host-server.ts). */
export const PANEL_FILES = ['index.html', 'panel.css', 'session.js', 'view.js', 'controller.js', 'panel.js'];

export const RELEASE_WEB_FILES = [
  'app.js', 'controls-ui.js', 'controls.js', 'core-state.js', 'disc-download.js', 'disc-identity.js',
  'disc-parts.js', 'disc-sheet.js', 'disc-source.js', 'disc-zip.js', 'display.js',
  'game-data-folder.js', 'graphics-presets.js', 'hardware-preview.js', 'index.html', 'invitation.js',
  'launch-mode.js', 'lobby-mountains.svg', 'lobby-snow-trail.svg', 'lobby-ui.js', 'local-disc.js', 'netplay-downlink.js',
  'netplay-wire.js', 'pal-profile.js', 'performance-metrics.js', 'performance-ui.js', 'playstation-controller.svg',
  'retroarch-netplay.js', 'room-identity.js', 'room-restore.js', 'save-file.js', 'save-manager.js',
  'save-storage.js', 'shaders/crt-lottes.glsl', 'shaders/sharp-bilinear.glsl',
  'sled-storm-logo.png', 'sled-storm-pal-cover.jpg', 'solo-save.js', 'style.css',
];

/**
 * Copies the panel's page from `source`, the repository's `admin` folder, into the resource directory
 * `target`: the files of the page by name, so that its tests and whatever else lies in the folder stay out.
 */
export async function stagePanel(target, source = join(repoRoot, 'admin')) {
  await mkdir(join(target, 'admin'), { recursive: true });
  for (const name of PANEL_FILES) await cp(join(source, name), join(target, 'admin', name));
}

export async function stageResources(target, { candidate = false } = {}) {
  if (candidate) {
    await mkdir(join(target, 'web', 'shaders'), { recursive: true });
    for (const name of RELEASE_WEB_FILES) {
      await cp(join(repoRoot, 'web', name), join(target, 'web', name), bundleCopy);
    }
  } else {
    // Tests and their fixtures are not part of the client.
    await cp(join(repoRoot, 'web'), join(target, 'web'),
      { recursive: true, filter: source => !source.endsWith('.test.mjs') && !source.endsWith('.fixtures.json')
          && !['frame-sync.js', 'session-client.js'].some(name => source.endsWith(`/${name}`)) });
  }
  const index = join(target, 'web', 'index.html');
  const html = await readFile(index, 'utf8');
  await writeFile(index, html.replace('<html lang="en">', '<html lang="en" data-launcher="mac">'));
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
    const destination = join(target, 'chromium', 'Chromium.app');
    if (candidate) {
      // Use the verified archive so extra files in a local Chromium cache stay out of the package.
      const staging = await mkdtemp(join(dirname(target), 'chromium-'));
      try {
        await run('/usr/bin/ditto', ['-x', '-k', browser.archive, staging]);
        await cp(join(staging, browser.archiveApplication), destination, bundleCopy);
      } finally {
        await rm(staging, { recursive: true, force: true });
      }
    } else {
      await cp(browser.application, destination, bundleCopy);
    }
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
