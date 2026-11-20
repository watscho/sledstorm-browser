import assert from 'node:assert/strict';
import test from 'node:test';
import { StackStartError, startStack, type StackStep } from '../src/stack.ts';

function recorder() {
  const events: string[] = [];
  const step = (name: string, { fail = false, failStop = false } = {}): StackStep => ({
    name,
    async start() {
      if (fail) {
        events.push(`fail ${name}`);
        throw new Error(`${name} broke`);
      }
      events.push(`start ${name}`);
      return async () => {
        events.push(`stop ${name}`);
        if (failStop) throw new Error(`${name} stuck`);
      };
    },
  });
  return { events, step };
}

test('a failure at any position stops the started steps in reverse', async () => {
  const expected: Record<string, string[]> = {
    a: ['fail a'],
    b: ['start a', 'fail b', 'stop a'],
    c: ['start a', 'start b', 'fail c', 'stop b', 'stop a'],
  };
  for (const failing of ['a', 'b', 'c']) {
    const { events, step } = recorder();
    await assert.rejects(startStack(['a', 'b', 'c'].map(name => step(name, { fail: name === failing }))), error => {
      assert.ok(error instanceof StackStartError, String(error));
      assert.equal(error.component, failing);
      assert.equal(error.message, `${failing} broke`);
      assert.equal((error.cause as Error).message, `${failing} broke`);
      return true;
    });
    assert.deepEqual(events, expected[failing]);
  }
});

test('all steps start in order and stop in reverse, once', async () => {
  const { events, step } = recorder();
  const stop = await startStack(['a', 'b', 'c'].map(name => step(name)));
  assert.deepEqual(events, ['start a', 'start b', 'start c']);
  await Promise.all([stop(), stop()]);
  await stop();
  assert.deepEqual(events.slice(3), ['stop c', 'stop b', 'stop a']);
});

test('stop and rollback continue past a step that fails to stop', async () => {
  const first = recorder();
  const complaints: string[] = [];
  const stop = await startStack([first.step('a'), first.step('b', { failStop: true }), first.step('c')],
    (component, error) => complaints.push(`${component}: ${(error as Error).message}`));
  await stop();
  assert.deepEqual(first.events.slice(3), ['stop c', 'stop b', 'stop a']);
  assert.deepEqual(complaints, ['b: b stuck']);

  const second = recorder();
  await assert.rejects(startStack([second.step('a'), second.step('b', { failStop: true }), second.step('c', { fail: true })]),
    StackStartError);
  assert.deepEqual(second.events, ['start a', 'start b', 'fail c', 'stop b', 'stop a']);
});
