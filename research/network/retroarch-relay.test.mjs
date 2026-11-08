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
