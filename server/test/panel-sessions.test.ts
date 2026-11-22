import assert from 'node:assert/strict';
import test from 'node:test';
import { createPanelSessions } from '../src/panel-sessions.ts';

const token = /^[a-f0-9]{64}$/;

test('a one-time token opens one session, once', () => {
  const sessions = createPanelSessions();
  const bootstrap = sessions.mintBootstrap();
  assert.match(bootstrap, token);
  const session = sessions.exchange(bootstrap);
  assert.ok(session);
  assert.match(session, token);
  assert.notEqual(session, bootstrap);
  assert.equal(sessions.has(session), true);
  assert.equal(sessions.has(bootstrap), false, 'a one-time token is not a session');

  assert.equal(sessions.exchange(bootstrap), null, 'a token is good once');
  assert.equal(sessions.exchange('0'.repeat(64)), null, 'an unknown token opens nothing');
  assert.equal(sessions.exchange(session), null, 'a session is not a one-time token');
  for (const text of ['', 'bootstrap', bootstrap.toUpperCase(), `${sessions.mintBootstrap()}0`])
    assert.equal(sessions.exchange(text), null);
  assert.equal(sessions.has(''), false);
  assert.equal(sessions.has('0'.repeat(64)), false);
  assert.equal(sessions.has(session), true, 'refusals end no session');
  assert.notEqual(sessions.mintBootstrap(), sessions.mintBootstrap());
});

test('a one-time token that waited a minute is refused', () => {
  let clock = 1000;
  const sessions = createPanelSessions({ now: () => clock });
  const early = sessions.mintBootstrap();
  const late = sessions.mintBootstrap();
  clock += 59_999;
  assert.ok(sessions.exchange(early), 'still good just inside the minute');
  clock += 1;
  assert.equal(sessions.exchange(late), null);
  clock -= 30_000;
  assert.equal(sessions.exchange(late), null, 'a refused token stays refused');
});

test('only the newest tokens and sessions are kept', () => {
  const sessions = createPanelSessions();
  const bootstraps = Array.from({ length: 9 }, () => sessions.mintBootstrap());
  assert.equal(sessions.exchange(bootstraps[0]!), null, 'the ninth token pushed the first one out');
  const opened = bootstraps.slice(1).map(bootstrap => sessions.exchange(bootstrap));
  assert.ok(opened.every(Boolean), 'the eight newest work');

  for (let count = opened.length; count < 17; count++) opened.push(sessions.exchange(sessions.mintBootstrap()));
  assert.equal(opened.length, 17);
  assert.equal(sessions.has(opened[0]!), false, 'the seventeenth session ended the first');
  assert.ok(opened.slice(1).every(session => sessions.has(session!)), 'the sixteen newest stay');
});

test('a session that is in use outlives newer ones that are not', () => {
  const sessions = createPanelSessions({ maxSessions: 3 });
  const open = () => sessions.exchange(sessions.mintBootstrap())!;
  const pinned = open();
  const second = open();
  const third = open();
  // The tab that was opened first is the one the owner keeps and uses.
  assert.equal(sessions.has(pinned), true);
  const fourth = open();
  assert.deepEqual([pinned, second, third, fourth].map(session => sessions.has(session)), [true, false, true, true],
    'the session that was not asked with for longest goes');
});
