import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareNetplay } from './retroarch-netplay.js';

function storage() {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) };
}

test('a browser-hosted guest requests the same controller after closing the tab', async () => {
  const invitation = { v: 7, room: 'a'.repeat(24), token: 'b'.repeat(64) };
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
