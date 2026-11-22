// Synthetic resources and game folders shared by several test files. None of
// this is game data: tracks are random bytes and emulator files are stubs.
import { randomBytes } from 'node:crypto';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { TestContext } from 'node:test';
import { fileURLToPath } from 'node:url';
import type { DiagnosticReport } from '../src/diagnostics.ts';
import type { HostControl } from '../src/host-control.ts';
import { ensureWritableRoots, type Paths } from '../src/paths.ts';

export async function scratch(t: TestContext, label: string): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), `sled ${label} тест `)));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

export const lock = { files: { 'loader.js': 'a'.repeat(64), 'cores/pcsx_rearmed-wasm.data': 'b'.repeat(64) } };
export const nativeBuild = { files: { 'pcsx_rearmed_libretro.wasm': 'c'.repeat(64) }, patches: {} };

/** A complete resource root with stub files. */
export async function stageAssets(resourceRoot: string): Promise<string> {
  const emulator = join(resourceRoot, 'emulator');
  await mkdir(join(resourceRoot, 'web'), { recursive: true });
  await mkdir(join(emulator, 'emulatorjs', 'cores'), { recursive: true });
  await writeFile(join(resourceRoot, 'web', 'index.html'), '<!doctype html><title>Synthetic client</title>');
  await writeFile(join(resourceRoot, 'web', 'app.js'), 'export {};\n');
  await writeFile(join(emulator, 'emulator.lock.json'), JSON.stringify(lock));
  await writeFile(join(emulator, 'native-build.json'), JSON.stringify(nativeBuild));
  await writeFile(join(emulator, 'network-core.data'), 'synthetic core');
  await writeFile(join(emulator, 'emulatorjs', 'loader.js'), '// synthetic loader\n');
  await writeFile(join(emulator, 'emulatorjs', 'cores', 'pcsx_rearmed-wasm.data'), 'synthetic archive');
  return resourceRoot;
}

/** A CUE and two tracks of random bytes. */
export async function writeGame(folder: string): Promise<string> {
  await mkdir(folder, { recursive: true });
  await writeFile(join(folder, 'Track 01.bin'), randomBytes(4000));
  await writeFile(join(folder, 'Трек 02.bin'), randomBytes(2500));
  await writeFile(join(folder, 'Game.cue'),
    'FILE "Track 01.bin" BINARY\r\n  TRACK 01 MODE2/2352\r\nFILE "Трек 02.bin" BINARY\r\n  TRACK 02 AUDIO\r\n');
  return folder;
}

/** Paths under a scratch directory, with staged assets as the resource root. */
export async function scratchPaths(t: TestContext, label: string): Promise<Paths & { root: string }> {
  const root = await scratch(t, label);
  const paths = { resourceRoot: await stageAssets(join(root, 'resources')), dataRoot: join(root, 'data'),
    cacheRoot: join(root, 'cache'), logRoot: join(root, 'logs'), tempRoot: join(root, 'temporary'),
    profileRoot: join(root, 'cache', 'browser-profiles') };
  await ensureWritableRoots(paths);
  await mkdir(paths.tempRoot, { recursive: true });
  return { ...paths, root };
}

/** The panel's page as the repository has it. The folder also holds the page's tests, which no build ships. */
export const panelRoot = fileURLToPath(new URL('../../admin', import.meta.url));

/** What the control listener may ask of the host, answered by nothing: `calls` keeps what was asked. */
export function standInControl(): { control: HostControl; calls: string[] } {
  const calls: string[] = [];
  return { calls, control: {
    start(force) {
      calls.push(force ? 'start --force' : 'start');
      return null;
    },
    stop(force) {
      calls.push(force ? 'stop --force' : 'stop');
      return null;
    },
    quit(force) {
      calls.push(force ? 'quit --force' : 'quit');
      return null;
    },
    newGame(force) {
      calls.push(force ? 'new-game --force' : 'new-game');
      return null;
    },
    config: async () => ({ gameFolder: null, discPolicy: null, autoStart: true, roomOptions: { progress: 'all', camera: true }, problem: null }),
    configure: async () => ({ status: 400, error: 'This test has no configuration.' }),
    async pickFolder() {
      calls.push('pick');
      return { status: 503, error: 'This test has no dialog.' };
    },
    async diagnostics(about) {
      calls.push('diagnostics');
      return standInReport(about);
    },
    close() {},
  } };
}

/** A diagnostic report of nothing, for a control that hosts nothing. */
export function standInReport({ version, startedAt }: { version: string; startedAt: string | null }): DiagnosticReport {
  return { application: 'Sled Storm Server', version, generatedAt: '2026-11-21T00:00:00.000Z', startedAt, uptimeSeconds: null,
    system: { platform: process.platform, release: '', arch: process.arch, node: process.versions.node }, manifest: null,
    parts: { web: false, emulator: false, browser: false, tunnel: false, panel: false }, host: null,
    config: { gameFolder: false, discPolicy: null, autoStart: true, roomOptions: { progress: 'all', camera: true }, problem: null },
    log: { lines: [], problem: null } };
}

const fakeBrowser = fileURLToPath(new URL('../../research/network/fake-browser.mjs', import.meta.url));

export interface BrowserEvent {
  event: 'start' | 'navigate';
  pid: number;
  args: string[];
  env: { HOME: string | null; BREAKPAD_DUMP_LOCATION: string | null };
  url: string;
  /** A save that the worker was started with is recorded by its length as text and the SHA-256 of that text. */
  setup: { room: string; workerKey: string; snapshot?: { length: number; sha256: string } };
}

/** A state of the right size that carries the marks the format check looks for. Not a game. */
export function validState(): Buffer {
  const bytes = Buffer.alloc(4_456_472);
  bytes.write('RASTATE', 0);
  bytes.write('STv4 PCSXra f29871d', 16);
  bytes.writeUInt32LE(1, 0x29934d);
  return bytes;
}

/**
 * An executable that runs the stand-in browser with a plan, and the record of
 * what it was asked to do. See research/network/fake-browser.mjs for the plan.
 */
export async function standInBrowser(root: string, plan: { netplayPort?: number; launches?: object[] } = {}) {
  const script = join(root, 'browser-script.json');
  const record = join(root, 'browser-launches.jsonl');
  await writeFile(script, JSON.stringify({ record, ...plan }));
  const program = join(root, 'stand-in browser');
  await writeFile(program, `#!/bin/sh\nexec '${process.execPath}' '${fakeBrowser}' --script-file '${script}' "$@"\n`, { mode: 0o755 });
  const events = async () => (await readFile(record, 'utf8').catch(() => '')).split('\n').filter(Boolean)
    .map(line => JSON.parse(line) as BrowserEvent);
  return { program, events };
}
