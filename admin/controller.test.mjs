import test from 'node:test';
import assert from 'node:assert/strict';
import { createPanel } from './controller.js';

const FOLDER = '/Users/owner/Games/Sled Storm';
const LOCAL = 'http://127.0.0.1:8000/#room';
const PUBLIC = `https://synthetic-test.trycloudflare.com/access/${'a'.repeat(48)}#room`;
const NEXT = `https://synthetic-next.trycloudflare.com/access/${'b'.repeat(48)}#room`;
const NO_ADDRESS = 'The public address is not available. The game still works on this computer.';
const NOT_CONNECTED = 'This page is not connected to the server. Open Sled Storm Server again.';
const NOT_RUNNING = 'This page cannot reach the server. Open Sled Storm Server to start it or to reach it again.';
const UNREADABLE = 'The server gave an answer that this page cannot read.';
const READING = ['GET /api/status', 'GET /api/config'];
const READING_A_ROOM = [...READING, 'GET /api/invitation'];

/** A server that cannot be reached, as an entry of a stand-in's table. */
const DOWN = Symbol('down');
/** A page that waits for an answer that never comes would hang the run. With a bound it is a test that failed. */
const bounded = { timeout: 5_000 };

/** The status as `GET /api/status` gives it, with a host in the given state. */
function report(state, host = {}) {
  return { application: 'Sled Storm Server', version: '1.2.0', instance: '0123456789abcdef', pid: 4242, startedAt: '2026-11-21T10:00:00.000Z',
    host: { state, problem: null, game: null, localUrl: null, gatewayPort: null, tunnel: 'off', mirror: 'off', room: 'off', players: null, ...host } };
}

/** A room that is open, with one player in it unless the test says otherwise. */
const room = (state, host = {}) => report(state, { game: { pal: true, archiveBytes: 642_900_000, tracks: 2 }, localUrl: 'http://127.0.0.1:8000/',
  gatewayPort: 8100, tunnel: 'online', room: 'open', players: { connected: 1, reserved: 0 }, ...host });

/** The configuration as `GET /api/config` gives it: of a new installation, and with both choices made. */
const saved = (change = {}) => ({ gameFolder: null, discPolicy: null, autoStart: false, roomOptions: { progress: 'all', camera: true }, problem: null, ...change });
const chosen = (change = {}) => saved({ gameFolder: FOLDER, discPolicy: 'shared-allowed', ...change });

const ok = body => ({ status: 200, body });
const accepted = { status: 202, body: { host: report('idle').host } };
const refused = (status, error, more = {}) => ({ status, body: { error, ...more } });
/** The answers of a server with an open room that has both links. */
const hosting = (host = {}) => ({ 'GET /api/status': ok(room('online', host)), 'GET /api/config': ok(chosen()),
  'GET /api/invitation': ok({ url: PUBLIC, localUrl: LOCAL }) });

/** Lets everything that is due happen. No stand-in here waits for anything but the test. */
const settled = () => new Promise(resolve => { setImmediate(resolve); });

/** An answer that waits for the test. */
function held() {
  let answer;
  const promise = new Promise(resolve => { answer = resolve; });
  return { promise, answer };
}

/**
 * A page whose server answers from a table and keeps what it was asked. An entry of the table is an
 * answer, a function that gives one, or DOWN. Without a table the server is a new installation at rest.
 */
function page(table = {}, openAtLaunch = false) {
  const answers = { 'GET /api/status': ok(report('idle')), 'GET /api/config': ok(saved()), ...table };
  const asked = [];
  const views = [];
  const due = [];
  const copied = [];
  const files = [];
  const opened = [];
  const state = { lost: 0, clipboard: true, save: true };
  const ask = async (path, init = {}) => {
    const method = init.method ?? 'GET';
    asked.push(init.body === undefined ? `${method} ${path}` : `${method} ${path} ${init.body}`);
    // As the listener does: a body is read as JSON or not at all.
    if (init.body !== undefined && init.headers?.['Content-Type'] !== 'application/json') return refused(415, 'Send the request as application/json.');
    let answer = answers[`${method} ${path}`] ?? refused(404, 'Not found');
    if (typeof answer === 'function') answer = await answer(init);
    if (answer === DOWN) throw new TypeError('Failed to fetch');
    return answer;
  };
  const panel = createPanel({
    ask,
    openAtLaunch,
    openGame: url => opened.push(url),
    render: view => { views.push(view); },
    wait: ms => new Promise(resolve => { due.push({ ms, resolve }); }),
    clipboard: async text => {
      if (!state.clipboard) throw new DOMException('Write permission denied.', 'NotAllowedError');
      copied.push(text);
    },
    lost: () => { state.lost += 1; },
    save: (name, text) => {
      if (!state.save) throw new DOMException('The download was blocked.', 'SecurityError');
      files.push({ name, text });
    },
  });
  return {
    panel, answers, views, due, copied, files, opened, state,
    /** What the page shows now. */
    get view() { return views.at(-1); },
    /** What the server was asked since the last look. */
    taken: () => asked.splice(0),
    /** Starts the reading and lets the first one happen. */
    async open() {
      void panel.run();
      await settled();
      asked.length = 0;
    },
    /** The next reading, a second later. */
    async later() {
      assert.equal(due.length, 1, 'one reading is due');
      due.shift().resolve();
      await settled();
    },
  };
}

test('Start opens the local game once when the room is ready, and Stop cancels a pending open', bounded, async () => {
  const pendingRoom = { ...hosting({ room: 'starting' }),
    'GET /api/status': ok(room('starting', { room: 'starting' })) };
  const p = page({ 'GET /api/config': ok(chosen()),
    'POST /api/host/start': () => { Object.assign(p.answers, pendingRoom); return accepted; },
    'POST /api/room/stop': () => { p.answers['GET /api/status'] = ok(report('idle')); return accepted; } });
  await p.open();
  await p.panel.start();
  assert.deepEqual(p.opened, []);
  Object.assign(p.answers, hosting({ tunnel: 'starting' }));
  await p.later();
  await p.later();
  assert.deepEqual(p.opened, [LOCAL]);
  await p.panel.stop();
  await p.panel.start();
  await p.panel.stop();
  Object.assign(p.answers, hosting());
  await p.later();
  assert.deepEqual(p.opened, [LOCAL]);
});

test('only a fresh foreground launch opens a room started by auto-start', bounded, async () => {
  const fresh = page(hosting(), true);
  const existing = page(hosting());
  await fresh.open();
  await existing.open();
  await fresh.later();
  assert.deepEqual(fresh.opened, [LOCAL]);
  assert.deepEqual(existing.opened, []);
});

test('the page reads the status, the configuration and the invitation, and reads again a second later', bounded, async () => {
  const p = page();
  void p.panel.run();
  await settled();
  // Without a room there is no invitation to ask for.
  assert.deepEqual(p.taken(), READING);
  assert.equal(p.views.length, 1);
  assert.equal(p.view.headline, 'Needs setup');
  assert.deepEqual(p.view.start, { shown: true, enabled: false });
  assert.deepEqual(p.due.map(({ ms }) => ms), [1000]);

  Object.assign(p.answers, hosting());
  await p.later();
  assert.deepEqual(p.taken(), READING_A_ROOM);
  assert.equal(p.views.length, 2, 'one view for one reading');
  assert.equal(p.view.headline, 'Online');
  assert.equal(p.view.setup.folder, FOLDER);
  assert.deepEqual(p.view.invite, { url: PUBLIC, note: null });
  assert.equal(p.view.openGame, LOCAL);
  assert.equal(p.view.players, '1');
  assert.deepEqual(p.due.map(({ ms }) => ms), [1000]);

  // A room that is not open yet has no links, and the server's answer about that is no sentence of the page.
  p.answers['GET /api/status'] = ok(report('starting', { room: 'starting' }));
  p.answers['GET /api/invitation'] = refused(409, 'No room is open.');
  await p.later();
  assert.deepEqual(p.taken(), READING_A_ROOM);
  assert.equal(p.view.headline, 'Starting');
  assert.deepEqual(p.view.invite, { url: null, note: null });
  assert.equal(p.view.sentence, null);
});

test("a folder is chosen through the server's dialog, and a cancel changes nothing and says nothing", bounded, async () => {
  const p = page();
  await p.open();

  // The request is open for as long as the dialog is, and it names no folder.
  const dialog = held();
  p.answers['POST /api/game-folder/pick'] = () => dialog.promise;
  const choosing = p.panel.chooseFolder();
  await settled();
  assert.deepEqual(p.taken(), ['POST /api/game-folder/pick']);
  assert.equal(p.view.setup.locked, true);
  assert.equal(p.view.sentence, 'The folder dialog is open. Look for it among the windows.');
  // Meanwhile the page goes on reading.
  await p.later();
  assert.deepEqual(p.taken(), READING);
  assert.equal(p.view.setup.locked, true);

  p.answers['GET /api/config'] = ok(saved({ gameFolder: FOLDER }));
  dialog.answer(ok({ picked: true, config: saved({ gameFolder: FOLDER }) }));
  await choosing;
  assert.deepEqual(p.taken(), READING, 'the page reads anew once the request is answered');
  assert.deepEqual(p.view.setup, { unfinished: true, folder: FOLDER, policy: null, locked: false });
  assert.equal(p.view.sentence, null);

  p.answers['POST /api/game-folder/pick'] = ok({ picked: false, config: saved({ gameFolder: FOLDER }) });
  await p.panel.chooseFolder();
  assert.deepEqual(p.taken(), ['POST /api/game-folder/pick', ...READING]);
  assert.equal(p.view.setup.folder, FOLDER);
  assert.equal(p.view.sentence, null);

  // What the server refuses, it says, and the page shows that until the next press.
  const refusals = [
    refused(400, 'Expected exactly one CUE file in the game folder.'),
    refused(409, 'The folder dialog is already open. Look for it among the windows.'),
    refused(503, 'The folder dialog could not be opened.'),
  ];
  for (const refusal of refusals) {
    p.answers['POST /api/game-folder/pick'] = refusal;
    await p.panel.chooseFolder();
    assert.equal(p.view.sentence, refusal.body.error);
    assert.equal(p.view.setup.folder, FOLDER);
    assert.equal(p.view.setup.locked, false);
    await p.later();
    assert.equal(p.view.sentence, refusal.body.error, 'a reading leaves the sentence');
  }
  p.answers['POST /api/game-folder/pick'] = ok({ picked: false, config: saved({ gameFolder: FOLDER }) });
  await p.panel.chooseFolder();
  assert.equal(p.view.sentence, null);
});

test('a second press while a request is under way sends nothing', bounded, async () => {
  // Before the page has read anything it has no button to press.
  const unread = page();
  await unread.panel.start();
  await unread.panel.quit();
  await unread.panel.newGame();
  await unread.panel.setOptions({ camera: false });
  await unread.panel.saveDiagnostics();
  assert.equal(await unread.panel.copyInvite(), false);
  assert.deepEqual(unread.taken(), []);
  assert.deepEqual(unread.views, []);

  const p = page({ 'GET /api/config': ok(chosen()) });
  await p.open();
  const start = held();
  p.answers['POST /api/host/start'] = () => start.promise;
  const first = p.panel.start();
  await settled();
  assert.deepEqual(p.view.start, { shown: true, enabled: false });
  assert.equal(p.view.quit.enabled, false);
  const pressed = [p.panel.start(), p.panel.stop(), p.panel.quit(), p.panel.chooseFolder(), p.panel.setPolicy('local-only'), p.panel.setAutoStart(true),
    p.panel.newGame(), p.panel.setOptions({ camera: false }), p.panel.saveDiagnostics()];
  await settled();
  assert.deepEqual(p.taken(), ['POST /api/host/start']);

  start.answer(accepted);
  await first;
  await Promise.all(pressed);
  assert.deepEqual(p.taken(), READING);
  assert.deepEqual(p.view.start, { shown: true, enabled: true });

  // Two presses in the same moment are one request.
  p.answers['POST /api/host/start'] = accepted;
  await Promise.all([p.panel.start(), p.panel.start()]);
  assert.deepEqual(p.taken(), ['POST /api/host/start', ...READING]);
});

test('a press ends once the page shows what the server said after it, even when a reading overtook its own', bounded, async () => {
  const p = page({ 'GET /api/config': ok(chosen()) });
  await p.open();
  // The readings' answers wait for the test, in the order that they are asked.
  const readings = [];
  p.answers['GET /api/status'] = () => {
    const reading = held();
    readings.push(reading);
    return reading.promise;
  };
  p.answers['POST /api/host/start'] = accepted;
  let ended = false;
  const pressing = p.panel.start().then(() => { ended = true; });
  await settled();
  assert.equal(readings.length, 1, 'the reading that follows the press');
  // The page's own reading begins before the press's reading is answered, so it is the newer one.
  p.due.shift().resolve();
  await settled();
  assert.equal(readings.length, 2);
  readings[0].answer(ok(report('preparing')));
  await settled();
  assert.equal(ended, false, 'the press waits for the newer reading');
  readings[1].answer(ok(report('preparing')));
  await pressing;
  assert.equal(p.view.headline, 'Preparing the game files');
  assert.deepEqual(p.view.stop, { shown: true, enabled: true, label: 'Stop Server' });
  assert.equal(p.view.quit.enabled, true, 'nothing is under way');
});

test('the policy and the switch are saved by one request each', bounded, async () => {
  let config = saved({ gameFolder: FOLDER });
  const p = page({ 'GET /api/config': () => ok(config) });
  p.answers['PUT /api/config'] = init => {
    config = { ...config, ...JSON.parse(init.body) };
    return ok(config);
  };
  await p.open();
  assert.equal(p.view.headline, 'Needs setup');

  await p.panel.setPolicy('shared-allowed');
  assert.deepEqual(p.taken(), ['PUT /api/config {"discPolicy":"shared-allowed"}', ...READING]);
  assert.deepEqual(p.view.setup, { unfinished: false, folder: FOLDER, policy: 'shared-allowed', locked: false });
  assert.equal(p.view.headline, 'Stopped');
  assert.equal(p.view.sentence, null);

  await p.panel.setAutoStart(true);
  assert.deepEqual(p.taken(), ['PUT /api/config {"autoStart":true}', ...READING]);
  assert.deepEqual(p.view.autoStart, { checked: true, enabled: true });
  await p.panel.setAutoStart(false);
  assert.deepEqual(p.taken(), ['PUT /api/config {"autoStart":false}', ...READING]);
  assert.equal(p.view.autoStart.checked, false);

  // The page shows what is saved, not what was pressed.
  p.answers['PUT /api/config'] = refused(409, 'Stop the room before changing the game folder or the disc policy.');
  await p.panel.setPolicy('local-only');
  assert.deepEqual(p.taken(), ['PUT /api/config {"discPolicy":"local-only"}', ...READING]);
  assert.equal(p.view.sentence, 'Stop the room before changing the game folder or the disc policy.');
  assert.equal(p.view.setup.policy, 'shared-allowed');
});

test('start and stop send one request, and what the server refuses is shown in its sentence', bounded, async () => {
  const p = page({ 'GET /api/config': ok(chosen()) });
  await p.open();

  p.answers['POST /api/host/start'] = () => {
    p.answers['GET /api/status'] = ok(report('preparing'));
    return accepted;
  };
  await p.panel.start();
  assert.deepEqual(p.taken(), ['POST /api/host/start', ...READING]);
  assert.equal(p.view.headline, 'Preparing the game files');
  assert.deepEqual(p.view.stop, { shown: true, enabled: true, label: 'Stop Server' });

  p.answers['POST /api/room/stop'] = () => {
    p.answers['GET /api/status'] = ok(report('idle'));
    return accepted;
  };
  await p.panel.stop();
  assert.deepEqual(p.taken(), ['POST /api/room/stop', ...READING]);
  assert.equal(p.view.headline, 'Stopped');
  assert.equal(p.view.sentence, null);

  p.answers['POST /api/host/start'] = refused(409, 'The server is quitting.');
  await p.panel.start();
  assert.equal(p.view.sentence, 'The server is quitting.');
  assert.equal(p.view.headline, 'Stopped');
  // A start that would end a room with players in it is refused in the server's words. The page has no second start for it.
  p.answers['POST /api/host/start'] = refused(409, 'Players are in the room.', { players: { connected: 1, reserved: 0 } });
  await p.panel.start();
  assert.equal(p.view.sentence, 'Players are in the room.');
  await p.panel.start();
  // A refusal without a sentence still says that nothing was done.
  p.answers['POST /api/host/start'] = { status: 500, body: null };
  await p.panel.start();
  assert.equal(p.view.sentence, 'The server refused the request (500).');
  assert.deepEqual(p.taken().filter(request => request.startsWith('POST')), Array(4).fill('POST /api/host/start'));

  // The next press takes the sentence away.
  p.answers['POST /api/host/start'] = accepted;
  await p.panel.start();
  assert.equal(p.view.sentence, null);
});

test('a stop with players asks first and then stops with force', bounded, async () => {
  /** The room's stop as the server has it: refused for players, unless the request says force. */
  const stop = p => init => {
    if (init.body !== '{"force":true}') return refused(409, 'Players are in the room.', { players: { connected: 2, reserved: 1 } });
    p.answers['GET /api/status'] = ok(report('idle'));
    return accepted;
  };
  const question = 'Players are in the room: 2 connected, 1 away with a controller kept. Stop it anyway?';

  const p = page(hosting());
  p.answers['POST /api/room/stop'] = stop(p);
  await p.open();
  await p.panel.stop();
  assert.deepEqual(p.taken(), ['POST /api/room/stop', ...READING_A_ROOM]);
  // The counts are those of the refusal, which is newer than what the page last read.
  assert.equal(p.view.sentence, question);
  assert.deepEqual(p.view.stop, { shown: true, enabled: true, label: 'Stop anyway' });
  assert.equal(p.view.headline, 'Online');
  await p.later();
  assert.equal(p.view.sentence, question, 'the question stays while the players do');
  assert.equal(p.view.stop.label, 'Stop anyway');
  p.taken();

  await p.panel.stop();
  assert.deepEqual(p.taken(), ['POST /api/room/stop {"force":true}', ...READING]);
  assert.equal(p.view.headline, 'Stopped');
  assert.equal(p.view.sentence, null);
  assert.equal(p.view.stop.label, 'Stop Server');

  // Another press in between takes the question back, and the next stop asks again.
  const other = page(hosting());
  other.answers['POST /api/room/stop'] = stop(other);
  other.answers['PUT /api/config'] = ok(chosen({ autoStart: true }));
  await other.open();
  await other.panel.stop();
  assert.equal(other.view.stop.label, 'Stop anyway');
  await other.panel.setAutoStart(true);
  assert.equal(other.view.stop.label, 'Stop Server');
  assert.equal(other.view.sentence, null);
  other.taken();
  await other.panel.stop();
  assert.deepEqual(other.taken(), ['POST /api/room/stop', ...READING_A_ROOM]);
  assert.equal(other.view.sentence, question);

  // Once the players have left, nothing is left to ask about.
  other.answers['GET /api/status'] = ok(room('online', { players: { connected: 0, reserved: 0 } }));
  await other.later();
  assert.equal(other.view.sentence, null);
  assert.equal(other.view.stop.label, 'Stop Server');
  other.taken();
  other.answers['POST /api/room/stop'] = accepted;
  await other.panel.stop();
  assert.deepEqual(other.taken(), ['POST /api/room/stop', ...READING_A_ROOM]);
});

test("a quit is asked about from the server's refusal, not from the last reading", bounded, async () => {
  /** The server's quit: refused for players, unless the request says force. */
  const quit = players => init => (init.body === '{"force":true}' ? { status: 202, body: { quitting: true } }
    : refused(409, 'Players are in the room.', { players }));
  // The page last read an empty room; a player has joined since.
  const p = page({ ...hosting({ players: { connected: 0, reserved: 0 } }), 'POST /api/host/quit': quit({ connected: 1, reserved: 0 }) });
  const running = p.panel.run();
  await settled();
  p.taken();
  p.answers['GET /api/status'] = ok(room('online'));
  assert.equal(p.view.players, '0');

  await p.panel.quit();
  assert.deepEqual(p.taken(), ['POST /api/host/quit', ...READING_A_ROOM]);
  assert.equal(p.view.sentence, 'Players are in the room: 1 connected, 0 away with a controller kept. Quit anyway?');
  assert.deepEqual(p.view.quit, { enabled: true, label: 'Quit anyway' });
  assert.equal(p.view.stop.label, 'Stop Server');

  // The second press says force, and the page is over.
  await p.panel.quit();
  assert.deepEqual(p.taken(), ['POST /api/host/quit {"force":true}']);
  assert.equal(p.view.headline, 'Not connected');
  assert.equal(p.view.sentence, 'The server has quit. Open Sled Storm Server to start it again.');
  assert.equal(p.view.quit, null);
  assert.equal(p.view.openGame, null);
  assert.equal(p.state.lost, 0);

  // The reading is over, and so is every button.
  const shown = p.views.length;
  await p.later();
  await running;
  await Promise.all([p.panel.start(), p.panel.stop(), p.panel.quit(), p.panel.chooseFolder(), p.panel.setPolicy('local-only'), p.panel.setAutoStart(true),
    p.panel.newGame(), p.panel.setOptions({ camera: false }), p.panel.saveDiagnostics()]);
  assert.equal(await p.panel.copyInvite(), false);
  assert.deepEqual(p.taken(), []);
  assert.deepEqual(p.due, []);
  assert.equal(p.views.length, shown);

  // A room that the page last read with players in it is not asked about before the server is: it may have emptied.
  const left = page({ ...hosting(), 'POST /api/host/quit': { status: 202, body: { quitting: true } } });
  await left.open();
  await left.panel.quit();
  assert.deepEqual(left.taken(), ['POST /api/host/quit']);
  assert.equal(left.view.sentence, 'The server has quit. Open Sled Storm Server to start it again.');

  // A controller that is kept for a player who is away is somebody in the room, in the server's counts as in the page's words.
  const away = page({ ...hosting(), 'POST /api/host/quit': quit({ connected: 0, reserved: 1 }) });
  await away.open();
  await away.panel.quit();
  assert.equal(away.view.sentence, 'Players are in the room: 0 connected, 1 away with a controller kept. Quit anyway?');

  // A refusal of another kind is the server's sentence, and the next press asks without force.
  const other = page({ ...hosting(), 'POST /api/host/quit': { status: 500, body: null } });
  await other.open();
  await other.panel.quit();
  assert.equal(other.view.sentence, 'The server refused the request (500).');
  assert.equal(other.view.quit.label, 'Quit server');
  other.taken();
  await other.panel.quit();
  assert.deepEqual(other.taken(), ['POST /api/host/quit', ...READING_A_ROOM]);
});

test('a quit during the folder dialog is sent, and ends the page while the dialog is answered', bounded, async () => {
  const p = page({ 'GET /api/config': ok(chosen()) });
  await p.open();
  const dialog = held();
  p.answers['POST /api/game-folder/pick'] = () => dialog.promise;
  const choosing = p.panel.chooseFolder();
  await settled();
  assert.deepEqual(p.taken(), ['POST /api/game-folder/pick']);
  assert.deepEqual(p.view.quit, { enabled: true, label: 'Quit server' });

  // Every other button waits for the dialog.
  await Promise.all([p.panel.start(), p.panel.chooseFolder(), p.panel.setOptions({ camera: false }), p.panel.saveDiagnostics()]);
  assert.deepEqual(p.taken(), []);

  // The server answers the quit, then ends the dialog as it goes, and answers the dialog's request so.
  p.answers['POST /api/host/quit'] = () => {
    setImmediate(() => dialog.answer(refused(409, 'The server is quitting.')));
    return { status: 202, body: { quitting: true } };
  };
  await p.panel.quit();
  await choosing;
  await settled();
  assert.deepEqual(p.taken(), ['POST /api/host/quit']);
  assert.equal(p.view.sentence, 'The server has quit. Open Sled Storm Server to start it again.');
  assert.equal(p.view.quit, null);

  // A quit that is refused while the dialog is open leaves the dialog's request under way.
  const q = page({ 'GET /api/config': ok(chosen()), 'POST /api/host/quit': { status: 500, body: null } });
  await q.open();
  const second = held();
  q.answers['POST /api/game-folder/pick'] = () => second.promise;
  const picking = q.panel.chooseFolder();
  await settled();
  await q.panel.quit();
  assert.deepEqual(q.taken(), ['POST /api/game-folder/pick', 'POST /api/host/quit', ...READING]);
  assert.equal(q.view.sentence, 'The server refused the request (500).');
  assert.deepEqual([q.view.quit.enabled, q.view.start.enabled, q.view.setup.locked], [true, false, true]);
  // While the quit is under way, it is not sent twice.
  const slow = held();
  q.answers['POST /api/host/quit'] = () => slow.promise;
  const quitting = q.panel.quit();
  await settled();
  await q.panel.quit();
  assert.deepEqual(q.taken(), ['POST /api/host/quit']);
  assert.equal(q.view.quit.enabled, false);
  slow.answer({ status: 500, body: null });
  await quitting;
  q.taken();
  second.answer(ok({ picked: false, config: chosen() }));
  await picking;
  assert.deepEqual(q.taken(), READING);
  // The dialog's answer says nothing of its own, so the quit's refusal stays until the next press.
  assert.deepEqual([q.view.start.enabled, q.view.setup.locked, q.view.sentence], [true, false, 'The server refused the request (500).']);
});

test('a new game with players asks first, then sends force', bounded, async () => {
  const question = 'Players are in the room: 2 connected, 1 away with a controller kept. A new game disconnects them. Start one anyway?';
  const p = page(hosting());
  p.answers['POST /api/room/new-game'] = init => (init.body === '{"force":true}' ? accepted
    : refused(409, 'Players are in the room.', { players: { connected: 2, reserved: 1 } }));
  await p.open();
  assert.deepEqual(p.view.newGame, { shown: true, enabled: true, label: 'New game' });
  await p.panel.newGame();
  assert.deepEqual(p.taken(), ['POST /api/room/new-game', ...READING_A_ROOM]);
  assert.equal(p.view.sentence, question);
  assert.deepEqual(p.view.newGame, { shown: true, enabled: true, label: 'New game anyway' });
  assert.equal(p.view.stop.label, 'Stop Server');

  await p.panel.newGame();
  assert.deepEqual(p.taken(), ['POST /api/room/new-game {"force":true}', ...READING_A_ROOM]);
  assert.equal(p.view.sentence, 'A new game is starting in the same room. The links stay the same.');
  assert.equal(p.view.newGame.label, 'New game');

  // A stop's question is not answered by a new game, nor the other way round.
  p.answers['POST /api/room/stop'] = refused(409, 'Players are in the room.', { players: { connected: 1, reserved: 0 } });
  await p.panel.stop();
  assert.equal(p.view.stop.label, 'Stop anyway');
  p.taken();
  await p.panel.newGame();
  assert.deepEqual(p.taken(), ['POST /api/room/new-game', ...READING_A_ROOM]);
  assert.deepEqual([p.view.stop.label, p.view.newGame.label], ['Stop Server', 'New game anyway']);

  // An empty room gets its new game at once, and a refusal is the server's sentence.
  const empty = page({ ...hosting({ players: { connected: 0, reserved: 0 } }), 'POST /api/room/new-game': accepted });
  await empty.open();
  await empty.panel.newGame();
  assert.deepEqual(empty.taken(), ['POST /api/room/new-game', ...READING_A_ROOM]);
  empty.answers['POST /api/room/new-game'] = refused(409, 'No room is open.');
  await empty.panel.newGame();
  assert.equal(empty.view.sentence, 'No room is open.');
});

test("the room's options are saved by one request, with both of them", bounded, async () => {
  let config = chosen();
  const p = page({ 'GET /api/config': () => ok(config) });
  p.answers['PUT /api/config'] = init => {
    config = { ...config, ...JSON.parse(init.body) };
    return ok(config);
  };
  await p.open();
  assert.deepEqual(p.view.options, { progress: 'all', camera: true, locked: false, note: 'Unlocked content and separate cameras need the verified PAL disc.' });

  await p.panel.setOptions({ camera: false });
  assert.deepEqual(p.taken(), ['PUT /api/config {"roomOptions":{"progress":"all","camera":false}}', ...READING]);
  assert.deepEqual([p.view.options.progress, p.view.options.camera, p.view.sentence], ['all', false, null]);
  await p.panel.setOptions({ progress: 'original' });
  assert.deepEqual(p.taken(), ['PUT /api/config {"roomOptions":{"progress":"original","camera":false}}', ...READING]);
  assert.deepEqual([p.view.options.progress, p.view.options.camera], ['original', false]);

  // What the server refuses is said, and the page shows what is saved.
  p.answers['PUT /api/config'] = refused(409, "Stop the room before changing the room's options.");
  await p.panel.setOptions({ camera: true });
  assert.deepEqual(p.taken(), ['PUT /api/config {"roomOptions":{"progress":"original","camera":true}}', ...READING]);
  assert.equal(p.view.sentence, "Stop the room before changing the room's options.");
  assert.equal(p.view.options.camera, false);

  // A configuration without options that the page can read is sent with the web client's defaults for the other one.
  config = chosen({ roomOptions: null });
  await p.later();
  p.taken();
  p.answers['PUT /api/config'] = ok(config);
  await p.panel.setOptions({ camera: false });
  assert.deepEqual(p.taken(), ['PUT /api/config {"roomOptions":{"progress":"all","camera":false}}', ...READING]);
});

test('the diagnostic report is saved as a file named by the date', bounded, async () => {
  const body = { application: 'Sled Storm Server', version: '1.2.0', generatedAt: '2026-11-21T14:05:09.123Z', log: ['<b>line</b>'] };
  const p = page({ 'POST /api/diagnostics/export': ok(body) });
  await p.open();
  assert.deepEqual(p.view.diagnostics, { enabled: true });
  await p.panel.saveDiagnostics();
  assert.deepEqual(p.taken(), ['POST /api/diagnostics/export', ...READING]);
  assert.deepEqual(p.files, [{ name: 'sled-storm-server-diagnostics-2026-11-21.json', text: `${JSON.stringify(body, null, 2)}\n` }]);
  assert.equal(p.view.sentence, 'The browser saves the diagnostic report as sled-storm-server-diagnostics-2026-11-21.json.');

  // A report without a time that the page can read still has a name.
  p.answers['POST /api/diagnostics/export'] = ok({ generatedAt: 'soon' });
  await p.panel.saveDiagnostics();
  assert.equal(p.files.at(-1).name, 'sled-storm-server-diagnostics.json');

  // A refusal, an answer that is no report, and a browser that saves nothing: each is said, and nothing more is saved.
  const saved = p.files.length;
  p.answers['POST /api/diagnostics/export'] = { status: 500, body: null };
  await p.panel.saveDiagnostics();
  assert.equal(p.view.sentence, 'The server refused the request (500).');
  p.answers['POST /api/diagnostics/export'] = ok('report');
  await p.panel.saveDiagnostics();
  assert.equal(p.view.sentence, 'The server gave an answer that this page cannot read.');
  p.answers['POST /api/diagnostics/export'] = ok(body);
  p.state.save = false;
  await p.panel.saveDiagnostics();
  assert.equal(p.view.sentence, 'The diagnostic report could not be saved.');
  assert.equal(p.files.length, saved);
});

test('a server that forgets the session disconnects the page and lets go of the session', bounded, async () => {
  const unknown = refused(401, 'Authorization required');
  const p = page();
  const running = p.panel.run();
  await settled();
  p.taken();
  p.answers['GET /api/status'] = unknown;
  await p.later();
  await running;
  assert.equal(p.state.lost, 1);
  assert.equal(p.view.headline, 'Not connected');
  assert.equal(p.view.sentence, NOT_CONNECTED);
  assert.equal(p.view.start, null);
  assert.deepEqual(p.taken(), ['GET /api/status']);
  assert.deepEqual(p.due, [], 'no further reading is due');
  await p.panel.start();
  assert.deepEqual(p.taken(), []);

  // The same on either of the other two readings.
  for (const path of ['GET /api/config', 'GET /api/invitation']) {
    const reading = page({ ...hosting(), [path]: unknown });
    await reading.panel.run();
    assert.equal(reading.state.lost, 1, path);
    assert.equal(reading.view.sentence, NOT_CONNECTED, path);
    assert.equal(reading.views.length, 1, path);
  }

  // And on a button's request, which is then not followed by a reading.
  const pressed = page({ 'GET /api/config': ok(chosen()), 'POST /api/host/start': unknown });
  const reading = pressed.panel.run();
  await settled();
  pressed.taken();
  await pressed.panel.start();
  assert.deepEqual(pressed.taken(), ['POST /api/host/start']);
  assert.equal(pressed.state.lost, 1);
  assert.equal(pressed.view.sentence, NOT_CONNECTED);
  await pressed.later();
  await reading;
  assert.deepEqual(pressed.taken(), []);
});

test('a server that cannot be reached is said to be out of reach, and the page finds it again when it answers', bounded, async () => {
  const p = page(hosting());
  await p.open();
  assert.equal(p.view.headline, 'Online');

  p.answers['GET /api/status'] = DOWN;
  await p.later();
  assert.equal(p.view.headline, 'Not connected');
  assert.equal(p.view.sentence, NOT_RUNNING);
  assert.equal(p.view.stop, null);
  assert.equal(p.view.invite, null);
  assert.equal(p.view.openGame, null);
  assert.equal(p.state.lost, 0, 'the session is kept, for the same server may answer again');
  await p.later();
  assert.equal(p.view.sentence, NOT_RUNNING);
  // A page without a server has no button.
  p.taken();
  await p.panel.stop();
  assert.equal(await p.panel.copyInvite(), false);
  assert.deepEqual(p.taken(), []);

  p.answers['GET /api/status'] = ok(room('online'));
  await p.later();
  assert.equal(p.view.headline, 'Online');
  assert.deepEqual(p.view.invite, { url: PUBLIC, note: null });

  // A server that goes away in the middle of a reading leaves nothing of that reading.
  p.answers['GET /api/invitation'] = DOWN;
  await p.later();
  assert.equal(p.view.sentence, NOT_RUNNING);
  p.answers['GET /api/invitation'] = ok({ url: PUBLIC, localUrl: LOCAL });
  await p.later();
  assert.equal(p.view.headline, 'Online');

  // A button's request that gets no answer: the reading after it says how the server is.
  p.answers['POST /api/room/stop'] = DOWN;
  p.answers['GET /api/status'] = DOWN;
  p.taken();
  await p.panel.stop();
  assert.deepEqual(p.taken(), ['POST /api/room/stop', 'GET /api/status']);
  assert.equal(p.view.sentence, NOT_RUNNING);
  // And when the server is there after all, the page says that the request was not answered.
  p.answers['GET /api/status'] = ok(room('online'));
  await p.later();
  assert.equal(p.view.headline, 'Online');
  assert.equal(p.view.sentence, 'The server did not answer. Try again.');
  assert.deepEqual(p.view.stop, { shown: true, enabled: true, label: 'Stop Server' });
});

test('the invitation that is shown is the one of the latest reading', bounded, async () => {
  const p = page(hosting());
  await p.open();
  assert.deepEqual(p.view.invite, { url: PUBLIC, note: null });

  // The public address changed.
  p.answers['GET /api/invitation'] = ok({ url: NEXT, localUrl: LOCAL });
  await p.later();
  assert.deepEqual(p.view.invite, { url: NEXT, note: null });

  // A reading that was overtaken by a later one does not bring the old link back.
  const slow = held();
  p.answers['GET /api/status'] = () => slow.promise;
  p.due.shift().resolve();
  await settled();
  p.answers['GET /api/status'] = ok(room('online'));
  p.answers['PUT /api/config'] = ok(chosen({ autoStart: true }));
  await p.panel.setAutoStart(true);
  assert.deepEqual(p.view.invite, { url: NEXT, note: null });
  const shown = p.views.length;
  p.answers['GET /api/invitation'] = ok({ url: PUBLIC, localUrl: LOCAL });
  slow.answer(ok(room('online')));
  await settled();
  assert.equal(p.views.length, shown, 'the older reading shows nothing');
  assert.deepEqual(p.view.invite, { url: NEXT, note: null });

  // The public address went away: no link is offered, and the game on this computer still is.
  p.answers['GET /api/status'] = ok(room('degraded', { tunnel: 'retrying', problem: { component: 'tunnel', message: NO_ADDRESS } }));
  p.answers['GET /api/invitation'] = ok({ url: null, localUrl: LOCAL });
  await p.later();
  assert.deepEqual(p.view.invite, { url: null, note: 'The public address is not available yet.' });
  assert.equal(p.view.openGame, LOCAL);
  assert.equal(await p.panel.copyInvite(), false);
  assert.deepEqual(p.copied, [], 'the old link is not copied');

  // The room closed: neither link.
  p.answers['GET /api/invitation'] = refused(409, 'No room is open.');
  await p.later();
  assert.deepEqual(p.view.invite, { url: null, note: null });
  assert.equal(p.view.openGame, null);
  p.answers['GET /api/status'] = ok(report('idle'));
  p.answers['GET /api/invitation'] = ok({ url: PUBLIC, localUrl: LOCAL });
  p.taken();
  await p.later();
  assert.deepEqual(p.taken(), READING, 'and none is asked for');
  assert.deepEqual(p.view.invite, { url: null, note: null });
});

test('the link is copied, or the page says how to copy it', bounded, async () => {
  const p = page(hosting());
  await p.open();
  assert.equal(await p.panel.copyInvite(), true);
  assert.deepEqual(p.copied, [PUBLIC]);
  assert.equal(p.view.sentence, 'The link is copied.');
  assert.deepEqual(p.taken(), [], 'copying asks nothing of the server');

  // A browser that refuses: the page tells the owner to copy by hand, and its caller to select the link.
  p.state.clipboard = false;
  assert.equal(await p.panel.copyInvite(), false);
  assert.deepEqual(p.copied, [PUBLIC]);
  assert.equal(p.view.sentence, 'Select the link and copy it.');

  // Without a link nothing is copied and nothing is said: the page shows what is missing already.
  const local = page({ ...hosting({ tunnel: 'failed', problem: { component: 'tunnel', message: NO_ADDRESS } }),
    'GET /api/invitation': ok({ url: null, localUrl: LOCAL }) });
  await local.open();
  const shown = local.views.length;
  assert.equal(await local.panel.copyInvite(), false);
  assert.deepEqual(local.copied, []);
  assert.equal(local.views.length, shown);
  assert.equal(local.view.sentence, NO_ADDRESS);
});

test('an answer that is not what the page expects does not stop the reading', bounded, async () => {
  const p = page({ 'GET /api/status': { status: 500, body: null } });
  await p.open();
  assert.equal(p.view.headline, 'Not connected');
  assert.equal(p.view.sentence, UNREADABLE);
  for (const answer of [ok(null), ok('running'), ok([]), ok(7), refused(404, 'Not found'), { status: 204, body: null }]) {
    p.answers['GET /api/status'] = answer;
    await p.later();
    assert.equal(p.view.sentence, UNREADABLE, JSON.stringify(answer));
    assert.equal(p.view.start, null);
  }
  assert.equal(p.state.lost, 0);

  // A status of a form that the page does not know is shown as it is.
  p.answers['GET /api/status'] = ok({});
  await p.later();
  assert.equal(p.view.headline, 'unknown');
  assert.deepEqual(p.view.start, { shown: true, enabled: false });

  // Without a configuration or an invitation that can be read, the page shows the rest. A refusal is
  // neither of them, whatever it carries.
  Object.assign(p.answers, hosting());
  const carrying = { status: 503, body: { ...chosen(), url: PUBLIC, localUrl: LOCAL } };
  for (const answer of [{ status: 500, body: null }, ok(null), ok('none'), refused(404, 'Not found'), carrying]) {
    p.answers['GET /api/config'] = answer;
    p.answers['GET /api/invitation'] = answer;
    await p.later();
    assert.equal(p.view.headline, 'Online', JSON.stringify(answer));
    assert.deepEqual(p.view.setup, { unfinished: true, folder: null, policy: null, locked: true });
    assert.deepEqual(p.view.invite, { url: null, note: null });
    assert.equal(p.view.openGame, null);
    assert.equal(p.view.sentence, null);
  }

  Object.assign(p.answers, hosting());
  await p.later();
  assert.equal(p.view.setup.folder, FOLDER);
  assert.deepEqual(p.view.invite, { url: PUBLIC, note: null });
  assert.equal(p.due.length, 1, 'the next reading is due');
});

test("a sentence of the page's own gives way once the status says something new", bounded, async () => {
  const p = page(hosting());
  await p.open();
  await p.panel.copyInvite();
  assert.equal(p.view.sentence, 'The link is copied.');
  await p.later();
  await p.later();
  assert.equal(p.view.sentence, 'The link is copied.', 'a status that says the same leaves it');

  // The public address fails: that is what the page has to say now.
  p.answers['GET /api/status'] = ok(room('degraded', { tunnel: 'retrying', problem: { component: 'tunnel', message: NO_ADDRESS } }));
  await p.later();
  assert.equal(p.view.headline, 'Running, with a problem');
  assert.equal(p.view.sentence, NO_ADDRESS);

  // A refusal is not lost to the reading that follows its own request, whatever that reading finds.
  p.answers['POST /api/host/start'] = () => {
    p.answers['GET /api/status'] = ok(room('online'));
    return refused(409, 'The server is quitting.');
  };
  await p.panel.start();
  assert.equal(p.view.headline, 'Online');
  assert.equal(p.view.sentence, 'The server is quitting.');
  await p.later();
  assert.equal(p.view.sentence, 'The server is quitting.');

  // The same state with another problem is something new as well.
  p.answers['GET /api/status'] = ok(room('degraded', { problem: { component: 'room', message: 'The room is restarting.' } }));
  await p.later();
  assert.equal(p.view.sentence, 'The room is restarting.');
  p.answers['POST /api/host/start'] = refused(409, 'The server is quitting.');
  await p.panel.start();
  assert.equal(p.view.sentence, 'The server is quitting.');
  p.answers['GET /api/status'] = ok(room('degraded', { problem: { component: 'tunnel', message: NO_ADDRESS } }));
  await p.later();
  assert.equal(p.view.sentence, NO_ADDRESS);
});

test("a sentence of the page's own about the folder gives way once the saved folder or policy changes", bounded, async () => {
  // A second tab, or a page that was loaded again, while the dialog of the first is open.
  const p = page({ 'GET /api/config': ok(saved()), 'POST /api/game-folder/pick': refused(409, 'The folder dialog is already open. Look for it among the windows.') });
  await p.open();
  await p.panel.chooseFolder();
  assert.equal(p.view.sentence, 'The folder dialog is already open. Look for it among the windows.');
  await p.later();
  assert.equal(p.view.sentence, 'The folder dialog is already open. Look for it among the windows.', 'nothing new: it stays');
  // The owner chooses in that dialog, and the server saves the folder: the dialog is gone.
  p.answers['GET /api/config'] = ok(saved({ gameFolder: FOLDER }));
  await p.later();
  assert.deepEqual([p.view.setup.folder, p.view.sentence], [FOLDER, null]);
  // The same for a policy that another tab saved after a refusal here.
  p.answers['PUT /api/config'] = refused(409, 'Stop the room before changing the game folder or the disc policy.');
  await p.panel.setPolicy('shared-allowed');
  assert.equal(p.view.sentence, 'Stop the room before changing the game folder or the disc policy.');
  p.answers['GET /api/config'] = ok(saved({ gameFolder: FOLDER, discPolicy: 'shared-allowed' }));
  await p.later();
  assert.equal(p.view.sentence, null);
});
