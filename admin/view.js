// What the panel shows, as data. `panelView` turns what the server answered
// into the words, the links and the state of every control; the page writes
// that into its document and decides nothing itself. Whatever the server sent
// leaves here as text: a view holds strings, booleans and null, nothing else.

const APPLICATION = 'Sled Storm Server';

const STATES = new Map([
  ['needs_setup', 'Needs setup'],
  ['idle', 'Stopped'],
  ['preparing', 'Preparing the game files'],
  ['starting', 'Starting'],
  ['online', 'Online'],
  ['degraded', 'Running, with a problem'],
  ['failed', 'Failed'],
  ['stopping', 'Stopping'],
]);

/** In these states nothing is hosted, and the server takes a change of the game folder or the disc policy. */
const AT_REST = ['needs_setup', 'idle', 'failed'];
/** A start in `degraded` tries again what has failed there. */
const STARTABLE = [...AT_REST, 'degraded'];
const STOPPABLE = ['preparing', 'starting', 'online', 'degraded', 'stopping'];
const POLICIES = ['local-only', 'shared-allowed'];
const PROGRESS = ['all', 'original'];
/** The states of a room that exists: a new game ends its session and opens the next, or starts it again after it failed. */
const ROOMS = ['starting', 'open', 'restoring', 'restarting', 'failed'];

/** What the room's options need, and what a room with another disc plays instead, whatever is saved. */
const PAL_ONLY = 'Unlocked content and separate cameras need the verified PAL disc.';
const OTHER_DISC = 'This disc plays with the original progression and a shared camera.';

/** The folder's request lasts as long as its dialog is open, and a second press sends nothing that the server could answer. */
const DIALOG_OPEN = 'The folder dialog is open. Look for it among the windows.';
/** While the tunnel starts or tries again, an address is on its way; after it has failed, none is until a start. */
const ADDRESS_COMING = 'The public address is not available yet.';
const NO_PUBLIC_ADDRESS = 'The public address is not available.';
const UNDER_WAY = ['starting', 'retrying', 'online'];

/** Whatever the server sent, as text. What it did not send at all is not known. */
const text = value => (typeof value === 'string' ? value : JSON.stringify(value) ?? 'unknown');
/** A sentence to show, or none. */
const sentence = value => (typeof value === 'string' && value ? value : null);
/** A part of an answer that has parts of its own, or null. */
const part = value => (typeof value === 'object' && value !== null ? value : null);
/** A link of the page is an address of the web. Anything else that is sent in its place is none. */
const link = value => (typeof value === 'string' && /^https?:\/\//.test(value) ? value : null);

/** Who is in the room, in words, or null when the status counts nobody because it has no room. */
export function inTheRoom(players) {
  if (part(players) === null) return null;
  return `${text(players.connected)} connected, ${text(players.reserved)} away with a controller kept`;
}

/** The room's options that are saved, each as the page knows it or null. */
function chosenOptions(config, locked, host) {
  const saved = part(config?.roomOptions) ?? {};
  // A room runs while the status names its options; the disc it was prepared with decides what it plays.
  const other = part(host.roomOptions) !== null && part(host.game)?.pal === false;
  return { progress: PROGRESS.includes(saved.progress) ? saved.progress : null, camera: typeof saved.camera === 'boolean' ? saved.camera : null, locked,
    note: other ? OTHER_DISC : PAL_ONLY };
}

/** The disc that the server prepared, in a line. */
function disc(game) {
  if (part(game) === null) return null;
  const name = game.pal === true ? 'Sled Storm (PAL)' : 'Unrecognized disc';
  const tracks = game.tracks === 1 ? '1 track' : `${text(game.tracks)} tracks`;
  const size = typeof game.archiveBytes === 'number' ? `${Math.round(game.archiveBytes / 1048576)} MB` : text(game.archiveBytes);
  return `${name}, ${tracks}, ${size}`;
}

/**
 * The view of a page that reads its server. `report`, `config` and `invitation` are the bodies of
 * `GET /api/status`, `/api/config` and `/api/invitation`, the last two or null. `busy` names the
 * request that is under way (the latest, while a quit is sent during the folder's request),
 * `confirming` the button that asked a question about the players, and `notice` is a sentence of the
 * page's own; each is null without one.
 */
export function panelView({ report, config, invitation, busy, confirming, notice }) {
  const host = part(report?.host) ?? {};
  const { state } = host;
  const folder = sentence(config?.gameFolder);
  const policy = POLICIES.includes(config?.discPolicy) ? config.discPolicy : null;
  // Setup is what the configuration says: a host at rest says nothing about it until a start is tried.
  const unfinished = folder === null || policy === null || (config?.problem ?? null) !== null;
  const under = Boolean(busy);
  const locked = under || !AT_REST.includes(state);
  // The folder's request lasts as long as its dialog, and a quit ends that dialog.
  const quittable = !under || busy === 'folder';
  const renewable = ROOMS.includes(host.room);
  const version = text(report?.version);
  const startable = STARTABLE.includes(state);
  const stoppable = STOPPABLE.includes(state);
  const url = link(invitation?.url);
  const localUrl = link(invitation?.localUrl);
  return {
    application: text(report?.application),
    version,
    headline: state === 'idle' && unfinished ? STATES.get('needs_setup') : STATES.get(state) ?? text(state),
    sentence: sentence(notice) ?? (busy === 'folder' ? DIALOG_OPEN : null) ?? sentence(host.problem?.message) ?? sentence(config?.problem),
    setup: { unfinished, folder, policy, locked, ...(sentence(config?.problem) && { problem: config.problem }),
      ...(state === 'failed' && host.problem?.component === 'game-data' && { repair: true }) },
    options: chosenOptions(config, locked, host),
    game: disc(host.game),
    start: { shown: true, enabled: startable && !unfinished && !under },
    stop: { shown: true, enabled: stoppable && state !== 'stopping' && !under, label: confirming === 'stop' ? 'Stop anyway' : 'Stop Server' },
    newGame: { shown: renewable, enabled: renewable && state !== 'stopping' && !under, label: confirming === 'newGame' ? 'New game anyway' : 'New game' },
    quit: { enabled: quittable, label: confirming === 'quit' ? 'Quit anyway' : 'Quit server' },
    players: String(Number.isSafeInteger(host.players?.connected) ? host.players.connected : 0),
    // Without a link of either kind there is no room, and nothing is missing.
    invite: { url, note: url === null && localUrl !== null ? (UNDER_WAY.includes(host.tunnel) ? ADDRESS_COMING : NO_PUBLIC_ADDRESS) : null },
    openGame: state !== 'stopping' && ['open', 'restoring'].includes(host.room) ? localUrl : null,
    autoStart: { checked: config?.autoStart === true, enabled: !under },
    diagnostics: { enabled: !under },
    details: [['Version', version], ['Room', text(host.room)], ['Public address', text(host.tunnel)], ['Second address', text(host.mirror)]],
  };
}

/** The view of a page without a server: its sentence, and no control at all. */
export function disconnected(why) {
  return { application: APPLICATION, version: null, headline: 'Not connected', sentence: why, setup: null, options: null, game: null, start: null,
    stop: null, newGame: null, quit: null, players: null, invite: null, openGame: null, autoStart: null, diagnostics: null, details: [] };
}
