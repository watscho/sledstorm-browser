// The keeper is tested with sessions that the test ends by hand. No relay and no browser.
import assert from 'node:assert/strict';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { keepRoom, type RoomState, type RoomTiming } from '../src/room.ts';

function keeper(t: TestContext, timing: Partial<RoomTiming> = {}, failFirstOpen = false) {
  const made: { listen(): void; end(reason: string): void; stop(reason: string): void; restoring(active: boolean): void;
    stopped: string[] }[] = [];
  const seen: RoomState[] = [];
  const lines: string[] = [];
  let opens = 0;
  const room = keepRoom({
    open(events) {
      opens += 1;
      if (failFirstOpen && opens === 1) throw new Error('This room is already open.');
      let listen!: () => void;
      let fail!: (error: Error) => void;
      let finish!: (reason: string) => void;
      const ready = new Promise<void>((resolve, reject) => { listen = resolve; fail = reject; });
      ready.catch(() => {});
      const ended = new Promise<string>(resolve => { finish = resolve; });
      const session = { ready, ended, listen, restoring: events.restoring, stopped: [] as string[],
        end(reason: string) { fail(new Error(reason)); finish(reason); },
        stop(reason: string) { session.stopped.push(reason); session.end(reason); } };
      made.push(session);
      return session;
    },
    log: line => lines.push(line),
    onChange: () => seen.push(room.state()),
    timing: { restartDelaysMs: [20, 20], stableMs: 60_000, ...timing },
  });
  t.after(() => room.stop());
  const until = async (description: string, done: () => boolean) => {
    const deadline = Date.now() + 4000;
    while (!done()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting until ${description}; state ${room.state()}, seen ${seen.join(' ')}`);
      await delay(5);
    }
  };
  return { room, made, seen, lines, until, opens: () => opens };
}

test('a room opens and says so', async t => {
  const { room, made, seen, until } = keeper(t);
  assert.equal(room.state(), 'off');
  assert.equal(room.reason(), null);
  room.start();
  room.start();
  assert.equal(room.state(), 'starting');
  await until('a session is asked for', () => made.length === 1);
  made[0]!.listen();
  await until('open', () => room.state() === 'open');
  assert.deepEqual(seen, ['starting', 'open']);
  assert.equal(made.length, 1, 'a second start changes nothing');
});

test('a session that ends is followed by another, within a bound', async t => {
  const { room, made, seen, lines, until } = keeper(t);
  room.start();
  await until('the first session', () => made.length === 1);
  made[0]!.listen();
  await until('open', () => room.state() === 'open');
  made[0]!.end('Dedicated emulator disconnected');
  await until('restarting', () => room.state() === 'restarting');
  await until('the second session', () => made.length === 2);
  made[1]!.end('Could not start the dedicated emulator');
  await until('the third session', () => made.length === 3);
  made[2]!.end('Dedicated emulator did not start');
  await until('failed', () => room.state() === 'failed');
  assert.equal(room.reason(), 'Dedicated emulator did not start', 'why the last session ended');
  await delay(80);
  assert.equal(made.length, 3, 'one session and two more, then no more');
  assert.deepEqual(seen, ['starting', 'open', 'restarting', 'failed']);
  assert.ok(lines.some(line => line.includes('Dedicated emulator disconnected')), lines.join('\n'));
});

test('a room that stayed open earns its pauses back', async t => {
  const { room, made, until } = keeper(t, { restartDelaysMs: [20], stableMs: 100 });
  room.start();
  for (const index of [0, 1, 2]) {
    await until(`session ${index}`, () => made.length === index + 1);
    made[index]!.listen();
    await until('open', () => room.state() === 'open');
    if (index === 2) break;
    await delay(150);
    made[index]!.end('Dedicated emulator disconnected');
  }
  assert.equal(room.state(), 'open', 'without the earned pause the third session would not exist');
});

test('a new session that opens brings the room back', async t => {
  const { room, made, seen, until } = keeper(t);
  room.start();
  await until('the first session', () => made.length === 1);
  made[0]!.end('Could not start the dedicated emulator');
  await until('the second session', () => made.length === 2);
  made[1]!.listen();
  await until('open', () => room.state() === 'open');
  assert.deepEqual(seen, ['starting', 'restarting', 'open']);
});

test('stop ends the session and nothing is opened afterwards', async t => {
  const { room, made, until } = keeper(t);
  room.start();
  await until('the first session', () => made.length === 1);
  made[0]!.listen();
  await until('open', () => room.state() === 'open');
  await room.stop();
  await room.stop();
  assert.deepEqual(made[0]!.stopped, ['Dedicated server stopped']);
  assert.equal(room.state(), 'off');
  await delay(80);
  assert.equal(made.length, 1);
});

test('stop while a session starts, and stop during a pause, open nothing more', async t => {
  const starting = keeper(t);
  starting.room.start();
  await starting.until('the first session', () => starting.made.length === 1);
  await starting.room.stop();
  assert.equal(starting.room.state(), 'off');
  assert.deepEqual(starting.made[0]!.stopped, ['Dedicated server stopped']);

  const pausing = keeper(t, { restartDelaysMs: [300] });
  pausing.room.start();
  await pausing.until('the first session', () => pausing.made.length === 1);
  pausing.made[0]!.end('Dedicated emulator disconnected');
  await pausing.until('restarting', () => pausing.room.state() === 'restarting');
  const asked = performance.now();
  await pausing.room.stop();
  assert.ok(performance.now() - asked < 200, 'the pause is not waited out');
  await delay(400);
  assert.equal(pausing.made.length, 1);
  assert.equal(pausing.room.state(), 'off');
});

test('a session that cannot even be asked for counts as one that ended', async t => {
  const { room, made, lines, until, opens } = keeper(t, {}, true);
  room.start();
  await until('the second attempt', () => made.length === 1);
  made[0]!.listen();
  await until('open', () => room.state() === 'open');
  assert.equal(opens(), 2);
  assert.ok(!lines.join('\n').includes('at '), 'no stack in the log');
});

test('a failed room can be started again', async t => {
  const { room, made, until } = keeper(t, { restartDelaysMs: [] });
  room.start();
  await until('the first session', () => made.length === 1);
  made[0]!.end('Could not start the dedicated emulator');
  await until('failed', () => room.state() === 'failed');
  room.start();
  await until('the next session', () => made.length === 2);
  made[1]!.listen();
  await until('open', () => room.state() === 'open');
});

test('a failed room can be started again from the very report of its failure', async t => {
  // The first session ends at once and the room has no pauses left, so it fails; the second one listens.
  let opens = 0;
  let asked = false;
  const room = keepRoom({
    open() {
      opens += 1;
      const first = opens === 1;
      const ready = first ? Promise.reject(new Error('gone')) : Promise.resolve();
      ready.catch(() => {});
      let finish!: (reason: string) => void;
      const ended = new Promise<string>(resolve => { finish = resolve; });
      if (first) finish('gone');
      return { ready, ended, stop: finish };
    },
    log: () => {},
    onChange() {
      if (room.state() !== 'failed' || asked) return;
      asked = true;
      room.start();
    },
    timing: { restartDelaysMs: [] },
  });
  t.after(() => room.stop());
  room.start();
  const deadline = Date.now() + 4000;
  while (room.state() !== 'open' && Date.now() < deadline) await delay(5);
  assert.deepEqual({ state: room.state(), opens, asked }, { state: 'open', opens: 2, asked: true });
});

test('a room that loads a save is restoring and then open again', async t => {
  const { room, made, seen, lines, until } = keeper(t);
  room.start();
  await until('the first session', () => made.length === 1);
  made[0]!.restoring(true);
  assert.equal(room.state(), 'starting', 'nothing loads into a room that is not open');
  made[0]!.listen();
  await until('open', () => room.state() === 'open');
  made[0]!.restoring(false);
  made[0]!.restoring(true);
  assert.equal(room.state(), 'restoring');
  made[0]!.restoring(true);
  made[0]!.restoring(false);
  assert.equal(room.state(), 'open');
  made[0]!.restoring(false);
  assert.deepEqual(seen, ['starting', 'open', 'restoring', 'open']);
  assert.equal(made.length, 1, 'the session is the same one');
  assert.equal(room.reason(), null, 'no session has ended');
  assert.deepEqual(lines, ['The room is open.', 'The room is loading a saved game.', 'The load of the saved game is over.']);
});

test('a session that ends while a save is loading is followed by a new one', async t => {
  const { room, made, seen, until } = keeper(t);
  room.start();
  await until('the first session', () => made.length === 1);
  made[0]!.listen();
  await until('open', () => room.state() === 'open');
  made[0]!.restoring(true);
  made[0]!.end('Dedicated emulator disconnected');
  await until('restarting', () => room.state() === 'restarting');
  assert.equal(room.reason(), 'Dedicated emulator disconnected');
  await until('the second session', () => made.length === 2);
  // What the session that ended says afterwards is not about the next one.
  made[0]!.restoring(false);
  assert.equal(room.state(), 'restarting');
  made[1]!.listen();
  await until('open', () => room.state() === 'open');
  made[0]!.restoring(true);
  assert.equal(room.state(), 'open');
  made[1]!.restoring(true);
  assert.equal(room.state(), 'restoring');
  assert.deepEqual(seen, ['starting', 'open', 'restoring', 'restarting', 'open', 'restoring']);
});

test('stop while a save is loading ends the session, and the room is not called open on the way', async t => {
  const { room, made, seen, until } = keeper(t);
  room.start();
  await until('the first session', () => made.length === 1);
  made[0]!.listen();
  await until('open', () => room.state() === 'open');
  made[0]!.restoring(true);
  // A relay's room that is stopped during a load says that the load is over before it says that it ended.
  const { stop } = made[0]!;
  made[0]!.stop = reason => {
    made[0]!.restoring(false);
    stop(reason);
  };
  await room.stop();
  assert.deepEqual(made[0]!.stopped, ['Dedicated server stopped']);
  assert.deepEqual(seen, ['starting', 'open', 'restoring', 'off']);
});

const NEW_GAME = 'The host started a new game. Open the invitation again to join.';

test('a new game ends the session and opens the next at once, without counting a failure', async t => {
  // One pause, and a long one: a new game that waited for it, or counted a failure, would show.
  const { room, made, lines, until } = keeper(t, { restartDelaysMs: [5000] });
  room.start();
  await until('the first session', () => made.length === 1);
  made[0]!.listen();
  await until('open', () => room.state() === 'open');
  assert.equal(room.renew(), true);
  assert.deepEqual(made[0]!.stopped, [NEW_GAME]);
  await until('the second session, without a pause', () => made.length === 2);
  assert.equal(room.state(), 'starting');
  made[1]!.listen();
  await until('open again', () => room.state() === 'open');
  assert.ok(lines.includes('The host started a new game.'), lines.join('\n'));

  // A session that ends by itself waits for its pause; a new game asked during it ends the pause now.
  made[1]!.end('Dedicated emulator stopped');
  await until('restarting', () => room.state() === 'restarting');
  assert.equal(room.renew(), true);
  await until('the third session, without the pause', () => made.length === 3);
  made[2]!.listen();
  await until('open once more', () => room.state() === 'open');
  // The pause was used once, then the count started again: the next end waits again instead of failing.
  made[2]!.end('Dedicated emulator stopped');
  await until('restarting, not failed', () => room.state() === 'restarting' || room.state() === 'failed');
  assert.equal(room.state(), 'restarting');
});

test('a new game in a room that is loading a save ends the load with the session', async t => {
  const { room, made, seen, until } = keeper(t);
  room.start();
  await until('the first session', () => made.length === 1);
  made[0]!.listen();
  await until('open', () => room.state() === 'open');
  made[0]!.restoring(true);
  // A relay's room that is stopped during a load says that the load is over before it says that it ended.
  const { stop } = made[0]!;
  made[0]!.stop = reason => {
    made[0]!.restoring(false);
    stop(reason);
  };
  assert.equal(room.renew(), true);
  assert.deepEqual(made[0]!.stopped, [NEW_GAME]);
  await until('the second session', () => made.length === 2);
  made[1]!.listen();
  await until('open', () => room.state() === 'open');
  assert.deepEqual(seen, ['starting', 'open', 'restoring', 'starting', 'open'], 'the room is not called open on the way');
});

test('a new game starts a failed room again, and changes nothing in a room that is off or starting', async t => {
  const { room, made, until } = keeper(t, { restartDelaysMs: [] });
  assert.equal(room.renew(), false, 'there is no room');
  assert.equal(room.state(), 'off');
  room.start();
  await until('the first session', () => made.length === 1);
  // The game that is starting is a new one already.
  assert.equal(room.renew(), true);
  assert.deepEqual(made[0]!.stopped, []);
  assert.equal(made.length, 1);
  made[0]!.end('Could not start the dedicated emulator');
  await until('failed', () => room.state() === 'failed');
  assert.equal(room.renew(), true);
  await until('a session of the failed room', () => made.length === 2);
  assert.equal(room.state(), 'starting');
});

test('a new game asked twice opens one session, and a stop right after a new game opens none', async t => {
  // Pinned: the keeper already did both when the review asked for them.
  const { room, made, until } = keeper(t);
  room.start();
  await until('the first session', () => made.length === 1);
  made[0]!.listen();
  await until('open', () => room.state() === 'open');
  assert.equal(room.renew(), true);
  assert.equal(room.renew(), true);
  assert.deepEqual(made[0]!.stopped, [NEW_GAME], 'the session is stopped once');
  await until('the next session', () => made.length === 2);
  await delay(50);
  assert.equal(made.length, 2, 'one session for two presses');
  made[1]!.listen();
  await until('open again', () => room.state() === 'open');

  assert.equal(room.renew(), true);
  await room.stop();
  await delay(50);
  assert.equal(made.length, 2, 'the stop opened nothing');
  assert.equal(room.state(), 'off');
});
