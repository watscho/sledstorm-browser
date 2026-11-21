import assert from 'node:assert/strict';
import test from 'node:test';
import { loadInRoom, rememberRejoin, restoreInRoom, takeRejoin } from './room-restore.js';

const room = 'a'.repeat(24);
const token = 'b'.repeat(64);
const seatKey = 'c'.repeat(32);
const notAlone = 'The room is not available for loading a save. Try again when playing alone.';
const lost = 'Could not reach the room. Check the connection and try again.';
const requestId = '0b7e4c52-8a0d-4f0e-9d6a-3f1c2b5a7e90';

/** A stand-in for the browser's WebSocket that the test drives by hand. */
function fakeSockets() {
  const sockets = [];
  class Socket extends EventTarget {
    sent = [];
    constructor(url) {
      super();
      this.url = String(url);
      sockets.push(this);
    }
    send(data) { this.sent.push(data); }
    close() { this.closed = true; }
    open() { this.dispatchEvent(new Event('open')); }
    say(message) { this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })); }
    end(code, reason = '') { this.dispatchEvent(Object.assign(new Event('close'), { code, reason })); }
  }
  return { Socket, sockets };
}

function ask(Socket, more = {}) {
  return restoreInRoom({ url: 'wss://game.example/netplay', room, token, seatKey, save: 'the-key',
    state: new Uint8Array([1, 2, 3]), WebSocket: Socket, ...more });
}

async function withSessionStorage(value, work) {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage');
  Object.defineProperty(globalThis, 'sessionStorage', { ...value, configurable: true });
  try { await work(); } finally {
    if (original) Object.defineProperty(globalThis, 'sessionStorage', original);
    else delete globalThis.sessionStorage;
  }
}

function storageOf(values = new Map()) {
  return { value: { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, String(value)),
    removeItem: key => values.delete(key) } };
}

test('a save is sent only when the room asks for it, and the load ends when the room says so', async () => {
  const { Socket, sockets } = fakeSockets();
  const state = new Uint8Array([1, 2, 3]);
  let starting = 0;
  let settled = false;
  const load = ask(Socket, { state, onStarting: () => starting++ });
  load.then(() => { settled = true; }, () => { settled = true; });
  const [socket] = sockets;
  assert.equal(socket.url, 'wss://game.example/netplay');
  assert.deepEqual(socket.sent, []);

  socket.open();
  assert.deepEqual(socket.sent.map(text => JSON.parse(text)), [{ role: 'restore', room, token, seatKey, save: 'the-key' }]);
  // Nothing but the room's own request releases the save.
  socket.say({ type: 'ready', slot: 0 });
  socket.dispatchEvent(new MessageEvent('message', { data: 'not json' }));
  socket.dispatchEvent(new MessageEvent('message', { data: new Uint8Array(4) }));
  assert.equal(socket.sent.length, 1);

  socket.say({ type: 'restore', state: 'send' });
  assert.equal(socket.sent.length, 2);
  assert.equal(socket.sent[1], state);
  socket.say({ type: 'restore', state: 'send' });
  assert.equal(socket.sent.length, 2, 'the save is sent once');

  assert.equal(starting, 0);
  socket.say({ type: 'restore', state: 'starting' });
  assert.equal(starting, 1);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(settled, false, 'a starting emulator is not a loaded game');

  socket.say({ type: 'restore', state: 'done' });
  await load;
  socket.end(1000, 'Saved game loaded');
});

test('a refusal is given in the room\'s words', async () => {
  const { Socket, sockets } = fakeSockets();
  const refused = ask(Socket);
  sockets[0].open();
  sockets[0].end(1008, notAlone);
  await assert.rejects(refused, { message: notAlone });

  const damaged = ask(Socket);
  sockets[1].open();
  sockets[1].say({ type: 'restore', state: 'send' });
  sockets[1].end(1008, 'Invalid game save');
  await assert.rejects(damaged, { message: 'Invalid game save' });

  let starting = 0;
  const failed = ask(Socket, { onStarting: () => starting++ });
  sockets[2].open();
  sockets[2].say({ type: 'restore', state: 'send' });
  sockets[2].say({ type: 'restore', state: 'starting' });
  sockets[2].end(1008, 'The saved game could not be started. The room is unchanged.');
  await assert.rejects(failed, { message: 'The saved game could not be started. The room is unchanged.' });
  assert.equal(starting, 1);
});

test('a connection that ends without a word is a lost connection', async () => {
  const { Socket, sockets } = fakeSockets();
  const unreachable = ask(Socket);
  sockets[0].end(1006);
  await assert.rejects(unreachable, { message: lost });
  assert.deepEqual(sockets[0].sent, []);

  const dropped = ask(Socket);
  sockets[1].open();
  sockets[1].say({ type: 'restore', state: 'send' });
  sockets[1].end(1006);
  await assert.rejects(dropped, { message: lost });

  // A browser that cannot open the connection at all says so the same way.
  class Refusing { constructor() { throw new DOMException('Blocked', 'SecurityError'); } }
  await assert.rejects(ask(Refusing), { message: lost });
});

test('the way back is remembered once', async () => {
  const values = new Map();
  await withSessionStorage(storageOf(values), () => {
    assert.equal(takeRejoin(), undefined);
    rememberRejoin(requestId);
    assert.equal(values.get('sled-room-rejoin'), requestId);
    assert.equal(takeRejoin(), requestId);
    assert.equal(takeRejoin(), undefined);
    assert.equal(values.has('sled-room-rejoin'), false);

    values.set('sled-room-rejoin', '<script>');
    assert.equal(takeRejoin(), undefined);
    assert.equal(values.has('sled-room-rejoin'), false);
  });
  // A browser without storage still plays; the page then returns with its lobby settings.
  await withSessionStorage({ get() { throw new DOMException('Denied', 'SecurityError'); } }, () => {
    rememberRejoin(requestId);
    assert.equal(takeRejoin(), undefined);
  });
});

function library(calls) {
  return {
    identity: { disc: 'd'.repeat(64), core: 'e'.repeat(64), bios: 'hle', adapter: 'pcsx-frame-gate-v3' },
    async prepareLoad(record, options) {
      calls.push(['prepare', record, options]);
      return { id: requestId, cancel: async () => { calls.push(['cancel']); } };
    },
  };
}

test('a load that the room takes is remembered, and the page returns to the room', async () => {
  await withSessionStorage(storageOf(), async () => {
    const calls = [];
    const record = { state: new Uint8Array([4, 5, 6]) };
    const options = { files: [], settings: { volume: '80' } };
    const connection = { restore: async (state, save) => { calls.push(['restore', state, save]); } };
    await loadInRoom(connection, library(calls), record, options, () => calls.push(['reload', takeRejoin()]));
    assert.deepEqual(calls, [
      ['prepare', record, options],
      // The same key the server gives its room: the save library's own.
      ['restore', record.state, `${'d'.repeat(64)}:${'e'.repeat(64)}:hle:pcsx-frame-gate-v3`],
      ['reload', requestId],
    ]);
  });
});

test('a load that the room refuses is withdrawn, and the page stays', async () => {
  await withSessionStorage(storageOf(), async () => {
    const calls = [];
    const connection = { restore: async () => { throw new Error(notAlone); } };
    await assert.rejects(loadInRoom(connection, library(calls), { state: new Uint8Array(3) }, { files: [], settings: {} },
      () => calls.push(['reload'])), { message: notAlone });
    assert.deepEqual(calls.map(([name]) => name), ['prepare', 'cancel']);
    assert.equal(takeRejoin(), undefined);
  });
});

test('a room that stays silent is given up, so that the page is not left waiting', async t => {
  // The network path may die without a word: the request then neither answers nor closes.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { Socket, sockets } = fakeSockets();
  let outcome = 'waiting';
  ask(Socket).then(() => { outcome = 'loaded'; }, error => { outcome = error.message; });
  const [socket] = sockets;
  socket.open();
  socket.say({ type: 'restore', state: 'send' });
  socket.say({ type: 'restore', state: 'starting' });
  // The room may take a minute for the save and more than a minute for the emulator.
  t.mock.timers.tick(140_000);
  await Promise.resolve();
  assert.equal(outcome, 'waiting');
  assert.notEqual(socket.closed, true);
  t.mock.timers.tick(15_000);
  await Promise.resolve();
  assert.equal(outcome, lost);
  assert.equal(socket.closed, true, 'the request is closed, so the room calls the load off');
});

test('a load that ended leaves no deadline behind', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { Socket, sockets } = fakeSockets();
  const asked = ask(Socket);
  const [socket] = sockets;
  socket.open();
  socket.say({ type: 'restore', state: 'send' });
  socket.say({ type: 'restore', state: 'done' });
  await asked;
  t.mock.timers.tick(600_000);
  assert.notEqual(socket.closed, true);
});
