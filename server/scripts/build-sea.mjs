// Turn the server bundle into a single executable application on the pinned
// Node.js runtime, then write the manifest of what went into it.
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildBundle } from './build.mjs';
import { pinnedNode } from './fetch-node.mjs';
import { applicationName, distRoot, executableName, readJson, repoRoot, run, serverRoot } from './lib.mjs';
import { stageResources } from './stage-resources.mjs';

export const bundleIdentifier = 'io.github.watscho.sledstorm-server';

async function sourceRevision() {
  try {
    return { revision: await run('git', ['rev-parse', 'HEAD'], { cwd: repoRoot }),
      modified: await run('git', ['status', '--porcelain'], { cwd: repoRoot }) !== '' };
  } catch {
    // A source archive has no Git metadata.
    return { revision: null, modified: null };
  }
}

export async function buildSea() {
  const bundle = await buildBundle();
  const node = await pinnedNode();
  const root = join(distRoot, 'sea');
  await rm(root, { recursive: true, force: true });
  const resources = join(root, 'resources');
  await mkdir(resources, { recursive: true });
  const executable = join(root, executableName);

  // Snapshots, the code cache and the virtual file system stay off on purpose:
  // the first package keeps the number of moving parts small.
  const configPath = join(distRoot, 'sea-config.json');
  await writeFile(configPath, JSON.stringify({
    main: bundle.outfile,
    mainFormat: 'commonjs',
    output: executable,
    useSnapshot: false,
    useCodeCache: false,
    execArgvExtension: 'none',
    disableExperimentalSEAWarning: true,
  }, null, 2));
  await run(node.path, ['--build-sea', configPath]);

  if (process.platform === 'darwin') {
    // --build-sea leaves the Mach-O unsigned, and macOS on Apple Silicon kills
    // unsigned code. An ad-hoc signature is enough to run it locally; it is not
    // a Developer ID signature and does not make a distributable build.
    await run('codesign', ['--force', '--sign', '-', '--identifier', bundleIdentifier, executable]);
    await run('codesign', ['--verify', '--strict', executable]);
  }

  const staged = await stageResources(resources);
  const ws = await readJson(join(serverRoot, 'node_modules', 'ws', 'package.json'));
  const manifest = {
    schema: 1,
    app: { name: applicationName, version: bundle.version, source: await sourceRevision() },
    platform: node.platform,
    node: { version: node.version, archive: node.archive, archiveSha256: node.archiveSha256, binarySha256: node.binarySha256 },
    server: { sha256: bundle.sha256 },
    dependencies: { ws: ws.version },
    // Null when this checkout has no built emulator: the server then reports that it cannot host.
    emulator: staged.emulator,
    // Not bundled yet. Each gets its version, origin and hashes when it ships.
    chromium: null,
    cloudflared: null,
  };
  await writeFile(join(resources, 'runtime-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);

  const reported = await run(executable, ['--version'], { env: {} });
  if (reported !== bundle.version) throw new Error(`The executable reports version ${reported}, expected ${bundle.version}`);
  return { root, executable, resources, manifest };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const sea = await buildSea();
  console.log(`Built ${relative(repoRoot, sea.executable)} on Node.js ${sea.manifest.node.version} for ${sea.manifest.platform}.`);
}
