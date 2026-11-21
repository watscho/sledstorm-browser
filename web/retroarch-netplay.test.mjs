import assert from 'node:assert/strict';
import test from 'node:test';
import { checkNetplayInvitation, prepareNetplay, driveRetroPad } from './retroarch-netplay.js';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('a save dialog releases physical controller input and returns it after closing', () => {
  let modal = false;
  const game = new EventTarget();
  const globals = {
    window: new EventTarget(),
    document: { hasFocus: () => true, hidden: false, addEventListener() {}, querySelector: selector => selector === '#game' ? game : modal ? {} : null },
    navigator: { getGamepads: () => [{ index: 0, mapping: 'standard', buttons: [{ pressed: true }], axes: [0, 0] }] },
  };
  const originals = Object.fromEntries(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(globals)) Object.defineProperty(globalThis, name, { value, configurable: true });
  const calls = [];
  try {
    const drive = driveRetroPad({ gameManager: { setKeyboardEnabled() {}, functions: { simulateInput: (...args) => calls.push(args) } }, elements: { parent: new EventTarget() } },
      { keyMap: {}, gamepadIndex: () => 0 });
    drive(); assert.deepEqual(calls.at(-1), [0, 0, 1]);
    modal = true; drive(); assert.deepEqual(calls.at(-1), [0, 0, 0]);
    modal = false; drive(); assert.deepEqual(calls.at(-1), [0, 0, 1]);
  } finally {
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test('a browser-hosted guest requests the same controller after closing the tab', async () => {
  const invitation = { v: 8, room: 'a'.repeat(24), token: 'b'.repeat(64) };
  const key = `sled-netplay-seat:${invitation.room}`;
  const preferredSlots = [];
  let availableSlot = 2;
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = Socket.OPEN;
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    send(text) {
      const message = JSON.parse(text);
      if (message.role !== 'guest') return;
      preferredSlots.push(message.preferredSlot);
      const slot = message.preferredSlot || availableSlot;
      const data = JSON.stringify({ type: 'ready', slot });
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data })));
    }
  }
  const globals = {
    location: new URL('https://game.example/'),
    WebSocket: Socket,
    sessionStorage: storage(),
    localStorage: storage(),
  };
  const originals = Object.fromEntries(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });

  const join = () => prepareNetplay({
    Module: { sledInstallNetplay() {}, _sled_netplay_status() {}, FS: { readFile: () => '', writeFile() {} } },
    gameManager: {},
  }, { invitation, identity: 'c'.repeat(64), options: {}, onClose() {} });

  try {
    const first = await join();
    assert.equal(first.slot, 2);
    assert.equal(localStorage.getItem(key), null);
    first.markSynchronized();

    availableSlot = 1;
    globalThis.sessionStorage = storage();
    const returning = await join();
    assert.equal(preferredSlots.at(-1), 2);
    assert.equal(returning.slot, 2);

    sessionStorage.setItem(key, '1');
    await join();
    assert.equal(preferredSlots.at(-1), 1);
  } finally {
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test('a player of a server\'s room can load into it, and a guest of a browser\'s room cannot', async () => {
  const invitation = { v: 8, room: 'a'.repeat(24), token: 'b'.repeat(64) };
  const seatKey = 'd'.repeat(32);
  const notAlone = 'The room is not available for loading a save. Try again when playing alone.';
  const lostRoom = 'Disconnected from the room. Open the invitation again to rejoin.';
  const sockets = [];
  let serverRoom = true;
  class Socket extends EventTarget {
    static OPEN = 1;
    readyState = Socket.OPEN;
    sent = [];
    constructor(url) {
      super();
      this.url = String(url);
      sockets.push(this);
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    send(data) {
      this.sent.push(data);
      if (typeof data === 'string' && JSON.parse(data).role === 'guest')
        this.say({ type: 'ready', slot: 0, owner: true, seatKey, releaseForLoad: !serverRoom, ...(serverRoom && { restore: true }) });
    }
    say(message) {
      queueMicrotask(() => this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(message) })));
    }
    close() {}
    end(code, reason = '') {
      this.readyState = 3;
      this.dispatchEvent(Object.assign(new Event('close'), { code, reason }));
    }
  }
  const globals = {
    location: new URL('https://game.example/'),
    WebSocket: Socket,
    sessionStorage: storage(),
    localStorage: storage(),
  };
  const originals = Object.fromEntries(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });

  const closed = [];
  const join = dedicated => prepareNetplay({
    Module: { sledInstallNetplay() {}, _sled_netplay_status() {}, FS: { readFile: () => '', writeFile() {} } },
    gameManager: {},
  }, { invitation, identity: 'c'.repeat(64), options: {}, dedicated, onClose: reason => closed.push(reason) });
  const turn = () => new Promise(resolve => setImmediate(resolve));
  const state = new Uint8Array(8);

  try {
    // The room takes the save: this player's connection closes because the game moved, not because it is lost.
    const player = await join(true);
    const [playing] = sockets;
    assert.equal(typeof player.restore, 'function');
    const load = player.restore(state, 'the-key');
    await assert.rejects(player.restore(state, 'the-key'), /Try again/);
    await turn();
    assert.equal(sockets.length, 2, 'one request per load');
    const request = sockets[1];
    assert.equal(request.url, playing.url);
    assert.deepEqual(JSON.parse(request.sent[0]), { role: 'restore', room: invitation.room, token: invitation.token, seatKey, save: 'the-key' });
    assert.equal(playing.sent.some(data => data === state), false, 'the save stays out of the connection that carries the input');
    request.say({ type: 'restore', state: 'send' });
    await turn();
    assert.equal(request.sent[1], state);
    playing.end(1000, 'Saved game loaded');
    request.say({ type: 'restore', state: 'done' });
    await load;
    assert.deepEqual(closed, []);

    // The room refuses: the game goes on, and a room that is lost later is reported as before.
    const refused = await join(true);
    const refusal = refused.restore(state, 'the-key');
    await turn();
    sockets.at(-1).end(1008, notAlone);
    await assert.rejects(refusal, { message: notAlone });
    assert.deepEqual(closed, []);
    const again = refused.restore(state, 'the-key');
    await turn();
    sockets.at(-1).end(1008, notAlone);
    await assert.rejects(again, { message: notAlone });
    sockets.at(-3).end(1006);
    assert.deepEqual(closed, [lostRoom]);
    await assert.rejects(refused.restore(state, 'the-key'), /Try again/);

    // The room is lost while a load is asked for: the load fails, and the lost room is still reported.
    const leaving = await join(true);
    const roomSocket = sockets.at(-1);
    const failing = leaving.restore(state, 'the-key');
    await turn();
    roomSocket.end(1006);
    assert.deepEqual(closed, [lostRoom]);
    sockets.at(-1).end(1008, notAlone);
    await assert.rejects(failing, { message: notAlone });
    assert.deepEqual(closed, [lostRoom, lostRoom]);

    serverRoom = false;
    assert.equal((await join(false)).restore, undefined);
  } finally {
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});

test('asking about a room names the controller this browser keeps there', async () => {
  // The room of a server answers nobody but the player of a load until that player is back, and the
  // controller key is how it knows that player.
  const invitation = { v: 8, room: 'a'.repeat(24), token: 'b'.repeat(64) };
  const kept = 'd'.repeat(32);
  const asked = [];
  class Socket extends EventTarget {
    constructor() {
      super();
      queueMicrotask(() => this.dispatchEvent(new Event('open')));
    }
    send(text) {
      asked.push(JSON.parse(text));
      queueMicrotask(() => this.dispatchEvent(Object.assign(new Event('close'), { code: 1000, reason: 'Room available' })));
    }
    close() {}
  }
  const globals = { location: new URL('https://game.example/'), WebSocket: Socket, sessionStorage: storage(), localStorage: storage() };
  const originals = Object.fromEntries(Object.keys(globals).map(name => [name, Object.getOwnPropertyDescriptor(globalThis, name)]));
  for (const [name, value] of Object.entries(globals))
    Object.defineProperty(globalThis, name, { value, writable: true, configurable: true });
  try {
    await checkNetplayInvitation(invitation);
    assert.deepEqual(asked.at(-1), { role: 'check', room: invitation.room, token: invitation.token });
    localStorage.setItem(`sled-controller-key:${invitation.room}`, kept);
    await checkNetplayInvitation(invitation);
    assert.equal(asked.at(-1).seatKey, kept);
    sessionStorage.setItem(`sled-controller-key:${invitation.room}`, 'e'.repeat(32));
    await checkNetplayInvitation(invitation);
    assert.equal(asked.at(-1).seatKey, 'e'.repeat(32), 'the key of this tab comes first');
    sessionStorage.setItem(`sled-controller-key:${invitation.room}`, 'not a key');
    await checkNetplayInvitation(invitation);
    assert.equal(asked.at(-1).seatKey, undefined);
    // A browser without storage still asks.
    Object.defineProperty(globalThis, 'sessionStorage', { get() { throw new Error('blocked'); }, configurable: true });
    await checkNetplayInvitation(invitation);
    assert.equal(asked.at(-1).seatKey, undefined);
  } finally {
    for (const [name, descriptor] of Object.entries(originals)) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else delete globalThis[name];
    }
  }
});
