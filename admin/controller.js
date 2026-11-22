// How the panel follows its server, and what its buttons do. The page asks
// once a second for the status, the configuration and, while a room may
// exist, the invitation. A button sends one request, and what the server
// answers decides what is shown: the page keeps no state of the host of its
// own. Nothing here touches the document; `render` is given the view of
// `view.js`.
import { disconnected, inTheRoom, panelView } from './view.js';

const NOT_CONNECTED = 'This page is not connected to the server. Open Sled Storm Server again.';
// The server may be gone, or running anew on another port that this tab does not know.
const NOT_RUNNING = 'This page cannot reach the server. Open Sled Storm Server to start it or to reach it again.';
const HAS_QUIT = 'The server has quit. Open Sled Storm Server to start it again.';
const UNREADABLE = 'The server gave an answer that this page cannot read.';
const NO_ANSWER = 'The server did not answer. Try again.';
const COPIED = 'The link is copied.';
const COPY_BY_HAND = 'Select the link and copy it.';
const NEW_GAME = 'A new game is starting in the same room. The links stay the same.';
const NOT_SAVED = 'The diagnostic report could not be saved.';
/** The options that the web client starts with, which the server takes for a file without any. */
const DEFAULT_OPTIONS = Object.freeze({ progress: 'all', camera: true });

/** The time between two readings. */
const EVERY = 1000;
/** A reading that the server answered with 401: it no longer knows the session of this tab. */
const FORGOTTEN = Symbol('forgotten');

const POST = Object.freeze({ method: 'POST' });
/** The listener reads a body as JSON or not at all. */
const json = (method, body) => ({ method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const record = value => typeof value === 'object' && value !== null && !Array.isArray(value);
const taken = answer => answer.status >= 200 && answer.status < 300;
/** The server's sentence for what it did not do. */
const refusal = answer => (typeof answer.body?.error === 'string' && answer.body.error ? answer.body.error
  : `The server refused the request (${answer.status}).`);
/** A connected player, or a controller that is kept for one who is away, is somebody in the room. */
const occupied = players => [players?.connected, players?.reserved].some(count => typeof count === 'number' && count > 0);
/**
 * What a status says in words of its own, with the folder and the policy that are saved. A sentence of
 * the page gives way when this changes: a folder that was saved meanwhile, through a dialog that another
 * tab opened, is news to a page that was told to look for that dialog.
 */
const said = (report, config) =>
  JSON.stringify([report.host?.state, report.host?.problem?.message, config?.gameFolder ?? null, config?.discPolicy ?? null]);
const question = (players, asking) => `Players are in the room: ${inTheRoom(players)}. ${asking}`;
/** The file of a report, named by the day on which the server made it. */
function reportName(report) {
  const day = typeof report.generatedAt === 'string' ? /^(\d{4}-\d{2}-\d{2})T/.exec(report.generatedAt)?.[1] : undefined;
  return day ? `sled-storm-server-diagnostics-${day}.json` : 'sled-storm-server-diagnostics.json';
}

/**
 * `ask(path, init)` resolves to `{ status, body }`, with the JSON body or null, and rejects when the
 * server cannot be reached. `render(view)` is called after every reading and every change. `wait(ms)`
 * resolves when the next reading is due. `clipboard(text)` resolves when the text was copied.
 * `lost()` is called when the server answers 401, so that the tab lets go of its session.
 * `save(name, text)` hands a file to the browser to save, and throws when it cannot.
 */
export function createPanel({ ask, render, wait, clipboard, lost, save, openGame, openAtLaunch = false }) {
  let report = null;
  let config = null;
  let invitation = null;
  /** The requests of buttons that are under way, in the order they were sent: one, or a quit during the folder's. */
  const pending = [];
  /** A sentence of the page's own, and the button that asked it when it is a question about the players. */
  let notice = null;
  let confirming = null;
  /** What the status said at the first reading after that sentence was made; null before that reading. */
  let heard = null;
  /** Why the page shows no server at the moment, while it goes on asking. */
  let away = null;
  /** Why the page has stopped asking for good. */
  let over = null;
  let readings = 0;
  /** The reading that began last. */
  let latest = Promise.resolve();
  let shown = null;
  let openOnReady = openAtLaunch;

  const show = () => {
    const gone = over ?? away;
    shown = gone === null ? panelView({ report, config, invitation, busy: pending.at(-1) ?? null, confirming, notice }) : disconnected(gone);
    render(shown);
  };
  const say = (sentence, button = null) => {
    notice = sentence;
    confirming = button;
    heard = null;
  };
  const forget = () => say(null);
  const end = why => {
    over = why;
    show();
  };
  const disconnect = () => {
    lost();
    end(NOT_CONNECTED);
  };

  /** What the server says now, or why the page cannot show it. */
  async function answers() {
    const status = await ask('/api/status');
    if (status.status === 401) return FORGOTTEN;
    if (status.status !== 200 || !record(status.body)) return { away: UNREADABLE };
    const settings = await ask('/api/config');
    if (settings.status === 401) return FORGOTTEN;
    // Without a room there are no links to ask for.
    const links = status.body.host?.room === 'off' ? null : await ask('/api/invitation');
    if (links?.status === 401) return FORGOTTEN;
    // An answer of another form is the view's to show; a refusal is no answer.
    const body = answer => (answer?.status === 200 ? answer.body : null);
    return { report: status.body, config: body(settings), invitation: body(links) };
  }

  async function read() {
    const mine = ++readings;
    let next;
    try {
      next = await answers();
    } catch {
      next = { away: NOT_RUNNING };
    }
    // A reading that began later has the newer answer, and a page that is over shows nothing more.
    if (mine !== readings || over !== null) return;
    if (next === FORGOTTEN) return disconnect();
    if (next.away) {
      away = next.away;
      return show();
    }
    away = null;
    // A sentence of the page must not hide what the status says next. The reading that follows its
    // own request is where it begins, whatever that reading finds.
    const saying = said(next.report, next.config);
    if (notice !== null && heard !== null && heard !== saying) forget();
    // A question about the players lasts while there are any.
    if (confirming !== null && !occupied(next.report.host?.players)) forget();
    if (notice !== null) heard = saying;
    ({ report, config, invitation } = next);
    show();
    const { state, room } = report.host ?? {};
    if (['needs_setup', 'failed', 'stopping'].includes(state) || room === 'failed') openOnReady = false;
    if (openOnReady && !pending.includes('stop') && shown.openGame) {
      openOnReady = false;
      openGame?.(shown.openGame);
    }
  }

  /** Begins a reading, which is then the latest. A reading never rejects. */
  const begin = () => (latest = read());
  /**
   * Waits for a reading and for every one that began after it. A reading that was overtaken shows
   * nothing, so the page shows what the server said once the latest one is done.
   */
  async function through(reading) {
    for (let current = reading; ; current = latest) {
      await current;
      if (latest === current) return;
    }
  }

  /**
   * Nothing is sent before the first reading, without a server, or while a request is under way. A quit
   * is the one request that goes while the folder's is under way: the server ends that dialog when it quits.
   */
  const ready = (name = null) => over === null && away === null && report !== null
    && pending.every(other => name === 'quit' && other === 'folder');

  /** The request of a button. Every button waits for its answer, and then the page reads anew. */
  async function request(name, path, init, answered) {
    pending.push(name);
    show();
    let answer = null;
    try {
      answer = await ask(path, init);
    } catch {
      // No answer at all. The reading below says whether the server is there.
    }
    pending.splice(pending.indexOf(name), 1);
    // A reading may have ended the page meanwhile.
    if (over !== null) return;
    if (answer === null) say(NO_ANSWER);
    else if (answer.status === 401) return disconnect();
    else answered(answer);
    // A press ends once the page shows what the server said after it.
    if (over === null) await through(begin());
  }

  /** A button whose request the server either takes or refuses in a sentence. */
  async function press(name, path, init, done = () => {}) {
    if (!ready()) return;
    forget();
    await request(name, path, init, answer => {
      if (taken(answer)) done();
      else say(refusal(answer));
    });
  }

  /**
   * A button whose request the server refuses while players are in the room. The refusal, with the
   * server's counts, becomes a question, and the second press of the same button says force.
   */
  async function guarded(name, path, asking, done) {
    if (!ready(name)) return;
    const force = confirming === name;
    forget();
    await request(name, path, force ? json('POST', { force: true }) : POST, answer => {
      if (taken(answer)) return done();
      const players = answer.status === 409 ? answer.body?.players : null;
      if (record(players)) say(question(players, asking), name);
      else say(refusal(answer));
    });
  }

  return {
    /** Reads once a second until the page is disconnected. */
    async run() {
      while (over === null) {
        await begin();
        if (over === null) await wait(EVERY);
      }
    },
    /** The folder comes out of a dialog on the server's computer; the request names none, and a cancel is taken like a choice. */
    chooseFolder: () => press('folder', '/api/game-folder/pick', POST),
    setPolicy: name => press('policy', '/api/config', json('PUT', { discPolicy: name })),
    setAutoStart: value => press('autoStart', '/api/config', json('PUT', { autoStart: value })),
    /** The server takes both options or neither; the one that is not changed is sent as it is saved. */
    setOptions(change) {
      const saved = record(config?.roomOptions) ? config.roomOptions : {};
      const { progress = DEFAULT_OPTIONS.progress, camera = DEFAULT_OPTIONS.camera } = saved;
      return press('options', '/api/config', json('PUT', { roomOptions: { progress, camera, ...change } }));
    },
    start: () => press('start', '/api/host/start', POST, () => { openOnReady = true; }),
    async solo() {
      if (!ready() || !openGame) return;
      forget();
      await request('solo', '/api/solo/start', POST, answer => {
        if (taken(answer) && typeof answer.body?.url === 'string') openGame(answer.body.url);
        else say(refusal(answer));
      });
    },
    stop: () => guarded('stop', '/api/room/stop', 'Stop it anyway?', () => { openOnReady = false; }),
    newGame: () => guarded('newGame', '/api/room/new-game', 'A new game disconnects them. Start one anyway?', () => say(NEW_GAME)),
    /** The server asks about the players in its own answer, so a player who joined after the last reading is asked about too. */
    quit: () => guarded('quit', '/api/host/quit', 'Quit anyway?', () => end(HAS_QUIT)),
    /** The server makes the report; the browser saves it as a file. */
    async saveDiagnostics() {
      if (!ready()) return;
      forget();
      await request('diagnostics', '/api/diagnostics/export', POST, answer => {
        if (!taken(answer)) return say(refusal(answer));
        if (!record(answer.body)) return say(UNREADABLE);
        const name = reportName(answer.body);
        try {
          save(name, `${JSON.stringify(answer.body, null, 2)}\n`);
        } catch {
          return say(NOT_SAVED);
        }
        say(`The browser saves the diagnostic report as ${name}.`);
      });
    },
    /** Copies the guests' link that the page shows. False when nothing was copied: the caller then selects the link, if there is one. */
    async copyInvite() {
      const url = shown?.invite?.url ?? null;
      if (url === null) return false;
      let copied = true;
      try {
        await clipboard(url);
      } catch {
        copied = false;
      }
      if (over === null && away === null) {
        say(copied ? COPIED : COPY_BY_HAND);
        show();
      }
      return copied;
    },
  };
}
