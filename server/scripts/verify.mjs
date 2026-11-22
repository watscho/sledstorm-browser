// Every automated check of this repository in one command, with one line per
// check. Run it before calling a change done:
//
//   npm run verify --prefix server            everything, including the packaged build and its smoke tests
//   npm run verify --prefix server -- --quick without the build and the smoke tests
//
// It starts no real browser and no tunnel. A failed check prints the names of
// its failed tests, or the end of its output, keeps its whole output in
// dist/verify, and the command exits with 1.
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { pinnedNode } from './fetch-node.mjs';
import { distRoot, repoRoot, serverRoot } from './lib.mjs';

/** The totals that node:test prints at the end of a run, from its spec or its TAP reporter. Null without them. */
export function testCounts(output) {
  const count = name => {
    const found = new RegExp(`^(?:ℹ|#) ${name} (\\d+)$`, 'm').exec(output);
    return found ? Number(found[1]) : null;
  };
  const [tests, pass, fail] = [count('tests'), count('pass'), count('fail')];
  return tests === null || pass === null || fail === null ? null : { tests, pass, fail };
}

/** The names of the tests that failed, each once. */
export function failedTests(output) {
  const names = new Set();
  for (const [, spec, tap] of output.matchAll(/^(?:✖ (.+?) \(\d+(?:\.\d+)?ms\)|not ok \d+ - (.+))$/gm)) names.add(spec ?? tap);
  return [...names];
}

/**
 * Writes the whole output of a failed check into `folder`, named after the check, and returns the file's path.
 * A failure that does not come again can then still be read.
 */
export async function keepFailure(folder, name, output) {
  const file = join(folder, `${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}.log`);
  await mkdir(folder, { recursive: true });
  await writeFile(file, output);
  return file;
}

function run(command, args, cwd) {
  return new Promise(resolve => {
    const child = spawn(command, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', chunk => { output += chunk; });
    child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', error => resolve({ code: 1, output: `${output}\n${error.message}` }));
    child.on('close', code => resolve({ code: code ?? 1, output }));
  });
}

/** Servers and stand-in programs that a test run should have ended. */
async function leftovers() {
  const { output } = await run('ps', ['-axwwo', 'pid=,command='], repoRoot);
  const lines = output.split('\n').filter(line => /SledStormServer (serve|internal)|fake-browser\.mjs|fake-cloudflared\.mjs/.test(line));
  return { code: lines.length ? 1 : 0, output: lines.map(line => line.trim().slice(0, 160)).join('\n') };
}

async function main(argv) {
  const quick = argv.includes('--quick');
  const pinned = await pinnedNode();
  const network = join(repoRoot, 'research', 'network');
  const unit = ['--test', 'test/*.test.ts'];
  const checks = [
    { name: 'types', run: () => run('npm', ['run', 'typecheck'], serverRoot) },
    { name: `server, Node.js ${process.versions.node}`, tests: true, run: () => run(process.execPath, unit, serverRoot) },
    { name: `server, Node.js ${pinned.version} (pinned)`, tests: true, run: () => run(pinned.path, unit, serverRoot) },
    { name: 'network modules', tests: true, run: () => run('npm', ['test'], network) },
    { name: 'web client and panel page', tests: true, run: () => run(process.execPath, ['--test', 'web/*.test.mjs', 'admin/*.test.mjs'], repoRoot) },
    { name: 'launcher (Python)', run: () => run('python3', ['tools/test-emulator-server.py'], repoRoot) },
    { name: 'Python syntax', run: () => run('python3', ['-m', 'py_compile', 'server.py', 'tools/build-emulator.py', 'tools/play-online.py'], repoRoot) },
    { name: 'whitespace', run: () => run('git', ['diff', '--check'], repoRoot) },
    ...(quick ? [] : [
      { name: 'packaged build', run: () => run(process.execPath, ['scripts/package-macos.mjs'], serverRoot) },
      { name: 'packaged smoke tests', tests: true, run: () => run(process.execPath, ['--test', 'smoke/*.test.mjs'], serverRoot) },
    ]),
    { name: 'nothing left running', run: leftovers },
  ];

  const began = performance.now();
  let failed = 0;
  for (const check of checks) {
    const started = performance.now();
    const { code, output } = await check.run();
    const seconds = `${Math.round((performance.now() - started) / 1000)} s`.padStart(5);
    const counts = check.tests ? testCounts(output) : null;
    // A test run counts only with its totals: a runner that died without them has not passed.
    const ok = code === 0 && (!check.tests || (counts !== null && counts.fail === 0 && counts.pass === counts.tests));
    const detail = counts ? `${counts.pass} of ${counts.tests} passed` : '';
    console.log(`${ok ? 'ok  ' : 'FAIL'}  ${check.name.padEnd(34)} ${seconds}  ${detail}`);
    if (ok) continue;
    failed += 1;
    const names = check.tests ? failedTests(output) : [];
    const lines = names.length ? names.slice(0, 20).map(name => `✖ ${name}`) : output.trim().split('\n').slice(-15);
    for (const line of lines) console.log(`      ${line.slice(0, 200)}`);
    console.log(`      The whole output is in ${await keepFailure(join(distRoot, 'verify'), check.name, output)}.`);
  }
  const total = Math.round((performance.now() - began) / 1000);
  console.log(failed ? `${failed} of ${checks.length} checks failed (${total} s).`
    : `All ${checks.length} checks passed in ${total} s${quick ? ', without the packaged build and its smoke tests' : ''}.`);
  return failed ? 1 : 0;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) process.exitCode = await main(process.argv.slice(2));
