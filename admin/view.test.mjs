import test from 'node:test';
import assert from 'node:assert/strict';
import { disconnected, inTheRoom, panelView } from './view.js';

const FOLDER = '/Users/owner/Games/Sled Storm';
const LOCAL = 'http://127.0.0.1:8000/#room';
const PUBLIC = `https://synthetic-test.trycloudflare.com/access/${'a'.repeat(48)}#room`;
const SETUP = 'Choose the game folder and the disc policy to start hosting.';
const NO_ADDRESS = 'The public address is not available. The game still works on this computer.';
const DAMAGED = 'The configuration file is damaged. Choose the game folder again.';
const QUESTION = 'Players are in the room: 1 connected, 0 away with a controller kept. Stop it anyway?';
const DISC = { pal: true, archiveBytes: 642_900_000, tracks: 2 };
const REQUESTS = ['folder', 'policy', 'start', 'stop', 'quit', 'autoStart', 'options', 'newGame', 'diagnostics'];
const PAL_ONLY = 'Unlocked content and separate cameras need the verified PAL disc.';
const OTHER_DISC = 'This disc plays with the original progression and a shared camera.';

/** The status as `GET /api/status` gives it, with a host in the given state. */
function report(state, host = {}) {
  return { application: 'Sled Storm Server', version: '1.2.0', instance: '0123456789abcdef', pid: 4242, startedAt: '2026-11-21T10:00:00.000Z',
    host: { state, problem: null, game: null, localUrl: null, gatewayPort: null, tunnel: 'off', mirror: 'off', room: 'off', players: null, ...host } };
}

/** The configuration as `GET /api/config` gives it: of a new installation, and with both choices made. */
const saved = (change = {}) => ({ gameFolder: null, discPolicy: null, autoStart: false, roomOptions: { progress: 'all', camera: true }, problem: null, ...change });
const chosen = (change = {}) => saved({ gameFolder: FOLDER, discPolicy: 'shared-allowed', ...change });

/** A room that is open, with one player in it. */
const room = (state, host = {}) => report(state, { game: DISC, localUrl: 'http://127.0.0.1:8000/', gatewayPort: 8100, tunnel: 'online', room: 'open',
  players: { connected: 1, reserved: 0 }, roomOptions: { progress: 'all', camera: true }, ...host });

/** The view of a page of a new installation at rest with nothing under way, but for what the test names. */
const view = (parts = {}) => panelView({ report: report('idle'), config: saved(), invitation: null, busy: null, confirming: null, notice: null, ...parts });

/** Every value in a view, however deep. */
const leaves = value => (value !== null && typeof value === 'object' ? Object.values(value).flatMap(leaves) : [value]);

test('a new installation is asked for its folder and its policy, and cannot be started', () => {
  // Without a start at launch the host is at rest, and it is the configuration that says what is missing.
  assert.deepEqual(view(), {
    application: 'Sled Storm Server',
    version: '1.2.0',
    headline: 'Needs setup',
    sentence: null,
    setup: { unfinished: true, folder: null, policy: null, locked: false },
    options: { progress: 'all', camera: true, locked: false, note: PAL_ONLY },
    game: null,
    start: { shown: true, enabled: false },
    stop: { shown: true, enabled: false, label: 'Stop Server' },
    newGame: { shown: false, enabled: false, label: 'New game' },
    quit: { enabled: true, label: 'Quit server' },
    players: '0',
    invite: { url: null, note: null },
    openGame: null,
    autoStart: { checked: false, enabled: true },
    diagnostics: { enabled: true },
    details: [['Version', '1.2.0'], ['Room', 'off'], ['Public address', 'off'], ['Second address', 'off']],
  });

  // A start that was tried says so in the server's sentence.
  const tried = view({ report: report('needs_setup', { problem: { component: 'config', message: SETUP } }) });
  assert.equal(tried.headline, 'Needs setup');
  assert.equal(tried.sentence, SETUP);
  assert.deepEqual(tried.start, { shown: true, enabled: false });

  // One of the two is not enough.
  const folderOnly = view({ config: saved({ gameFolder: FOLDER }) });
  assert.deepEqual(folderOnly.setup, { unfinished: true, folder: FOLDER, policy: null, locked: false });
  const policyOnly = view({ config: saved({ discPolicy: 'local-only' }) });
  assert.deepEqual(policyOnly.setup, { unfinished: true, folder: null, policy: 'local-only', locked: false });
  for (const half of [folderOnly, policyOnly]) {
    assert.equal(half.headline, 'Needs setup');
    assert.equal(half.start.enabled, false);
  }

  // A file that could not be read is said in its own sentence, and setup is not finished whatever it held.
  const damaged = view({ config: chosen({ problem: DAMAGED }) });
  assert.equal(damaged.sentence, DAMAGED);
  assert.equal(damaged.setup.unfinished, true);
  assert.equal(damaged.start.enabled, false);
});

test('with both chosen the server can be started, and the folder can still be changed', () => {
  const ready = view({ config: chosen({ autoStart: true }) });
  assert.equal(ready.headline, 'Stopped');
  assert.equal(ready.sentence, null);
  assert.deepEqual(ready.setup, { unfinished: false, folder: FOLDER, policy: 'shared-allowed', locked: false });
  assert.deepEqual(ready.start, { shown: true, enabled: true });
  assert.deepEqual(ready.stop, { shown: true, enabled: false, label: 'Stop Server' });
  assert.deepEqual(ready.autoStart, { checked: true, enabled: true });

  // The other policy is a choice like the first. What stops a start, the server says at that start.
  const own = view({ config: chosen({ discPolicy: 'local-only' }) });
  assert.equal(own.setup.policy, 'local-only');
  assert.deepEqual(own.start, { shown: true, enabled: true });
  const refused = view({ config: chosen({ discPolicy: 'local-only' }),
    report: report('needs_setup', { problem: { component: 'config', message: 'The configuration file is damaged. Choose the game folder again.' } }) });
  assert.equal(refused.headline, 'Needs setup');
  assert.equal(refused.sentence, 'The configuration file is damaged. Choose the game folder again.');
  assert.deepEqual(refused.start, { shown: true, enabled: true });
});

test('while the server prepares and starts, it can be stopped and the setup is locked', () => {
  const preparing = view({ config: chosen(), report: report('preparing') });
  assert.equal(preparing.headline, 'Preparing the game files');
  assert.equal(preparing.game, null);
  const starting = view({ config: chosen(), report: report('starting', { game: DISC, room: 'starting', tunnel: 'starting' }) });
  assert.equal(starting.headline, 'Starting');
  assert.equal(starting.game, 'Sled Storm (PAL), 2 tracks, 613 MB');
  assert.deepEqual(starting.details, [['Version', '1.2.0'], ['Room', 'starting'], ['Public address', 'starting'], ['Second address', 'off']]);
  for (const under of [preparing, starting]) {
    assert.deepEqual(under.start, { shown: true, enabled: false });
    assert.deepEqual(under.stop, { shown: true, enabled: true, label: 'Stop Server' });
    assert.deepEqual(under.setup, { unfinished: false, folder: FOLDER, policy: 'shared-allowed', locked: true });
    assert.deepEqual(under.quit, { enabled: true, label: 'Quit server' });
  }

  // A stop that is under way is not asked for again.
  const stopping = view({ config: chosen(), report: report('stopping', { game: DISC }) });
  assert.equal(stopping.headline, 'Stopping');
  assert.deepEqual(stopping.start, { shown: true, enabled: false });
  assert.deepEqual(stopping.stop, { shown: true, enabled: false, label: 'Stop Server' });
  assert.equal(stopping.setup.locked, true);

  // A disc that is not the known one is named so, and one track is one track.
  const other = view({ config: chosen(), report: report('starting', { game: { pal: false, archiveBytes: 1_572_864, tracks: 1 } }) });
  assert.equal(other.game, 'Unrecognized disc, 1 track, 2 MB');
});

test('an online room shows its invitation, its players and the way into the game', () => {
  const online = view({ config: chosen({ autoStart: true }), report: room('online', { mirror: 'online' }), invitation: { url: PUBLIC, localUrl: LOCAL } });
  assert.deepEqual(online, {
    application: 'Sled Storm Server',
    version: '1.2.0',
    headline: 'Online',
    sentence: null,
    setup: { unfinished: false, folder: FOLDER, policy: 'shared-allowed', locked: true },
    options: { progress: 'all', camera: true, locked: true, note: PAL_ONLY },
    game: 'Sled Storm (PAL), 2 tracks, 613 MB',
    start: { shown: true, enabled: false },
    stop: { shown: true, enabled: true, label: 'Stop Server' },
    newGame: { shown: true, enabled: true, label: 'New game' },
    quit: { enabled: true, label: 'Quit server' },
    players: '1',
    invite: { url: PUBLIC, note: null },
    openGame: LOCAL,
    autoStart: { checked: true, enabled: true },
    diagnostics: { enabled: true },
    details: [['Version', '1.2.0'], ['Room', 'open'], ['Public address', 'online'], ['Second address', 'online']],
  });

  // An empty room is counted too, and so is a controller that is kept for a player who is away.
  assert.equal(view({ report: room('online', { players: { connected: 0, reserved: 0 } }) }).players, '0');
  assert.equal(view({ report: room('online', { players: { connected: 2, reserved: 1 } }) }).players, '2');
  // The same words serve a question about the players, which counts those of the server's refusal.
  assert.equal(inTheRoom({ connected: 2, reserved: 1 }), '2 connected, 1 away with a controller kept');
  assert.equal(inTheRoom(null), null);
});

test('a room without a public address says so and can still be played on this computer', () => {
  const local = view({ config: chosen(), invitation: { url: null, localUrl: LOCAL },
    report: room('degraded', { tunnel: 'failed', problem: { component: 'tunnel', message: NO_ADDRESS } }) });
  assert.equal(local.headline, 'Running, with a problem');
  assert.equal(local.sentence, NO_ADDRESS);
  // The address has failed: none is coming until a start tries it again.
  assert.deepEqual(local.invite, { url: null, note: 'The public address is not available.' });
  assert.equal(local.openGame, LOCAL);
  // While the tunnel starts or tries again, one is on its way.
  for (const tunnel of ['starting', 'retrying'])
    assert.deepEqual(view({ invitation: { url: null, localUrl: LOCAL }, report: room('online', { tunnel }) }).invite,
      { url: null, note: 'The public address is not available yet.' }, tunnel);
  assert.deepEqual(view({ invitation: { url: null, localUrl: LOCAL }, report: room('degraded', { tunnel: 'off' }) }).invite,
    { url: null, note: 'The public address is not available.' });
  // What has failed can be tried again, and the room can be stopped.
  assert.deepEqual(local.start, { shown: true, enabled: true });
  assert.deepEqual(local.stop, { shown: true, enabled: true, label: 'Stop Server' });
  assert.equal(local.setup.locked, true);
  assert.deepEqual(local.details, [['Version', '1.2.0'], ['Room', 'open'], ['Public address', 'failed'], ['Second address', 'off']]);

  // Before the room is open there is neither link, and nothing is said to be missing.
  const early = view({ config: chosen(), report: report('starting', { room: 'starting' }), invitation: null });
  assert.deepEqual(early.invite, { url: null, note: null });
  assert.equal(early.openGame, null);
  assert.equal(early.players, '0');
});

test('a failed start shows its sentence and can be tried again', () => {
  const message = 'A track of the disc is missing from the game folder.';
  const failed = view({ config: chosen(), report: report('failed', { problem: { component: 'game-data', message } }) });
  assert.equal(failed.headline, 'Failed');
  assert.equal(failed.sentence, message);
  assert.deepEqual(failed.start, { shown: true, enabled: true });
  assert.deepEqual(failed.stop, { shown: true, enabled: false, label: 'Stop Server' });
  assert.deepEqual(failed.setup, { unfinished: false, folder: FOLDER, policy: 'shared-allowed', locked: false, repair: true });

  // What the status says comes before what the configuration's file says, and the page's own sentence before both.
  const both = { config: chosen({ problem: DAMAGED }), report: report('failed', { problem: { component: 'emulator', message } }) };
  assert.equal(view(both).sentence, message);
  assert.equal(view({ ...both, notice: 'The link is copied.' }).sentence, 'The link is copied.');
});

test('a stop that the server refused for players becomes a question', () => {
  const asked = view({ config: chosen(), report: room('degraded', { tunnel: 'failed', problem: { component: 'tunnel', message: NO_ADDRESS } }),
    invitation: { url: null, localUrl: LOCAL }, confirming: 'stop', notice: QUESTION });
  assert.equal(asked.sentence, QUESTION);
  assert.deepEqual(asked.stop, { shown: true, enabled: true, label: 'Stop anyway' });
  assert.deepEqual(asked.quit, { enabled: true, label: 'Quit server' });

  // The same for a quit.
  const quitting = view({ config: chosen(), report: room('online'), confirming: 'quit', notice: 'Quit anyway?' });
  assert.equal(quitting.sentence, 'Quit anyway?');
  assert.deepEqual(quitting.quit, { enabled: true, label: 'Quit anyway' });
  assert.deepEqual(quitting.stop, { shown: true, enabled: true, label: 'Stop Server' });
});

test('a request under way disables every button', () => {
  for (const busy of REQUESTS) {
    const resting = view({ config: chosen(), busy });
    assert.deepEqual(resting.start, { shown: true, enabled: false }, busy);
    assert.equal(resting.setup.locked, true, busy);
    // A quit is let through while the folder's dialog is open: it ends that dialog.
    assert.deepEqual(resting.quit, { enabled: busy === 'folder', label: 'Quit server' }, busy);
    assert.deepEqual(resting.options.locked, true, busy);
    assert.deepEqual(resting.diagnostics, { enabled: false }, busy);
    assert.deepEqual(resting.autoStart, { checked: false, enabled: false }, busy);
    assert.equal(resting.headline, 'Stopped', busy);

    const hosting = view({ config: chosen(), report: room('degraded'), busy });
    assert.deepEqual(hosting.start, { shown: true, enabled: false }, busy);
    assert.deepEqual(hosting.stop, { shown: true, enabled: false, label: 'Stop Server' }, busy);
    assert.deepEqual(hosting.newGame, { shown: true, enabled: false, label: 'New game' }, busy);
    assert.equal(hosting.quit.enabled, busy === 'folder', busy);
  }

  // The folder's request lasts as long as its dialog is open, and the dialog may be behind this window.
  const open = 'The folder dialog is open. Look for it among the windows.';
  assert.equal(view({ busy: 'folder' }).sentence, open);
  assert.equal(view({ busy: 'folder', report: report('failed', { problem: { component: 'game-data', message: 'No disc.' } }) }).sentence, open);
  for (const busy of REQUESTS.filter(name => name !== 'folder')) assert.equal(view({ busy }).sentence, null, busy);
});

test('a state or a value that the page does not know is shown as it is', () => {
  const odd = panelView({
    report: { application: 7, version: 2, host: { state: 'resting', problem: { message: 404 }, game: { pal: 'yes', archiveBytes: '613', tracks: null },
      tunnel: null, mirror: ['a'], room: { toString: 1 }, players: { connected: 'many', reserved: 'few' } } },
    config: null, invitation: 'soon', busy: null, confirming: null, notice: null,
  });
  assert.equal(odd.application, '7');
  assert.equal(odd.version, '2');
  assert.equal(odd.headline, 'resting');
  assert.equal(odd.sentence, null, 'only a sentence is shown as one');
  assert.equal(odd.players, '0');
  assert.equal(odd.game, 'Unrecognized disc, null tracks, 613');
  assert.deepEqual(odd.setup, { unfinished: true, folder: null, policy: null, locked: true });
  assert.deepEqual(odd.start, { shown: true, enabled: false });
  assert.deepEqual(odd.stop, { shown: true, enabled: false, label: 'Stop Server' });
  assert.deepEqual(odd.quit, { enabled: true, label: 'Quit server' });
  assert.deepEqual(odd.invite, { url: null, note: null });
  assert.equal(odd.openGame, null);
  assert.deepEqual(odd.autoStart, { checked: false, enabled: true });
  assert.deepEqual(odd.options, { progress: null, camera: null, locked: true, note: PAL_ONLY });
  assert.deepEqual(odd.newGame, { shown: false, enabled: false, label: 'New game' });
  assert.deepEqual(odd.details, [['Version', '2'], ['Room', '{"toString":1}'], ['Public address', 'null'], ['Second address', '["a"]']]);

  // A name that every object has is a state like any other that the page does not know.
  for (const state of ['constructor', '__proto__', 'toString', '', null, 404])
    assert.equal(typeof view({ report: report(state) }).headline, 'string', String(state));
  assert.equal(view({ report: report('constructor') }).headline, 'constructor');

  // A configuration of another form chooses nothing.
  const strange = view({ config: { gameFolder: 7, discPolicy: 'future', autoStart: 'yes', roomOptions: { progress: 'some', camera: 'yes' }, problem: 5 } });
  assert.deepEqual(strange.setup, { unfinished: true, folder: null, policy: null, locked: false });
  assert.deepEqual(strange.options, { progress: null, camera: null, locked: false, note: PAL_ONLY });
  assert.deepEqual(view({ config: saved({ roomOptions: 'all' }) }).options, { progress: null, camera: null, locked: false, note: PAL_ONLY });
  assert.equal(strange.autoStart.checked, false);
  assert.equal(strange.sentence, null);

  // A link is an address of the web, or it is none: it becomes a link of the page.
  const links = view({ report: room('online'), invitation: { url: 'javascript:alert(1)', localUrl: 'data:text/html,<p>' } });
  assert.deepEqual(links.invite, { url: null, note: null });
  assert.equal(links.openGame, null);
  const half = view({ report: room('online'), invitation: { url: 7, localUrl: LOCAL } });
  assert.deepEqual(half.invite, { url: null, note: 'The public address is not available yet.' });
  assert.equal(half.openGame, LOCAL);

  // Without a host, a status still gives a view.
  const bare = [odd, strange, links, half, panelView({ report: {}, config: {}, invitation: [], busy: null, confirming: null, notice: null }),
    view({ report: room('online', { players: 'two', game: 'a disc' }) })];
  for (const [index, shown] of bare.entries()) {
    for (const value of leaves(shown))
      assert.ok(value === null || typeof value === 'string' || typeof value === 'boolean', `view ${index}: ${String(value)}`);
  }
  // What a status does not name at all is not known.
  assert.equal(bare[4].headline, 'unknown');
  assert.equal(bare[4].version, 'unknown');
  assert.deepEqual(bare[4].details, [['Version', 'unknown'], ['Room', 'unknown'], ['Public address', 'unknown'], ['Second address', 'unknown']]);
  assert.equal(bare[5].players, '0');
  assert.equal(bare[5].game, null);
});

test('markup in a sentence or a path stays text', () => {
  const markup = '<img src=x onerror="alert(1)">';
  const shown = view({ config: chosen({ gameFolder: `/Users/owner/${markup}` }),
    report: { ...report('failed', { problem: { component: 'game-data', message: markup }, room: markup }), version: markup } });
  assert.equal(shown.sentence, markup);
  assert.equal(shown.setup.folder, `/Users/owner/${markup}`);
  assert.equal(shown.version, markup);
  assert.deepEqual(shown.details[1], ['Room', markup]);
  assert.equal(view({ notice: markup }).sentence, markup);
  assert.equal(view({ config: saved({ problem: markup }) }).sentence, markup);
  assert.equal(view({ report: report(markup) }).headline, markup);
  assert.equal(disconnected(markup).sentence, markup);
});

test('a page without a server says so and offers nothing', () => {
  const sentence = 'This page cannot reach the server. Open Sled Storm Server to start it or to reach it again.';
  assert.deepEqual(disconnected(sentence), {
    application: 'Sled Storm Server',
    version: null,
    headline: 'Not connected',
    sentence,
    setup: null,
    options: null,
    game: null,
    start: null,
    stop: null,
    newGame: null,
    quit: null,
    players: null,
    invite: null,
    openGame: null,
    autoStart: null,
    diagnostics: null,
    details: [],
  });
  // The two views have the same parts, so that the page writes either the same way.
  assert.deepEqual(Object.keys(disconnected(sentence)), Object.keys(view()));
});

test("the room's options are those of the configuration, locked as the setup is, with a note about the disc", () => {
  // At rest they can be changed, and the note says what they need.
  const resting = view({ config: chosen({ roomOptions: { progress: 'original', camera: false } }) });
  assert.deepEqual(resting.options, { progress: 'original', camera: false, locked: false, note: PAL_ONLY });
  assert.deepEqual(view({ config: chosen(), report: report('failed', { problem: { component: 'game-data', message: 'No disc.' } }) }).options,
    { progress: 'all', camera: true, locked: false, note: PAL_ONLY });

  // While hosting is up they are the room's, and stay as they are.
  for (const state of ['preparing', 'starting', 'online', 'degraded', 'stopping'])
    assert.equal(view({ config: chosen(), report: report(state) }).options.locked, true, state);

  // The verified disc plays with what was chosen.
  assert.deepEqual(view({ config: chosen(), report: room('online') }).options, { progress: 'all', camera: true, locked: true, note: PAL_ONLY });
  // Any other disc plays with the original progression and a shared camera, whatever is saved, and the page says so.
  const other = view({ config: chosen(), report: room('online', { game: { pal: false, archiveBytes: 1_572_864, tracks: 1 },
    roomOptions: { progress: 'original', camera: false } }) });
  assert.deepEqual(other.options, { progress: 'all', camera: true, locked: true, note: OTHER_DISC });
  // Before a room runs, the disc that was prepared says nothing yet about what a room plays.
  assert.equal(view({ config: chosen(), report: report('starting', { game: { pal: false, archiveBytes: 1, tracks: 1 } }) }).options.note, PAL_ONLY);
});

test('a new game is offered while a room exists, and with players it becomes a question', () => {
  for (const state of ['starting', 'open', 'restoring', 'restarting', 'failed'])
    assert.deepEqual(view({ config: chosen(), report: room('online', { room: state }) }).newGame, { shown: true, enabled: true, label: 'New game' }, state);
  // Without a room, or with one that the page does not know, there is no game to renew.
  for (const state of ['off', 'resting', null, 7])
    assert.deepEqual(view({ config: chosen(), report: room('online', { room: state }) }).newGame, { shown: false, enabled: false, label: 'New game' },
      String(state));
  // A room that is being stopped is not given a new game.
  assert.deepEqual(view({ config: chosen(), report: room('stopping') }).newGame, { shown: true, enabled: false, label: 'New game' });

  const question = 'Players are in the room: 1 connected, 0 away with a controller kept. A new game disconnects them. Start one anyway?';
  const asked = view({ config: chosen(), report: room('online'), confirming: 'newGame', notice: question });
  assert.equal(asked.sentence, question);
  assert.deepEqual(asked.newGame, { shown: true, enabled: true, label: 'New game anyway' });
  assert.equal(asked.stop.label, 'Stop Server');
  assert.equal(asked.quit.label, 'Quit server');
});

test('while the folder dialog is open, Quit is the one button that can be pressed', () => {
  const open = view({ config: chosen(), busy: 'folder' });
  assert.equal(open.sentence, 'The folder dialog is open. Look for it among the windows.');
  assert.deepEqual(open.quit, { enabled: true, label: 'Quit server' });
  assert.deepEqual([open.start.enabled, open.setup.locked, open.options.locked, open.autoStart.enabled, open.diagnostics.enabled], [false, true, true, false, false]);
  // Once the quit is under way, nothing can be pressed.
  assert.deepEqual(view({ config: chosen(), busy: 'quit' }).quit, { enabled: false, label: 'Quit server' });
});
