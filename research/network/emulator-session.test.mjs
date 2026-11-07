import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { WebSocket } from 'ws';
import { createRelay } from './server.mjs';

test('checkpoint transfer leaves the room live and the guest replays only the frames after the snapshot', { timeout: 12000 }, async t => {
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
  const live = await host.next('frame');
  assert.deepEqual(live.pads, [65533, 65535, 65535, 65535]);
  guest.send({ type: 'snapshot-restored', tick: 1 });
  assert.deepEqual(await guest.next('snapshot-boundary'), { type: 'snapshot-boundary', tick: 2 });
  guest.send({ type: 'history', from: 1 });
  assert.deepEqual((await guest.next('history')).frames, [live]);
  guest.send({ type: 'ready', tick: 2 }); guest.send({ type: 'input', tick: 2, pad: 65531, state: null });
  host.send({ type: 'input', tick: 2, pad: 65533, state: null });
  assert.deepEqual((await host.next('frame')).pads, [65533, 65531, 65535, 65535]);
  assert.equal((await guest.next('frame')).tick, 2);

  const rejected = await client();
  rejected.send({ type: 'join', identity: 'a'.repeat(64), room: room.room, token: room.token });
  const next = await rejected.next('start');
  assert.equal(next.replayTarget, 3);
  await host.next('snapshot-request');
  host.send({ type: 'snapshot-unavailable', slot: next.slot, tick: next.replayTarget });
  assert.match((await rejected.next('ended')).reason, /capture the room snapshot/);
  host.send({ type: 'input', tick: 3, pad: 65534, state: null });
  guest.send({ type: 'input', tick: 3, pad: 65533, state: null });
  assert.equal((await host.next('frame')).tick, 3);
  assert.equal((await guest.next('frame')).tick, 3);

  // A guest can restore matching bytes and still diverge on the first live checksum.
  host.send({ type: 'input', tick: 4, pad: 65533, state: 456 });
  guest.send({ type: 'input', tick: 4, pad: 65531, state: 789 });
  assert.match((await guest.next('ended')).reason, /desync at tick 4/);
  assert.deepEqual((await host.next('frame')).pads, [65533, 65535, 65535, 65535]);

  const stalled = await client();
  stalled.send({ type: 'join', identity: 'a'.repeat(64), room: room.room, token: room.token });
  const stalledStart = await stalled.next('start');
  await host.next('snapshot-request');
  host.send({ type: 'snapshot', slot: stalledStart.slot, tick: 5, data, checks: [] });
  await stalled.next('snapshot');
  stalled.send({ type: 'snapshot-restored', tick: 5 });
  await stalled.next('snapshot-boundary');
  stalled.send({ type: 'ready', tick: 5 });
  stalled.send({ type: 'input', tick: 5, pad: 65531, state: null });
  host.send({ type: 'input', tick: 5, pad: 65533, state: null });
  assert.equal((await stalled.next('frame')).tick, 5);
  assert.equal((await host.next('frame')).tick, 5);
  host.send({ type: 'input', tick: 6, pad: 65533, state: null });
  stalled.send({ type: 'ping' });
  await stalled.next('pong');
  assert.match((await stalled.next('ended')).reason, /stopped sending inputs/);
  assert.equal((await host.next('frame')).tick, 6);
});
