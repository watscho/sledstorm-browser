// What the host runs: the game origin, the Netplay relay, the public gateway
// and the tunnels that give it a public address. The local stack starts as
// one transaction from the saved configuration; the tunnels are supervised
// beside it and never take the local game down. The server opens one room by
// itself, before any player; its emulator runs in the shipped browser.
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { access, constants, mkdir, rm } from 'node:fs/promises';
import { connect, type Server, type Socket } from 'node:net';
import { join } from 'node:path';
import type { Readable } from 'node:stream';
import { readConfig } from './config-store.ts';
import { createWorkers, shippedBrowser } from './dedicated.ts';
import { findDisc, GameFolderError } from './disc-folder.ts';
import { loadEmulatorAssets, MissingAssetsError, type EmulatorAssets } from './emulator-assets.ts';
import { GameFilesChangedError, prepareGameData, type GameData } from './game-data.ts';
import type { Log } from './log.ts';
import { createPublicGateway, createRetroArchRelay, identityKey, invitationUrl, invitationVersion, listeningPort, roomIdentity,
  type NetplayRelay, type RoomOptions } from './network.ts';
import type { Paths } from './paths.ts';
import { keepRoom, type RoomKeeper, type RoomState, type RoomTiming } from './room.ts';
import { startRuntimeHttp } from './runtime-http.ts';
import { selfCommand } from './self.ts';
import { StackStartError, startStack, type StackStep } from './stack.ts';
import { publicProbe } from './tunnel-probe.ts';
import { createTunnel, type Tunnel, type TunnelOptions, type TunnelState } from './tunnel.ts';

export type HostState = 'needs_setup' | 'idle' | 'preparing' | 'starting' | 'online' | 'degraded' | 'failed' | 'stopping';
export type HostComponent = 'config' | 'emulator' | 'game-data' | 'runtime' | 'netplay' | 'room' | 'gateway' | 'tunnel';

export interface HostStatus {
  /** `online` means that the local game, the room and the public address all work. */
  state: HostState;
  problem: { component: HostComponent; message: string } | null;
  game: { pal: boolean; archiveBytes: number; tracks: number } | null;
  localUrl: string | null;
  gatewayPort: number | null;
  /** The tunnel to the gateway. Its address is part of the private link and is not shown here. */
  tunnel: TunnelState;
  /** The optional second tunnel for mirrored Netplay packets. It never changes `state`. */
  mirror: TunnelState;
  /**
   * The server's one room. Its name and token are parts of the private link and are not shown here.
   * While it is `restoring`, a player's save is loading into it: the room and both links stay as they
   * are, so that does not change `state`.
   */
  room: RoomState;
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
  /** The private link for guests, or null while no public address works. */
  invitation(): string | null;
  /** The same room for a browser on this computer, or null without a room. It needs no public address. */
  localInvitation(): string | null;
}

/** How the tunnels are run. Tests give a stand-in program; the default is the shipped one. */
export interface TunnelSetup {
  command: { command: string; args: string[] };
  probe?: TunnelOptions['probe'];
  guard?: TunnelOptions['guard'];
  timing?: TunnelOptions['timing'];
}

// The web client is tied to these: the saved games live in the storage of
// http://127.0.0.1:8000, and its local Netplay address is derived from it.
const GAME_PORT = 8000;
const NETPLAY_PORT = 8006;

const DISC_CHANGED = 'The game files changed after they were prepared. Quit the server and open it again.';
const NO_ADDRESS = 'The public address is not available. The game still works on this computer.';
const ROOM_RESTARTING = 'The room is not open at the moment. The server is starting it again.';
const roomFailed = (reason: string | null) =>
  `The room could not be started${reason ? ` (${reason})` : ''}. Quit the server and open it again.`;

const snapshot = (status: HostStatus): HostStatus =>
  Object.freeze({ ...status, problem: status.problem && Object.freeze({ ...status.problem }),
    game: status.game && Object.freeze({ ...status.game }) });

const stopped = snapshot({ state: 'idle', problem: null, game: null, localUrl: null, gatewayPort: null, tunnel: 'off', mirror: 'off',
  room: 'off' });

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

const executable = (path: string) => access(path, constants.X_OK).then(() => true, () => false);

/** The tunnel program that ships in the resource root. */
export const shippedTunnelProgram = (paths: Paths) => join(paths.resourceRoot, 'bin', 'cloudflared');

/** The connector protocol of the primary tunnel, as tools/play-online.py takes it from the environment. */
function primaryProtocol(): string {
  const chosen = process.env.TUNNEL_TRANSPORT_PROTOCOL;
  return chosen === 'quic' || chosen === 'http2' ? chosen : 'auto';
}

export function createHostService({ paths, log, gamePort = GAME_PORT, netplayPort = NETPLAY_PORT, accessToken, tunnels, worker }: {
  paths: Paths;
  log: Log;
  gamePort?: number;
  netplayPort?: number;
  /** The gateway credential, 48 hexadecimal digits. Random unless a test supplies one. */
  accessToken?: string;
  /** Absent: the shipped tunnel program. Null: no tunnels, for tests of the local stack. */
  tunnels?: TunnelSetup | null;
  /**
   * The browser that runs the room's emulator. Absent: the shipped one. Null: no room and no browser, for
   * tests of the other parts. `startupMs` and `room` shorten the room's deadlines in tests.
   */
  worker?: { browser: string; graceMs?: number; startupMs?: number; room?: Partial<RoomTiming> } | null;
}): HostService {
  let status = stopped;
  let stopStack: (() => Promise<void>) | null = null;
  // Set by the stack that is up: the private link, and a retry of its public address alone.
  let invite: (() => string | null) | null = null;
  let localInvite: (() => string | null) | null = null;
  let retryAddress: ((signal: AbortSignal) => Promise<void>) | null = null;
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
    // A killed server cannot remove its browser profiles. One server runs per data location and an
    // attempt begins with nothing running, so what is here was left behind. It goes before anything
    // can end the attempt, because a profile holds what the game page stored. A leftover that will
    // not go must not stop hosting: every profile has a name of its own, and a worker makes the
    // folder again when it needs it.
    if (worker !== null) {
      const complain = (error: unknown) => log(`Old browser profiles could not be removed: ${describe(error)}`);
      await rm(paths.profileRoot, { recursive: true, force: true, maxRetries: 3 }).catch(complain);
      await mkdir(paths.profileRoot, { recursive: true, mode: 0o700 }).catch(complain);
    }
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
    // Rooms run in this browser. Without it there is nothing to host, so that is said before anything starts.
    const browser = worker === null ? null : worker?.browser ?? shippedBrowser(paths);
    if (browser && !await executable(browser)) return blocked('failed', 'emulator', 'This build is missing the emulator browser.');
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

    // Everything below belongs to this one stack. `live.active` turns false the moment it starts to stop,
    // so that a late report from one of its parts cannot repaint the status of the next stack.
    const token = accessToken ?? randomBytes(24).toString('hex');
    const game = { pal: identity.pal, archiveBytes: identity.archive.size, tracks };
    const live: { active: boolean; changed: boolean; noProgram: boolean; gatewayPort: number; mirrorPort: number;
      primary: Tunnel | null; mirror: Tunnel | null; room: RoomKeeper | null; wake: (() => void) | null } =
      { active: false, changed: false, noProgram: false, gatewayPort: 0, mirrorPort: 0, primary: null, mirror: null, room: null,
        wake: null };

    // The room is the server's: its name and token are made here, and so is its identity, from the real
    // game data and this build. A player's page works out the same identity for itself, or is not let in.
    // The built-in BIOS is the only one a dedicated room runs. The options are the web client's defaults.
    const options: RoomOptions = identity.pal ? { progress: 'all', camera: true, nativeCamera: true }
      : { progress: 'original', camera: false };
    let room: { room: string; token: string; identity: string; saves: string } | null = null;
    if (browser) {
      // The saves that fit the room are those of this game and this build, under the key that a player's
      // save library keeps them by. The page and the server take that key from the same function.
      const saves = identityKey({ disc: identity.disc, core: assets.identity.core, adapter: assets.identity.adapter, bios: 'hle' });
      try {
        room = { room: randomBytes(12).toString('hex'), token: randomBytes(32).toString('hex'), saves,
          identity: await roomIdentity({ disc: identity.disc, ...assets.identity, bios: 'HLE', options }) };
      } catch {
        return blocked('failed', 'emulator', 'This build has a damaged runtime file: emulator/native-build.json.');
      }
    }
    let relay: NetplayRelay | null = null;

    const refresh = () => {
      live.wake?.();
      if (!live.active) return;
      const tunnel: TunnelState = live.noProgram ? 'failed' : live.primary?.state() ?? 'off';
      const roomState = live.room?.state() ?? 'off';
      const base: HostStatus = { state: 'online', problem: null, game, localUrl: `http://127.0.0.1:${gamePort}/`,
        gatewayPort: live.gatewayPort, tunnel, mirror: live.mirror?.state() ?? 'off', room: roomState };
      if (live.changed) return set({ ...base, state: 'degraded', problem: { component: 'game-data', message: DISC_CHANGED } });
      // Without its room there is nothing to play, whatever the public address does.
      if (roomState === 'restarting' || roomState === 'failed') {
        return set({ ...base, state: 'degraded',
          problem: { component: 'room', message: roomState === 'failed' ? roomFailed(live.room?.reason() ?? null) : ROOM_RESTARTING } });
      }
      if (tunnel === 'starting' || roomState === 'starting') return set({ ...base, state: 'starting' });
      if (tunnel === 'retrying' || tunnel === 'failed') {
        return set({ ...base, state: 'degraded',
          problem: { component: 'tunnel', message: live.noProgram ? 'This build has no tunnel program.' : NO_ADDRESS } });
      }
      set(base);
    };

    // A disc that changes under a running server must not be sent, and the host has to learn of it.
    const noteChange = () => {
      if (live.changed) return;
      live.changed = true;
      log('The game files changed while the server was running.');
      refresh();
    };
    const archive = {
      size: identity.archive.size,
      async open(): Promise<Readable> {
        if (live.changed) throw new GameFilesChangedError('The game files changed after they were prepared.');
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

    set({ ...stopped, state: 'starting', game });
    const origins = [`http://127.0.0.1:${gamePort}`, `http://localhost:${gamePort}`];
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
            // The keys keep the launcher's order. A Netplay room is identified by a fixed list of these fields
            // (web/room-identity.js), so what is added here for the page, like `serverRoom`, does not count.
            sessionInfo: { disc: identity.disc, pal: identity.pal, archive: identity.archive, discMode: 'shared',
              roomCheck: true, ...assets.identity, ...(browser && { dedicated: true, serverRoom: true }) },
            // The host page builds invitations for the public address, once that address works.
            invitation: () => {
              const origin = live.primary?.origin();
              return origin ? { origin, path: `/access/${token}` } : null;
            },
            archive,
          });
          return () => runtime.close();
        },
      },
      {
        name: 'netplay',
        async start() {
          await expectFree(netplayPort);
          let workers = null;
          if (browser) {
            workers = createWorkers({ browser, url: `http://127.0.0.1:${gamePort}/`, profileRoot: paths.profileRoot, log,
              graceMs: worker?.graceMs });
          }
          // With a browser, the relay is told that its rooms are the server's: a player's page cannot start one.
          const opened = createRetroArchRelay({ port: netplayPort, origins,
            ...(workers && { startDedicated: workers.start, ownsRooms: true, startupMs: worker?.startupMs }) });
          try {
            await once(opened, 'listening');
          } catch (error) {
            opened.close();
            throw error;
          }
          relay = opened;
          return async () => {
            relay = null;
            opened.stopDedicated();
            for (const client of opened.clients) client.terminate();
            await new Promise<void>(resolve => { opened.close(() => resolve()); });
            // The rooms were told to stop above; this waits until their browsers and profiles are gone.
            await workers?.settled();
          };
        },
      },
      {
        // The room is opened here and kept from then on. Like the tunnels it cannot fail this step:
        // the local page stays up without it, and the status says what is wrong.
        name: 'room',
        async start() {
          const netplay = relay;
          if (!room || !netplay) return async () => {};
          const spec = { ...room, ...options };
          live.room = keepRoom({ open: events => netplay.createRoom({ ...spec, onRestoring: events.restoring }), log,
            timing: worker?.room,
            onChange() {
              // A room that has given up gets no further session: its guests are not told to wait for one.
              if (live.room?.state() === 'failed') netplay.releaseRoom(spec.room);
              refresh();
            } });
          live.room.start();
          return async () => {
            await live.room?.stop();
            netplay.releaseRoom(spec.room);
          };
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
            accessToken: token,
            discMode: 'shared',
            assetPaths: assets.assetPaths,
            maxPayload: 8 * 1024 * 1024,
            mirrorPort: 0,
            getMirrorOrigin: () => live.mirror?.origin() ?? undefined,
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
          live.gatewayPort = listeningPort(gateway);
          if (gateway.mirrorServer) live.mirrorPort = listeningPort(gateway.mirrorServer);
          return stop;
        },
      },
      {
        // The tunnels are started here and supervised from then on. They cannot fail this step:
        // without a public address the local game still works, and the status says so.
        name: 'tunnel',
        async start() {
          if (tunnels === null) return async () => {};
          const setup: TunnelSetup = tunnels ?? { command: { command: shippedTunnelProgram(paths), args: [] },
            probe: publicProbe(token), guard: selfCommand(['internal', 'guard']) };
          if (!await executable(setup.command.command)) {
            live.noProgram = true;
            log('Cannot open a tunnel: this build has no tunnel program.');
            return async () => {};
          }
          const shared = { command: setup.command, homeRoot: paths.tempRoot, log, guard: setup.guard, timing: setup.timing,
            onChange: refresh };
          live.primary = createTunnel({ ...shared, name: 'primary', port: live.gatewayPort, protocol: primaryProtocol(), probe: setup.probe });
          live.primary.start();
          // The mirror only carries copies of small packets; the client falls back when it is missing.
          if (live.mirrorPort) {
            // Like the launcher, it keeps trying at a slow pace: one bad minute must not cost the mirror for the session.
            live.mirror = createTunnel({ ...shared, name: 'mirror', port: live.mirrorPort, protocol: 'http2', keepTrying: true });
            live.mirror.start();
          }
          return async () => { await Promise.all([live.primary?.stop(), live.mirror?.stop()]); };
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

    /**
     * Resolves once the public address and the room each work or have failed, or the wait is interrupted.
     * A room that is loading a save works: the load may last as long as its player stays away.
     */
    const addressSettled = async (interrupted: AbortSignal) => {
      const wake = () => live.wake?.();
      const pending = () => (live.primary !== null && !['online', 'failed'].includes(live.primary.state()))
        || (live.room !== null && !['open', 'restoring', 'failed'].includes(live.room.state()));
      interrupted.addEventListener('abort', wake);
      while (live.active && !interrupted.aborted && pending())
        await new Promise<void>(resolve => { live.wake = resolve; });
      interrupted.removeEventListener('abort', wake);
    };
    live.active = true;
    stopStack = async () => {
      live.active = false;
      invite = null;
      localInvite = null;
      retryAddress = null;
      live.wake?.();
      await stop();
    };
    // Both links name the same room. The public one also carries the gateway's access path. A room that
    // has failed is not handed out.
    const named = room && { v: invitationVersion, room: room.room, token: room.token };
    const gone = () => live.room?.state() === 'failed';
    invite = () => {
      const origin = live.primary?.origin();
      if (!origin || gone()) return null;
      return named ? invitationUrl(`${origin}/`, `/access/${token}`, named, options) : `${origin}/access/${token}`;
    };
    localInvite = () => (named && !gone() ? invitationUrl(`http://127.0.0.1:${gamePort}/`, '/', named, options) : null);
    retryAddress = async interrupted => {
      live.primary?.start();
      refresh();
      await addressSettled(interrupted);
    };
    log(`The local game page is ready on 127.0.0.1:${gamePort}.`);
    refresh();
    await addressSettled(signal);
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
          interrupt = new AbortController();
          try {
            if (status.problem?.component === 'tunnel' && retryAddress) {
              // Only the public address is down: try it again and leave the local game running.
              await retryAddress(interrupt.signal);
            } else {
              // A degraded or half-failed stack goes first, so the new attempt starts clean.
              await halt();
              await attempt(interrupt.signal);
            }
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
    invitation: () => invite?.() ?? null,
    localInvitation: () => localInvite?.() ?? null,
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
