import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startOwnedProcess } from '../src/owned-process.ts';

const child = (name: string, script: string, startupMs = 5000) => startOwnedProcess({
  name, command: process.execPath, args: ['-e', script], ready: line => line === 'ready', startupMs,
});

const gone = (pid: number) => {
  try { process.kill(pid, 0); return false; } catch { return true; }
};

test('a child is handed over once it reports ready and stops when asked', async () => {
  const lines: string[] = [];
  const owned = await startOwnedProcess({
    name: 'polite', command: process.execPath, startupMs: 5000,
    args: ['-e', "console.log('starting'); console.log('ready'); setInterval(() => {}, 1000)"],
    ready: line => line === 'ready', onLine: line => lines.push(line),
  });
  assert.deepEqual(lines, ['starting', 'ready']);
  const stopped = await owned.stop(2000);
  assert.deepEqual(stopped, { code: null, signal: 'SIGTERM', forced: false });
  assert.deepEqual(await owned.stop(), stopped, 'a second stop reports the same result');
  assert.ok(gone(owned.pid));
});

test('a child that ignores the stop request is killed after the grace period', async () => {
  const owned = await child('stubborn', "process.on('SIGTERM', () => {}); console.log('ready'); setInterval(() => {}, 1000)");
  const stopped = await owned.stop(200);
  assert.deepEqual(stopped, { code: null, signal: 'SIGKILL', forced: true });
  assert.ok(gone(owned.pid));
});

test('a child that never becomes ready is killed at the startup deadline', async () => {
  let pid = 0;
  await assert.rejects(child('silent', 'console.error(process.pid); setInterval(() => {}, 1000)', 400), error => {
    assert.match((error as Error).message, /^silent: not ready within 400 ms/);
    pid = Number(/\n(\d+)$/.exec((error as Error).message)?.[1]);
    return true;
  });
  assert.ok(pid > 0, 'the error carries the output of the child');
  for (let attempt = 0; !gone(pid) && attempt < 50; attempt++) await delay(20);
  assert.ok(gone(pid), 'no child is left behind');
});

test('a child that exits early reports its exit and its error output', async () => {
  await assert.rejects(child('broken', "console.error('missing configuration'); process.exit(7)"),
    /^Error: broken: exited before it was ready \(code 7\)\nmissing configuration$/);
});

test('a command that cannot be started is reported', async () => {
  await assert.rejects(startOwnedProcess({ name: 'absent', command: '/nonexistent/sled-storm-command', args: [],
    ready: () => true, startupMs: 1000 }), /^Error: absent: could not start/);
});

test('an owned child that exits by itself is visible to its owner', async () => {
  const owned = await child('brief', "console.log('ready'); setTimeout(() => process.exit(3), 50)");
  assert.deepEqual(await owned.exited, { code: 3, signal: null });
  assert.deepEqual(await owned.stop(), { code: 3, signal: null, forced: false });
});
