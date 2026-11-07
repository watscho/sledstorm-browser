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
