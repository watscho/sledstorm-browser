// Bundle the TypeScript server and the existing network modules into the one
// CommonJS file that a single executable application can run.
import { build } from 'esbuild';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { distRoot, repoRoot, serverRoot, sha256File } from './lib.mjs';

export async function buildBundle() {
  const version = (await readFile(join(repoRoot, 'VERSION'), 'utf8')).trim();
  const outfile = join(distRoot, 'server.cjs');
  await mkdir(distRoot, { recursive: true });
  const result = await build({
    absWorkingDir: repoRoot,
    entryPoints: [join(serverRoot, 'src', 'entry.ts')],
    outfile,
    bundle: true,
    platform: 'node',
    format: 'cjs',
    target: 'node26',
    metafile: true,
    logLevel: 'warning',
    // Every importer gets the same copy of ws, whichever folder it lives in.
    alias: { ws: join(serverRoot, 'node_modules', 'ws') },
    define: {
      __APP_VERSION__: JSON.stringify(version),
      // ws tries optional native add-ons unless told not to. An executable
      // without node_modules must take the pure JavaScript path.
      'process.env.WS_NO_BUFFER_UTIL': '"1"',
      'process.env.WS_NO_UTF_8_VALIDATE': '"1"',
    },
  });
  if (result.warnings.length) throw new Error('The server bundle must build without warnings.');

  // The executable can load built-in modules only, so anything else left as a
  // runtime require would fail on the user's machine. Fail here instead.
  const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name.replace(/^node:/, '')}`]));
  const output = result.metafile.outputs[relative(repoRoot, outfile)];
  const text = await readFile(outfile, 'utf8');
  const required = new Set([
    ...output.imports.filter(entry => entry.external).map(entry => entry.path),
    ...Array.from(text.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g), match => match[1]),
  ]);
  const foreign = [...required].filter(name => !builtins.has(name));
  if (foreign.length) throw new Error(`The bundle would require non-built-in modules at run time: ${foreign.join(', ')}`);
  const inputs = Object.keys(result.metafile.inputs);
  const copies = inputs.filter(path => path.endsWith('ws/lib/websocket.js'));
  if (copies.length !== 1) throw new Error(`Expected exactly one bundled copy of ws, found: ${copies.join(', ') || 'none'}`);

  await writeFile(join(distRoot, 'server.meta.json'), JSON.stringify(result.metafile));
  return { outfile, version, sha256: await sha256File(outfile), inputs: inputs.length, bytes: output.bytes };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const bundle = await buildBundle();
  console.log(`Bundled ${bundle.inputs} modules into ${relative(repoRoot, bundle.outfile)} (${bundle.bytes} bytes, version ${bundle.version}).`);
}
