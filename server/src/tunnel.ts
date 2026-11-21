// Runs one cloudflared Quick Tunnel and knows whether its public address
// works. Readiness comes from the program's own metrics listener, not from
// its log. The address and the metrics port stay out of the log: they are
// parts of a private link.
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import type { Log } from './log.ts';
import { startOwnedProcess, type OwnedProcess } from './owned-process.ts';

export type TunnelState = 'off' | 'starting' | 'online' | 'retrying' | 'failed';

export interface TunnelTiming {
  /** How long the program may take to register a connection. */
  readyMs: number;
  /** How long the public address may take to pass the probe. */
  probeMs: number;
  /** Pause between readiness polls while starting; eight times longer once online. */
  pollMs: number;
  /** How long an online tunnel may go without a connection before it is restarted. */
  lostMs: number;
  /** The pause before each restart. When they are used up the tunnel has failed. */
  restartDelaysMs: number[];
  /** An online period this long earns the restart pauses back. */
  stableMs: number;
  graceMs: number;
}

export interface TunnelOptions {
  name: string;
  /** The program and its leading arguments; the supervisor appends the tunnel arguments. */
  command: { command: string; args: string[] };
  /** Loopback port that the tunnel exposes. */
  port: number;
  protocol: string;
  /** Parent of the empty home directory each launch gets. */
  homeRoot: string;
  log: Log;
  /** Rejects while the public address does not work yet. Absent: a registered connection is enough. */
  probe?: (origin: string, signal: AbortSignal) => Promise<void>;
  onChange?: () => void;
  /** Ends the program if this process is killed. See `guard` in owned-process.ts. */
  guard?: { command: string; args: string[] };
  /** Keep restarting at the last pause instead of failing. For a tunnel that hosting can do without. */
  keepTrying?: boolean;
  timing?: Partial<TunnelTiming>;
}

export interface Tunnel {
  state(): TunnelState;
  /** `https://<hostname>` while online, else null. */
  origin(): string | null;
  /** Starts supervising. Does nothing while a start is already under way or online. */
  start(): void;
  stop(): Promise<void>;
}

/** How long a tunnel program may take to end before it is killed. */
export const TUNNEL_GRACE_MS = 5000;

const defaults: TunnelTiming = { readyMs: 90_000, probeMs: 60_000, pollMs: 250, lostMs: 20_000,
  restartDelaysMs: [2000, 4000, 8000, 16_000, 30_000], stableMs: 60_000, graceMs: TUNNEL_GRACE_MS };

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, 'close');
  return port;
}

/** Runs `work` with a signal that also aborts after `ms`. */
async function within<T>(ms: number, signal: AbortSignal, work: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const limited = AbortSignal.any([signal, AbortSignal.timeout(ms)]);
  limited.throwIfAborted();
  const task = work(limited);
  // The work may be slow to notice its signal, or ignore it. The wait for it must not.
  task.catch(() => {});
  const aborted = new Promise<never>((_resolve, reject) => {
    limited.addEventListener('abort', () => reject(limited.reason), { once: true });
  });
  return Promise.race([task, aborted]);
}

async function json(url: string, signal: AbortSignal): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await fetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(2000)]) });
  return { status: response.status, body: await response.json() as Record<string, unknown> };
}

/** True when the program reports at least one registered connection. Unreachable metrics count as not ready. */
async function connected(metrics: string, signal: AbortSignal): Promise<boolean> {
  try {
    const { status, body } = await json(`${metrics}/ready`, signal);
    return status === 200 && Number(body.readyConnections) >= 1;
  } catch {
    signal.throwIfAborted();
    return false;
  }
}

export function createTunnel(options: TunnelOptions): Tunnel {
  const { name, log } = options;
  const timing = { ...defaults, ...options.timing };
  let state: TunnelState = 'off';
  let origin: string | null = null;
  let run: { abort: AbortController; done: Promise<void> } | null = null;

  const set = (next: TunnelState, address: string | null = null) => {
    if (state === next && origin === address) return;
    state = next;
    origin = address;
    options.onChange?.();
  };

  /** One run of the program, until it fails or `outer` aborts. Resolves to whether it stayed online long enough to count as stable. */
  async function launch(outer: AbortSignal): Promise<boolean> {
    const attempt = new AbortController();
    const forward = () => attempt.abort();
    outer.addEventListener('abort', forward, { once: true });
    const { signal } = attempt;
    let child: OwnedProcess | undefined;
    let home: string | undefined;
    let onlineSince: number | undefined;
    try {
      const port = await freePort();
      const metrics = `http://127.0.0.1:${port}`;
      // An empty home of its own: no configuration or certificate of the user reaches the program.
      home = await mkdtemp(join(options.homeRoot, `${name}-tunnel-`));
      signal.throwIfAborted();
      child = await startOwnedProcess({
        name: `${name} tunnel`,
        command: options.command.command,
        args: [...options.command.args, 'tunnel', '--url', `http://127.0.0.1:${options.port}`, '--metrics', `127.0.0.1:${port}`,
          '--protocol', options.protocol, '--no-autoupdate'],
        env: { HOME: home },
        startupMs: 5000,
        guard: options.guard,
      });
      void child.exited.then(() => attempt.abort());

      await within(timing.readyMs, signal, async limited => {
        while (!await connected(metrics, limited)) await delay(timing.pollMs, undefined, { signal: limited });
      });
      const { hostname } = (await json(`${metrics}/quicktunnel`, signal)).body;
      if (typeof hostname !== 'string' || !/^[a-z0-9-]+\.trycloudflare\.com$/.test(hostname))
        throw new Error('The tunnel program reported an unexpected address.');
      const address = `https://${hostname}`;
      if (options.probe) await within(timing.probeMs, signal, limited => options.probe!(address, limited));
      signal.throwIfAborted();

      onlineSince = Date.now();
      log(`The ${name} tunnel is online.`);
      set('online', address);
      for (let seen = Date.now(); Date.now() - seen < timing.lostMs;) {
        await delay(timing.pollMs * 8, undefined, { signal });
        if (await connected(metrics, signal)) seen = Date.now();
      }
      log(`The ${name} tunnel lost its connection.`);
    } catch {
      // Stopped, exited, past a deadline or an unusable answer: this launch is over either way.
    } finally {
      outer.removeEventListener('abort', forward);
      attempt.abort();
      // The address stops being handed out before the program is even gone.
      if (state === 'online' && !outer.aborted) set('retrying');
      await child?.stop(timing.graceMs);
      // A home that cannot be removed is left behind; it must not take the tunnel or the server down.
      if (home) await rm(home, { recursive: true, force: true }).catch(() => log(`The ${name} tunnel left a temporary folder behind.`));
    }
    return onlineSince !== undefined && Date.now() - onlineSince >= timing.stableMs;
  }

  async function supervise(signal: AbortSignal): Promise<void> {
    let failures = 0;
    log(`The ${name} tunnel is starting.`);
    set('starting');
    while (!signal.aborted) {
      if (await launch(signal)) failures = 0;
      if (signal.aborted) return;
      const pause = timing.restartDelaysMs[failures] ?? (options.keepTrying ? timing.restartDelaysMs.at(-1) : undefined);
      if (pause === undefined) {
        log(`The ${name} tunnel failed.`);
        return set('failed');
      }
      failures += 1;
      log(`The ${name} tunnel is restarting.`);
      set('retrying');
      await delay(pause, undefined, { signal }).catch(() => {});
    }
  }

  // A supervision that ends by itself, failed, frees the slot so that a new start can try again.
  const release = (abort: AbortController) => {
    if (run?.abort === abort) run = null;
  };

  return {
    state: () => state,
    origin: () => origin,
    start() {
      if (run) return;
      const abort = new AbortController();
      const done = (async () => {
        try {
          await supervise(abort.signal);
        } catch (error) {
          // Nothing above is expected to throw. If it does, the tunnel has failed; the server goes on.
          log(`The ${name} tunnel stopped on an unexpected error: ${(error as Error).name}.`);
          if (!abort.signal.aborted) set('failed');
        } finally {
          release(abort);
        }
      })();
      run = { abort, done };
    },
    async stop() {
      const current = run;
      run = null;
      if (current) {
        current.abort.abort();
        await current.done;
        log(`The ${name} tunnel is stopped.`);
      }
      set('off');
    },
  };
}
