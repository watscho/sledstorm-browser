import assert from 'node:assert/strict';
import test from 'node:test';
import { mirrorNetplayDownlink } from './netplay-downlink.js';

test('Netplay keeps the stream ordered through fallback and mirror recovery', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  class Socket extends EventTarget {
    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
    readyState = Socket.OPEN;
    bufferedAmount = 0;
    sent = [];
    open() { this.readyState = Socket.OPEN; this.dispatchEvent(new Event('open')); }
    send(data) { this.sent.push(data); }
    close() { this.readyState = 3; this.dispatchEvent(new Event('close')); }
    receive(sequence, value) {
      const data = new ArrayBuffer(5);
      new DataView(data).setUint32(0, sequence);
      new Uint8Array(data)[4] = value;
      this.dispatchEvent(new MessageEvent('message', { data }));
    }
  }
  let mirror;
  const Original = globalThis.WebSocket;
  globalThis.WebSocket = class extends Socket {
    constructor(url) { super(); this.url = url; this.readyState = Socket.CONNECTING; mirror = this; }
  };
  try {
    const primary = new Socket();
    const delivery = mirrorNetplayDownlink(primary, 'wss://test.invalid/netplay-mirror');
    assert.equal(delivery.stream.readyState, delivery.stream.OPEN);
    const received = [];
    delivery.stream.onmessage = ({ data }) => received.push(new Uint8Array(data)[0]);
    primary.receive(0, 10);
    delivery.startMirror();
    mirror.open();
    mirror.receive(2, 12);
    assert.deepEqual(received, [10]);
    mirror.receive(1, 11);
    assert.deepEqual(received, [10, 11, 12]);
    primary.receive(1, 11);
    primary.receive(2, 12);
    mirror.close();
    primary.receive(3, 13);
    assert.deepEqual(received, [10, 11, 12, 13]);
    delivery.stream.send('input');
    assert.deepEqual(primary.sent, ['input']);
    assert.deepEqual(mirror.sent, []);
    delivery.stream.close();
    assert.equal(primary.readyState, 3);
    assert.equal(mirror.readyState, 3);

    const duplexPrimary = new Socket();
    const duplex = mirrorNetplayDownlink(duplexPrimary, 'wss://test.invalid/netplay-mirror', {
      duplex: true, separateUrl: 'wss://backup.invalid/netplay-mirror',
      discoverMirror: async () => 'wss://replacement.invalid/netplay-mirror',
    });
    duplex.startMirror();
    const backup = mirror;
    backup.open();
    duplex.stream.send(Uint8Array.of(20));
    assert.deepEqual(duplexPrimary.sent, [Uint8Array.of(0, 0, 0, 0, 20)]);
    assert.deepEqual(backup.sent, duplexPrimary.sent);
    backup.close();
    assert.notEqual(mirror, backup);
    const fallback = mirror;
    fallback.open();
    duplex.stream.send(new Uint8Array(513));
    assert.equal(duplexPrimary.sent.length, 2);
    assert.equal(mirror.sent.length, 0);
    duplex.stream.send(Uint8Array.of(22));
    assert.deepEqual(fallback.sent, [Uint8Array.of(0, 0, 0, 2, 22)]);
    t.mock.timers.tick(3000);
    await Promise.resolve();
    assert.match(mirror.url, /replacement/);
    assert.equal(fallback.readyState, Socket.OPEN);
    duplex.stream.send(Uint8Array.of(23));
    assert.equal(fallback.sent.length, 2);
    const replacementPackets = [];
    duplex.stream.onmessage = ({ data }) => replacementPackets.push(new Uint8Array(data)[0]);
    duplexPrimary.receive(0, 30);
    duplexPrimary.receive(2, 32);
    mirror.open();
    mirror.receive(2, 32);
    assert.equal(fallback.readyState, Socket.OPEN);
    assert.deepEqual(replacementPackets, [30]);
    duplex.stream.send(Uint8Array.of(24));
    assert.deepEqual(fallback.sent.at(-1), Uint8Array.of(0, 0, 0, 4, 24));
    assert.deepEqual(mirror.sent, [fallback.sent.at(-1)]);
    fallback.receive(1, 31);
    assert.deepEqual(replacementPackets, [30, 31, 32]);
    assert.equal(fallback.readyState, Socket.CLOSED);
    duplex.stream.send(Uint8Array.of(25));
    assert.deepEqual(mirror.sent, [Uint8Array.of(0, 0, 0, 4, 24), Uint8Array.of(0, 0, 0, 5, 25)]);
    duplex.stream.close();
  } finally {
    globalThis.WebSocket = Original;
  }
});
