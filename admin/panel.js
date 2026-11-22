// The panel's page: it connects, hands the controller its way to the server,
// and writes each view into the document. What is shown and what a button
// does is decided in view.js and controller.js; nothing here knows a rule of
// the server. Whatever the server sent reaches the document as text.
// Closing the page stops nothing: the server runs until it is told to quit.
import { createPanel } from './controller.js';
import { api, forgetSession, openSession, takeBootstrap } from './session.js';

/** How long a reading waits for its answer before the page takes the server for gone. */
const PATIENCE = 5000;

const element = id => document.getElementById(id);

/** This tab's own storage, or null in a browser that gives the page none. */
function tabStorage() {
  try { return window.sessionStorage; } catch { return null; }
}

/** Writes a property only when it changes, so that a reading that found nothing new leaves the document alone. */
function set(target, property, value) {
  if (target[property] !== value) target[property] = value;
}
const show = (target, shown) => set(target, 'hidden', !shown);
/** A line of text, or nothing in its place. */
function write(target, text) {
  set(target, 'textContent', text ?? '');
  show(target, text !== null);
}
/** A button with the state and the words that the view gives it, or none. */
function button(target, part) {
  show(target, part !== null && part.shown !== false);
  set(target, 'disabled', !part?.enabled);
  if (part?.label) set(target, 'textContent', part.label);
}
/** A radio button or a switch. It is written at every reading, so a press that the server refused goes back by itself. */
function choice(target, checked, enabled) {
  set(target, 'checked', checked);
  set(target, 'disabled', !enabled);
}

/** The details as they were last written: their lines are made anew only when they change. */
let listed = '[]';

function render(view, page, manualInvite) {
  const native = page !== null;
  const home = page === 'home';
  const settings = page === 'settings';
  set(element('application'), 'textContent', view.application);
  set(element('headline'), 'textContent', view.headline);
  show(element('headline'), !home || view.setup === null);
  write(element('sentence'), view.sentence);

  const { setup } = view;
  show(element('mode-chooser'), home && setup !== null);
  set(element('solo'), 'disabled', view.diagnostics?.enabled !== true);
  set(element('multiplayer'), 'disabled', view.diagnostics?.enabled !== true);
  write(element('disc-summary'), setup?.folder && !setup.problem ? `Disc: ${setup.folder.split('/').filter(Boolean).at(-1)}` : 'Choose a folder in Settings or select files in the game.');
  show(element('navigation'), native && setup !== null);
  show(element('back'), !home);
  show(element('show-settings'), !settings);
  show(element('settings'), setup !== null && (!native || settings));
  if (native) set(element('settings'), 'open', settings);
  show(element('setup'), setup !== null && (!native || settings));
  show(element('setup-unfinished'), setup?.unfinished === true);
  show(element('no-folder'), setup !== null && setup.folder === null);
  write(element('folder'), setup?.folder ?? null);
  write(element('game'), view.game);
  set(element('choose-folder'), 'disabled', setup?.locked !== false);
  choice(element('policy-shared-allowed'), setup?.policy === 'shared-allowed', setup?.locked === false);
  choice(element('policy-local-only'), setup?.policy === 'local-only', setup?.locked === false);

  const { options } = view;
  show(element('room-options'), options !== null);
  choice(element('progress-all'), options?.progress === 'all', options?.locked === false);
  choice(element('progress-original'), options?.progress === 'original', options?.locked === false);
  show(element('room-camera-setting'), !native);
  choice(element('camera'), options?.camera === true, options?.locked === false);
  write(element('room-options-note'), options === null ? null : native
    ? 'Unlocked content requires the verified PAL disc.'
    : options.note);

  button(element('start'), view.start);
  button(element('stop'), view.stop);
  button(element('new-game'), view.newGame);
  show(element('hosting'), view.start !== null && (!native || page === 'room'));

  const url = view.invite?.url ?? null;
  const note = view.invite?.note ?? null;
  write(element('players'), view.players);
  show(element('players-line'), view.players !== null && (!native || page === 'room'));
  show(element('copy-room-invite'), page === 'room' && url !== null);
  write(element('public-status'), page === 'room' ? note : null);
  write(element('invite-note'), note);
  // A link that is not offered is not kept either.
  set(element('invite-url'), 'value', url ?? '');
  show(element('invite'), url !== null && (!native || (page === 'room' && manualInvite)));
  if (view.openGame === null) element('open-game').removeAttribute('href');
  else set(element('open-game'), 'href', view.openGame);
  set(element('open-game'), 'ariaDisabled', String(view.openGame === null));
  show(element('open-game'), view.start !== null);
  show(element('room'), !native && (view.newGame?.shown === true || url !== null || note !== null));

  show(element('options'), !native && view.autoStart !== null);
  choice(element('auto-start'), view.autoStart?.checked === true, view.autoStart?.enabled === true);

  const details = JSON.stringify(view.details);
  if (details !== listed) {
    listed = details;
    element('details-list').replaceChildren(...view.details.flatMap(([name, value]) => {
      const term = document.createElement('dt');
      term.textContent = name;
      const description = document.createElement('dd');
      description.textContent = value;
      return [term, description];
    }));
  }
  show(element('details'), !native && view.details.length > 0);

  button(element('save-diagnostics'), view.diagnostics);
  button(element('quit'), view.quit);
  show(element('closing'), view.quit !== null);
}

/** The address of the last file that the page offered to save. The browser holds its contents until it is let go. */
let offered = null;

/** Hands a file to the browser to save, through the page's own link: the page makes no element for it. */
function saveFile(name, text) {
  if (offered !== null) URL.revokeObjectURL(offered);
  offered = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = element('diagnostics-file');
  set(link, 'href', offered);
  set(link, 'download', name);
  link.click();
}

async function connect() {
  const storage = tabStorage();
  // First of all: the token must not stay in the address.
  const bootstrap = takeBootstrap(window.location, window.history);
  const session = await openSession({ fetch: (path, init) => fetch(path, init), storage, bootstrap });

  /** A request as this tab's session: the answer's status and its JSON, or null for a body that is none. */
  async function ask(path, init = {}) {
    // The server answers a request without a session with 401, so none is sent.
    if (session === null) return { status: 401, body: null };
    // A reading is asked again a second later, so it may give up. A button's request waits for its
    // answer: the folder's lasts as long as its dialog is open.
    const reading = (init.method ?? 'GET') === 'GET';
    const response = await api(session, path, reading ? { ...init, signal: AbortSignal.timeout(PATIENCE) } : init);
    // An answer that is cut short was not given: that rejects, like a server that cannot be reached.
    const text = await response.text();
    try {
      return { status: response.status, body: JSON.parse(text) };
    } catch {
      return { status: response.status, body: null };
    }
  }

  const browser = window.webkit?.messageHandlers?.openGame;
  const pasteboard = window.webkit?.messageHandlers?.copyInvite;
  let page = browser ? 'home' : null;
  let manualInvite = false;
  let startAfterSetup = false;
  let currentView;
  function select(next) {
    page = next;
    manualInvite = false;
    if (currentView) display(currentView);
  }
  function display(view) {
    currentView = view;
    if (startAfterSetup && view.start?.enabled && !view.setup?.repair) {
      startAfterSetup = false;
      page = 'room';
      queueMicrotask(() => { if (page === 'room') void panel.start(); });
    }
    if (page === 'room' && view.setup?.repair) {
      startAfterSetup = true;
      page = 'settings';
    }
    if (!view.invite?.url) manualInvite = false;
    render(view, page, manualInvite);
  }
  const panel = createPanel({
    ask,
    render: display,
    openGame: browser ? url => browser.postMessage(url) : undefined,
    wait: ms => new Promise(resolve => { window.setTimeout(resolve, ms); }),
    clipboard: text => pasteboard ? pasteboard.postMessage(text) : window.navigator.clipboard.writeText(text),
    lost: () => forgetSession(storage),
    save: saveFile,
  });

  // A press is one click. The clicks that follow it in a double click are no presses of their own: the
  // second would land on the question that the first one asked ("Stop anyway", "Quit anyway") and answer it.
  // A key presses with a count of 0, and once however long it is held: its repeats are not let through.
  const onPress = (button, action) => {
    button.addEventListener('click', event => {
      if (event.detail > 1) return;
      action();
    });
    button.addEventListener('keydown', event => {
      if (event.repeat) event.preventDefault();
    });
  };
  onPress(element('solo'), () => panel.solo());
  onPress(element('multiplayer'), () => {
    if (currentView?.stop?.enabled || currentView?.openGame) {
      select('room');
      return;
    }
    startAfterSetup = true;
    select('settings');
  });
  onPress(element('back'), () => { startAfterSetup = false; select('home'); });
  onPress(element('show-settings'), () => select('settings'));
  onPress(element('copy-room-invite'), async () => {
    manualInvite = !await panel.copyInvite();
    display(currentView);
    if (manualInvite && element('invite-url').value) {
      element('invite-url').focus();
      element('invite-url').select();
    }
  });
  onPress(element('choose-folder'), () => panel.chooseFolder());
  for (const policy of [element('policy-shared-allowed'), element('policy-local-only')])
    policy.addEventListener('change', event => panel.setPolicy(event.target.value));
  element('auto-start').addEventListener('change', event => panel.setAutoStart(event.target.checked));
  for (const progress of [element('progress-all'), element('progress-original')])
    progress.addEventListener('change', event => panel.setOptions({ progress: event.target.value }));
  element('camera').addEventListener('change', event => panel.setOptions({ camera: event.target.checked }));
  onPress(element('start'), () => panel.start());
  onPress(element('stop'), () => panel.stop());
  if (browser) element('open-game').addEventListener('click', event => {
    event.preventDefault();
    const link = element('open-game');
    if (link.getAttribute('href') && event.detail <= 1) browser.postMessage(link.href);
  });
  onPress(element('new-game'), () => panel.newGame());
  onPress(element('save-diagnostics'), () => panel.saveDiagnostics());
  onPress(element('quit'), () => panel.quit());
  onPress(element('copy-invite'), async () => {
    // Where the browser does not let the page copy, the link is ready to be copied by hand.
    if (await panel.copyInvite() || element('invite-url').value === '') return;
    element('invite-url').focus();
    element('invite-url').select();
  });

  await panel.run();
}

connect();
