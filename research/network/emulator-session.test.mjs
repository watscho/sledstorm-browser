import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createRelay } from './server.mjs';

test('checkpoint join freezes the exact boundary, transfers a bounded snapshot and resumes pad order', async t => {
  const relay = createRelay({ port: 0, checkpoints: true, inputDelay: 0 });
  await once(relay, 'listening');
  const clients = [];
  t.after(async () => { for (const c of clients) c.terminate(); await new Promise(resolve => relay.close(resolve)); });
  async function client() {
    const socket = new WebSocket(`ws://127.0.0.1:${relay.address().port}`, { maxPayload: 8 * 1024 * 1024 });
    const queued = [], pending = [];
    socket.on('message', bytes => {
      const data = JSON.parse(bytes.toString());
      const i = pending.findIndex(item => item.type === data.type);
      if (i < 0) queued.push(data); else pending.splice(i, 1)[0].resolve(data);
    });
    clients.push(socket); await once(socket, 'open');
    return { send: msg => socket.send(JSON.stringify(msg)), next: type => {
      const i = queued.findIndex(item => item.type === type);
      return i < 0 ? new Promise(resolve => pending.push({ type, resolve })) : Promise.resolve(queued.splice(i, 1)[0]);
    } };
  }
  const host = await client(); host.send({ type: 'create', identity: 'a'.repeat(64) });
  const room = await host.next('created'); await host.next('start');
  host.send({ type: 'ready', tick: 0 }); host.send({ type: 'input', tick: 0, pad: 65534, state: 123 });
  assert.equal((await host.next('frame')).tick, 0);
  const guest = await client(); guest.send({ type: 'join', identity: 'a'.repeat(64), room: room.room, token: room.token });
  const start = await guest.next('start');
  assert.equal(start.snapshot, true); assert.equal(start.replayTarget, 1);
  assert.deepEqual(await host.next('snapshot-request'), { type: 'snapshot-request', tick: 1, slot: 1 });
  const data = 'A'.repeat(5941964);
  host.send({ type: 'snapshot', slot: 1, tick: 1, data, checks: [[0, 123]] });
  const snapshot = await guest.next('snapshot'); assert.equal(snapshot.data, data); assert.deepEqual(snapshot.checks, [[0, 123]]);
  host.send({ type: 'input', tick: 1, pad: 65533, state: null });
  guest.send({ type: 'ready', tick: 1 }); guest.send({ type: 'input', tick: 1, pad: 65531, state: null });
  const row = await host.next('frame'); assert.deepEqual(row.pads, [65533, 65531, 65535, 65535]);
  assert.equal((await guest.next('frame')).tick, 1);
});
