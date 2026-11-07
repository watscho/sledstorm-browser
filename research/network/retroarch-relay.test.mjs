import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { WebSocket } from 'ws';
import { createRetroArchRelay } from './retroarch-relay.mjs';
import { createPublicGateway } from './public-server.mjs';

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
  const message = async ws => (await once(ws, 'message'))[0];
  try {
    assert.match(String((await once(connect(false), 'error'))[0]), /403/);
    const host = connect();
    await once(host, 'open');
    send(host, { role: 'host' });
    assert.deepEqual(JSON.parse(await message(host)), { type: 'ready', slot: 0 });
    const attach = async (slot, preferredSlot) => {
      const incoming = message(host);
      const guest = connect();
      await once(guest, 'open');
      send(guest, { role: 'guest', preferredSlot });
      const ready = message(guest);
      const stream = connect();
      await once(stream, 'open');
      send(stream, { role: 'accept', ticket: String(await incoming) });
      assert.deepEqual(JSON.parse(await ready), { type: 'ready', slot });
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
  const seat1 = '1'.repeat(32), seat2 = '2'.repeat(32);
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
    const creator = await connect({ role: 'create', seatKey: seat1, progress: 'all' });
    const { workerKey } = await setup;
    const firstReady = message(creator);
    const worker = await connect({ role: 'worker', token: workerKey });
    await message(worker);
    const firstTicket = message(worker);
    worker.send('listening');
    const firstStream = await connect({ role: 'accept', ticket: String(await firstTicket) });
    assert.equal(JSON.parse(await firstReady).slot, 0);
    async function attach(seatKey, slot) {
      const ticket = message(worker);
      const guest = await connect({ role: 'guest', seatKey });
      const ready = message(guest);
      const stream = await connect({ role: 'accept', ticket: String(await ticket) });
      assert.equal(JSON.parse(await ready).slot, slot);
      return { guest, stream };
    }
    const second = await attach(seat2, 1);
    const seat3 = '3'.repeat(32), seat4 = '4'.repeat(32);
    const third = await attach(seat3, 2);
    const fourth = await attach(seat4, 3);
    const dropped = once(firstStream, 'close');
    const ownership = message(second.guest);
    creator.close();
    await dropped;
    assert.deepEqual(JSON.parse(await ownership), { type: 'ownership', owner: true });
    const bytes = Buffer.from([2, 255, 0]);
    const received = once(second.stream, 'message');
    second.guest.send(bytes);
    assert.deepEqual(await received, [bytes, true]);
    const othersDropped = [once(third.stream, 'close'), once(fourth.stream, 'close')];
    third.guest.close();
    fourth.guest.close();
    await Promise.all(othersDropped);
    const unknown = await connect({ role: 'guest', seatKey: '5'.repeat(32) });
    assert.equal(String((await once(unknown, 'close'))[1]), 'All controllers are connected or reserved');
    await attach(seat4, 3);
    await attach(seat1, 0);
    await attach(seat3, 2);
  } finally {
    relay.stopDedicated();
    for (const socket of sockets) socket.terminate();
    await new Promise(resolve => relay.close(resolve));
  }
});

test('the dedicated roster retains a private controller reservation past the lobby grace period during a race', { timeout: 6000 }, async t => {
  let now = Date.now();
  t.mock.method(Date, 'now', () => now);
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
  const room = 'b'.repeat(24), token = 'c'.repeat(64), identity = 'd'.repeat(64), key = '1'.repeat(32);
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
    const original = await connect({ role: 'create', seatKey: key, progress: 'all', roster: true });
    const worker = await connect({ role: 'worker', token: (await setup).workerKey });
    await worker.next(type('ready'));
    worker.ws.send('listening');
    const stream = await connect({ role: 'accept', ticket: await worker.next() });
    await original.next(type('ready'));
    original.ws.send(JSON.stringify({ type: 'player', synchronized: true, ready: true, name: 'Rider' }));
    const roster = predicate => value => type('roster')(value) && predicate(JSON.parse(value));
    await original.next(roster(message => message.seats[0].ready && message.seats[0].name === 'Rider'));
    worker.ws.send('race');
    await original.next(roster(message => message.racing));
    const closed = once(stream.ws, 'close');
    original.ws.close();
    await closed;
    now += 90_000;
    const returned = await connect({ role: 'guest', seatKey: key, recover: true, roster: true });
    await connect({ role: 'accept', ticket: await worker.next() });
    assert.equal(JSON.parse(await returned.next(type('ready'))).slot, 0);
    await returned.next(roster(message => message.racing && message.seats[0].name === 'Rider'));
    const invalid = await connect({ role: 'guest', seatKey: '9'.repeat(32), recover: true });
    assert.match(String((await once(invalid.ws, 'close'))[1]), /no longer has a reserved controller/);
  } finally {
    relay.stopDedicated();
    for (const socket of sockets) socket.terminate();
    await new Promise(resolve => relay.close(resolve));
  }
});
