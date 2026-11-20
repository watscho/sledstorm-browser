// What the host runs: the game origin, the Netplay relay and the public
// gateway, started as one transaction from the saved configuration. The
// tunnel and the dedicated emulator join this stack in later stages.
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { connect, type Server, type Socket } from 'node:net';
import type { Readable } from 'node:stream';
import { readConfig } from './config-store.ts';
import { findDisc, GameFolderError } from './disc-folder.ts';
import { loadEmulatorAssets, MissingAssetsError, type EmulatorAssets } from './emulator-assets.ts';
import { GameFilesChangedError, prepareGameData, type GameData } from './game-data.ts';
import type { Log } from './log.ts';
import { createPublicGateway, createRetroArchRelay, listeningPort } from './network.ts';
import type { Paths } from './paths.ts';
import { startRuntimeHttp } from './runtime-http.ts';
import { StackStartError, startStack, type StackStep } from './stack.ts';

export type HostState = 'needs_setup' | 'idle' | 'preparing' | 'starting' | 'online' | 'degraded' | 'failed' | 'stopping';
export type HostComponent = 'config' | 'emulator' | 'game-data' | 'runtime' | 'netplay' | 'gateway';

export interface HostStatus {
  state: HostState;
  problem: { component: HostComponent; message: string } | null;
  game: { pal: boolean; archiveBytes: number; tracks: number } | null;
  localUrl: string | null;
  gatewayPort: number | null;
  tunnel: 'off';
}

/**
 * Requests may arrive in any order and at any time. The latest one wins, and
 * every call resolves once the service has settled on it.
 */
export interface HostService {
  /** A frozen snapshot. */
  status(): HostStatus;
  /** Resolves to the settled status. Expected problems are reported there, not thrown. */
  start(): Promise<HostStatus>;
  /** Interrupts a start that is under way. */
  stop(): Promise<void>;
}

// The web client is tied to these: the saved games live in the storage of
// http://127.0.0.1:8000, and its local Netplay address is derived from it.
const GAME_PORT = 8000;
const NETPLAY_PORT = 8006;

const snapshot = (status: HostStatus): HostStatus =>
  Object.freeze({ ...status, problem: status.problem && Object.freeze({ ...status.problem }),
    game: status.game && Object.freeze({ ...status.game }) });

const stopped = snapshot({ state: 'idle', problem: null, game: null, localUrl: null, gatewayPort: null, tunnel: 'off' });

/** A file system message names the user's folders; its code says enough. Other errors keep their text. */
function describe(error: unknown): string {
  const { code, name, message } = error as NodeJS.ErrnoException;
  return code ? String(code) : `${name}: ${message}`;
}

/** Closes a listener together with every connection it still holds, upgraded ones included. */
function closer(server: Server): () => Promise<void> {
  const sockets = new Set<Socket>();
  server.on('connection', (socket: Socket) => {
    sockets.add(socket);
    socket.once('close', () => sockets.delete(socket));
  });
  return () => new Promise<void>(resolve => {
    server.close(() => resolve());
    for (const socket of sockets) socket.destroy();
  });
}

/**
 * Refuses a port that anything already answers on. Binding alone does not
 * tell: on macOS a loopback bind succeeds while another program listens on
 * all interfaces, and would silently take that program's local traffic.
 */
async function expectFree(port: number): Promise<void> {
  const answered = await new Promise<boolean>(resolve => {
    const socket = connect({ host: '127.0.0.1', port });
    socket.once('connect', () => {
      socket.destroy();
      resolve(true);
    });
    socket.once('error', () => resolve(false));
  });
  if (answered) throw Object.assign(new Error(`Port ${port} is in use.`), { code: 'EADDRINUSE' });
}

export function createHostService({ paths, log, gamePort = GAME_PORT, netplayPort = NETPLAY_PORT, accessToken }: {
  paths: Paths;
  log: Log;
  gamePort?: number;
  netplayPort?: number;
  /** The gateway credential, 48 hexadecimal digits. Random unless a test supplies one. */
  accessToken?: string;
}): HostService {
  let status = stopped;
  let stopStack: (() => Promise<void>) | null = null;
  // What the latest request asked for, and whether that start request has had its attempt.
  let wanted = false;
  let attempted = false;
  let working: Promise<void> | null = null;
  let interrupt: AbortController | null = null;

  const set = (next: HostStatus) => { status = snapshot(next); };
  const blocked = (state: 'needs_setup' | 'failed', component: HostComponent, message: string) => {
    log(`Cannot host (${component}): ${message}`);
    set({ ...stopped, state, problem: { component, message } });
  };
  const busy = (port: number, purpose: string) =>
    `Port ${port} is in use by another program. Sled Storm needs it for ${purpose}. Quit that program, then start the server again.`;

  /** One start attempt. Returns early, leaving nothing behind, once `signal` is aborted. */
  async function attempt(signal: AbortSignal): Promise<void> {
    const { config, problem } = await readConfig(paths);
    if (signal.aborted) return;
    if (problem) return blocked('needs_setup', 'config', problem);
    if (!config.gameFolder || !config.discPolicy)
      return blocked('needs_setup', 'config', 'Choose the game folder and the disc policy to start hosting.');
    if (config.discPolicy !== 'shared-allowed')
      return blocked('needs_setup', 'config', "Rooms that use each player's own game files are not available in this build yet. Choose shared-allowed to host.");

    let assets: EmulatorAssets;
    try {
      assets = await loadEmulatorAssets(paths.resourceRoot);
    } catch (error) {
      if (error instanceof MissingAssetsError) return blocked('failed', 'emulator', error.message);
      throw error;
    }
    if (signal.aborted) return;

    set({ ...stopped, state: 'preparing' });
    log('Preparing the game files.');
    let data: GameData;
    let tracks: number;
    try {
      const disc = await findDisc(config.gameFolder);
      tracks = disc.files.length - 1;
      data = await prepareGameData(disc, paths.cacheRoot, { signal });
    } catch (error) {
      if (signal.aborted) return set(stopped);
      if (error instanceof GameFolderError || error instanceof GameFilesChangedError)
        return blocked('failed', 'game-data', error.message);
      log(`Unexpected game data error: ${describe(error)}`);
      return blocked('failed', 'game-data', 'The game files could not be read.');
    }
    if (signal.aborted) return set(stopped);
    const { identity } = data;
    log(data.reused ? 'The game files are unchanged since they were last prepared.' : 'The game files are prepared.');

    // A disc that changes under a running server must not be sent, and the host has to learn of it.
    let changed = false;
    const noteChange = () => {
      if (changed) return;
      changed = true;
      log('The game files changed while the server was running.');
      if (status.state === 'online') {
        set({ ...status, state: 'degraded', problem: { component: 'game-data',
          message: 'The game files changed after they were prepared. Quit the server and open it again.' } });
      }
    };
    const archive = {
      size: identity.archive.size,
      async open(): Promise<Readable> {
        if (changed) throw new GameFilesChangedError('The game files changed after they were prepared.');
        try {
          const stream = await data.openArchive();
          stream.once('error', error => { if (error instanceof GameFilesChangedError) noteChange(); });
          return stream;
        } catch (error) {
          if (error instanceof GameFilesChangedError) noteChange();
          throw error;
        }
      },
    };

    set({ ...stopped, state: 'starting', game: { pal: identity.pal, archiveBytes: identity.archive.size, tracks } });
    const origins = [`http://127.0.0.1:${gamePort}`, `http://localhost:${gamePort}`];
    let gatewayPort = 0;
    const steps: StackStep[] = [
      {
        name: 'runtime',
        async start() {
          await expectFree(gamePort);
          const runtime = await startRuntimeHttp({
            port: gamePort,
            webRoot: assets.webRoot,
            emulatorRoot: assets.emulatorRoot,
            coreData: assets.coreData,
            hardwareRenderer: assets.hardwareRenderer,
            // Every client hashes this object into the room identity, so the keys keep the launcher's order.
            sessionInfo: { disc: identity.disc, pal: identity.pal, archive: identity.archive, discMode: 'shared',
              roomCheck: true, ...assets.identity },
            invitation: () => null,
            archive,
          });
          return () => runtime.close();
        },
      },
      {
        name: 'netplay',
        async start() {
          await expectFree(netplayPort);
          const relay = createRetroArchRelay({ port: netplayPort, origins });
          try {
            await once(relay, 'listening');
          } catch (error) {
            relay.close();
            throw error;
          }
          return () => new Promise<void>(resolve => {
            relay.stopDedicated();
            for (const client of relay.clients) client.terminate();
            relay.close(() => resolve());
          });
        },
      },
      {
        name: 'gateway',
        async start() {
          const gateway = createPublicGateway({
            port: 0,
            upstream: gamePort,
            netplay: netplayPort,
            // Part of every invitation link. It stays in memory and out of the status and the log.
            accessToken: accessToken ?? randomBytes(24).toString('hex'),
            discMode: 'shared',
            assetPaths: assets.assetPaths,
            maxPayload: 8 * 1024 * 1024,
            mirrorPort: 0,
            getMirrorOrigin: () => undefined,
          });
          const closeGateway = closer(gateway);
          const closeMirror = gateway.mirrorServer ? closer(gateway.mirrorServer) : async () => {};
          const stop = async () => {
            await closeMirror();
            await closeGateway();
          };
          try {
            await Promise.all([once(gateway, 'listening'), gateway.mirrorServer && once(gateway.mirrorServer, 'listening')]);
          } catch (error) {
            await stop();
            throw error;
          }
          gatewayPort = listeningPort(gateway);
          return stop;
        },
      },
    ];

    let stop: () => Promise<void>;
    try {
      stop = await startStack(steps, (component, error) => log(`The ${component} component did not stop cleanly: ${describe(error)}`));
    } catch (error) {
      if (!(error instanceof StackStartError)) throw error;
      const component = error.component as HostComponent;
      const inUse = (error.cause as NodeJS.ErrnoException | undefined)?.code === 'EADDRINUSE';
      if (inUse && component === 'runtime') return blocked('failed', component, busy(gamePort, 'the local game page'));
      if (inUse && component === 'netplay') return blocked('failed', component, busy(netplayPort, 'multiplayer'));
      log(`Unexpected ${component} error: ${describe(error.cause)}`);
      return blocked('failed', component, `The ${component} component could not start.`);
    }
    if (signal.aborted) {
      await stop();
      return set(stopped);
    }
    stopStack = stop;
    log(`The local game page is ready on 127.0.0.1:${gamePort}.`);
    set({ ...status, state: 'online', localUrl: `http://127.0.0.1:${gamePort}/`, gatewayPort });
  }

  async function halt(): Promise<void> {
    const stop = stopStack;
    if (!stop) return;
    stopStack = null;
    set({ ...status, state: 'stopping' });
    await stop();
    log('The local game page is stopped.');
  }

  /** Drives the service toward the latest request. One loop runs at a time; later requests join it. */
  const settle = (): Promise<void> => working ??= (async () => {
    // Yield first. A loop with nothing to do would otherwise finish, and clear `working`, inside the
    // very call that is about to store its promise there; the stale promise would then swallow every
    // later request.
    await null;
    try {
      for (;;) {
        if (wanted && !attempted && status.state !== 'online') {
          attempted = true;
          // A degraded or half-failed stack goes first, so the new attempt starts clean.
          await halt();
          interrupt = new AbortController();
          try {
            await attempt(interrupt.signal);
          } catch (error) {
            log(`Unexpected start error: ${describe(error)}`);
            await halt();
            blocked('failed', 'runtime', 'The server could not start.');
          } finally {
            interrupt = null;
          }
        } else if (!wanted && (stopStack || status.state !== 'idle')) {
          await halt();
          set(stopped);
        } else {
          break;
        }
      }
    } finally {
      working = null;
    }
  })();

  return {
    status: () => status,
    async start() {
      wanted = true;
      attempted = false;
      await settle();
      return status;
    },
    async stop() {
      wanted = false;
      interrupt?.abort();
      await settle();
    },
  };
}
