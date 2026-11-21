import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocket, WebSocketServer } from 'ws';
import { createRetroArchRelay } from './retroarch-relay.mjs';
import { createPublicGateway } from './public-server.mjs';
import { sequencePacket } from '../../web/netplay-wire.js';

test('the separate mirror forwards the first ordered input and binds to its primary origin', { timeout: 6000 }, async () => {
  const relay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(relay, 'listening');
  const access = 'a'.repeat(48);
  const gateway = createPublicGateway({ port: 0, mirrorPort: 0, netplay: relay.address().port, accessToken: access });
  await Promise.all([once(gateway, 'listening'), once(gateway.mirrorServer, 'listening')]);
  const address = `127.0.0.1:${gateway.address().port}`;
  const mirrorAddress = `127.0.0.1:${gateway.mirrorServer.address().port}`;
  const origin = `https://${address}`;
  const key = 'b'.repeat(48);
  const sockets = [];
  const connect = (target, route, headers) => {
    const ws = new WebSocket(`ws://${target}${route}?duplex=${key}`, { headers });
    sockets.push(ws);
    return ws;
  };
  const connectMirror = (value = origin, scheme = 'https') => connect(mirrorAddress, '/netplay-mirror',
    { origin: value, 'x-forwarded-proto': scheme });
  try {
    assert.equal((await fetch(`http://${mirrorAddress}/disc.zip`)).status, 403);
    const accepted = once(relay, 'connection');
    const primary = connect(address, '/netplay', { origin, cookie: `sled_access=${access}` });
    await once(primary, 'open');
    const [upstream] = await accepted;
    assert.match(String((await once(connectMirror(), 'error'))[0]), /403/);
    const snapshot = Buffer.alloc(768, 7);
    const upload = once(upstream, 'message');
    primary.send(snapshot);
    assert.deepEqual(await upload, [snapshot, true]);
    const ready = once(primary, 'message');
    upstream.send('{"type":"ready","slot":0}');
    assert.equal((await ready)[1], false);
    assert.match(String((await once(connectMirror('https://other.invalid'), 'error'))[0]), /403/);
    assert.match(String((await once(connectMirror(origin, 'http'), 'error'))[0]), /403/);
    const fallback = connect(address, '/netplay-mirror', { origin, cookie: `sled_access=${access}` });
    await once(fallback, 'open');
    const mirror = connectMirror();
    await once(mirror, 'open');

    const pad = value => Uint8Array.of(value);
    const inputs = [];
    const firstTwo = new Promise(resolve => upstream.on('message', bytes => {
      inputs.push(bytes[0]);
      if (inputs.length === 2) resolve();
    }));
    mirror.send(sequencePacket(1, pad(11)));
    primary.send(sequencePacket(0, pad(10)));
    await firstTwo;
    assert.deepEqual(inputs, [10, 11]);
    primary.send(sequencePacket(1, pad(11)));
    const next = once(upstream, 'message');
    primary.send(sequencePacket(2, pad(12)));
    assert.deepEqual(await next, [Buffer.from([12]), true]);

    const down = Promise.all([once(primary, 'message'), once(mirror, 'message'), once(fallback, 'message')]);
    upstream.send(pad(22));
    const framed = [Buffer.from(sequencePacket(0, pad(22))), true];
    assert.deepEqual(await down, [framed, framed, framed]);
    const closed = once(fallback, 'close');
    fallback.close();
    await closed;
    const continued = once(mirror, 'message');
    upstream.send(pad(23));
    assert.deepEqual(await continued, [Buffer.from(sequencePacket(1, pad(23))), true]);
  } finally {
    for (const ws of sockets) ws.terminate();
    for (const ws of relay.clients) ws.terminate();
    gateway.close();
    relay.close();
  }
});

test('the private gateway mirrors small downlink packets and keeps uplink and snapshots on the primary', { timeout: 6000 }, async () => {
  const relay = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(relay, 'listening');
  const access = 'a'.repeat(48);
  const gateway = createPublicGateway({ port: 0, netplay: relay.address().port, accessToken: access });
  await once(gateway, 'listening');
  const address = `127.0.0.1:${gateway.address().port}`;
  const sockets = [];
  const key = 'b'.repeat(48);
  const connect = (path, deliveryKey = key, authorized = true) => {
    const ws = new WebSocket(`ws://${address}${path}?downlink=${deliveryKey}`, {
      origin: `http://${address}`, headers: authorized ? { cookie: `sled_access=${access}` } : {},
    });
    sockets.push(ws);
    return ws;
  };
  const frame = (sequence, data) => {
    const header = Buffer.alloc(4);
    header.writeUInt32BE(sequence);
    return Buffer.concat([header, data]);
  };
  try {
    const connection = once(relay, 'connection');
    const primary = connect('/netplay');
    await once(primary, 'open');
    const [upstream] = await connection;
    assert.match(String((await once(connect('/netplay-mirror', key, false), 'error'))[0]), /403/);
    assert.match(String((await once(connect('/netplay-mirror', 'c'.repeat(48)), 'error'))[0]), /403/);
    const mirror = connect('/netplay-mirror');
    await once(mirror, 'open');
    assert.match(String((await once(connect('/netplay-mirror'), 'error'))[0]), /403/);

    const pad = Buffer.from([0, 1, 2]);
    const input = once(upstream, 'message');
    primary.send(pad);
    assert.deepEqual(await input, [pad, true]);

    const small = Buffer.from([0, 3, 4]);
    const copies = Promise.all([once(primary, 'message'), once(mirror, 'message')]);
    upstream.send(small);
    assert.deepEqual(await copies, [[frame(0, small), true], [frame(0, small), true]]);

    const snapshot = Buffer.alloc(768, 5);
    const primarySnapshot = once(primary, 'message');
    const mirrorNext = once(mirror, 'message');
    upstream.send(snapshot);
    assert.deepEqual(await primarySnapshot, [frame(1, snapshot), true]);
    upstream.send(small);
    assert.deepEqual(await mirrorNext, [frame(2, small), true]);

    const mirrorClosed = once(mirror, 'close');
    primary.close();
    await mirrorClosed;
    assert.match(String((await once(connect('/netplay-mirror'), 'error'))[0]), /403/);
  } finally {
    for (const ws of sockets) ws.terminate();
    for (const ws of relay.clients) ws.terminate();
    gateway.close();
    relay.close();
  }
});

test('private gateway carries three Netplay guest streams and reuses a freed controller', { timeout: 6000 }, async () => {
  const relay = createRetroArchRelay({ port: 0 });
  await once(relay, 'listening');
  const access = 'a'.repeat(48);
  const gateway = createPublicGateway({ port: 0, upstream: 8000, netplay: relay.address().port,
    accessToken: access, maxPayload: 8 * 1024 * 1024 });
  await once(gateway, 'listening');
  const address = `127.0.0.1:${gateway.address().port}`;
  const sockets = [];
  const room = 'b'.repeat(24), token = 'c'.repeat(64), identity = 'd'.repeat(64);
  const connect = (cookie = true) => {
    const ws = new WebSocket(`ws://${address}/netplay`, {
      origin: `http://${address}`, headers: cookie ? { cookie: `sled_access=${access}` } : {},
    });
    sockets.push(ws);
    return ws;
  };
  const send = (ws, fields) => ws.send(JSON.stringify({ room, token, identity, ...fields }));
  const message = async (ws, match = () => true) => {
    for (;;) {
      const [data] = await once(ws, 'message');
      if (match(data)) return data;
    }
  };
  try {
    assert.match(String((await once(connect(false), 'error'))[0]), /403/);
    const host = connect();
    await once(host, 'open');
    send(host, { role: 'host', roster: true });
    assert.deepEqual(JSON.parse(await message(host)), { type: 'ready', slot: 0 });
    host.send('{"type":"synchronized"}');
    assert.equal(JSON.parse(await message(host)).seats[0].status, 'connected');
    const attach = async (slot, preferredSlot) => {
      const incoming = message(host, data => /^[a-f0-9]{48}$/.test(String(data)));
      const guest = connect();
      await once(guest, 'open');
      send(guest, { role: 'guest', preferredSlot, roster: true });
      const ready = message(guest);
      const stream = connect();
      await once(stream, 'open');
      send(stream, { role: 'accept', ticket: String(await incoming) });
      assert.deepEqual(JSON.parse(await ready), { type: 'ready', slot });
      const indicator = message(host, data => JSON.parse(data).seats[slot].status === 'connected');
      const guestRoster = message(guest, data => JSON.parse(data).seats[slot].status === 'connected');
      guest.send('{"type":"synchronized"}');
      await Promise.all([indicator, guestRoster]);
      const atHost = once(stream, 'message');
      const bytes = Buffer.from([slot, 0, 255]);
      guest.send(bytes);
      assert.deepEqual(await atHost, [bytes, true]);
      const atGuest = once(guest, 'message');
      stream.send(bytes);
      assert.deepEqual(await atGuest, [bytes, true]);
      return { guest, stream };
    };
    const bad = connect();
    await once(bad, 'open');
    send(bad, { role: 'guest', identity: 'e'.repeat(64) });
    assert.match(String((await once(bad, 'close'))[1]), /differs/);
    const peers = [];
    for (const slot of [1, 2, 3]) peers.push(await attach(slot));
    const full = connect();
    await once(full, 'open');
    send(full, { role: 'guest' });
    assert.equal(String((await once(full, 'close'))[1]), 'Room is full');
    const closed = once(peers[1].stream, 'close');
    peers[1].guest.close();
    await closed;
    peers[1] = await attach(2);
    for (const { guest, stream } of peers) {
      const closed = once(stream, 'close');
      guest.close();
      await closed;
    }
    await attach(3, 3);
  } finally {
    for (const ws of sockets) ws.terminate();
    gateway.close();
    for (const ws of relay.clients) ws.terminate();
    relay.close();
  }
});

test('dedicated room keeps controller 2 online and restores three reserved controllers out of order', { timeout: 6000 }, async () => {
  let workerSetup;
  const relay = createRetroArchRelay({
    port: 0,
    startDedicated: (setup, signal) => {
      workerSetup(setup);
      return { exited: new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })) };
    },
  });
  await once(relay, 'listening');
  const sockets = [];
  const room = 'b'.repeat(24), token = 'c'.repeat(64), identity = 'd'.repeat(64);
  async function connect(fields) {
    const ws = new WebSocket(`ws://127.0.0.1:${relay.address().port}/`, { origin: 'http://127.0.0.1:8000' });
    sockets.push(ws);
    await once(ws, 'open');
    ws.send(JSON.stringify({ room, token, identity, ...fields }));
    return ws;
  }
  const message = async ws => (await once(ws, 'message'))[0];
  try {
    const setup = new Promise(resolve => { workerSetup = resolve; });
    const creator = await connect({ role: 'create', progress: 'all', roster: true });
    const { workerKey } = await setup;
    const firstReady = message(creator);
    const worker = await connect({ role: 'worker', token: workerKey });
    await message(worker);
    const firstTicket = message(worker);
    worker.send('listening');
    const firstStream = await connect({ role: 'accept', ticket: String(await firstTicket) });
    const first = JSON.parse(await firstReady);
    assert.equal(first.slot, 0);
    creator.send('{"type":"synchronized"}');
    async function attach(previousSeatKey, slot) {
      const ticket = message(worker);
      const guest = await connect({ role: 'guest', previousSeatKey, roster: true });
      const ready = message(guest);
      const stream = await connect({ role: 'accept', ticket: String(await ticket) });
      const assigned = JSON.parse(await ready);
      assert.equal(assigned.slot, slot);
      if (previousSeatKey) assert.equal(assigned.seatKey, previousSeatKey);
      guest.send('{"type":"synchronized"}');
      return { guest, stream, key: assigned.seatKey };
    }
    const second = await attach(undefined, 1);
    const third = await attach(undefined, 2);
    const fourth = await attach(undefined, 3);
    const nextMessageOfType = async (ws, type) => {
      for (;;) {
        const event = JSON.parse(await message(ws));
        if (event.type === type) return event;
      }
    };
    const raceReady = nextMessageOfType(creator, 'roster');
    worker.send('race');
    await raceReady;
    const dropped = once(firstStream, 'close');
    const ownership = nextMessageOfType(second.guest, 'ownership');
    creator.close();
    await dropped;
    assert.deepEqual(await ownership, { type: 'ownership', owner: true });
    const bytes = Buffer.from([2, 255, 0]);
    const received = once(second.stream, 'message');
    second.guest.send(bytes);
    assert.deepEqual(await received, [bytes, true]);
    const othersDropped = [once(third.stream, 'close'), once(fourth.stream, 'close')];
    third.guest.close();
    fourth.guest.close();
    await Promise.all(othersDropped);
    const unknown = await connect({ role: 'guest' });
    assert.equal(String((await once(unknown, 'close'))[1]), 'All controllers are connected or reserved');
    await attach(fourth.key, 3);
    await attach(first.seatKey, 0);
    await attach(third.key, 2);
  } finally {
    relay.stopDedicated();
    for (const socket of sockets) socket.terminate();
    await new Promise(resolve => relay.close(resolve));
  }
});

test('dedicated controller indicators light after sync and a lobby join replaces a saved controller key', { timeout: 6000 }, async () => {
  let giveWorkerSetup;
  const setup = new Promise(resolve => { giveWorkerSetup = resolve; });
  const relay = createRetroArchRelay({
    port: 0,
    startDedicated: (params, signal) => {
      giveWorkerSetup(params);
      return { exited: new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })) };
    },
  });
  await once(relay, 'listening');
  const sockets = [];
  const room = 'b'.repeat(24), token = 'c'.repeat(64), identity = 'd'.repeat(64);
  async function connect(fields) {
    const ws = new WebSocket(`ws://127.0.0.1:${relay.address().port}/`, { origin: 'http://127.0.0.1:8000' });
    sockets.push(ws);
    const inbox = [];
    ws.on('message', (data, binary) => { if (!binary) inbox.push(String(data)); });
    await once(ws, 'open');
    ws.send(JSON.stringify({ room, token, identity, ...fields }));
    return { ws, async next(predicate = () => true) {
      for (;;) {
        const index = inbox.findIndex(predicate);
        if (index >= 0) return inbox.splice(index, 1)[0];
        await once(ws, 'message');
      }
    } };
  }
  const type = name => value => value.startsWith('{"type":"' + name + '"');
  try {
    const original = await connect({ role: 'create', progress: 'all', roster: true });
    const worker = await connect({ role: 'worker', token: (await setup).workerKey });
    await worker.next(type('ready'));
    worker.ws.send('listening');
    const stream = await connect({ role: 'accept', ticket: await worker.next() });
    const first = JSON.parse(await original.next(type('ready')));
    const valid = await connect({ role: 'check' });
    const [code, reason] = await once(valid.ws, 'close');
    assert.equal(code, 1000);
    assert.equal(String(reason), 'Room available');
    const wrongToken = await connect({ role: 'check', token: '0'.repeat(64) });
    assert.equal(String((await once(wrongToken.ws, 'close'))[1]), 'Invalid invitation');
    const stale = await connect({ role: 'check', room: '0'.repeat(24) });
    assert.match(String((await once(stale.ws, 'close'))[1]), /fresh invitation/);
    const roster = (slot, status) => value => type('roster')(value) &&
      JSON.parse(value).seats[slot].status === status;
    await original.next(roster(0, 'loading'));
    original.ws.send(JSON.stringify({ type: 'synchronized' }));
    await original.next(roster(0, 'connected'));
    const second = await connect({ role: 'guest', roster: true });
    await connect({ role: 'accept', ticket: await worker.next() });
    await second.next(type('ready'));
    original.ws.send('{"type":"release-for-load"}');
    assert.equal(JSON.parse(await original.next(type('released-for-load'))).allowed, false);
    const secondClosed = once(second.ws, 'close');
    second.ws.close();
    await secondClosed;
    const closed = once(stream.ws, 'close');
    original.ws.close();
    await closed;
    const returned = await connect({ role: 'guest', previousSeatKey: first.seatKey, roster: true });
    await connect({ role: 'accept', ticket: await worker.next() });
    const assignment = JSON.parse(await returned.next(type('ready')));
    assert.equal(assignment.slot, 0);
    assert.notEqual(assignment.seatKey, first.seatKey);
    const duplicate = await connect({ role: 'guest', previousSeatKey: assignment.seatKey });
    assert.match(String((await once(duplicate.ws, 'close'))[1]), /already connected/);
    assert.equal(assignment.releaseForLoad, true);
    returned.ws.send('{"type":"synchronized"}');
    await returned.next(roster(0, 'connected'));
    const released = once(returned.ws, 'close');
    returned.ws.send('{"type":"release-for-load"}');
    assert.equal(JSON.parse(await returned.next(type('released-for-load'))).allowed, true);
    assert.equal(String((await released)[1]), 'Loading saved game');
  } finally {
    relay.stopDedicated();
    for (const socket of sockets) socket.terminate();
    await new Promise(resolve => relay.close(resolve));
  }
});

test('the relay accepts only its configured origins', { timeout: 6000 }, async () => {
  const custom = createRetroArchRelay({ port: 0, origins: ['http://127.0.0.1:8123'] });
  const standard = createRetroArchRelay({ port: 0 });
  await Promise.all([once(custom, 'listening'), once(standard, 'listening')]);
  const sockets = [];
  const connect = (relay, origin) => {
    const ws = new WebSocket(`ws://127.0.0.1:${relay.address().port}`, { origin });
    sockets.push(ws);
    return ws;
  };
  try {
    await once(connect(custom, 'http://127.0.0.1:8123'), 'open');
    assert.match(String((await once(connect(custom, 'http://127.0.0.1:8000'), 'error'))[0]), /401/);
    await once(connect(standard, 'http://127.0.0.1:8000'), 'open');
    await once(connect(standard, 'http://localhost:8000'), 'open');
    assert.match(String((await once(connect(standard, 'http://127.0.0.1:8123'), 'error'))[0]), /401/);
  } finally {
    for (const ws of sockets) ws.terminate();
    custom.close();
    standard.close();
  }
});

/** A dedicated room with its creator seated: the relay, the worker's own connection and the creator's stream. */
async function dedicatedRoom(t) {
  let workerSetup;
  const relay = createRetroArchRelay({
    port: 0,
    startDedicated: (setup, signal) => {
      workerSetup(setup);
      return { exited: new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })) };
    },
  });
  await once(relay, 'listening');
  const sockets = [];
  t.after(async () => {
    relay.stopDedicated();
    for (const socket of [...sockets, ...relay.clients]) socket.terminate();
    await new Promise(resolve => relay.close(resolve));
  });
  const room = 'b'.repeat(24), token = 'c'.repeat(64), identity = 'd'.repeat(64);
  async function connect(fields) {
    const ws = new WebSocket(`ws://127.0.0.1:${relay.address().port}/`, { origin: 'http://127.0.0.1:8000' });
    sockets.push(ws);
    await once(ws, 'open');
    ws.send(JSON.stringify({ room, token, identity, ...fields }));
    return ws;
  }
  const message = async ws => (await once(ws, 'message'))[0];
  const setup = new Promise(resolve => { workerSetup = resolve; });
  const creator = await connect({ role: 'create', progress: 'all' });
  const { workerKey } = await setup;
  const ready = message(creator);
  const worker = await connect({ role: 'worker', token: workerKey });
  await message(worker);
  const ticket = message(worker);
  worker.send('listening');
  const stream = await connect({ role: 'accept', ticket: String(await ticket) });
  assert.equal(JSON.parse(await ready).type, 'ready');
  return { creator, worker, stream, connect };
}

for (const order of ['its stream', 'its own connection']) {
  test(`a player hears why the room is gone when a dying worker loses ${order} first`, { timeout: 6000 }, async t => {
    const { creator, worker, stream } = await dedicatedRoom(t);
    const closed = once(creator, 'close');
    const [first, second] = order === 'its stream' ? [stream, worker] : [worker, stream];
    first.terminate();
    await new Promise(resolve => setTimeout(resolve, 20));
    second.terminate();
    assert.equal(String((await closed)[1]), 'Dedicated emulator disconnected');
  });
}

test('a player whose stream alone ends is let go without a reason, and the room stays', { timeout: 6000 }, async t => {
  const { creator, stream, connect } = await dedicatedRoom(t);
  const closed = once(creator, 'close');
  // The player keeps sending, as a game does. That must not turn into a reason of its own.
  const sending = setInterval(() => { if (creator.readyState === WebSocket.OPEN) creator.send(Buffer.from([1, 2, 3])); }, 5);
  t.after(() => clearInterval(sending));
  stream.terminate();
  assert.equal(String((await closed)[1]), '');
  const [code, reason] = await once(await connect({ role: 'check' }), 'close');
  assert.deepEqual([code, String(reason)], [1000, 'Room available']);
});

/**
 * A relay that owns its room, as the packaged server runs it, with a worker played by this test.
 * The worker accepts every player's stream, as the emulator's Netplay host does.
 */
async function ownedRoom(t, { fail = false, connectWorker = true, options = {}, saves, exitMs = 0 } = {}) {
  const starts = [], signals = [], workers = [], restoring = [];
  // The emulators that exist: one that was told to end is gone `exitMs` later, as a browser takes a while.
  const existing = new Set();
  let most = 0;
  const relay = createRetroArchRelay({
    port: 0, ownsRooms: true, ...options,
    startDedicated: (setup, signal) => {
      starts.push(setup);
      signals.push(signal);
      if (typeof fail === 'function' ? fail(starts.length - 1) : fail) throw new Error('No browser');
      existing.add(setup.workerKey);
      most = Math.max(most, existing.size);
      return { exited: new Promise(resolve => {
        const gone = () => { existing.delete(setup.workerKey); resolve(); };
        signal.addEventListener('abort', () => { if (exitMs) setTimeout(gone, exitMs); else gone(); }, { once: true });
      }) };
    },
  });
  await once(relay, 'listening');
  const sockets = [];
  t.after(async () => {
    relay.stopDedicated();
    for (const socket of [...sockets, ...relay.clients]) socket.terminate();
    await new Promise(resolve => relay.close(resolve));
  });
  const room = 'b'.repeat(24), token = 'c'.repeat(64), identity = 'd'.repeat(64);
  /** Straight to the relay, as on the server's own computer, or by `via` through a gateway in front of it. */
  async function connect(fields, via) {
    const ws = via ? new WebSocket(via.url, { headers: via.headers })
      : new WebSocket(`ws://127.0.0.1:${relay.address().port}/`, { origin: 'http://127.0.0.1:8000' });
    sockets.push(ws);
    ws.inbox = [];
    ws.binary = [];
    // A connection that the cleanup ends before it was established reports that as an error; it is not one here.
    ws.on('error', () => {});
    ws.on('message', (data, binary) => { if (binary) ws.binary.push(data); else ws.inbox.push(JSON.parse(String(data))); });
    ws.ended = new Promise(resolve => ws.once('close', (code, reason) => resolve(String(reason))));
    await once(ws, 'open');
    ws.send(JSON.stringify({ room, token, identity, ...fields }));
    return ws;
  }
  const until = async (description, done) => {
    for (let attempt = 0; !done(); attempt++) {
      if (attempt > 300) throw new Error(`Timed out waiting until ${description}`);
      await new Promise(resolve => setTimeout(resolve, 10));
    }
  };
  /** Resolves to the player's `ready` message, or to why the relay closed the connection. */
  const seated = async player => {
    const closed = player.ended.then(reason => ({ closed: reason }));
    const ready = (async () => {
      await until('the player is ready', () => player.inbox.some(message => message.type === 'ready') || player.readyState > 1);
      return player.inbox.find(message => message.type === 'ready');
    })();
    return await Promise.race([ready.then(message => message ?? closed), closed]);
  };
  const handle = relay.createRoom({ room, token, identity, progress: 'all', camera: true, nativeCamera: true,
    ...(saves && { saves, onRestoring: active => restoring.push(active) }) });
  /** Plays the emulator that was started last: its worker connects, listens, and accepts every player's stream. */
  async function startWorker({ listen = true } = {}) {
    const worker = new WebSocket(`ws://127.0.0.1:${relay.address().port}/`, { origin: 'http://127.0.0.1:8000' });
    sockets.push(worker);
    workers.push(worker);
    worker.streams = [];
    worker.on('error', () => {});
    worker.on('message', data => {
      const text = String(data);
      if (!text.startsWith('{')) void connect({ role: 'accept', ticket: text }).then(stream => worker.streams.push(stream));
    });
    await once(worker, 'open');
    worker.send(JSON.stringify({ role: 'worker', room, token: starts.at(-1).workerKey }));
    await once(worker, 'message');
    if (listen) {
      worker.send('listening');
      await handle.ready;
    }
    return worker;
  }
  if (connectWorker && fail !== true) await startWorker();
  return { relay, handle, starts, signals, workers, restoring, saves, room, token, identity, connect, seated, until, startWorker,
    worker: () => workers.at(-1), existing: () => existing.size, most: () => most };
}

test('a room opened by the server has four free controllers, and its worker is no player', { timeout: 6000 }, async t => {
  const { handle, starts, connect, seated } = await ownedRoom(t);
  assert.deepEqual(starts.map(({ room, progress, camera, nativeCamera, snapshot }) => ({ room, progress, camera, nativeCamera, snapshot })),
    [{ room: 'b'.repeat(24), progress: 'all', camera: true, nativeCamera: true, snapshot: undefined }]);
  const empty = [0, 1, 2, 3].map(slot => ({ slot, status: 'empty' }));
  assert.deepEqual(handle.status(), { listening: true, players: 0, seats: empty, racing: false, expiresAt: null, restoring: false });
  const first = await seated(await connect({ role: 'guest', roster: true }));
  assert.deepEqual({ type: first.type, slot: first.slot, owner: first.owner }, { type: 'ready', slot: 0, owner: true });
  assert.equal(handle.status().players, 1);
  assert.deepEqual(handle.status().seats.map(seat => seat.status), ['loading', 'empty', 'empty', 'empty']);
});

test('four players get the four controllers and a fifth is refused', { timeout: 6000 }, async t => {
  const { connect, seated } = await ownedRoom(t);
  const slots = [];
  for (let player = 0; player < 4; player++) slots.push((await seated(await connect({ role: 'guest' }))).slot);
  assert.deepEqual(slots, [0, 1, 2, 3]);
  assert.deepEqual(await seated(await connect({ role: 'guest' })), { closed: 'All controllers are connected or reserved' });
});

test('the room goes on when its first player leaves a race, and that player gets the seat back', { timeout: 6000 }, async t => {
  const { handle, connect, seated, until, worker } = await ownedRoom(t);
  const first = await connect({ role: 'guest', roster: true });
  const firstReady = await seated(first);
  const second = await connect({ role: 'guest', roster: true });
  assert.equal((await seated(second)).slot, 1);
  for (const player of [first, second]) player.send('{"type":"synchronized"}');
  await until('both are connected', () => handle.status().seats.filter(seat => seat.status === 'connected').length === 2);
  worker().send('race');
  await until('the race is on', () => handle.status().racing);

  first.terminate();
  await until('the seat is kept for the first player', () => handle.status().seats[0].status === 'reserved');
  await until('the second player owns the room', () => second.inbox.some(message => message.type === 'ownership' && message.owner === true));
  assert.equal(handle.status().listening, true, 'the emulator keeps running');
  assert.equal(worker().readyState, WebSocket.OPEN);

  const returned = await seated(await connect({ role: 'guest', previousSeatKey: firstReady.seatKey, roster: true }));
  assert.deepEqual({ slot: returned.slot, seatKey: returned.seatKey }, { slot: 0, seatKey: firstReady.seatKey });
});

test('a server-owned room with no players has no expiry, unlike a room that a browser created', { timeout: 6000 }, async t => {
  const { relay, handle, room, connect, seated, until } = await ownedRoom(t);
  const player = await connect({ role: 'guest' });
  await seated(player);
  player.terminate();
  await until('the room is empty', () => handle.status().players === 0);
  assert.equal(handle.status().expiresAt, null);
  assert.equal(await (await connect({ role: 'check' })).ended, 'Room available');
  assert.deepEqual(relay.roomStatus(room), handle.status());
  assert.equal(relay.roomStatus('e'.repeat(24)), null);

  // The launcher's way: a browser creates the room, and the room ends a minute after its last player.
  let workerSetup;
  const launcher = createRetroArchRelay({ port: 0, startDedicated: (setup, signal) => {
    workerSetup = setup;
    return { exited: new Promise(resolve => signal.addEventListener('abort', resolve, { once: true })) };
  } });
  await once(launcher, 'listening');
  t.after(async () => {
    launcher.stopDedicated();
    for (const socket of launcher.clients) socket.terminate();
    await new Promise(resolve => launcher.close(resolve));
  });
  const creator = new WebSocket(`ws://127.0.0.1:${launcher.address().port}/`, { origin: 'http://127.0.0.1:8000' });
  await once(creator, 'open');
  creator.send(JSON.stringify({ role: 'create', room, token: 'c'.repeat(64), identity: 'd'.repeat(64), progress: 'all' }));
  await until('the launcher room exists', () => workerSetup && launcher.roomStatus(room));
  assert.equal(launcher.roomStatus(room).expiresAt, null, 'not while its creator is there');
  creator.terminate();
  await until('the launcher room is empty', () => launcher.roomStatus(room)?.players === 0);
  const left = launcher.roomStatus(room).expiresAt - Date.now();
  assert.ok(left > 50_000 && left <= 60_000, `${left} ms`);
});

test('a player whose identity differs is refused and takes no seat', { timeout: 6000 }, async t => {
  const { handle, connect, seated } = await ownedRoom(t);
  assert.deepEqual(await seated(await connect({ role: 'guest', identity: 'e'.repeat(64) })),
    { closed: 'Disc, BIOS or emulator differs from the room' });
  assert.deepEqual(await seated(await connect({ role: 'guest', token: 'f'.repeat(64) })), { closed: 'Invalid invitation' });
  assert.deepEqual({ players: handle.status().players, taken: handle.status().seats.filter(seat => seat.status !== 'empty').length },
    { players: 0, taken: 0 });
});

test('a server that owns its room starts nothing and stops nothing for a player', { timeout: 6000 }, async t => {
  const { handle, starts, connect, seated } = await ownedRoom(t);
  const own = 'This server has one room. Open the game with its invitation link.';
  assert.deepEqual(await seated(await connect({ role: 'create', room: 'a'.repeat(24), progress: 'all' })), { closed: own });
  assert.deepEqual(await seated(await connect({ role: 'host', room: 'a'.repeat(24) })), { closed: own });
  assert.equal(starts.length, 1, 'no second emulator');

  // The only player, connected and the owner: the launcher's room would stop for this request.
  const player = await connect({ role: 'guest', roster: true });
  assert.equal((await seated(player)).releaseForLoad, false);
  player.send('{"type":"synchronized"}');
  player.send('{"type":"release-for-load"}');
  await new Promise(resolve => setTimeout(resolve, 150));
  assert.deepEqual(player.inbox.filter(message => message.type === 'released-for-load'), [{ type: 'released-for-load', allowed: false }]);
  assert.equal(player.readyState, WebSocket.OPEN);
  assert.equal(handle.status().listening, true);
});

test('a guest who arrives before the worker listens waits, and one who arrives between sessions is told to try again', { timeout: 6000 }, async t => {
  const { relay, handle, room, connect, seated, startWorker, worker } = await ownedRoom(t, { connectWorker: false });
  assert.equal(handle.status().listening, false);
  assert.equal(await (await connect({ role: 'check' })).ended, 'Room available');
  const early = await connect({ role: 'guest' });
  await startWorker();
  assert.equal((await seated(early)).slot, 0);

  worker().terminate();
  assert.equal(await handle.ended, 'Dedicated emulator disconnected');
  assert.equal(await early.ended, 'Dedicated emulator disconnected');
  assert.equal(relay.roomStatus(room), null);
  const starting = 'The room is starting. Try again in a moment.';
  assert.equal(await (await connect({ role: 'check' })).ended, starting);
  assert.deepEqual(await seated(await connect({ role: 'guest' })), { closed: starting });
  relay.releaseRoom(room);
  assert.match(await (await connect({ role: 'check' })).ended, /no longer available/);
});

test('a room that cannot start reports why, and a room is described before it is made', { timeout: 6000 }, async t => {
  const { relay, handle, room, token, identity } = await ownedRoom(t, { fail: true });
  await assert.rejects(handle.ready, /Could not start the dedicated emulator/);
  assert.equal(await handle.ended, 'Could not start the dedicated emulator');
  const fields = { room, token, identity, progress: 'all', camera: true };
  for (const wrong of [{ room: 'short' }, { token: 'x' }, { identity: 'x' }, { progress: 'everything' }, { camera: false, nativeCamera: true }])
    assert.throws(() => relay.createRoom({ ...fields, ...wrong }), /Invalid room/);
  const launcher = createRetroArchRelay({ port: 0 });
  await once(launcher, 'listening');
  t.after(() => new Promise(resolve => launcher.close(resolve)));
  assert.throws(() => launcher.createRoom(fields), /cannot run a dedicated emulator/);
});

test('the server cannot open the same room twice', { timeout: 6000 }, async t => {
  const { relay, room, token, identity } = await ownedRoom(t);
  assert.throws(() => relay.createRoom({ room, token, identity, progress: 'all', camera: true }), /already open/);
});

test('the late end of an old emulator does not touch the next session under the same name', { timeout: 6000 }, async t => {
  // Each emulator ends when the test says so, which may be long after its session is over.
  const emulators = [];
  const relay = createRetroArchRelay({ port: 0, ownsRooms: true, startupMs: 100,
    startDedicated: () => new Promise(started => {
      let leave;
      const exited = new Promise(resolve => { leave = resolve; });
      emulators.push(leave);
      started({ exited });
    }) });
  await once(relay, 'listening');
  t.after(() => new Promise(resolve => relay.close(resolve)));
  const spec = { room: 'b'.repeat(24), token: 'c'.repeat(64), identity: 'd'.repeat(64), progress: 'all', camera: true };

  const first = relay.createRoom(spec);
  assert.equal(await first.ended, 'Dedicated emulator did not start');
  const second = relay.createRoom(spec);
  emulators[0]();
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.notEqual(second.status(), null, 'the new session is still the room');
  assert.notEqual(relay.roomStatus(spec.room), null);
  first.stop('Dedicated emulator stopped');
  assert.notEqual(second.status(), null, 'and an old handle cannot end it either');
  second.stop('Dedicated server stopped');
  assert.equal(await second.ended, 'Dedicated server stopped');
  assert.equal(relay.roomStatus(spec.room), null);
});

test('controllers kept for players who left a race are freed once the server\'s room has stood empty', { timeout: 6000 }, async t => {
  const { handle, connect, seated, until, worker } = await ownedRoom(t, { options: { reservedMs: 200 } });
  const players = [await connect({ role: 'guest', roster: true }), await connect({ role: 'guest', roster: true })];
  const keys = [];
  for (const player of players) keys.push((await seated(player)).seatKey);
  for (const player of players) player.send('{"type":"synchronized"}');
  await until('both are connected', () => handle.status().seats.filter(seat => seat.status === 'connected').length === 2);
  worker().send('race');
  await until('the race is on', () => handle.status().racing);

  for (const player of players) player.terminate();
  await until('nobody is left', () => handle.status().players === 0);
  assert.deepEqual(handle.status().seats.map(seat => seat.status), ['reserved', 'reserved', 'empty', 'empty']);
  // A room that somebody keeps asking about is still empty: asking does not hold the controllers.
  // Hooks run in the order they were registered, so this one stops the asking before the sockets are ended.
  const asking = setInterval(() => { connect({ role: 'check' }).catch(() => {}); }, 40);
  const stopAsking = () => clearInterval(asking);
  t.after(stopAsking);
  // The first player comes back in time and gets the controller back; the other controller stays kept while someone plays.
  const returned = await connect({ role: 'guest', previousSeatKey: keys[0], roster: true });
  assert.equal((await seated(returned)).slot, 0);
  await new Promise(resolve => setTimeout(resolve, 300));
  assert.equal(handle.status().seats[1].status, 'reserved');

  returned.terminate();
  await until('nobody is left again', () => handle.status().players === 0);
  await until('the kept controllers are free', () => handle.status().seats.every(seat => seat.status === 'empty'));
  assert.equal(handle.status().expiresAt, null, 'the room itself stays');
  stopAsking();
  assert.equal((await seated(await connect({ role: 'guest' }))).slot, 0);
});

test('a guest who waited for a session that could not start is told to try again', { timeout: 6000 }, async t => {
  const { handle, connect } = await ownedRoom(t, { connectWorker: false, options: { startupMs: 150 } });
  const waiting = await connect({ role: 'guest' });
  assert.equal(await handle.ended, 'Dedicated emulator did not start');
  assert.equal(await waiting.ended, 'The room is starting. Try again in a moment.');
});

// Loading a save inside the server's room. The save travels on a connection of its own, so that the
// player's live input is never mixed with it.

/** The identity key of the saves that fit the room, as the save library writes it. */
const fitting = ['1'.repeat(64), '2'.repeat(64), 'hle', 'pcsx-frame-gate-v3'].join(':');
const notAlone = 'The room is not available for loading a save. Try again when playing alone.';
const loading = 'The room is loading a saved game. Try again in a moment.';
const settling = 'The room is still finishing the last load. Try again in a moment.';
const notStarted = 'The saved game could not be started. The room is unchanged.';
const said = (socket, state) => socket.inbox.some(message => message.type === 'restore' && message.state === state);
const statuses = handle => handle.status().seats.map(seat => seat.status);

/** A state of the right size that carries the marks the format check looks for. */
function validState() {
  const bytes = Buffer.alloc(4456472);
  bytes.write('RASTATE', 0);
  bytes.write('STv4 PCSXra f29871d', 16);
  bytes.writeUInt32LE(1, 0x29934d);
  return bytes;
}

/** One player, seated, synchronized and alone: the owner of the room. */
async function soloPlayer({ handle, connect, seated, until }, via) {
  const player = await connect({ role: 'guest', roster: true }, via);
  const ready = await seated(player);
  player.send('{"type":"synchronized"}');
  await until('the player is connected', () => handle.status().seats[ready.slot].status === 'connected');
  return { player, ready };
}

/** Asks for a load as the player with that `ready`, and waits for the relay to ask for the save or to refuse. */
async function askForLoad({ connect, until, saves }, ready, fields = {}) {
  const request = await connect({ role: 'restore', seatKey: ready.seatKey, save: saves, ...fields });
  await until('the room answers', () => said(request, 'send') || request.readyState > 1);
  return request;
}

/** Sends a good save and waits until the relay has started the second emulator with it, or has refused. */
async function beginLoad(room, ready, state = validState()) {
  const request = await askForLoad(room, ready);
  request.send(state);
  await room.until('the second emulator is started', () => room.starts.length === 2 || request.readyState > 1);
  return request;
}

test('a player alone in the server\'s room loads a save into it', { timeout: 6000 }, async t => {
  const room = await ownedRoom(t, { saves: fitting });
  const { relay, handle, starts, signals, workers, until, startWorker } = room;
  const { player, ready } = await soloPlayer(room);
  assert.equal(ready.restore, true);

  const state = validState();
  const request = await askForLoad(room, ready);
  assert.equal(said(request, 'send'), true);
  assert.equal(handle.status().restoring, false, 'asking changes nothing');
  // The game goes on while the save is on its way, and nothing of the save reaches the emulator's stream.
  player.send(Buffer.from([1, 2, 3]));
  request.send(state);
  await until('the second emulator is started', () => starts.length === 2);
  await until('the room says so', () => said(request, 'starting'));
  await until('the input arrived', () => workers[0].streams[0]?.binary.length > 0);
  assert.deepEqual(workers[0].streams[0].binary, [Buffer.from([1, 2, 3])]);
  assert.deepEqual(starts.map(start => start.room), [room.room, room.room]);
  assert.notEqual(starts[1].workerKey, starts[0].workerKey);
  assert.equal(starts[0].snapshot, undefined);
  assert.equal(starts[1].snapshot === state.toString('base64'), true, 'the second emulator starts with the save');
  assert.equal(handle.status().restoring, true);
  assert.deepEqual(room.restoring, [true]);
  assert.equal(signals[0].aborted, false, 'the first emulator runs until the second listens');
  assert.equal(player.readyState, WebSocket.OPEN);

  await startWorker();
  assert.equal(await request.ended, 'Saved game loaded');
  assert.equal(said(request, 'done'), true);
  assert.equal(await player.ended, 'Saved game loaded');
  await until('the first emulator is told to end', () => signals[0].aborted);
  assert.equal(signals[1].aborted, false);
  // The room is the same one: its name is still taken, and it never ended.
  assert.equal(relay.roomStatus(room.room).listening, true);
  assert.equal(await Promise.race([handle.ended, new Promise(resolve => setTimeout(() => resolve('still open'), 50))]), 'still open');
});

test('the player returns to the same controller after a load and owns the room again', { timeout: 6000 }, async t => {
  const room = await ownedRoom(t, { saves: fitting });
  const { handle, connect, seated, startWorker } = room;
  const { player, ready } = await soloPlayer(room);
  await beginLoad(room, ready);
  await startWorker();
  await player.ended;
  assert.deepEqual(statuses(handle), ['reserved', 'empty', 'empty', 'empty']);
  assert.equal(handle.status().restoring, true, 'until the player is back');

  const back = await seated(await connect({ role: 'guest', previousSeatKey: ready.seatKey, roster: true }));
  assert.deepEqual({ slot: back.slot, owner: back.owner, seatKey: back.seatKey, restore: back.restore },
    { slot: 0, owner: true, seatKey: ready.seatKey, restore: true });
  assert.equal(handle.status().restoring, false);
  assert.deepEqual(room.restoring, [true, false]);
  assert.equal((await seated(await connect({ role: 'guest' }))).slot, 1);
});

test('others are told to try again while a save is loading and until its player is back', { timeout: 6000 }, async t => {
  const room = await ownedRoom(t, { saves: fitting, options: { reservedMs: 1000 } });
  const { handle, connect, seated, until, startWorker } = room;
  const { player, ready } = await soloPlayer(room);
  await beginLoad(room, ready);
  assert.equal(await (await connect({ role: 'check' })).ended, loading);
  assert.deepEqual(await seated(await connect({ role: 'guest' })), { closed: loading });
  assert.equal(await (await askForLoad(room, ready)).ended, notAlone, 'one load at a time');
  assert.equal(handle.status().players, 1, 'nobody was seated in the emulator that is about to end');

  await startWorker();
  await player.ended;
  assert.deepEqual(await seated(await connect({ role: 'guest' })), { closed: loading });
  // The player never returns: the kept controller lapses and the room opens by itself.
  await until('the room is open again', () => !handle.status().restoring);
  assert.deepEqual(statuses(handle), ['empty', 'empty', 'empty', 'empty']);
  assert.deepEqual(room.restoring, [true, false]);
  const next = await seated(await connect({ role: 'guest' }));
  assert.deepEqual({ slot: next.slot, owner: next.owner }, { slot: 0, owner: true });
});

test('the player of a load may ask about the room on the way back, and nobody else', { timeout: 6000 }, async t => {
  const room = await ownedRoom(t, { saves: fitting });
  const { connect, startWorker } = room;
  const { player, ready } = await soloPlayer(room);
  await beginLoad(room, ready);
  // While the second emulator starts the answer is the same for everybody: the game is not there yet.
  assert.equal(await (await connect({ role: 'check', seatKey: ready.seatKey })).ended, loading);
  await startWorker();
  await player.ended;
  // A page that was reloaded once more, or opened again, asks first. Its controller key says whose load it is.
  assert.equal(await (await connect({ role: 'check', seatKey: ready.seatKey })).ended, 'Room available');
  assert.equal(await (await connect({ role: 'check' })).ended, loading);
  assert.equal(await (await connect({ role: 'check', seatKey: 'e'.repeat(32) })).ended, loading);
  assert.equal(room.handle.status().restoring, true, 'asking changes nothing');
});

test('a load is refused and the room is untouched', { timeout: 6000 }, async t => {
  const room = await ownedRoom(t, { saves: fitting });
  const { handle, starts, workers, connect, seated, until } = room;
  const refusal = async fields => (await connect({ role: 'restore', save: fitting, ...fields })).ended;
  const first = await connect({ role: 'guest', roster: true });
  const own = { seatKey: (await seated(first)).seatKey };
  assert.equal(await refusal(own), notAlone, 'the player is not synchronized yet');
  first.send('{"type":"synchronized"}');
  await until('the first player is connected', () => statuses(handle)[0] === 'connected');
  assert.equal(await refusal({ ...own, token: 'f'.repeat(64) }), 'Invalid invitation');
  assert.equal(await refusal({ ...own, room: 'a'.repeat(24) }), 'Invalid invitation');
  assert.equal(await refusal({ seatKey: 'e'.repeat(32) }), notAlone, 'not a controller of this room');
  assert.equal(await refusal({}), notAlone, 'no controller key at all');

  workers[0].send('race');
  await until('a race is on', () => handle.status().racing);
  assert.equal(await refusal(own), notAlone, 'a race runs');
  workers[0].send('lobby');
  await until('the race is over', () => !handle.status().racing);

  const second = await connect({ role: 'guest', roster: true });
  const other = { seatKey: (await seated(second)).seatKey };
  assert.equal(await refusal(own), notAlone, 'another player is there');
  assert.equal(await refusal(other), notAlone, 'and that player does not own the room');
  second.send('{"type":"synchronized"}');
  await until('both are connected', () => statuses(handle)[1] === 'connected');
  workers[0].send('race');
  await until('a race is on again', () => handle.status().racing);
  second.terminate();
  await until('the controller is kept', () => statuses(handle)[1] === 'reserved');
  assert.equal(handle.status().players, 1);
  assert.equal(await refusal(own), notAlone, 'a controller is kept for a player who left');

  assert.equal(starts.length, 1, 'no second emulator');
  assert.equal(first.readyState, WebSocket.OPEN);
  assert.equal(handle.status().restoring, false);
  assert.deepEqual(room.restoring, []);
});

test('a save that is damaged, cut short, of another game, or sent as text is refused before anything starts', { timeout: 6000 }, async t => {
  const room = await ownedRoom(t, { saves: fitting });
  const { player, ready } = await soloPlayer(room);
  const otherGame = 'This save belongs to a different game or emulator build.';
  assert.equal(await (await askForLoad(room, ready, { save: fitting.replace('hle', 'f'.repeat(64)) })).ended, otherGame, 'a custom BIOS');
  assert.equal(await (await askForLoad(room, ready, { save: undefined })).ended, otherGame);
  const damaged = validState();
  damaged[20] ^= 0xff;
  for (const bytes of [damaged, validState().subarray(0, 1000), Buffer.alloc(0), '{"not":"a save"}']) {
    const request = await askForLoad(room, ready);
    request.send(bytes);
    assert.equal(await request.ended, 'Invalid game save');
  }
  assert.equal(room.starts.length, 1, 'no second emulator');
  assert.equal(player.readyState, WebSocket.OPEN);
  assert.deepEqual(room.restoring, []);
  // Nothing is left of the refused attempts: the same player loads a good save right after.
  await beginLoad(room, ready);
  assert.equal(room.starts.length, 2);
});

test('a player who joins while the save is on its way voids the load', { timeout: 6000 }, async t => {
  const room = await ownedRoom(t, { saves: fitting });
  const { player, ready } = await soloPlayer(room);
  const request = await askForLoad(room, ready);
  const second = await room.connect({ role: 'guest' });
  assert.equal((await room.seated(second)).slot, 1, 'the room is open until a good save has arrived');
  request.send(validState());
  assert.equal(await request.ended, notAlone);
  assert.equal(room.starts.length, 1);
  assert.deepEqual([player.readyState, second.readyState], [WebSocket.OPEN, WebSocket.OPEN]);
});

test('a save that does not arrive in time is given up', { timeout: 6000 }, async t => {
  const room = await ownedRoom(t, { saves: fitting, options: { transferMs: 50 } });
  const { player, ready } = await soloPlayer(room);
  const request = await askForLoad(room, ready);
  assert.equal(said(request, 'send'), true);
  assert.equal(await request.ended, 'Save transfer timed out');
  assert.equal(room.starts.length, 1);
  assert.equal(player.readyState, WebSocket.OPEN);
  assert.equal(room.handle.status().restoring, false);
});

for (const [what, setup, act] of [
  ['cannot start', { fail: index => index === 1 }],
  ['never listens', { options: { startupMs: 1000 } }],
  ['loses its connection before it listens', {}, async room => (await room.startWorker({ listen: false })).terminate()],
]) {
  test(`a new emulator that ${what} is stopped, and the old one keeps the room`, { timeout: 6000 }, async t => {
    const room = await ownedRoom(t, { saves: fitting, ...setup });
    const { handle, signals, workers, connect, seated, until } = room;
    const { player, ready } = await soloPlayer(room);
    const request = await beginLoad(room, ready);
    await act?.(room);
    assert.equal(await request.ended, notStarted);
    assert.deepEqual(signals.map(signal => signal.aborted), [false, true]);
    assert.equal(handle.status().restoring, false);
    assert.deepEqual(room.restoring, [true, false]);
    assert.deepEqual(statuses(handle), ['connected', 'empty', 'empty', 'empty']);
    // The game goes on: the player's input reaches the first emulator, and the room takes players again.
    player.send(Buffer.from([9]));
    await until('the input arrived', () => workers[0].streams[0]?.binary.length > 0);
    assert.equal((await seated(await connect({ role: 'guest' }))).slot, 1);
    assert.equal(player.readyState, WebSocket.OPEN);
  });
}

for (const [what, leave] of [
  ['its player leaves', ({ player }) => player.terminate()],
  ['its player calls it off', ({ request }) => request.terminate()],
]) {
  test(`a load ends with nothing changed when ${what} before the new emulator listens`, { timeout: 6000 }, async t => {
    const room = await ownedRoom(t, { saves: fitting });
    const { handle, signals, connect, seated, until } = room;
    const { player, ready } = await soloPlayer(room);
    const request = await beginLoad(room, ready);
    leave({ player, request });
    await until('the new emulator is stopped', () => signals[1].aborted);
    await until('the room is open again', () => !handle.status().restoring);
    assert.equal(signals[0].aborted, false);
    assert.deepEqual(room.restoring, [true, false]);
    await request.ended;
    const next = await seated(await connect({ role: 'guest' }));
    assert.equal(next.type, 'ready', 'the first emulator still takes players');
  });
}

test('a load is called off when its player is dropped, before that player\'s connection has closed', { timeout: 6000 }, async t => {
  const room = await ownedRoom(t, { saves: fitting });
  const { handle, signals, workers, until } = room;
  const { player, ready } = await soloPlayer(room);
  const request = await beginLoad(room, ready);
  // The player's computer stops reading, so it cannot answer the relay's close. Then the emulator lets
  // the player go, and the relay drops a player whose connection stays half open.
  player._socket.pause();
  workers[0].streams[0].terminate();
  await until('the relay has dropped the player', () => handle.status().players === 0);
  await until('the new emulator is stopped', () => signals[1].aborted);
  assert.equal(await request.ended, notAlone);
  assert.equal(handle.status().restoring, false);
  assert.equal(signals[0].aborted, false, 'the room keeps its emulator');
});

test('a load that was called off holds the next one until its emulator is gone and a pause has passed', { timeout: 6000 }, async t => {
  const room = await ownedRoom(t, { saves: fitting, exitMs: 100, options: { retryMs: 1500 } });
  const { starts, signals, until } = room;
  const { player, ready } = await soloPlayer(room);
  const request = await beginLoad(room, ready);
  const calledOff = performance.now();
  request.terminate();
  await until('the new emulator is told to end', () => signals[1].aborted);
  // Asked again at once: refused in words, and nothing more is started.
  assert.equal(await (await askForLoad(room, ready)).ended, settling);
  await until('that emulator is gone', () => room.existing() === 1);
  assert.equal(await (await askForLoad(room, ready)).ended, settling, 'gone, but the pause has not passed');
  assert.equal(starts.length, 2);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, 1600 - (performance.now() - calledOff))));
  assert.equal(said(await askForLoad(room, ready), 'send'), true, 'then the room takes a load again');
  assert.equal(player.readyState, WebSocket.OPEN);
});

test('a player who asks and calls off again and again starts few emulators, and never more than two exist', { timeout: 8000 }, async t => {
  const room = await ownedRoom(t, { saves: fitting, exitMs: 150, options: { retryMs: 400 } });
  const { starts, until } = room;
  const { player, ready } = await soloPlayer(room);
  const state = validState();
  const began = performance.now();
  while (performance.now() - began < 1500) {
    const request = await askForLoad(room, ready);
    if (!said(request, 'send')) continue;
    request.send(state);
    await until('the room answers the save', () => said(request, 'starting') || request.readyState > 1);
    request.terminate();
    await request.ended;
  }
  assert.ok(room.most() <= 2, `the room's emulator and one for a load, saw ${room.most()} at once`);
  // One load in each pause. A second and a half holds four of them.
  assert.ok(starts.length - 1 <= 5, `saw ${starts.length - 1} emulators started`);
  assert.equal(player.readyState, WebSocket.OPEN);
});

test('after a load the next one waits until the emulator that was replaced is gone', { timeout: 8000 }, async t => {
  const room = await ownedRoom(t, { saves: fitting, exitMs: 1500 });
  const { handle, connect, seated, startWorker, until } = room;
  const { player, ready } = await soloPlayer(room);
  await beginLoad(room, ready);
  await startWorker();
  await player.ended;
  const back = await connect({ role: 'guest', previousSeatKey: ready.seatKey, roster: true });
  const again = await seated(back);
  back.send('{"type":"synchronized"}');
  await until('the player is connected', () => handle.status().seats[0].status === 'connected');
  assert.equal(room.existing(), 2, 'the first emulator is still ending');
  assert.equal(await (await askForLoad(room, again)).ended, settling);
  assert.equal(room.starts.length, 2);
  await until('the first emulator is gone', () => room.existing() === 1);
  assert.equal(said(await askForLoad(room, again), 'send'), true);
});

test('a save may take a minute to arrive', { timeout: 6000 }, async t => {
  const room = await ownedRoom(t, { saves: fitting });
  const { player, ready } = await soloPlayer(room);
  // From here on the relay's clock is the test's, so that nobody waits a minute for its own deadline.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  t.after(() => t.mock.timers.reset());
  const turns = async (done, most = 2000) => {
    for (let turn = 0; turn < most && !done(); turn++) await new Promise(resolve => setImmediate(resolve));
  };
  const request = await room.connect({ role: 'restore', seatKey: ready.seatKey, save: fitting });
  await turns(() => said(request, 'send') || request.readyState > 1);
  assert.equal(said(request, 'send'), true);
  // A player far away sends 4.4 MB on an uplink that also carries the game: most of a minute is ordinary.
  t.mock.timers.tick(59_000);
  await turns(() => request.readyState > 1, 50);
  assert.equal(request.readyState, WebSocket.OPEN, 'the room still waits for the save');
  request.send(validState());
  await turns(() => room.starts.length === 2 || request.readyState > 1);
  assert.equal(room.starts.length, 2, 'and takes it');
  assert.equal(player.readyState, WebSocket.OPEN);
});

test('a load asked through the gateway arrives whole, and the live input beside it is untouched', { timeout: 10_000 }, async t => {
  const room = await ownedRoom(t, { saves: fitting });
  const { starts, workers, connect, seated, until, startWorker } = room;
  const access = 'a'.repeat(48);
  const gateway = createPublicGateway({ port: 0, netplay: room.relay.address().port, accessToken: access, maxPayload: 8 * 1024 * 1024 });
  await once(gateway, 'listening');
  t.after(() => gateway.close());
  const address = `127.0.0.1:${gateway.address().port}`;
  const headers = { origin: `https://${address}`, cookie: `sled_access=${access}` };
  // Behind the public address the page plays on a mirrored connection and asks for the load on a plain one.
  const plain = { url: `ws://${address}/netplay`, headers };
  const mirrored = key => ({ url: `ws://${address}/netplay?duplex=${key.repeat(48)}`, headers });

  const { player, ready } = await soloPlayer(room, mirrored('e'));
  await until('the emulator has the player\'s stream', () => workers[0].streams.length === 1);
  const refused = await connect({ role: 'restore', seatKey: 'e'.repeat(32), save: fitting }, plain);
  assert.equal(await refused.ended, notAlone, 'a refusal reaches the page in the room\'s words');

  const state = validState();
  // Marked, so that any piece of the save would be known in the emulator's stream.
  for (let offset = 4096; offset < state.length - 64; offset += 65536) state.write('SAVE-BYTES', offset);
  const request = await connect({ role: 'restore', seatKey: ready.seatKey, save: fitting }, plain);
  await until('the room asks for the save', () => said(request, 'send') || request.readyState > 1);
  assert.equal(said(request, 'send'), true);
  // Input before, during and after the save, numbered as the page numbers it for the gateway.
  let sequence = 0;
  const input = value => player.send(sequencePacket(sequence++, Buffer.from([0xa0, value])));
  input(1);
  request.send(state);
  input(2);
  await until('the second emulator is started', () => starts.length === 2 || request.readyState > 1);
  input(3);
  assert.equal(starts.length, 2);
  assert.equal(starts[1].snapshot === state.toString('base64'), true, 'the save arrived whole');
  await until('the input arrived', () => workers[0].streams[0].binary.length === 3);
  assert.deepEqual(workers[0].streams[0].binary.map(bytes => [...bytes]), [[0xa0, 1], [0xa0, 2], [0xa0, 3]]);
  assert.equal(workers[0].streams[0].binary.some(bytes => bytes.includes('SAVE-BYTES')), false);

  await startWorker();
  assert.equal(await request.ended, 'Saved game loaded');
  assert.equal(await player.ended, 'Saved game loaded');
  assert.equal(await (await connect({ role: 'check' }, plain)).ended, loading);
  const back = await seated(await connect({ role: 'guest', previousSeatKey: ready.seatKey, roster: true }, mirrored('f')));
  assert.deepEqual({ slot: back.slot, owner: back.owner, seatKey: back.seatKey }, { slot: 0, owner: true, seatKey: ready.seatKey });
});

test('the room ending during a load ends both emulators', { timeout: 6000 }, async t => {
  const room = await ownedRoom(t, { saves: fitting });
  const { player, ready } = await soloPlayer(room);
  const request = await beginLoad(room, ready);
  room.workers[0].terminate();
  assert.equal(await room.handle.ended, 'Dedicated emulator disconnected');
  assert.deepEqual(room.signals.map(signal => signal.aborted), [true, true]);
  assert.equal(await player.ended, 'Dedicated emulator disconnected');
  assert.equal(await request.ended, 'Dedicated emulator disconnected');
  assert.deepEqual(room.restoring, [true, false]);
  assert.equal(room.relay.roomStatus(room.room), null);
});

test('a room made by a browser, and a server\'s room without saves, have no restore', { timeout: 6000 }, async t => {
  const room = await ownedRoom(t);
  const { player, ready } = await soloPlayer(room);
  assert.notEqual(ready.restore, true);
  assert.equal(await (await askForLoad({ ...room, saves: fitting }, ready)).ended, 'Invalid invitation');
  assert.equal(room.starts.length, 1);
  assert.equal(player.readyState, WebSocket.OPEN);
  const fields = { room: 'a'.repeat(24), token: room.token, identity: room.identity, progress: 'all', camera: true };
  for (const saves of ['', 'x'.repeat(257), 5])
    assert.throws(() => room.relay.createRoom({ ...fields, saves }), /Invalid room/);

  // The launcher's room keeps its own way of loading, which the tests above cover.
  const { creator, connect } = await dedicatedRoom(t);
  const request = await connect({ role: 'restore', seatKey: 'e'.repeat(32), save: fitting });
  assert.equal(String((await once(request, 'close'))[1]), 'Invalid invitation');
  assert.equal(creator.readyState, WebSocket.OPEN);
});
