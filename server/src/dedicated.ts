// The server's side of the dedicated emulator: which browser runs it, and
// every worker this server has started. The browser itself is driven by the
// existing runtime under research/network, over private pipes.
import { mkdir } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';
import type { Log } from './log.ts';
import { launchDedicatedRuntime, type DedicatedSetup } from './network.ts';
import type { Paths } from './paths.ts';

/** The browser that ships in the resource root. */
export const shippedBrowser = (paths: Paths): string =>
  join(paths.resourceRoot, 'chromium', 'Chromium.app', 'Contents', 'MacOS', 'Chromium');

/**
 * A developer who runs the server from source may point it at another
 * browser. The packaged server uses the shipped one and never looks elsewhere.
 */
export function chosenBrowser({ sea, env, paths }: { sea: boolean; env: NodeJS.ProcessEnv; paths: Paths }): string {
  const override = env.SLED_SERVER_CHROME;
  return !sea && override && isAbsolute(override) ? override : shippedBrowser(paths);
}

/**
 * Added to the runtime's own switches. A browser that runs unseen for the
 * server must not ask for the user's keychain, and has no reason to fetch
 * updates or talk to anything but this computer. The first three switches
 * are not enough for the last part: the shipped browser was seen to reach its
 * maker's servers with them. The resolver rule leaves it no name to resolve
 * but the loopback address, which the game page and the relay are on.
 */
export const WORKER_SWITCHES = ['--use-mock-keychain', '--disable-background-networking', '--disable-component-update',
  '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'];

/** How long a worker's browser may take to end before it is killed. */
export const WORKER_GRACE_MS = 5000;

export interface Workers {
  /** Starts the emulator of one room. Given to the Netplay relay as its `startDedicated`. */
  start(setup: DedicatedSetup, signal: AbortSignal): Promise<{ exited: Promise<void> }>;
  /** Workers that are starting or running. */
  count(): number;
  /** Resolves when every worker is gone, together with its profile. It does not stop them. */
  settled(): Promise<void>;
}

/** A file system message names the user's folders; its code says enough. Other errors keep their text. */
function reason(error: unknown): string {
  const { code, name, message } = error as NodeJS.ErrnoException;
  return code ? String(code) : `${name}: ${message}`;
}

export function createWorkers({ browser, url, profileRoot, log, graceMs = WORKER_GRACE_MS }: {
  browser: string;
  url: string;
  profileRoot: string;
  log: Log;
  graceMs?: number;
}): Workers {
  const running = new Set<Promise<void>>();
  return {
    start(setup, signal) {
      // Neither the room nor its key is logged: both are parts of a private invitation.
      log('Starting an emulator worker.');
      // The folder is in a cache, which the system or a cleaning tool may empty while the server runs.
      const launch = mkdir(profileRoot, { recursive: true, mode: 0o700 }).then(() =>
        launchDedicatedRuntime(browser, setup, signal, { url, args: WORKER_SWITCHES, profileRoot, graceMs,
          // No switch moves the browser's crash reports; this variable does. Left alone, they go to the
          // user's own Library, where a browser the user installed keeps its own.
          env: { BREAKPAD_DUMP_LOCATION: join(profileRoot, 'crash-reports') } }));
      launch.catch(error => {
        // A start that was called off is not a browser that cannot start.
        if (!signal.aborted) log(`An emulator worker could not start: ${reason(error)}`);
      });
      // Counted from before the browser exists, so that a stop during the start waits for it too.
      // A failed start has cleaned up after itself by the time it is reported.
      const ended = launch.then(runtime => runtime.exited, () => {});
      running.add(ended);
      void ended.then(() => {
        running.delete(ended);
        log(`An emulator worker ended; ${running.size} still running.`);
      });
      return launch;
    },
    count: () => running.size,
    async settled() {
      while (running.size) await Promise.all(running);
    },
  };
}
