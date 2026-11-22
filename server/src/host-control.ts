// What the control listener may ask of the host, for a command or for the
// panel: start hosting, stop it, start a new game, read or change the saved
// configuration, choose the game folder in the system's dialog, and make the
// diagnostic report. The rules of those requests are here; the listener only
// carries them.
import { isAbsolute } from 'node:path';
import { isRoomPreference, readConfig, writeConfig, type DiscPolicy, type HostConfig, type RoomPreference } from './config-store.ts';
import { diagnosticReport, type DiagnosticReport } from './diagnostics.ts';
import { findDisc, GameFolderError } from './disc-folder.ts';
import type { HostService, HostStatus } from './host-service.ts';
import type { Paths } from './paths.ts';
import { FolderDialogError, type ChooseFolder } from './platform/folder-dialog.ts';

/** The saved configuration as it leaves the server, with what is wrong with its file, if anything. */
export interface SavedConfig {
  /** The folder's path. It leaves the server in this answer only, never in the status. */
  gameFolder: string | null;
  discPolicy: DiscPolicy | null;
  autoStart: boolean;
  /** What the owner chose for the room. A start applies it, and only the verified PAL disc plays all of it. */
  roomOptions: RoomPreference;
  problem: string | null;
}

/** A request that is not carried out, with the sentence that says why. */
export interface Refusal {
  status: 400 | 409 | 500 | 503;
  error: string;
}

/** The players that a request would put out of their room. */
export interface InTheRoom {
  players: NonNullable<HostStatus['players']>;
}

export interface HostControl {
  /**
   * Begins a start of hosting and returns null at once; the status tells how it went. Or it starts
   * nothing and says why: the server is quitting, or the start would build the stack anew, which ends
   * the room, while somebody is in it. Then it returns who is there, and the request must say `force`.
   */
  start(force: boolean): InTheRoom | Refusal | null;
  /**
   * Begins a stop of hosting and returns null, or stops nothing and returns who is in the room: with a
   * player connected, or a controller kept for one, the request must say `force`.
   */
  stop(force: boolean): InTheRoom | null;
  /**
   * Says whether the server may quit now: with a player connected, or a controller kept for one, the
   * request must say `force`, and the players are returned. It quits nothing itself; the listener hands
   * an accepted quit to the server. A signal from the system is not asked.
   */
  quit(force: boolean): InTheRoom | null;
  /**
   * Begins a new game in the room and returns null: its session ends and the next opens, under the same
   * links. Or it changes nothing and says why: the server is quitting, no room is open, or somebody is in
   * the room, who is then returned, and the request must say `force`.
   */
  newGame(force: boolean): InTheRoom | Refusal | null;
  config(): Promise<SavedConfig>;
  /** Saves a change of any of `gameFolder`, `discPolicy`, `autoStart` and `roomOptions`, or refuses all of it. */
  configure(change: unknown): Promise<SavedConfig | Refusal>;
  /**
   * Shows the system's folder dialog on this computer and waits for its answer. The folder that is
   * chosen there is checked and saved as one that `configure` is given; a cancel changes nothing.
   * `config` is the saved configuration after it, either way. One dialog is open at a time.
   */
  pickFolder(): Promise<{ picked: boolean; config: SavedConfig } | Refusal>;
  /** The diagnostic report, made now. `about` is what the listener knows of the server: its version and when it started. */
  diagnostics(about: { version: string; startedAt: string }): Promise<DiagnosticReport>;
  /** Ends a dialog that is open, because the server stops. Safe to call again. */
  close(): void;
}

const NOT_VALID = 'The configuration in the request is not valid.';
const QUITTING = 'The server is quitting.';
const NO_ROOM = 'No room is open.';
const HOSTING = 'Stop the room before changing the game folder or the disc policy.';
const OPTIONS_HOSTING = "Stop the room before changing the room's options.";
/** In these states nothing is hosted, so nothing holds the disc that was prepared, unless a start is under way. */
const AT_REST: HostStatus['state'][] = ['needs_setup', 'idle', 'failed'];

/** A connected player, or a controller that is kept for one who is away, is somebody in the room. */
const occupied = (players: HostStatus['players']): players is NonNullable<HostStatus['players']> =>
  players !== null && players.connected + players.reserved > 0;

const report = (config: HostConfig, problem: string | null): SavedConfig =>
  ({ gameFolder: config.gameFolder, discPolicy: config.discPolicy, autoStart: config.autoStart, roomOptions: { ...config.roomOptions }, problem });

export function createHostControl({ paths, service, chooseFolder, checkGameFolder = false, log = () => {} }: {
  paths: Paths;
  service: HostService;
  /** The system's folder dialog. Without one, as in a server that may show nothing, a folder cannot be chosen that way. */
  chooseFolder?: ChooseFolder;
  checkGameFolder?: boolean;
  /** The server's log. It hears why a dialog could not be shown, in words that name no folder. */
  log?: (line: string) => void;
}): HostControl {
  // One change of the configuration at a time: each reads the file that the one before it wrote, so two
  // requests that change different things both end up in it.
  let last: Promise<unknown> = Promise.resolve();
  const inTurn = <T>(work: () => Promise<T>): Promise<T> => {
    const done = last.then(work);
    last = done.catch(() => {});
    return done;
  };

  const refuse = (status: Refusal['status'], error: string): Refusal => ({ status, error });
  const atRest = () => !service.starting() && AT_REST.includes(service.status().state);
  const config = async () => {
    const { config, problem } = await readConfig(paths);
    if (checkGameFolder && config.gameFolder && !problem) {
      try { await findDisc(config.gameFolder); }
      catch (error) {
        return report(config, error instanceof GameFolderError ? error.message : 'The game folder could not be read.');
      }
    }
    return report(config, problem);
  };
  /** The dialog that is open, if one is. */
  let dialog: AbortController | undefined;
  const change = async (asked: unknown): Promise<SavedConfig | Refusal> => {
    if (typeof asked !== 'object' || asked === null || Array.isArray(asked)) return refuse(400, NOT_VALID);
    const { gameFolder, discPolicy, autoStart, roomOptions, ...unknown } = asked as Record<string, unknown>;
    if (Object.keys(unknown).length || (autoStart !== undefined && typeof autoStart !== 'boolean')) return refuse(400, NOT_VALID);
    if (roomOptions !== undefined && !isRoomPreference(roomOptions)) return refuse(400, 'The room options in the request are not valid.');
    if (discPolicy !== undefined && discPolicy !== 'local-only' && discPolicy !== 'shared-allowed')
      return refuse(400, 'Unknown disc policy.');
    if (gameFolder !== undefined && (typeof gameFolder !== 'string' || !isAbsolute(gameFolder)))
      return refuse(400, 'The game folder must be given by its full path.');
    // A running stack keeps the disc it prepared and the policy it started with, and a start that was
    // just asked for is about to read both. The switch for starting at launch is read at launch only.
    if ((gameFolder !== undefined || discPolicy !== undefined) && !atRest()) return refuse(409, HOSTING);
    // The options are part of the room's identity and of every link that its players hold.
    if (roomOptions !== undefined && !atRest()) return refuse(409, OPTIONS_HOSTING);
    let folder: string | undefined;
    if (gameFolder !== undefined) {
      try {
        folder = (await findDisc(gameFolder)).folder;
      } catch (error) {
        // Any other error names the user's folders; its sentence stays here.
        return refuse(400, error instanceof GameFolderError ? error.message : 'The game folder could not be read.');
      }
    }
    const next = { ...(await readConfig(paths)).config };
    if (folder !== undefined) next.gameFolder = folder;
    if (discPolicy !== undefined) next.discPolicy = discPolicy;
    if (autoStart !== undefined) next.autoStart = autoStart;
    if (roomOptions !== undefined) next.roomOptions = { progress: roomOptions.progress, camera: roomOptions.camera };
    try {
      await writeConfig(paths, next);
    } catch {
      // The error names the user's folders too.
      return refuse(500, 'The configuration could not be saved.');
    }
    // What the host's status said about the folder or the policy was about the ones before.
    if (folder !== undefined || discPolicy !== undefined) service.configured();
    return report(next, null);
  };

  return {
    start(force) {
      // The listener answers until hosting has stopped, and a quit is not to be undone from there.
      if (service.closed()) return refuse(409, QUITTING);
      // With a stack up, a start tries again what has failed and the room stays. Only after the game
      // files changed does it build the stack anew, and the players of the old room have their copy
      // of the disc and could play on.
      const { players, problem } = service.status();
      if (!force && problem?.component === 'game-data' && occupied(players)) return { players };
      // After a change of the configuration that is being saved, so that the start reads what was saved.
      void last.then(() => service.start());
      return null;
    },
    stop(force) {
      const { players } = service.status();
      if (!force && occupied(players)) return { players };
      void service.stop();
      return null;
    },
    quit(force) {
      const { players } = service.status();
      return !force && occupied(players) ? { players } : null;
    },
    newGame(force) {
      if (service.closed()) return refuse(409, QUITTING);
      const { room, players } = service.status();
      if (room === 'off') return refuse(409, NO_ROOM);
      if (!force && occupied(players)) return { players };
      return service.newGame() ? null : refuse(409, NO_ROOM);
    },
    config,
    configure: asked => inTurn(() => change(asked)),
    async pickFolder() {
      if (!chooseFolder) return refuse(503, 'The folder dialog is not available.');
      if (service.closed()) return refuse(409, QUITTING);
      // Before any dialog: its answer could not be saved.
      if (!atRest()) return refuse(409, HOSTING);
      // The first one may be behind the browser's window.
      if (dialog) return refuse(409, 'The folder dialog is already open. Look for it among the windows.');
      const open = dialog = new AbortController();
      let chosen: string | null;
      try {
        chosen = await chooseFolder(open.signal);
      } catch (error) {
        // Only a quit ends a dialog: it was shown, and it is the server that goes away.
        if (open.signal.aborted) return refuse(409, QUITTING);
        log(`The folder dialog could not be shown (${error instanceof FolderDialogError ? error.reason : 'no answer'}).`);
        return refuse(503, 'The folder dialog could not be opened.');
      } finally {
        dialog = undefined;
      }
      // A cancel keeps what was chosen before.
      if (chosen === null) return { picked: false, config: await config() };
      const saved = await inTurn(() => change({ gameFolder: chosen }));
      return 'error' in saved ? saved : { picked: true, config: saved };
    },
    diagnostics: async ({ version, startedAt }) =>
      diagnosticReport({ paths, version, status: service.status(), config: await readConfig(paths), now: new Date(), startedAt }),
    close() {
      dialog?.abort();
    },
  };
}
