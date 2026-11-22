import { execFile } from 'node:child_process';
import { readdir, realpath, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { promisify } from 'node:util';
import { executableName, repoRoot, run, sha256File } from './lib.mjs';
import { isMachO } from './macos-minimum.mjs';

const exec = promisify(execFile);
const jitEntitlements = join(repoRoot, 'packaging', 'macos', 'jit.entitlements.plist');

export async function signingIdentity(mode) {
  if (mode === 'rehearsal') return '-';
  const identity = process.env.SLED_MACOS_SIGNING_IDENTITY?.trim().toUpperCase();
  if (!/^[0-9A-F]{40}$/.test(identity ?? '')) {
    throw new Error('Set SLED_MACOS_SIGNING_IDENTITY to the Keychain SHA-1 of a Developer ID Application identity.');
  }
  const identities = await run('/usr/bin/security', ['find-identity', '-v', '-p', 'codesigning']);
  if (!identities.split('\n').some(line => line.includes(`${identity} "Developer ID Application:`))) {
    throw new Error('The selected valid Developer ID Application identity is unavailable in Keychain.');
  }
  return identity;
}

async function bundleExecutable(app) {
  const contents = join(app, 'Contents');
  const name = await run('/usr/bin/plutil', ['-extract', 'CFBundleExecutable', 'raw', join(contents, 'Info.plist')]);
  if (!name || basename(name) !== name) throw new Error('Invalid CFBundleExecutable.');
  return realpath(join(contents, 'MacOS', name));
}

/** Sign executables first, then helper apps, the framework, Chromium and the outer app. */
async function signingTargets(app) {
  const contents = join(app, 'Contents');
  const resources = join(contents, 'Resources');
  const server = join(contents, 'Helpers', executableName);
  const browser = join(resources, 'chromium', 'Chromium.app');
  const framework = join(browser, 'Contents', 'Frameworks', 'Chromium Framework.framework');
  const helpers = await realpath(join(framework, 'Versions', 'Current', 'Helpers'));
  const helpersContents = await readdir(helpers, { withFileTypes: true });
  const helperApps = helpersContents.filter(entry => entry.isDirectory() && entry.name.endsWith('.app'))
    .map(entry => ({ path: join(helpers, entry.name), jit: / \((?:Aperitif )?(?:Renderer|GPU)\)\.app$/.test(entry.name) }));
  const containerExecutables = new Set(await Promise.all([
    ...helperApps.map(({ path }) => bundleExecutable(path)), bundleExecutable(browser), bundleExecutable(app),
    realpath(join(framework, 'Chromium Framework')),
  ]));
  const entries = await readdir(resources, { recursive: true, withFileTypes: true });
  const leaves = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const path = join(entry.parentPath, entry.name);
    if (containerExecutables.has(path) || !await isMachO(path)) continue;
    leaves.push({ path });
  }
  return [{ path: server, jit: true }, ...leaves, ...helperApps, { path: framework }, { path: browser }, { path: app }];
}

export async function packagedCodeHashes(app, browserPin) {
  const resources = join(app, 'Contents', 'Resources');
  const browser = join(resources, 'chromium', 'Chromium.app');
  return {
    cloudflared: await sha256File(join(resources, 'bin', 'cloudflared')),
    chromiumLauncher: await sha256File(join(browser, browserPin.executable)),
    chromiumFramework: await sha256File(join(browser, browserPin.framework)),
  };
}

export async function signMacosApp(app, manifest, browserPin, mode, identity) {
  const targets = await signingTargets(app);
  const options = ['--force', '--sign', identity, '--options', 'runtime',
    mode === 'rehearsal' ? '--timestamp=none' : '--timestamp'];
  for (const { path, jit } of targets) {
    if (path === app) {
      // Record the post-signing digests before sealing the outer app's resources.
      manifest.signing = { mode, code: await packagedCodeHashes(app, browserPin) };
      await writeFile(join(app, 'Contents', 'Resources', 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
    }
    await run('/usr/bin/codesign', [...options, ...(jit ? ['--entitlements', jitEntitlements] : []), path]);
  }
}

export async function verifyMacosSigning(app, mode) {
  const targets = await signingTargets(app);
  let team;
  for (const { path, jit = false } of targets) {
    await run('/usr/bin/codesign', ['--verify', '--strict', '--all-architectures', path]);
    const { stderr } = await exec('/usr/bin/codesign', ['--display', '--verbose=4', path]);
    const flags = /^CodeDirectory .*flags=.*\(([^)]+)\)/m.exec(stderr)?.[1].split(',');
    const validSigner = mode === 'rehearsal' ? /^Signature=adhoc$/m.test(stderr)
      : /^Authority=Developer ID Application:/m.test(stderr) && /^Timestamp=/m.test(stderr);
    if (!flags?.includes('runtime') || !validSigner) throw new Error(`Unexpected signature on ${basename(path)}.`);
    if (mode === 'developer-id') {
      const signedTeam = /^TeamIdentifier=([A-Z0-9]{10})$/m.exec(stderr)?.[1];
      if (!signedTeam || (team && team !== signedTeam)) throw new Error('The signed code must use one Developer ID team.');
      team = signedTeam;
    }
    const { stdout } = await exec('/usr/bin/codesign', ['--display', '--entitlements', '-', '--xml', path]);
    const keys = [...stdout.matchAll(/<key>([^<]+)<\/key>/g)].map(match => match[1]);
    const validEntitlements = jit
      ? keys.length === 1 && /<key>com\.apple\.security\.cs\.allow-jit<\/key>\s*<true\s*\/>/.test(stdout)
      : keys.length === 0;
    if (!validEntitlements) {
      throw new Error(`Unexpected entitlements on ${basename(path)}.`);
    }
  }
  return { targets: targets.length, jitTargets: targets.filter(target => target.jit).length };
}
