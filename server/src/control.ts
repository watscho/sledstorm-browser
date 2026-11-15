// Short-lived commands that talk to the running server: open it (starting it
// first when needed), ask it to quit, or report it.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { findLiveInstance, requestQuit, waitForInstance, isLive } from './instance.ts';
import { ensureWritableRoots, type Paths } from './paths.ts';
import { openBrowser } from './platform/open-browser.ts';
import { selfCommand } from './self.ts';

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
  const deadline = Date.now() + 10_000;
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
  const record = await findLiveInstance(paths);
  console.log(JSON.stringify(record
    ? { running: true, pid: record.pid, version: record.version, startedAt: record.startedAt, url: panelUrl(record.port) }
    : { running: false }));
  return 0;
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM'; }
}
