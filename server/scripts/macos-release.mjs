import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { access, lstat, mkdir, mkdtemp, readdir, readFile, readlink, realpath, rename, rm, stat, writeFile } from 'node:fs/promises';
import { isAbsolute, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { applicationName, distRoot, executableName, readJson, repoRoot, run, serverRoot, sha256File } from './lib.mjs';
import { macosMinimum } from './macos-minimum.mjs';
import { packagedCodeHashes, signingIdentity, signMacosApp, verifyMacosSigning } from './macos-signing.mjs';
import { applicationIcon, packageMacos } from './package-macos.mjs';
import { PANEL_FILES, RELEASE_WEB_FILES } from './stage-resources.mjs';

const exec = promisify(execFile);
const appName = `${applicationName}.app`;
const digest = /^[0-9a-f]{64}$/;

function requireMatch(actual, expected, description) {
  if (actual !== expected) throw new Error(`RELEASE-01: ${description} does not match.`);
}

function requireNames(actual, expected, description) {
  requireMatch(JSON.stringify([...actual].sort()), JSON.stringify([...expected].sort()), description);
}

/** An allowlist of regular files also rejects extra folders, symlinks and special files. */
export async function checkFiles(root, files) {
  const directories = new Set();
  for (const file of files) {
    const names = file.split('/');
    for (let length = 1; length < names.length; length++) directories.add(names.slice(0, length).join('/'));
  }
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  requireNames(entries.map(entry => {
    const path = relative(root, join(entry.parentPath, entry.name));
    if (entry.isDirectory()) return `${path}/`;
    if (!entry.isFile()) throw new Error('RELEASE-01: a regular file was expected.');
    return path;
  }), [...files, ...[...directories].map(name => `${name}/`)], 'file inventory');
}

async function inventory(app) {
  const root = await realpath(app);
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  const listing = [];
  let links = 0;
  for (const entry of entries) {
    const path = join(entry.parentPath, entry.name);
    const name = relative(root, path);
    if (entry.isSymbolicLink()) {
      const target = await readlink(path);
      const resolved = relative(root, await realpath(path));
      if (isAbsolute(target) || isAbsolute(resolved) || resolved.split('/')[0] === '..') {
        throw new Error('RELEASE-01: the bundle contains a link outside the app.');
      }
      links++;
      listing.push(JSON.stringify([name, 'link', target]));
    } else if (entry.isDirectory()) {
      listing.push(JSON.stringify([name, 'dir']));
    } else if (entry.isFile()) {
      const { size, mode } = await stat(path);
      listing.push(JSON.stringify([name, 'file', size, mode & 0o111]));
    } else {
      throw new Error('RELEASE-01: unexpected special file in the app.');
    }
  }
  return { listing, links };
}

async function checkResources(app, { signing, stapled = false } = {}) {
  const contents = join(app, 'Contents');
  const resources = join(contents, 'Resources');
  const manifest = await readJson(join(resources, 'runtime-manifest.json'));
  const lock = await readJson(join(serverRoot, 'toolchain.lock.json'));
  const licenseLock = await readJson(join(repoRoot, 'packaging', 'macos', 'notices.lock.json'));
  const emulator = join(resources, 'emulator');
  const emulatorLock = await readJson(join(repoRoot, 'emulator.lock.json'));
  const { node, chromium, cloudflared } = lock;
  const platform = 'darwin-arm64';
  const browser = chromium.archives[platform];
  const chromiumApp = join(resources, 'chromium', 'Chromium.app');
  const tunnel = join(resources, 'bin', 'cloudflared');
  const executable = join(contents, 'MacOS', executableName);
  const requiredNotices = [...Object.keys(licenseLock.texts), 'Chromium-credits.html', 'EmulatorJS-LICENSE.txt',
    'emulator-core-license.txt', 'PeriBluGaming-NOTICE-LICENSE.txt', 'SledStorm-LICENSE.txt', 'THIRD_PARTY_NOTICES.md', 'ws-LICENSE.txt'];

  requireNames(await readdir(app), ['Contents'], 'application root');
  const contentNames = await readdir(contents);
  const expectedContents = ['_CodeSignature', 'Helpers', 'Info.plist', 'MacOS', 'Resources'];
  if (stapled) {
    requireMatch((await lstat(join(contents, 'CodeResources'))).isFile(), true, 'ticket file type');
    expectedContents.push('CodeResources');
  }
  requireNames(contentNames, expectedContents, 'application contents');
  requireNames(await readdir(resources),
    [applicationIcon, 'admin', 'bin', 'chromium', 'emulator', 'licenses', 'runtime-manifest.json', 'web'], 'resource roots');
  requireNames(await readdir(join(resources, 'chromium')), ['Chromium.app'], 'Chromium resource root');
  await checkFiles(join(contents, 'MacOS'), [executableName]);
  await checkFiles(join(contents, 'Helpers'), [executableName]);
  await checkFiles(join(contents, '_CodeSignature'), ['CodeResources']);
  await checkFiles(join(resources, 'admin'), PANEL_FILES);
  await checkFiles(join(resources, 'web'), RELEASE_WEB_FILES);
  await checkFiles(join(resources, 'bin'), ['cloudflared']);
  await checkFiles(emulator, ['emulator.lock.json', 'native-build.json', 'network-core.data',
    ...Object.keys(emulatorLock.files).map(name => `emulatorjs/${name}`)]);
  await checkFiles(join(resources, 'licenses'), requiredNotices);
  requireNames(Object.keys(manifest.notices), requiredNotices, 'manifest notices');
  for (const name of requiredNotices) {
    const hash = await sha256File(join(resources, 'licenses', name));
    requireMatch(hash, manifest.notices[name], `${name} notice digest`);
    const pin = name === 'Chromium-credits.html' ? licenseLock.chromiumCredits : licenseLock.texts[name];
    if (pin) requireMatch(hash, pin.sha256, `${name} upstream digest`);
  }

  requireMatch(manifest.schema, 1, 'manifest schema');
  requireMatch(manifest.platform, platform, 'manifest platform');
  requireMatch(manifest.app.version, (await readFile(join(repoRoot, 'VERSION'), 'utf8')).trim(), 'app version');
  const source = manifest.app.source;
  if (source.revision !== null && !/^[0-9a-f]{40}$/.test(source.revision)) throw new Error('RELEASE-01: invalid source revision.');
  requireMatch(digest.test(manifest.server.sha256), true, 'bundled server digest format');
  requireMatch(manifest.node.version, node.version, 'Node.js version');
  requireMatch(manifest.node.archiveSha256, node.archives[platform].sha256, 'Node.js input archive digest');
  requireMatch(digest.test(manifest.node.binarySha256), true, 'Node.js input binary digest format');
  requireMatch(manifest.cloudflared.version, cloudflared.version, 'cloudflared version');
  requireMatch(manifest.cloudflared.archiveSha256, cloudflared.archives[platform].sha256, 'cloudflared input archive digest');
  requireMatch(manifest.cloudflared.binarySha256, cloudflared.archives[platform].binarySha256, 'cloudflared input binary digest');
  requireMatch(manifest.chromium.version, chromium.version, 'Chromium version');
  requireMatch(manifest.chromium.position, browser.position, 'Chromium snapshot position');
  requireMatch(manifest.chromium.commit, browser.commit, 'Chromium source revision');
  requireMatch(manifest.chromium.archiveSha256, browser.sha256, 'Chromium input archive digest');
  requireMatch(manifest.chromium.executableSha256, browser.executableSha256, 'Chromium input launcher digest');
  requireMatch(manifest.chromium.frameworkSha256, browser.frameworkSha256, 'Chromium input framework digest');
  requireMatch(manifest.signing?.mode, signing, 'manifest signing mode');
  const expectedCode = signing ? manifest.signing.code : {
    cloudflared: manifest.cloudflared.binarySha256,
    chromiumLauncher: browser.executableSha256,
    chromiumFramework: browser.frameworkSha256,
  };
  for (const [name, hash] of Object.entries(await packagedCodeHashes(app, browser))) {
    requireMatch(hash, expectedCode[name], `shipped ${name} digest`);
  }
  await Promise.all([executable, join(contents, 'Helpers', executableName), tunnel, join(chromiumApp, browser.executable)]
    .map(path => access(path, constants.X_OK)));

  requireMatch(await sha256File(join(emulator, 'emulator.lock.json')), await sha256File(join(repoRoot, 'emulator.lock.json')), 'emulator source lock');
  for (const [field, file] of Object.entries({ lock: 'emulator.lock.json', nativeBuild: 'native-build.json', coreData: 'network-core.data' })) {
    requireMatch(await sha256File(join(emulator, file)), manifest.emulator[field], `${file} digest`);
  }
  for (const [name, hash] of Object.entries(emulatorLock.files)) {
    requireMatch(await sha256File(join(emulator, 'emulatorjs', name)), hash, `EmulatorJS ${name} digest`);
  }
  const native = await readJson(join(emulator, 'native-build.json'));
  for (const [name, pin] of Object.entries({ core: emulatorLock.core_source, frontend: emulatorLock.frontend_source, sdk: emulatorLock.emsdk })) {
    requireMatch(native[name].url, pin.url, `${name} source URL`);
    requireMatch(native[name].commit, pin.commit, `${name} source commit`);
  }
  requireMatch(native.sdk.version, emulatorLock.emsdk.version, 'emulator SDK version');
  const coreArchive = join(emulator, 'network-core.data');
  const wasm = 'pcsx_rearmed_libretro.wasm';
  requireNames((await run('/usr/bin/unzip', ['-Z1', coreArchive])).split('\n'),
    ['build.json', 'core.json', 'license.txt', 'sled-build.json', 'pcsx_rearmed_libretro.js', wasm], 'prepared core archive');
  const coreBuild = JSON.parse(await run('/usr/bin/unzip', ['-p', coreArchive, 'sled-build.json']));
  requireMatch(JSON.stringify(coreBuild), JSON.stringify(native), 'prepared core build provenance');
  // Preparation patches the JavaScript loader. The archive digest covers that output;
  // its WebAssembly file is copied unchanged from the native build.
  const { stdout } = await exec('/usr/bin/unzip', ['-p', coreArchive, wasm], { encoding: 'buffer', maxBuffer: 16 * 1024 * 1024 });
  requireMatch(createHash('sha256').update(stdout).digest('hex'), native.files[wasm], 'prepared WebAssembly digest');
  const plist = join(contents, 'Info.plist');
  const icon = join(resources, applicationIcon);
  requireMatch(await run('/usr/bin/plutil', ['-extract', 'CFBundleIconFile', 'raw', plist]), applicationIcon, 'Finder icon filename');
  requireMatch((await lstat(icon)).isFile(), true, 'Finder icon file type');
  requireMatch(await sha256File(icon), await sha256File(join(repoRoot, 'packaging', 'macos', applicationIcon)), 'Finder icon digest');
  requireMatch(await run('/usr/bin/plutil', ['-extract', 'LSMinimumSystemVersion', 'raw', plist]), manifest.macosMinimum, 'Finder minimum macOS');
  requireMatch(await macosMinimum(contents), manifest.macosMinimum, 'shipped Mach-O minimum macOS');
  await run('/usr/bin/codesign', ['--verify', '--deep', '--strict', app]);
  if (stapled) {
    await run('/usr/bin/xcrun', ['stapler', 'validate', app]);
    await run('/usr/bin/syspolicy_check', ['distribution', app]);
  }
  const signed = signing ? await verifyMacosSigning(app, signing) : null;
  return { manifest, noticeCount: requiredNotices.length, signed, browserPin: browser };
}

async function extractApp(zip, root) {
  await mkdir(root);
  await run('/usr/bin/ditto', ['-x', '-k', zip, root]);
  requireNames(await readdir(root), [appName], 'ZIP root');
  const app = join(root, appName);
  if (!(await lstat(app)).isDirectory()) throw new Error('RELEASE-01: expected an application directory.');
  return app;
}

async function checkedZip(app, staging, destination, options = {}) {
  const original = await inventory(app);
  const zip = join(staging, 'candidate.zip');
  await run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip]);
  const restored = await extractApp(zip, join(staging, 'extracted'));
  const { manifest, noticeCount, signed } = await checkResources(restored, options);
  const unpacked = await inventory(restored);
  requireNames(unpacked.listing, original.listing, 'ZIP round-trip inventory');
  const hash = await sha256File(zip);
  await rename(zip, destination);
  console.log(`RELEASE-01 passed: ${noticeCount} notices, ${unpacked.links} relative symlinks, macOS ${manifest.macosMinimum}.`);
  if (signed) console.log(`Verified ${signed.targets} hardened signatures, with JIT enabled for ${signed.jitTargets}.`);
  console.log(`${relative(repoRoot, destination)}\nSHA-256 ${hash}`);
}

async function notarizeApp(app, staging, profile) {
  const zip = join(staging, 'notary-submission.zip');
  await run('/usr/bin/ditto', ['-c', '-k', '--keepParent', app, zip]);
  const credentials = ['--keychain-profile', profile];
  let report;
  try {
    report = JSON.parse(await run('/usr/bin/xcrun', ['notarytool', 'submit', zip, ...credentials,
      '--wait', '--timeout', '20m', '--output-format', 'json']));
  } catch (error) {
    try { report = JSON.parse(error.stdout); } catch { throw new Error('notarytool could not complete the submission.'); }
  }
  if (!/^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i.test(report.id ?? '')) throw new Error('Apple did not return a notarization submission ID.');
  if (!['Accepted', 'Invalid', 'Rejected'].includes(report.status)) {
    throw new Error(`Notarization is incomplete. Check submission ${report.id} with notarytool.`);
  }
  const log = await run('/usr/bin/xcrun', ['notarytool', 'log', report.id, ...credentials]);
  const logPath = join(distRoot, 'macos', `notary-${report.id}.json`);
  const details = JSON.parse(log);
  await writeFile(logPath, `${log}\n`, { mode: 0o600 });
  console.log(`Notary log: ${relative(repoRoot, logPath)}, ${details.issues?.length ?? 0} issue(s).`);
  if (report.status !== 'Accepted' || details.status !== 'Accepted') throw new Error(`Apple did not accept submission ${report.id}.`);
  await run('/usr/bin/xcrun', ['stapler', 'staple', app]);
}

async function buildZip(mode) {
  if (process.platform !== 'darwin' || process.arch !== 'arm64') throw new Error('Build macOS ZIPs on Apple Silicon.');
  const signing = mode === 'preview' ? undefined : mode === 'rehearsal' ? mode : 'developer-id';
  const stapled = mode === 'notarized';
  const identity = signing && !stapled ? await signingIdentity(signing) : null;
  const profile = process.env.SLED_MACOS_NOTARY_PROFILE?.trim();
  if (stapled && !profile) throw new Error('Set SLED_MACOS_NOTARY_PROFILE to the notarytool Keychain profile name.');
  const directory = join(distRoot, 'macos');
  await mkdir(directory, { recursive: true });
  const staging = await mkdtemp(join(directory, 'release-'));
  try {
    const version = (await readFile(join(repoRoot, 'VERSION'), 'utf8')).trim();
    const base = join(directory, `Sled-Storm-Server-${version}-macos-arm64`);
    if (!signing) {
      const { application } = await packageMacos({ candidate: true });
      await checkResources(application);
      await checkedZip(application, staging, `${base}-preview.zip`);
      return;
    }
    const input = stapled ? 'signed' : 'preview';
    const app = await extractApp(`${base}-${input}.zip`, join(staging, input));
    await inventory(app);
    if (stapled) {
      const { manifest } = await checkResources(app, { signing });
      if (manifest.app.source.modified !== false || !manifest.app.source.revision) {
        throw new Error('Build and sign the ZIP from an exact, clean Git revision before notarizing it.');
      }
      await notarizeApp(app, staging, profile);
    } else {
      const { manifest, browserPin } = await checkResources(app);
      await signMacosApp(app, manifest, browserPin, signing, identity);
    }
    await checkedZip(app, staging, `${base}-${mode}.zip`, { signing, stapled });
  } finally {
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [flag, ...extra] = process.argv.slice(2);
  const mode = new Map([[undefined, 'preview'], ['--rehearse', 'rehearsal'], ['--sign', 'signed'], ['--notarize', 'notarized']]).get(flag);
  if (!mode || extra.length) throw new Error('Usage: npm run package:macos:zip --prefix server -- [--rehearse | --sign | --notarize]');
  await buildZip(mode);
}
