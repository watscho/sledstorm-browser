// The workers are tested against the scripted stand-in. No test starts a real browser.
import assert from 'node:assert/strict';
import { mkdir, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { chosenBrowser, createWorkers, shippedBrowser, WORKER_SWITCHES } from '../src/dedicated.ts';
import type { Paths } from '../src/paths.ts';
import { scratch, standInBrowser } from './fixtures.ts';

const setup = { room: 'a'.repeat(24), workerKey: 'b'.repeat(64), progress: 'all', camera: false, nativeCamera: false };
const gone = (pid: number) => {
  try { process.kill(pid, 0); return false; } catch { return true; }
};

test('the browser override is honored only outside the packaged executable', () => {
  const paths = { resourceRoot: '/Applications/Sled Storm Server.app/Contents/Resources' } as Paths;
  const shipped = '/Applications/Sled Storm Server.app/Contents/Resources/chromium/Chromium.app/Contents/MacOS/Chromium';
  assert.equal(shippedBrowser(paths), shipped);
  const installed = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
  assert.equal(chosenBrowser({ sea: true, env: { SLED_SERVER_CHROME: installed }, paths }), shipped, 'the packaged server never looks elsewhere');
  assert.equal(chosenBrowser({ sea: false, env: { SLED_SERVER_CHROME: installed }, paths }), installed);
  assert.equal(chosenBrowser({ sea: false, env: {}, paths }), shipped);
  assert.equal(chosenBrowser({ sea: false, env: { SLED_SERVER_CHROME: 'relative/browser' }, paths }), shipped);
});

test('the worker is left no name to resolve but this computer', () => {
  // Measured on the shipped browser: without this rule it talks to its maker's servers on its own.
  assert.ok(WORKER_SWITCHES.includes('--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1'), WORKER_SWITCHES.join(' '));
});

test('workers are counted until they and their profiles are gone', async t => {
  const root = await scratch(t, 'workers');
  const { program, events } = await standInBrowser(root);
  const profileRoot = join(root, 'profiles');
  await mkdir(profileRoot);
  const lines: string[] = [];
  const workers = createWorkers({ browser: program, url: 'http://127.0.0.1:4321/', profileRoot, log: line => lines.push(line) });
  assert.equal(workers.count(), 0);
  await workers.settled();

  const controller = new AbortController();
  t.after(() => controller.abort());
  const starting = workers.start(setup, controller.signal);
  assert.equal(workers.count(), 1, 'counted from the moment it is asked for');
  await starting;
  const [start, navigate] = await events();
  assert.equal(navigate!.url, 'http://127.0.0.1:4321/');
  assert.deepEqual(navigate!.setup, setup);
  for (const added of WORKER_SWITCHES) assert.ok(start!.args.includes(added), added);
  assert.ok(start!.args.some(argument => argument.startsWith(`--user-data-dir=${profileRoot}/`)));
  // Measured on the shipped browser: without this it keeps its crash reports in the user's own Library.
  assert.equal(start!.env.BREAKPAD_DUMP_LOCATION, join(profileRoot, 'crash-reports'));
  assert.equal(start!.env.HOME, process.env.HOME ?? null);

  let settled = false;
  const waiting = workers.settled().then(() => { settled = true; });
  await delay(60);
  assert.equal(settled, false, 'a running worker is not settled');
  controller.abort();
  await waiting;
  assert.equal(workers.count(), 0);
  assert.ok(gone(start!.pid));
  assert.deepEqual(await readdir(profileRoot), []);
  const log = lines.join('\n');
  assert.ok(lines.length >= 2, log);
  assert.ok(!log.includes(setup.room) && !log.includes(setup.workerKey), 'the log names neither the room nor its key');
});

test('a worker that cannot start is not left counted', async t => {
  const root = await scratch(t, 'workers');
  const workers = createWorkers({ browser: join(root, 'missing'), url: 'http://127.0.0.1:4321/', profileRoot: root, log: () => {} });
  await assert.rejects(workers.start(setup, new AbortController().signal));
  await workers.settled();
  assert.equal(workers.count(), 0);
  assert.deepEqual(await readdir(root), []);
});
