// The page as a whole: its files against the two lists that serve and ship
// them, what its script may not do, and the script itself, run against a
// stand-in for the browser's document. What the page shows and what its
// buttons ask is decided in view.js and controller.js and tested there; here
// it is the way from a view into the document and from a press to a request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';

const read = name => readFile(new URL(name, import.meta.url), 'utf8');
const html = await read('./index.html');

const KEY = 'sled-panel-session';
const TOKEN = 'a'.repeat(64);
const SESSION = 'b'.repeat(64);
const FOLDER = '/Users/owner/Games/Sled Storm';
const LOCAL = 'http://127.0.0.1:8000/#room';
const PUBLIC = `https://synthetic-test.trycloudflare.com/access/${'a'.repeat(48)}#room`;
const SETUP = 'Choose the game folder and the disc policy to start hosting.';
const NO_ADDRESS = 'The public address is not available. The game still works on this computer.';
const NOT_CONNECTED = 'This page is not connected to the server. Open Sled Storm Server again.';
const NOT_RUNNING = 'This page cannot reach the server. Open Sled Storm Server to start it or to reach it again.';
const PAL_ONLY = 'Unlocked content and separate cameras need the verified PAL disc.';
const DETAILS = ['dt Version', 'dd 1.2.0', 'dt Room', 'dd off', 'dt Public address', 'dd off', 'dt Second address', 'dd off'];

// ---- The files of the page ----

/** The files of the page that a document names. */
const named = document => [...document.matchAll(/\s(?:src|href)="\/([^"]+)"/g)].map(([, name]) => name);
/** The modules that a module loads. */
const imported = script => [...script.matchAll(/^import\s[^'"]*['"]\.\/([^'"]+)['"];$/gm)].map(([, name]) => name);

/** Every file that a browser loads for the page: the document, what it names, and what those modules import. */
async function loaded() {
  const files = new Map([['index.html', html]]);
  const queue = named(html);
  while (queue.length) {
    const name = queue.shift();
    if (files.has(name)) continue;
    files.set(name, await read(`./${name}`));
    if (name.endsWith('.js')) queue.push(...imported(files.get(name)));
  }
  return files;
}

const TYPES = { html: 'text/html; charset=utf-8', css: 'text/css; charset=utf-8', js: 'text/javascript; charset=utf-8' };

test('every file that the page loads is served by the listener and staged into the bundle', async () => {
  const files = await loaded();
  const names = [...files.keys()].sort();
  for (const [name, text] of files) {
    if (!name.endsWith('.js')) continue;
    // A module is loaded by a line that this test can follow, or it would be missed here.
    assert.equal(imported(text).length, [...text.matchAll(/\bimport\b[^\n]*\bfrom\b/g)].length, `${name}: every import is a line of its own, from this folder`);
    assert.doesNotMatch(text, /\bimport\s*\(/, name);
  }

  const listener = await read('../server/src/host-server.ts');
  const lines = /const PANEL_FILES = new Map\(\[\n([\s\S]*?)\n\]\);/.exec(listener)[1].split('\n');
  const served = lines.map(line => /^\s*\['(\/[^']*)', \{ name: '([^']+)', type: '([^']+)' \}\],$/.exec(line));
  assert.ok(served.every(Boolean), 'every line of the listener\'s list is read');
  for (const [, path, name, type] of served) {
    assert.equal(path, name === 'index.html' ? '/' : `/${name}`, name);
    assert.equal(type, TYPES[name.split('.').at(-1)], name);
  }
  assert.deepEqual(served.map(([, , name]) => name).sort(), names, 'the listener serves what the page loads, and nothing more');

  const staging = await read('../server/scripts/stage-resources.mjs');
  const staged = [.../const PANEL_FILES = \[([^\]]*)\];/.exec(staging)[1].matchAll(/'([^']+)'/g)].map(([, name]) => name);
  assert.deepEqual(staged.sort(), names, 'the bundle gets what the page loads, and nothing more');

  // Whatever else lies in the folder is a test.
  const others = (await readdir(new URL('./', import.meta.url))).filter(name => !files.has(name) && !name.startsWith('.'));
  assert.deepEqual(others.filter(name => !name.endsWith('.test.mjs')), []);
});

test('the page writes text and sets no markup', async () => {
  for (const [name, text] of await loaded()) {
    assert.doesNotMatch(text, /innerHTML|outerHTML|insertAdjacentHTML|document\.write|createContextualFragment|DOMParser|srcdoc/, name);
    assert.doesNotMatch(text, /\beval\s*\(|new Function|setAttribute/, name);
    // The policy of the page refuses a style or a handler that is written into the document.
    assert.doesNotMatch(text, /<style|\sstyle=|\.style\b|\son[a-z]+=|<script>|javascript:/i, name);
  }
});

test('every element that the page writes into exists in the document', async () => {
  const script = await read('./panel.js');
  // The script reaches the document through one function, by an id that is written out.
  assert.equal([...script.matchAll(/getElementById/g)].length, 1);
  assert.doesNotMatch(script, /querySelector|getElementsBy|document\.(?:body|forms|all|head)\b/);
  const asked = [...script.matchAll(/\belement\(([^)]*)\)/g)].map(([, argument]) => argument);
  for (const argument of asked) assert.match(argument, /^'[a-z-]+'$/, 'an element is asked for by its id, written out');
  const ids = new Set(asked.map(argument => argument.slice(1, -1)));
  assert.ok(ids.size > 20, `${ids.size} ids`);
  const inDocument = [...html.matchAll(/\sid="([^"]+)"/g)].map(([, id]) => id);
  assert.deepEqual(inDocument.filter((id, index) => inDocument.indexOf(id) !== index), [], 'no id is used twice');
  for (const id of ids) assert.ok(inDocument.includes(id), `the document has no element ${id}`);
  // An id is there for the script, or for another element of the document that points at it.
  const pointedAt = [...html.matchAll(/\s(?:for|aria-describedby|aria-labelledby)="([^"]+)"/g)].map(([, id]) => id);
  assert.deepEqual(inDocument.filter(id => !ids.has(id) && !pointedAt.includes(id)), []);
});

// ---- A stand-in for the browser ----

const VOID = ['meta', 'link', 'input', 'br'];

/**
 * An element as the page's script may use it. A value of another type than the browser keeps there is
 * a mistake that a browser would hide: `href = null` is a link to "null". A property that is not listed
 * here cannot be set at all.
 */
function node(tagName, attributes = {}, parent = null) {
  const made = { tagName, parent, id: attributes.id ?? '', attributes, children: [], listeners: {}, selected: false, clicked: [] };
  const typed = (name, type, initial) => {
    let value = initial;
    Object.defineProperty(made, name, { enumerable: true, get: () => value, set(next) {
      assert.equal(typeof next, type, `${made.id || tagName}.${name}`);
      if (name === 'textContent') assert.deepEqual(made.children, [], `${made.id || tagName} holds other elements, which a text would replace`);
      value = next;
    } });
  };
  typed('textContent', 'string', '');
  typed('value', 'string', attributes.value ?? '');
  typed('hidden', 'boolean', 'hidden' in attributes);
  typed('disabled', 'boolean', 'disabled' in attributes);
  typed('checked', 'boolean', 'checked' in attributes);
  if (tagName === 'details') typed('open', 'boolean', 'open' in attributes);
  if (tagName === 'a') typed('ariaDisabled', 'string', attributes['aria-disabled'] ?? 'false');
  typed('download', 'string', attributes.download ?? '');
  // An address that the document gives, or null where it gives none.
  let href = attributes.href ?? null;
  Object.defineProperty(made, 'href', { enumerable: true, get: () => href, set(next) {
    assert.equal(typeof next, 'string', `${made.id}.href`);
    href = next;
  } });
  Object.assign(made, {
    addEventListener(type, listener) { (made.listeners[type] ??= []).push(listener); },
    getAttribute(name) { return name === 'href' ? href : (attributes[name] ?? null); },
    removeAttribute(name) {
      assert.equal(name, 'href');
      href = null;
    },
    replaceChildren(...nodes) { made.children = nodes; },
    select() { made.selected = true; },
    focus() {},
    /** A click by the script: what a link would open, and under which name it would save it. */
    click() { made.clicked.push({ href, download: made.download }); },
  });
  return Object.seal(made);
}

/** The document of the page: its elements by id, and whether one is shown. */
function documentOf(source) {
  const byId = new Map();
  const created = [];
  let open = node('#document');
  for (const [, closing, tag, rest, text] of source.replace(/^<!doctype html>\n/, '').matchAll(/<(\/?)([a-z0-9]+)((?:\s[^>]*)?)>|([^<]+)/g)) {
    if (text !== undefined) {
      // The text of an element that holds nothing else; the script writes only into such elements.
      if (text.trim() && open.children.length === 0) open.textContent = text.trim();
    } else if (closing) {
      assert.equal(open.tagName, tag, 'the document closes what it opened');
      open = open.parent;
    } else {
      const attributes = Object.fromEntries([...rest.matchAll(/\s([a-z-]+)(?:="([^"]*)")?/g)].map(([, name, value]) => [name, value ?? '']));
      const made = node(tag, attributes, open);
      open.children.push(made);
      if (made.id) byId.set(made.id, made);
      if (!VOID.includes(tag)) open = made;
    }
  }
  assert.equal(open.tagName, '#document', 'every element is closed');
  const at = id => byId.get(id) ?? assert.fail(`the document has no element ${id}`);
  return {
    at, created,
    getElementById: id => byId.get(id) ?? null,
    createElement(tag) {
      created.push(tag);
      return node(tag);
    },
    /** An element is shown unless it, or an element around it, is hidden. */
    shown(id) {
      for (let element = at(id); element; element = element.parent) if (element.hidden) return false;
      return true;
    },
    controls: () => [...byId.values()].filter(element => ['button', 'input', 'a'].includes(element.tagName)).map(element => element.id),
  };
}

/** What the owner sees and can press: the text of each part that is shown, and the state of each control. */
function screen(document) {
  const { at, shown } = document;
  const text = id => (shown(id) ? at(id).textContent : null);
  const button = id => (shown(id) ? { label: at(id).textContent, enabled: !at(id).disabled } : null);
  const choice = id => (shown(id) ? { checked: at(id).checked, enabled: !at(id).disabled } : null);
  return {
    application: text('application'), headline: text('headline'), sentence: text('sentence'),
    unfinished: shown('setup-unfinished'), folder: text('folder'), noFolder: shown('no-folder'), game: text('game'),
    chooseFolder: button('choose-folder'), shared: choice('policy-shared-allowed'), local: choice('policy-local-only'),
    allContent: choice('progress-all'), original: choice('progress-original'), camera: choice('camera'), optionsNote: text('room-options-note'),
    start: button('start'), stop: button('stop'), newGame: button('new-game'),
    players: text('players'), inviteNote: text('invite-note'), invite: shown('invite-url') ? at('invite-url').value : null, copy: button('copy-invite'),
    openGame: shown('open-game') ? at('open-game').href : null,
    autoStart: choice('auto-start'),
    details: shown('details-list') ? at('details-list').children.map(child => `${child.tagName} ${child.textContent}`) : null,
    diagnostics: button('save-diagnostics'), quit: button('quit'),
  };
}

/** A page without a server shows its sentence and no control. */
const without = (sentence, headline = 'Not connected') => ({ application: 'Sled Storm Server', headline, sentence, unfinished: false, folder: null,
  noFolder: false, game: null, chooseFolder: null, shared: null, local: null, allContent: null, original: null, camera: null, optionsNote: null,
  start: null, stop: null, newGame: null, players: null, inviteNote: null, invite: null, copy: null, openGame: null, autoStart: null, details: null,
  diagnostics: null, quit: null });

/** The status as `GET /api/status` gives it, with a host in the given state. */
function report(state, host = {}) {
  return { application: 'Sled Storm Server', version: '1.2.0', instance: '0123456789abcdef', pid: 4242, startedAt: '2026-11-21T10:00:00.000Z',
    host: { state, problem: null, game: null, localUrl: null, gatewayPort: null, tunnel: 'off', mirror: 'off', room: 'off', players: null, ...host } };
}
const room = (state, host = {}) => report(state, { game: { pal: true, archiveBytes: 642_900_000, tracks: 2 }, localUrl: 'http://127.0.0.1:8000/',
  gatewayPort: 8100, tunnel: 'online', room: 'open', players: { connected: 1, reserved: 0 }, ...host });
const saved = (change = {}) => ({ gameFolder: null, discPolicy: null, autoStart: false, roomOptions: { progress: 'all', camera: true }, problem: null, ...change });
const chosen = (change = {}) => saved({ gameFolder: FOLDER, discPolicy: 'shared-allowed', ...change });
const ok = body => ({ status: 200, body });
const accepted = { status: 202, body: { host: report('idle').host } };
const refused = (status, error, more = {}) => ({ status, body: { error, ...more } });
const hosting = (host = {}) => ({ 'GET /api/status': ok(room('online', host)), 'GET /api/config': ok(chosen()),
  'GET /api/invitation': ok({ url: PUBLIC, localUrl: LOCAL }) });

/** A server that cannot be reached, as an entry of a table. */
const DOWN = Symbol('down');
const settled = () => new Promise(resolve => { setImmediate(resolve); });
function held() {
  let answer;
  const promise = new Promise(resolve => { answer = resolve; });
  return { promise, answer };
}

let pages = 0;

/**
 * Loads the page's script into a tab whose server answers from a table, and lets it connect and read once.
 * `hash` is the fragment of the address, `kept` the session that the tab holds from before. An entry of
 * the table is an answer, a function that gives one, or DOWN; an answer has a `body`, a `text` that is no JSON,
 * or is `cut` short after its status.
 */
async function opened(t, { hash = '', kept = null, table = {}, native = false } = {}) {
  const document = documentOf(html);
  const answers = { 'GET /api/status': ok(report('idle')), 'GET /api/config': ok(saved()), ...table };
  const requests = [];
  const due = [];
  const copied = [];
  const gameTabs = [];
  const state = { clipboard: true };
  const values = new Map(kept === null ? [] : [[KEY, kept]]);
  const window = {
    webkit: native ? { messageHandlers: { openGame: { postMessage: url => gameTabs.push(url) } } } : undefined,
    location: { pathname: '/', search: '', hash },
    history: { replaceState(_state, _title, url) { window.location.hash = new URL(url, 'http://127.0.0.1').hash; } },
    sessionStorage: { getItem: key => values.get(key) ?? null, setItem(key, value) { values.set(key, String(value)); }, removeItem(key) { values.delete(key); } },
    navigator: { clipboard: { async writeText(text) {
      if (!state.clipboard) throw new DOMException('Write permission denied.', 'NotAllowedError');
      copied.push(text);
    } } },
    setTimeout(run, ms) { due.push({ run, ms }); },
  };
  Object.assign(globalThis, { window, document });
  t.after(() => {
    delete globalThis.window;
    delete globalThis.document;
  });
  // The files that the page hands to the browser to save: each address stands for its blob until it is let go.
  const blobs = new Map();
  let made = 0;
  t.mock.method(URL, 'createObjectURL', blob => {
    const address = `blob:http://127.0.0.1/${++made}`;
    blobs.set(address, blob);
    return address;
  });
  t.mock.method(URL, 'revokeObjectURL', address => { blobs.delete(address); });
  t.mock.method(globalThis, 'fetch', async (path, init = {}) => {
    const method = init.method ?? 'GET';
    requests.push({ asked: init.body === undefined ? `${method} ${path}` : `${method} ${path} ${init.body}`, signal: init.signal ?? null,
      authorization: init.headers?.Authorization ?? null });
    // As the listener does: a body is read as JSON or not at all.
    let answer = init.body !== undefined && init.headers?.['Content-Type'] !== 'application/json' ? refused(415, 'Send the request as application/json.')
      : answers[`${method} ${path}`] ?? refused(404, 'Not found');
    if (typeof answer === 'function') answer = await answer(init);
    if (answer === DOWN) throw new TypeError('Failed to fetch');
    const text = async () => {
      if (answer.cut) throw new TypeError('network error');
      return answer.text ?? JSON.stringify(answer.body);
    };
    return { status: answer.status, text, json: async () => JSON.parse(await text()) };
  });
  await import(`./panel.js?page=${++pages}`);
  await settled();
  /**
   * A press, as far as the owner can make one: on a control that is shown and enabled. `detail` is the
   * browser's count of the click: 1 for a click, 2 for the second click of a double click, 0 for a key.
   */
  const fire = async (id, type, change = () => {}, detail = 1) => {
    const element = document.at(id);
    assert.ok(document.shown(id) && !element.disabled, `${id} can be pressed`);
    change(element);
    for (const listener of element.listeners[type] ?? []) listener({ target: element, detail, preventDefault() {} });
    await settled();
  };
  return {
    document, answers, requests, due, copied, state, values, window, blobs, gameTabs,
    get screen() { return screen(document); },
    /** What the server was asked since the last look. */
    taken: () => requests.splice(0).map(request => request.asked),
    press: (id, detail = 1) => fire(id, 'click', () => {}, detail),
    /** A radio button that is chosen: the browser moves the mark before the page hears of it. */
    choose: id => fire(id, 'change', element => {
      for (const other of element.parent.parent.children.flatMap(label => label.children)) if (other.attributes.name === element.attributes.name) other.checked = false;
      element.checked = true;
    }),
    toggle: id => fire(id, 'change', element => { element.checked = !element.checked; }),
    /** The text of a file that the page offered to save, while its address holds. */
    async file(address) {
      assert.ok(blobs.has(address), `${address} is held`);
      return blobs.get(address).text();
    },
    /** The next reading, a second later. */
    async later() {
      assert.deepEqual(due.map(timer => timer.ms), [1000], 'one reading is due, a second after the last');
      due.shift().run();
      await settled();
    },
  };
}

// ---- The page ----

test('the configured window shows a live count and Join Room without settings', async t => {
  const page = await opened(t, { kept: SESSION, table: hosting(), native: true });
  await page.press('multiplayer');
  const { at } = page.document;
  assert.equal(page.document.shown('settings'), false);
  assert.equal(at('settings').open, false);
  assert.equal(page.document.shown('choose-folder'), false);
  assert.equal(at('open-game').textContent, 'Join Room');
  assert.equal(at('open-game').ariaDisabled, 'false');
  assert.deepEqual(page.gameTabs, []);
  await page.press('copy-room-invite');
  assert.deepEqual(page.copied, [PUBLIC]);
  page.state.clipboard = false;
  await page.press('copy-room-invite');
  assert.equal(page.document.shown('invite-url'), true);
  assert.equal(at('invite-url').selected, true);
  await page.press('open-game');
  assert.deepEqual(page.gameTabs, [LOCAL]);
  Object.assign(page.answers, hosting({ players: { connected: 2, reserved: 1 } }));
  await page.later();
  assert.equal(at('players').textContent, '2');
  assert.equal(at('settings').open, false);
  assert.deepEqual(page.gameTabs, [LOCAL]);
  page.answers['GET /api/status'] = ok(room('starting', { room: 'starting' }));
  await page.later();
  assert.equal(at('open-game').ariaDisabled, 'true');
  assert.equal(at('open-game').href, null);
});

test('the first-run window exposes the game folder and disc policy only until setup is complete', async t => {
  const page = await opened(t, { kept: SESSION, native: true });
  await page.press('multiplayer');
  const { shown } = page.document;
  assert.equal(shown('choose-folder'), true);
  assert.equal(shown('policy-local-only'), true);
  assert.equal(shown('room-options'), true);
  assert.equal(shown('camera'), false);
  assert.equal(shown('auto-start'), false);
  page.answers['GET /api/config'] = ok(chosen());
  await page.later();
  assert.equal(shown('choose-folder'), false);
  assert.equal(page.screen.start.enabled, true);

  page.answers['GET /api/status'] = ok(report('failed', { problem: { component: 'game-data', message: 'Game files missing.' } }));
  await page.later();
  assert.equal(shown('choose-folder'), true);
  assert.equal(shown('room-options'), true);
});

test('the native launcher starts in a mode chooser and opens the local solo page without hosting', async t => {
  const page = await opened(t, { kept: SESSION, native: true, table: {
    'GET /api/config': ok(chosen()), 'POST /api/solo/start': ok({ url: 'http://127.0.0.1:8000/solo' }),
  } });
  assert.equal(page.document.shown('solo'), true);
  assert.equal(page.document.shown('multiplayer'), true);
  page.taken();
  await page.press('solo');
  assert.deepEqual(page.gameTabs, ['http://127.0.0.1:8000/solo']);
  assert.ok(page.taken().includes('POST /api/solo/start'));
  assert.equal(page.document.shown('start'), false);
});

test('before its script runs, the document says that it is connecting and offers nothing', () => {
  const document = documentOf(html);
  assert.deepEqual(screen(document), without('Connecting to the server…', ''));
  for (const id of document.controls()) assert.ok(!document.shown(id), id);
  assert.deepEqual([document.at('open-game').attributes.target, document.at('open-game').attributes.rel, document.at('open-game').href],
    ['_blank', 'noopener noreferrer', null], 'the game opens in a tab that knows nothing of this one');
  assert.ok('readonly' in document.at('invite-url').attributes);
  for (const id of document.controls()) if (document.at(id).tagName === 'button') assert.equal(document.at(id).attributes.type, 'button', id);
});

test('the second disc policy says what it means for the players, not that it cannot host', () => {
  const note = documentOf(html).at('local-only-note').textContent;
  assert.doesNotMatch(note, /cannot host|not available|yet/i);
  // The guest's page offers the two choices of the brief's §11.2 that this policy leaves (D87).
  assert.match(note, /choose their own game files or a saved ZIP/);
  // A copy of the host's CUE and BIN files, or one ZIP of them, which their page reads and checks itself (DATA-03).
  assert.match(note, /CUE and BIN files/);
  assert.match(note, /or one ZIP of them/);
  // The room's identity counts each file's name; a guest's page takes any disc the server takes (D75).
  assert.match(note, /same names/);
  assert.doesNotMatch(note, /eleven|Europe/);
  assert.match(note, /this computer/);
});

test('the page that the application opened trades its token and shows a new installation', async t => {
  const page = await opened(t, { hash: `#bootstrap=${TOKEN}`, table: {
    'POST /api/session': { status: 201, body: { session: SESSION } },
    'GET /api/status': ok(report('needs_setup', { problem: { component: 'config', message: SETUP } })),
    'GET /api/config': ok(saved({ autoStart: true })),
  } });
  assert.equal(page.window.location.hash, '', 'the token has left the address');
  assert.deepEqual([...page.values], [[KEY, SESSION]]);
  assert.deepEqual(page.requests.map(request => [request.asked, request.authorization]), [
    [`POST /api/session {"bootstrap":"${TOKEN}"}`, null], ['GET /api/status', `Bearer ${SESSION}`], ['GET /api/config', `Bearer ${SESSION}`]]);
  assert.deepEqual(page.screen, {
    application: 'Sled Storm Server', headline: 'Needs setup', sentence: SETUP,
    unfinished: true, folder: null, noFolder: true, game: null,
    chooseFolder: { label: 'Choose game folder', enabled: true }, shared: { checked: false, enabled: true }, local: { checked: false, enabled: true },
    allContent: { checked: true, enabled: true }, original: { checked: false, enabled: true }, camera: { checked: true, enabled: true }, optionsNote: PAL_ONLY,
    start: { label: 'Start Server', enabled: false }, stop: { label: 'Stop Server', enabled: false }, newGame: null,
    players: '0', inviteNote: null, invite: null, copy: null, openGame: null,
    autoStart: { checked: true, enabled: true },
    details: DETAILS,
    diagnostics: { label: 'Save diagnostics', enabled: true }, quit: { label: 'Quit server', enabled: true },
  });
});

test('an open room shows its players and its links, and a link that is gone leaves the page', async t => {
  const page = await opened(t, { kept: SESSION, table: hosting() });
  assert.deepEqual(page.taken(), ['GET /api/status', 'GET /api/config', 'GET /api/invitation']);
  const online = {
    application: 'Sled Storm Server', headline: 'Online', sentence: null,
    unfinished: false, folder: FOLDER, noFolder: false, game: 'Sled Storm (PAL), 2 tracks, 613 MB',
    chooseFolder: { label: 'Choose game folder', enabled: false }, shared: { checked: true, enabled: false }, local: { checked: false, enabled: false },
    allContent: { checked: true, enabled: false }, original: { checked: false, enabled: false }, camera: { checked: true, enabled: false }, optionsNote: PAL_ONLY,
    start: { label: 'Start Server', enabled: false }, stop: { label: 'Stop Server', enabled: true }, newGame: { label: 'New game', enabled: true },
    players: '1', inviteNote: null, invite: PUBLIC, copy: { label: 'Copy invite link', enabled: true }, openGame: LOCAL,
    autoStart: { checked: false, enabled: true },
    details: ['dt Version', 'dd 1.2.0', 'dt Room', 'dd open', 'dt Public address', 'dd online', 'dt Second address', 'dd off'],
    diagnostics: { label: 'Save diagnostics', enabled: true }, quit: { label: 'Quit server', enabled: true },
  };
  assert.deepEqual(page.screen, online);

  // The public address fails: the guests' link goes, and the game on this computer stays.
  Object.assign(page.answers, { 'GET /api/status': ok(room('degraded', { tunnel: 'failed', problem: { component: 'tunnel', message: NO_ADDRESS } })),
    'GET /api/invitation': ok({ url: null, localUrl: LOCAL }) });
  await page.later();
  assert.deepEqual(page.screen, { ...online, headline: 'Running, with a problem', sentence: NO_ADDRESS, start: { label: 'Start Server', enabled: true },
    inviteNote: 'The public address is not available.', invite: null, copy: null,
    details: ['dt Version', 'dd 1.2.0', 'dt Room', 'dd open', 'dt Public address', 'dd failed', 'dt Second address', 'dd off'] });
  assert.equal(page.document.at('invite-url').value, '', 'a link that is not offered is not kept in the page');

  // The room is stopped: nothing of it stays.
  Object.assign(page.answers, { 'GET /api/status': ok(report('idle')) });
  await page.later();
  assert.deepEqual(page.screen, { ...online, headline: 'Stopped', game: null, chooseFolder: { label: 'Choose game folder', enabled: true },
    shared: { checked: true, enabled: true }, local: { checked: false, enabled: true }, allContent: { checked: true, enabled: true },
    original: { checked: false, enabled: true }, camera: { checked: true, enabled: true }, start: { label: 'Start Server', enabled: true }, stop: { label: 'Stop Server', enabled: false },
    newGame: null, players: '0', invite: null, copy: null, openGame: null, details: DETAILS });
  assert.equal(page.document.at('open-game').href, null);
  assert.ok(!page.document.shown('room'));
});

test('each control asks the server once, and the answer decides what the page shows', async t => {
  const page = await opened(t, { kept: SESSION, table: { 'GET /api/config': ok(chosen()) } });
  const reading = ['GET /api/status', 'GET /api/config'];
  assert.deepEqual(page.taken(), reading);

  // The folder: the request names none, has no end of its own, and holds every other button meanwhile.
  const dialog = held();
  page.answers['POST /api/game-folder/pick'] = () => dialog.promise;
  await page.press('choose-folder');
  assert.deepEqual(page.requests.map(request => [request.asked, request.signal, request.authorization]), [['POST /api/game-folder/pick', null, `Bearer ${SESSION}`]]);
  assert.deepEqual([page.screen.sentence, page.screen.chooseFolder.enabled, page.screen.start.enabled, page.screen.shared.enabled, page.screen.camera.enabled,
    page.screen.diagnostics.enabled], ['The folder dialog is open. Look for it among the windows.', false, false, false, false, false]);
  // Quit is let through: it ends the dialog.
  assert.deepEqual(page.screen.quit, { label: 'Quit server', enabled: true });
  dialog.answer(ok({ picked: false, config: chosen() }));
  await settled();
  assert.deepEqual(page.taken(), ['POST /api/game-folder/pick', ...reading]);
  assert.deepEqual([page.screen.sentence, page.screen.chooseFolder.enabled, page.screen.start.enabled], [null, true, true]);

  // A policy that the server does not take goes back to the one that is saved.
  page.answers['PUT /api/config'] = refused(409, 'Stop the room before changing the game folder or the disc policy.');
  await page.choose('policy-local-only');
  assert.deepEqual(page.taken(), ['PUT /api/config {"discPolicy":"local-only"}', ...reading]);
  assert.deepEqual([page.screen.sentence, page.screen.shared.checked, page.screen.local.checked],
    ['Stop the room before changing the game folder or the disc policy.', true, false]);
  // One that it takes is shown from what the server then says.
  page.answers['PUT /api/config'] = ok(chosen({ discPolicy: 'local-only' }));
  page.answers['GET /api/config'] = ok(chosen({ discPolicy: 'local-only' }));
  await page.choose('policy-local-only');
  assert.deepEqual([page.screen.sentence, page.screen.shared.checked, page.screen.local.checked], [null, false, true]);
  await page.choose('policy-shared-allowed');
  assert.deepEqual(page.taken(), ['PUT /api/config {"discPolicy":"local-only"}', ...reading, 'PUT /api/config {"discPolicy":"shared-allowed"}', ...reading]);

  page.answers['GET /api/config'] = ok(chosen({ autoStart: true }));
  await page.toggle('auto-start');
  assert.deepEqual(page.taken(), ['PUT /api/config {"autoStart":true}', ...reading]);
  assert.deepEqual(page.screen.autoStart, { checked: true, enabled: true });
  await page.toggle('auto-start');
  assert.deepEqual(page.taken(), ['PUT /api/config {"autoStart":false}', ...reading]);

  // The room's options: a choice of either is one request with both.
  page.answers['PUT /api/config'] = ok(chosen({ roomOptions: { progress: 'original', camera: true } }));
  page.answers['GET /api/config'] = ok(chosen({ roomOptions: { progress: 'original', camera: true } }));
  await page.choose('progress-original');
  assert.deepEqual(page.taken(), ['PUT /api/config {"roomOptions":{"progress":"original","camera":true}}', ...reading]);
  assert.deepEqual([page.screen.allContent.checked, page.screen.original.checked], [false, true]);
  // One that the server refuses goes back to what is saved.
  page.answers['PUT /api/config'] = refused(409, "Stop the room before changing the room's options.");
  await page.toggle('camera');
  assert.deepEqual(page.taken(), ['PUT /api/config {"roomOptions":{"progress":"original","camera":false}}', ...reading]);
  assert.deepEqual([page.screen.camera.checked, page.screen.sentence], [true, "Stop the room before changing the room's options."]);
  page.answers['GET /api/config'] = ok(chosen());

  page.answers['POST /api/host/start'] = accepted;
  await page.press('start');
  assert.deepEqual(page.taken(), ['POST /api/host/start', ...reading]);

  // A room with a player in it: the stop is a question first, and the second press says force.
  Object.assign(page.answers, hosting(), { 'POST /api/room/stop': init => (init.body ? accepted
    : refused(409, 'Players are in the room.', { players: { connected: 1, reserved: 0 } })) });
  await page.later();
  page.taken();
  await page.press('stop');
  assert.deepEqual(page.taken(), ['POST /api/room/stop', ...reading, 'GET /api/invitation']);
  assert.deepEqual([page.screen.stop, page.screen.sentence], [{ label: 'Stop anyway', enabled: true },
    'Players are in the room: 1 connected, 0 away with a controller kept. Stop it anyway?']);
  await page.press('stop');
  assert.deepEqual(page.taken(), ['POST /api/room/stop {"force":true}', ...reading, 'GET /api/invitation']);

  // So is a new game.
  page.answers['POST /api/room/new-game'] = init => (init.body ? accepted : refused(409, 'Players are in the room.', { players: { connected: 1, reserved: 0 } }));
  await page.press('new-game');
  assert.deepEqual(page.taken(), ['POST /api/room/new-game', ...reading, 'GET /api/invitation']);
  assert.deepEqual([page.screen.newGame, page.screen.sentence], [{ label: 'New game anyway', enabled: true },
    'Players are in the room: 1 connected, 0 away with a controller kept. A new game disconnects them. Start one anyway?']);
  await page.press('new-game');
  assert.deepEqual(page.taken(), ['POST /api/room/new-game {"force":true}', ...reading, 'GET /api/invitation']);
  assert.deepEqual([page.screen.newGame, page.screen.sentence], [{ label: 'New game', enabled: true },
    'A new game is starting in the same room. The links stay the same.']);

  // The diagnostic report becomes a file that the browser saves.
  const report = { application: 'Sled Storm Server', generatedAt: '2026-11-21T14:05:09.123Z' };
  page.answers['POST /api/diagnostics/export'] = ok(report);
  await page.press('save-diagnostics');
  assert.deepEqual(page.taken(), ['POST /api/diagnostics/export', ...reading, 'GET /api/invitation']);
  assert.equal(page.screen.sentence, 'The browser saves the diagnostic report as sled-storm-server-diagnostics-2026-11-21.json.');

  // So is a quit, from the server's answer. After it the page asks nothing more and offers nothing.
  page.answers['POST /api/host/quit'] = init => (init.body ? { status: 202, body: { quitting: true } }
    : refused(409, 'Players are in the room.', { players: { connected: 1, reserved: 0 } }));
  await page.press('quit');
  assert.deepEqual(page.taken(), ['POST /api/host/quit', ...reading, 'GET /api/invitation']);
  assert.deepEqual([page.screen.quit, page.screen.sentence], [{ label: 'Quit anyway', enabled: true },
    'Players are in the room: 1 connected, 0 away with a controller kept. Quit anyway?']);
  await page.press('quit');
  assert.deepEqual(page.taken(), ['POST /api/host/quit {"force":true}']);
  assert.deepEqual(page.screen, without('The server has quit. Open Sled Storm Server to start it again.'));
  for (const id of page.document.controls()) assert.ok(!page.document.shown(id), id);
  page.due.shift().run();
  await settled();
  assert.deepEqual([page.taken(), page.due], [[], []]);
  assert.deepEqual([...page.values], [[KEY, SESSION]], 'the tab keeps its session');
});

test('a double click on Stop, New game or Quit with players in the room asks, and does not answer its own question', async t => {
  const asking = answer => init => (init.body ? answer : refused(409, 'Players are in the room.', { players: { connected: 1, reserved: 0 } }));
  const page = await opened(t, { kept: SESSION, table: { ...hosting(), 'POST /api/host/quit': asking({ status: 202, body: { quitting: true } }),
    'POST /api/room/stop': asking(accepted), 'POST /api/room/new-game': asking(accepted) } });
  const reading = ['GET /api/status', 'GET /api/config', 'GET /api/invitation'];
  page.taken();

  // The two clicks of a double click land on the same place; the question is under the second one.
  await page.press('stop', 1);
  assert.deepEqual(page.taken(), ['POST /api/room/stop', ...reading]);
  await page.press('stop', 2);
  assert.deepEqual(page.taken(), [], 'the second click of a double click is no answer');
  assert.deepEqual([page.screen.stop, page.screen.sentence], [{ label: 'Stop anyway', enabled: true },
    'Players are in the room: 1 connected, 0 away with a controller kept. Stop it anyway?']);

  await page.press('new-game', 1);
  await page.press('new-game', 2);
  assert.deepEqual(page.taken(), ['POST /api/room/new-game', ...reading]);
  assert.equal(page.screen.newGame.label, 'New game anyway');

  await page.press('quit', 1);
  await page.press('quit', 2);
  assert.deepEqual(page.taken(), ['POST /api/host/quit', ...reading]);
  assert.deepEqual([page.screen.quit, page.screen.sentence], [{ label: 'Quit anyway', enabled: true },
    'Players are in the room: 1 connected, 0 away with a controller kept. Quit anyway?']);
  // A key that is held down repeats; the browser would press the button again with each repeat.
  for (const id of ['choose-folder', 'start', 'stop', 'new-game', 'save-diagnostics', 'quit', 'copy-invite']) {
    const kept = [];
    for (const repeat of [false, true]) {
      let prevented = false;
      for (const listener of page.document.at(id).listeners.keydown ?? []) listener({ target: page.document.at(id), key: 'Enter', repeat, preventDefault() { prevented = true; } });
      kept.push(prevented);
    }
    assert.deepEqual(kept, [false, true], `${id}: a key presses once however long it is held`);
  }
  // A key presses with a count of 0, and answers the question.
  await page.press('quit', 0);
  assert.deepEqual(page.taken(), ['POST /api/host/quit {"force":true}']);
  assert.equal(page.screen.sentence, 'The server has quit. Open Sled Storm Server to start it again.');
});

test('the guests\' link is copied, or selected when the browser refuses', async t => {
  const page = await opened(t, { kept: SESSION, table: hosting() });
  page.taken();
  await page.press('copy-invite');
  assert.deepEqual([page.copied, page.screen.sentence, page.document.at('invite-url').selected], [[PUBLIC], 'The link is copied.', false]);
  page.state.clipboard = false;
  await page.press('copy-invite');
  assert.deepEqual([page.copied, page.screen.sentence, page.document.at('invite-url').selected], [[PUBLIC], 'Select the link and copy it.', true]);
  assert.deepEqual(page.taken(), [], 'copying asks nothing of the server');
});

test('the diagnostic report is saved through the page\'s own link, and only the last file is held', async t => {
  const first = { application: 'Sled Storm Server', generatedAt: '2026-11-21T14:05:09.123Z', log: ['<script>alert(1)</script>'] };
  const page = await opened(t, { kept: SESSION, table: { 'POST /api/diagnostics/export': ok(first) } });
  const link = page.document.at('diagnostics-file');
  assert.ok(!page.document.shown('diagnostics-file'), 'the link is not a control of its own');
  await page.press('save-diagnostics');
  assert.equal(link.clicked.length, 1);
  const [{ href, download }] = link.clicked;
  assert.equal(download, 'sled-storm-server-diagnostics-2026-11-21.json');
  assert.equal(await page.file(href), `${JSON.stringify(first, null, 2)}\n`);
  assert.equal(page.blobs.get(href).type, 'application/json');

  // The next report lets go of the one before.
  page.answers['POST /api/diagnostics/export'] = ok({ ...first, generatedAt: '2026-11-22T00:00:00.000Z' });
  await page.press('save-diagnostics');
  assert.equal(link.clicked.length, 2);
  assert.equal(link.clicked[1].download, 'sled-storm-server-diagnostics-2026-11-22.json');
  assert.deepEqual([...page.blobs.keys()], [link.clicked[1].href]);
  assert.deepEqual([...new Set(page.document.created)].sort(), ['dd', 'dt'], 'the page makes no element for it, only the lines of its details');
});

test('a tab without a session, or with one that the server no longer knows, is not connected', async t => {
  // A tab that was opened by hand, or loaded again in a browser that kept nothing: nothing is asked.
  const stray = await opened(t);
  assert.deepEqual([stray.taken(), stray.due], [[], []]);
  assert.deepEqual(stray.screen, without(NOT_CONNECTED));

  // A link that was used before.
  const late = await opened(t, { hash: `#bootstrap=${TOKEN}`, kept: SESSION, table: { 'POST /api/session': refused(401, 'This link to the panel has expired.') } });
  assert.deepEqual([late.taken(), late.due, [...late.values], late.window.location.hash], [[`POST /api/session {"bootstrap":"${TOKEN}"}`], [], [], '']);
  assert.deepEqual(late.screen, without(NOT_CONNECTED));

  // A server that was started anew: the tab lets go of the session, and a reload asks nothing.
  const old = await opened(t, { kept: SESSION, table: { 'GET /api/status': refused(401, 'Authorization required') } });
  assert.deepEqual([old.taken(), old.due, [...old.values]], [['GET /api/status'], [], []]);
  assert.deepEqual(old.screen, without(NOT_CONNECTED));
});

test('a reading gives up after five seconds, and the page finds its server again', async t => {
  const bounds = [];
  t.mock.method(AbortSignal, 'timeout', ms => {
    const controller = new AbortController();
    bounds.push({ ms, controller });
    return controller.signal;
  });
  // A server that takes the request and never answers it.
  const silent = init => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });
  const page = await opened(t, { kept: SESSION, table: { 'GET /api/status': silent } });
  assert.deepEqual(page.screen, without('Connecting to the server…', ''), 'nothing is known yet');
  assert.deepEqual(bounds.map(bound => bound.ms), [5000]);
  assert.equal(page.requests[0].signal, bounds[0].controller.signal);
  bounds[0].controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
  await settled();
  assert.deepEqual(page.screen, without(NOT_RUNNING));

  page.answers['GET /api/status'] = ok(report('idle'));
  await page.later();
  assert.equal(page.screen.headline, 'Needs setup');
  assert.deepEqual(page.taken(), ['GET /api/status', 'GET /api/status', 'GET /api/config']);
  assert.deepEqual(bounds.map(bound => bound.ms), [5000, 5000, 5000], 'every reading has its bound, and only a reading');

  // A server that is gone, an answer that is cut short, and one that is no JSON.
  page.answers['GET /api/status'] = DOWN;
  await page.later();
  assert.deepEqual(page.screen, without(NOT_RUNNING));
  page.answers['GET /api/status'] = { status: 200, cut: true };
  await page.later();
  assert.deepEqual(page.screen, without(NOT_RUNNING));
  page.answers['GET /api/status'] = { status: 502, text: '<html>Bad gateway</html>' };
  await page.later();
  assert.deepEqual(page.screen, without('The server gave an answer that this page cannot read.'));
  page.answers['GET /api/status'] = ok(report('idle'));
  await page.later();
  assert.equal(page.screen.headline, 'Needs setup');
});

test('markup that the server sends is text in the page', async t => {
  const markup = '<img src=x onerror=alert(1)><script>alert(2)</script>';
  const page = await opened(t, { kept: SESSION, table: {
    'GET /api/status': ok({ ...room('online', { problem: { component: 'tunnel', message: markup }, players: { connected: markup, reserved: 0 }, room: markup }),
      application: markup, version: markup }),
    'GET /api/config': ok(chosen({ gameFolder: `/Users/owner/${markup}` })),
    'GET /api/invitation': ok({ url: `https://example.test/${markup}`, localUrl: `javascript:${markup}` }),
  } });
  const { screen: shown } = page;
  assert.deepEqual([shown.application, shown.sentence, shown.folder, shown.players, shown.invite, shown.openGame, shown.details.slice(0, 4)],
    [markup, markup, `/Users/owner/${markup}`, '0', `https://example.test/${markup}`, null,
      ['dt Version', `dd ${markup}`, 'dt Room', `dd ${markup}`]]);
  assert.deepEqual([...new Set(page.document.created)].sort(), ['dd', 'dt'], 'the page makes no element but the lines of its details');
});
