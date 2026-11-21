import assert from 'node:assert/strict';
import { execFile, spawn } from 'node:child_process';
import { once } from 'node:events';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
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

test('a child without a readiness line is handed over once it runs', async () => {
  const asked = performance.now();
  const owned = await startOwnedProcess({ name: 'silent', command: process.execPath, startupMs: 1500,
    args: ['-e', "console.error('a note'); setInterval(() => {}, 1000)"] });
  assert.ok(performance.now() - asked < 1000, 'it does not wait for the startup deadline');
  assert.deepEqual(await owned.stop(1000), { code: null, signal: 'SIGTERM', forced: false });
  assert.ok(gone(owned.pid));
});

const entry = fileURLToPath(new URL('../src/entry.ts', import.meta.url));
const guard = { command: process.execPath, args: [entry, 'internal', 'guard'] };
const guards = async (pid: number) =>
  (await promisify(execFile)('/bin/ps', ['-axwwo', 'command=']).then(({ stdout }) => stdout, () => ''))
    .split('\n').filter(line => line.endsWith(`internal guard ${pid}`)).length;

test('a guarded child does not outlive an owner that is killed', async t => {
  const module = new URL('../src/owned-process.ts', import.meta.url).href;
  const owner = spawn(process.execPath, ['--input-type=module', '-e', `
    import { startOwnedProcess } from ${JSON.stringify(module)};
    const child = await startOwnedProcess({ name: 'kept', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'],
      startupMs: 5000, guard: ${JSON.stringify(guard)} });
    console.log(child.pid);
    setInterval(() => {}, 1000);`], { stdio: ['ignore', 'pipe', 'inherit'] });
  const pid = Number(String((await once(owner.stdout!, 'data'))[0]));
  t.after(() => { try { process.kill(pid, 'SIGKILL'); } catch { /* Already gone, as it should be. */ } });
  assert.ok(pid > 0 && !gone(pid));
  owner.kill('SIGKILL');
  for (let attempt = 0; !gone(pid) && attempt < 300; attempt++) await delay(20);
  assert.ok(gone(pid), 'the child ends when its owner is killed');
  for (let attempt = 0; await guards(pid) > 0 && attempt < 100; attempt++) await delay(20);
  assert.equal(await guards(pid), 0, 'the guard ends too');
});

test('a guard ends with a child that is stopped normally', async () => {
  const owned = await startOwnedProcess({ name: 'kept', command: process.execPath, args: ['-e', 'setInterval(() => {}, 1000)'],
    startupMs: 5000, guard });
  try {
    for (let attempt = 0; await guards(owned.pid) === 0 && attempt < 100; attempt++) await delay(20);
    assert.equal(await guards(owned.pid), 1, 'one guard watches the child');
  } finally {
    await owned.stop(1000);
  }
  for (let attempt = 0; await guards(owned.pid) > 0 && attempt < 100; attempt++) await delay(20);
  assert.equal(await guards(owned.pid), 0);
});

test('a guard that is released signals nothing', async t => {
  // The process stands for a PID that the system gave to someone else after the guarded child ended.
  const bystander = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });
  t.after(() => bystander.kill('SIGKILL'));
  await once(bystander, 'spawn');
  const watcher = spawn(guard.command, [...guard.args, String(bystander.pid)], { stdio: ['pipe', 'ignore', 'inherit'] });
  await delay(300);
  watcher.stdin!.end('released');
  assert.deepEqual(await once(watcher, 'exit'), [0, null]);
  await delay(200);
  assert.ok(!gone(bystander.pid!), 'a released guard leaves the PID alone');
});
