// Short-lived commands that talk to the running server: open it (starting it
// first when needed), ask it to quit, report it, or print its diagnostics.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { readConfig, writeConfig } from './config-store.ts';
import { WORKER_GRACE_MS } from './dedicated.ts';
import { diagnosticReport } from './diagnostics.ts';
import { findDisc, GameFolderError } from './disc-folder.ts';
import { fetchInvitation, fetchStatus, findLiveInstance, isLive, readInstanceRecord, requestBootstrap, requestDiagnostics, requestNewGame, requestQuit,
  requestStart, requestStop, waitForInstance, type HostingAnswer, type InstanceRecord } from './instance.ts';
import { ensureWritableRoots, type Paths } from './paths.ts';
import { openBrowser } from './platform/open-browser.ts';
import { currentBuild } from './runtime-manifest.ts';
import { selfCommand } from './self.ts';
import { TUNNEL_GRACE_MS } from './tunnel.ts';
import { appVersion } from './version.ts';

const panelUrl = (port: number) => `http://127.0.0.1:${port}/`;

/**
 * Start a detached server or find the one that's already running. If a server
 * of another build has an empty room, ask it to quit and start this build's
 * server in its place.
 * The macOS window receives a one-time address through its private subprocess
 * pipe. `open` stands in for the user's browser in tests of the CLI launcher.
 */
export async function launch(paths: Paths, { openPanel, nativePanel = false, open = openBrowser, quitWait = QUIT_WAIT_MS }: {
  openPanel: boolean;
  nativePanel?: boolean;
  open?: (url: string) => Promise<void>;
  /** How long a server of another build that accepted a quit may take to go. Shorter in tests. */
  quitWait?: number;
}): Promise<number> {
  await ensureWritableRoots(paths);
  let record = await findLiveInstance(paths);
  let replaced = false;
  let otherBuild = false;
  if (record && anotherBuild(record, { build: await currentBuild(paths.resourceRoot), version: appVersion })) {
    const kept = await retire(record, quitWait);
    if (kept) {
      // Its page is opened as before: it is the server that hosts.
      console.error(kept);
      otherBuild = true;
    } else {
      record = null;
      replaced = true;
    }
  }
  let spawned: number | undefined;
  if (!record) {
    const { command, args } = selfCommand(nativePanel ? ['serve', '--launcher'] : ['serve']);
    const server = spawn(command, args, { detached: true, stdio: 'ignore' });
    server.once('error', () => { /* Reported below when no server appears. */ });
    server.unref();
    spawned = server.pid;
    // Several launches may race. Whichever server took the lock is the one to use.
    record = await waitForInstance(paths, 15_000);
  }
  if (!record) {
    console.error(`The server did not start. See the log in ${paths.logRoot}.`);
    return 1;
  }
  const url = panelUrl(record.port);
  const event = record.pid !== spawned ? 'reused' : replaced ? 'replaced' : 'started';
  if (openPanel || nativePanel) {
    // The page gets in with a token that is good once and for a minute.
    const bootstrap = await requestBootstrap(record);
    const address = bootstrap ? `${url}#bootstrap=${bootstrap}` : url;
    if (nativePanel) {
      console.log(JSON.stringify({ address, openAtLaunch: false }));
      return 0;
    }
    await open(address);
  }
  // The token is a credential: what is printed is the address alone.
  console.log(JSON.stringify({ event, pid: record.pid, url, ...(otherBuild && { otherBuild: true }) }));
  return 0;
}

/**
 * Whether the recorded server runs other code than this program. Two builds differ by the checksum of the
 * server's code; a record without one, from a run from source or from an earlier build, differs from a build
 * that has one. Two runs from source differ by their version.
 */
function anotherBuild(record: InstanceRecord, own: { build: string | null; version: string }): boolean {
  return record.build !== own.build || (own.build === null && record.version !== own.version);
}

/**
 * Asks a server of another build to quit, when its status says that nobody is in its room, and waits until it
 * is gone. Null once it is gone; otherwise the sentence that says why it keeps running. A server of an
 * earlier build quits without asking about players, so the room is read first.
 */
async function retire(record: InstanceRecord, wait: number): Promise<string | null> {
  if (!emptyRoom((await fetchStatus(record))?.host))
    return 'A server of another build is running and somebody may be in its room, so it keeps running.';
  const answer = await requestQuit(record);
  if (answer?.status !== 202) return 'A server of another build is running and did not quit, so it keeps running.';
  // It said that it quits. A later launch finds it gone.
  return await gone(record, wait) ? null : 'A server of another build is still quitting. Open Sled Storm Server again in a moment.';
}

/** True when a host's status says that nobody is in its room: it has no room, or nobody connected and no controller kept. */
function emptyRoom(host: unknown): boolean {
  if (typeof host !== 'object' || host === null || !('players' in host)) return false;
  const { players } = host as { players: unknown };
  if (players === null) return true;
  const { connected, reserved } = (typeof players === 'object' ? players : {}) as { connected?: unknown; reserved?: unknown };
  return connected === 0 && reserved === 0;
}

/** Waits until the recorded server neither answers nor runs, for at most `ms`. True when it is gone. */
async function gone(record: InstanceRecord, ms: number): Promise<boolean> {
  const deadline = Date.now() + ms;
  while (await isLive(record) || alive(record.pid)) {
    if (Date.now() >= deadline) return false;
    await delay(50);
  }
  return true;
}

/**
 * How long `quit`, and a launch that replaces a server of another build, wait for the server to be gone.
 * The host stops its tunnels first and its workers after them, and each may need its whole grace period
 * before it is killed.
 */
export const QUIT_WAIT_MS = TUNNEL_GRACE_MS + WORKER_GRACE_MS + 5000;

/** Stops the running server. With players in the room it needs `--force`. */
export async function quit(paths: Paths, argv: string[]): Promise<number> {
  const force = forceSwitch(argv);
  if (force === null) {
    console.error('Usage: SledStormServer quit [--force]');
    return 2;
  }
  const record = await findLiveInstance(paths);
  if (!record) {
    console.log(JSON.stringify({ event: 'not-running' }));
    return 0;
  }
  const answer = await requestQuit(record, force);
  if (answer?.status !== 202) {
    console.error(inTheRoom(answer?.players) ? `${inTheRoom(answer?.players)} Add --force to quit anyway.`
      : 'The server did not accept the quit request.');
    return 1;
  }
  if (!await gone(record, QUIT_WAIT_MS)) {
    console.error('The server accepted the quit request but is still running.');
    return 1;
  }
  console.log(JSON.stringify({ event: 'stopped', pid: record.pid }));
  return 0;
}

export async function status(paths: Paths): Promise<number> {
  const record = await readInstanceRecord(paths);
  const report = record && await fetchStatus(record);
  console.log(JSON.stringify(record && report?.instance === record.instance
    ? { running: true, pid: record.pid, version: record.version, startedAt: record.startedAt, url: panelUrl(record.port),
      host: report.host }
    : { running: false }));
  return 0;
}

/** Prints the private link that guests open. It is a credential: it goes to standard output and nowhere else. */
export async function invitation(paths: Paths): Promise<number> {
  const record = await findLiveInstance(paths);
  if (!record) {
    console.error('The server is not running.');
    return 1;
  }
  const links = await fetchInvitation(record);
  if (!links) {
    console.error('No room is open.');
    return 1;
  }
  // `url` is for guests and is null without a public address. `localUrl` opens the same room on this computer.
  console.log(JSON.stringify(links));
  return 0;
}

/**
 * Sends a request about hosting to the running server and prints its answer. The server answers at
 * once and works on; `status` tells how it went.
 */
async function hosting(paths: Paths, event: 'starting' | 'stopping' | 'new-game',
  request: (record: InstanceRecord) => Promise<HostingAnswer | null>): Promise<number> {
  const record = await findLiveInstance(paths);
  if (!record) {
    console.error('The server is not running.');
    return 1;
  }
  const answer = await request(record);
  if (answer?.status === 202) {
    console.log(JSON.stringify({ event, host: answer.host }));
    return 0;
  }
  const players = inTheRoom(answer?.players);
  if (players) {
    console.error(`${players} ${{ stopping: 'Add --force to stop it anyway.',
      starting: 'This start closes their room and opens a new one. Add --force to start anyway.',
      'new-game': 'A new game disconnects them. Add --force to start one anyway.' }[event]}`);
  } else {
    console.error(typeof answer?.error === 'string' ? answer.error : 'The server did not accept the request.');
  }
  return 1;
}

/** The sentence about the players of a refusal, or null when the answer counts none. */
function inTheRoom(players: unknown): string | null {
  const { connected, reserved } = (players ?? {}) as { connected?: unknown; reserved?: unknown };
  return typeof connected === 'number' && typeof reserved === 'number'
    ? `Players are in the room: ${connected} connected, ${reserved} away with a controller kept.` : null;
}

/** The one switch of `start`, `stop`, `new-game` and `quit`, or null for anything else on the command line. */
const forceSwitch = (argv: string[]): boolean | null =>
  argv.length === 0 ? false : argv.length === 1 && argv[0] === '--force' ? true : null;

/**
 * Starts hosting on the running server: the game page, the room and the public address. A start that
 * closes a room with players in it, after the game files changed, needs `--force`.
 */
export async function start(paths: Paths, argv: string[]): Promise<number> {
  const force = forceSwitch(argv);
  if (force === null) {
    console.error('Usage: SledStormServer start [--force]');
    return 2;
  }
  return hosting(paths, 'starting', record => requestStart(record, force));
}

/** Stops hosting and leaves the server running. With players in the room it needs `--force`. */
export async function stop(paths: Paths, argv: string[]): Promise<number> {
  const force = forceSwitch(argv);
  if (force === null) {
    console.error('Usage: SledStormServer stop [--force]');
    return 2;
  }
  return hosting(paths, 'stopping', record => requestStop(record, force));
}

/** Starts a new game in the room of the running server, under the same links. With players in the room it needs `--force`. */
export async function newGame(paths: Paths, argv: string[]): Promise<number> {
  const force = forceSwitch(argv);
  if (force === null) {
    console.error('Usage: SledStormServer new-game [--force]');
    return 2;
  }
  return hosting(paths, 'new-game', record => requestNewGame(record, force));
}

/**
 * Prints the diagnostic report: the running server's, or, when no server runs, one that this command
 * makes from the same log and configuration, without a host. It names no folder and no secret.
 */
export async function diagnostics(paths: Paths): Promise<number> {
  const record = await findLiveInstance(paths);
  const report = record ? await requestDiagnostics(record)
    : await diagnosticReport({ paths, version: appVersion, status: null, config: await readConfig(paths), now: new Date(), startedAt: null });
  if (!report) {
    console.error('The running server did not give a diagnostic report.');
    return 1;
  }
  console.log(JSON.stringify(report, null, 2));
  return 0;
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}

/** Saves the game folder and the disc policy after checking that the folder holds a disc. */
export async function configure(paths: Paths, argv: string[]): Promise<number> {
  const usage = () => {
    console.error('Usage: SledStormServer configure --game-folder <folder> --disc-policy <local-only|shared-allowed>');
    return 2;
  };
  const options = new Map<string, string>();
  for (let index = 0; index < argv.length; index += 2) {
    const name = argv[index]!;
    const value = argv[index + 1];
    if ((name !== '--game-folder' && name !== '--disc-policy') || value === undefined || options.has(name)) return usage();
    options.set(name, value);
  }
  const folder = options.get('--game-folder');
  const discPolicy = options.get('--disc-policy');
  if (!folder || (discPolicy !== 'local-only' && discPolicy !== 'shared-allowed')) return usage();

  let disc;
  try {
    disc = await findDisc(resolve(folder));
  } catch (error) {
    if (!(error instanceof GameFolderError)) throw error;
    console.error(error.message);
    return 2;
  }
  await ensureWritableRoots(paths);
  // The switch for starting at launch and the room's options are not this command's to change.
  const { autoStart, roomOptions } = (await readConfig(paths)).config;
  await writeConfig(paths, { version: 1, gameFolder: disc.folder, discPolicy, autoStart, roomOptions });
  // A running server keeps the disc it prepared at start.
  const restartRequired = await findLiveInstance(paths) !== null;
  console.log(JSON.stringify({ event: 'configured', gameFolder: disc.folder, discPolicy, tracks: disc.files.length - 1, restartRequired }));
  return 0;
}
