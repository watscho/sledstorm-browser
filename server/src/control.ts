// Short-lived commands that talk to the running server: open it (starting it
// first when needed), ask it to quit, or report it.
import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { writeConfig } from './config-store.ts';
import { WORKER_GRACE_MS } from './dedicated.ts';
import { findDisc, GameFolderError } from './disc-folder.ts';
import { fetchInvitation, fetchStatus, findLiveInstance, isLive, readInstanceRecord, requestQuit, waitForInstance } from './instance.ts';
import { ensureWritableRoots, type Paths } from './paths.ts';
import { openBrowser } from './platform/open-browser.ts';
import { selfCommand } from './self.ts';
import { TUNNEL_GRACE_MS } from './tunnel.ts';

const panelUrl = (port: number) => `http://127.0.0.1:${port}/`;

/**
 * What a double-click does. The first launch starts a detached server; every
 * later launch finds that server and opens its page again. This process exits
 * either way, so the application never sits unresponsive in the Dock.
 */
export async function launch(paths: Paths, { openPanel }: { openPanel: boolean }): Promise<number> {
  await ensureWritableRoots(paths);
  let record = await findLiveInstance(paths);
  let spawned: number | undefined;
  if (!record) {
    const { command, args } = selfCommand(['serve']);
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
  if (openPanel) await openBrowser(url);
  console.log(JSON.stringify({ event: record.pid === spawned ? 'started' : 'reused', pid: record.pid, url }));
  return 0;
}

/**
 * How long `quit` waits for the server to be gone. The host stops its tunnels first and its workers
 * after them, and each may need its whole grace period before it is killed.
 */
export const QUIT_WAIT_MS = TUNNEL_GRACE_MS + WORKER_GRACE_MS + 5000;

export async function quit(paths: Paths): Promise<number> {
  const record = await findLiveInstance(paths);
  if (!record) {
    console.log(JSON.stringify({ event: 'not-running' }));
    return 0;
  }
  if (!await requestQuit(record)) {
    console.error('The server did not accept the quit request.');
    return 1;
  }
  const deadline = Date.now() + QUIT_WAIT_MS;
  while (await isLive(record) || alive(record.pid)) {
    if (Date.now() >= deadline) {
      console.error('The server accepted the quit request but is still running.');
      return 1;
    }
    await delay(50);
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
  await writeConfig(paths, { version: 1, gameFolder: disc.folder, discPolicy });
  // A running server keeps the disc it prepared at start.
  const restartRequired = await findLiveInstance(paths) !== null;
  console.log(JSON.stringify({ event: 'configured', gameFolder: disc.folder, discPolicy, tracks: disc.files.length - 1, restartRequired }));
  return 0;
}
