// The diagnostic report: what the owner saves from the panel, or prints with
// a command, to tell what went wrong. It is made of what the server knows and
// of the end of its log, and it names no folder and no secret: the
// configuration leaves without the folder's path, and every line of the log
// goes through a filter. The log holds none of that to begin with (D19), so
// the filter is the second line of defense; it may hide a number that would
// have helped.
import { access, open } from 'node:fs/promises';
import { homedir, release } from 'node:os';
import { join } from 'node:path';
import type { DiscPolicy, HostConfig, RoomPreference } from './config-store.ts';
import { shippedBrowser } from './dedicated.ts';
import { shippedTunnelProgram, type HostStatus } from './host-service.ts';
import { applicationName, type Paths } from './paths.ts';
import { readRuntimeManifest, type RuntimeManifest } from './runtime-manifest.ts';

export interface DiagnosticReport {
  application: string;
  version: string;
  generatedAt: string;
  /** When the server started, and how long ago. Null in a report that a command made without a server. */
  startedAt: string | null;
  uptimeSeconds: number | null;
  system: { platform: string; release: string; arch: string; node: string };
  /** The versions and checksums of the build's parts, as the build wrote them. Null without a manifest that can be read. */
  manifest: RuntimeManifest | null;
  /** Which of its parts the build has: the web client, the emulator, its browser, the tunnel program and the panel's page. */
  parts: { web: boolean; emulator: boolean; browser: boolean; tunnel: boolean; panel: boolean };
  /** The host's status, as the panel reads it. Null when no server runs. */
  host: HostStatus | null;
  /** The saved configuration, with whether a folder is chosen in place of its path. */
  config: { gameFolder: boolean; discPolicy: DiscPolicy | null; autoStart: boolean; roomOptions: RoomPreference; problem: string | null };
  /** The last lines of the server's log, filtered. */
  log: { lines: string[]; problem: string | null };
}

const LOG_LINES = 200;
const LOG_BYTES = 64 * 1024;

/** A path as a line may hold it: as it is, in either normal form of its letters, and as an address spells it. Longest first. */
const spellings = (path: string) => [...new Set([path, path.normalize('NFC'), path.normalize('NFD'), encodeURI(path)])]
  .sort((a, b) => b.length - a.length);

const HEX = /[0-9a-f]{16,}/gi;
const PUBLIC_HOST = /(?:[a-z0-9-]+\.)+trycloudflare\.com/gi;
/**
 * A run of characters without a space, a quote or an angle bracket that is longer than any address the server
 * writes. It goes whole, before the filters below, so that none of them meets a run longer than this: each of them
 * looks, from every start, to the end of a run, which on a run of the whole line takes seconds.
 */
const LONG_RUN = /[^\s"'<>]{513,}/g;
/** An address, known by its scheme or by a slash, and its fragment up to a space, a quote or an angle bracket. */
const FRAGMENT = /((?:[a-z][a-z0-9+.-]*:\/\/|\/)[^\s#"'<>]*)#[^\s"'<>]*/gi;

/**
 * One line with the saved folder, the user's home folder, every run of more than 512 characters without a space,
 * every run of 16 or more hexadecimal digits, every host name under `trycloudflare.com` and the fragment of every
 * address replaced.
 */
export function scrubLine(line: string, { folder, home }: { folder: string | null; home: string }): string {
  let text = line;
  // The folder first: it may lie in the home folder, and then nothing of its path may be left behind.
  if (folder) for (const spelling of spellings(folder)) text = text.replaceAll(spelling, '<game folder>');
  // A home folder that is the root would take every slash.
  const own = home.replace(/\/+$/, '');
  if (own) for (const spelling of spellings(own)) text = text.replaceAll(spelling, '~');
  return text.replace(LONG_RUN, '<long text>').replace(FRAGMENT, '$1#<fragment>').replace(PUBLIC_HOST, '<public host>').replace(HEX, '<hex>');
}

/**
 * The last whole lines of a log, at most `lines` of them from its last `bytes` bytes. A missing log has
 * none; bytes that are not UTF-8 become the replacement character. Any other failure is thrown.
 */
export async function readLogTail(file: string, { lines = LOG_LINES, bytes = LOG_BYTES }: { lines?: number; bytes?: number } = {}): Promise<string[]> {
  let handle;
  try {
    handle = await open(file, 'r');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw error;
  }
  try {
    const { size } = await handle.stat();
    const start = Math.max(0, size - bytes);
    const buffer = Buffer.alloc(size - start);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, start);
    const all = new TextDecoder().decode(buffer.subarray(0, bytesRead)).split('\n');
    // The line that the bound cut is left out whole, and the newline at the end begins no line.
    if (start > 0) all.shift();
    if (all.at(-1) === '') all.pop();
    return all.slice(-lines);
  } finally {
    await handle.close();
  }
}

const exists = (path: string) => access(path).then(() => true, () => false);

export async function diagnosticReport({ paths, version, status, config, now, startedAt, home = homedir() }: {
  paths: Paths;
  version: string;
  /** Null when no server runs. */
  status: HostStatus | null;
  /** The saved configuration as it was read, with what is wrong with its file. */
  config: { config: HostConfig; problem: string | null };
  now: Date;
  startedAt: string | null;
  /** The user's home folder. A test names its own. */
  home?: string;
}): Promise<DiagnosticReport> {
  const scrub = (line: string) => scrubLine(line, { folder: config.config.gameFolder, home });
  let log: DiagnosticReport['log'];
  try {
    log = { lines: (await readLogTail(join(paths.logRoot, 'server.log'))).map(scrub), problem: null };
  } catch {
    log = { lines: [], problem: 'The log could not be read.' };
  }
  const started = startedAt === null ? Number.NaN : Date.parse(startedAt);
  const { gameFolder, discPolicy, autoStart, roomOptions } = config.config;
  return {
    application: applicationName,
    version,
    generatedAt: now.toISOString(),
    startedAt,
    uptimeSeconds: Number.isFinite(started) ? Math.max(0, Math.floor((now.getTime() - started) / 1000)) : null,
    system: { platform: process.platform, release: release(), arch: process.arch, node: process.versions.node },
    manifest: await readRuntimeManifest(paths.resourceRoot),
    parts: {
      web: await exists(join(paths.resourceRoot, 'web', 'index.html')),
      emulator: await exists(join(paths.resourceRoot, 'emulator', 'emulator.lock.json')),
      browser: await exists(shippedBrowser(paths)),
      tunnel: await exists(shippedTunnelProgram(paths)),
      panel: await exists(join(paths.resourceRoot, 'admin', 'index.html')),
    },
    // A problem's sentence is made without folders; it is filtered all the same.
    host: status && { ...status, problem: status.problem && { ...status.problem, message: scrub(status.problem.message) } },
    config: { gameFolder: gameFolder !== null, discPolicy, autoStart, roomOptions: { ...roomOptions }, problem: config.problem },
    log,
  };
}
