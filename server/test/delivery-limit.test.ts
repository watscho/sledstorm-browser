import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate as tick } from 'node:timers/promises';
import { createDeliveryLimit, DeliveryBusyError } from '../src/delivery-limit.ts';

const never = () => new AbortController().signal;

/** Whether the promise has settled after the pending callbacks ran. */
async function settled(promise: Promise<unknown>): Promise<boolean> {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  await tick();
  await tick();
  return done;
}

test('places are given in order and the queue is bounded', async () => {
  const limit = createDeliveryLimit({ active: 2, waiting: 1 });
  const first = await limit.acquire(never());
  await limit.acquire(never());
  const third = limit.acquire(never());
  assert.equal(await settled(third), false);
  assert.deepEqual([limit.running, limit.queued], [2, 1]);
  await assert.rejects(limit.acquire(never()), DeliveryBusyError);
  assert.deepEqual([limit.running, limit.queued], [2, 1]);
  first();
  assert.equal(typeof await third, 'function');
  assert.deepEqual([limit.running, limit.queued], [2, 0]);
});

test('a waiter that gives up leaves the queue', async () => {
  const limit = createDeliveryLimit({ active: 1, waiting: 1 });
  const first = await limit.acquire(never());
  const leaving = new AbortController();
  const second = limit.acquire(leaving.signal);
  const reason = new Error('the client went away');
  leaving.abort(reason);
  await assert.rejects(second, error => error === reason);
  assert.equal(limit.queued, 0);
  const third = limit.acquire(never());
  assert.equal(await settled(third), false, 'the third waits instead of being refused');
  first();
  assert.equal(typeof await third, 'function');
  assert.deepEqual([limit.running, limit.queued], [1, 0]);
});

test('a second release frees nothing more', async () => {
  const limit = createDeliveryLimit({ active: 2, waiting: 2 });
  const first = await limit.acquire(never());
  await limit.acquire(never());
  const third = limit.acquire(never());
  const fourth = limit.acquire(never());
  first();
  first();
  await third;
  assert.equal(await settled(fourth), false, 'one release serves one waiter');
  assert.deepEqual([limit.running, limit.queued], [2, 1]);
});

test('the last release empties the limit', async () => {
  const limit = createDeliveryLimit({ active: 2, waiting: 0 });
  const first = await limit.acquire(never());
  const second = await limit.acquire(never());
  await assert.rejects(limit.acquire(never()), DeliveryBusyError, 'no queue at all');
  first();
  second();
  assert.deepEqual([limit.running, limit.queued], [0, 0]);
  await limit.acquire(never());
  assert.equal(limit.running, 1);
});

test('an aborted signal is refused at once', async () => {
  const limit = createDeliveryLimit({ active: 1, waiting: 1 });
  const gone = new AbortController();
  gone.abort(new Error('gone'));
  await assert.rejects(limit.acquire(gone.signal), /gone/);
  assert.deepEqual([limit.running, limit.queued], [0, 0]);
});
