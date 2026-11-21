// The runtime is tested against a scripted stand-in. No test starts a real browser.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { launchDedicatedRuntime } from './dedicated-runtime.mjs';
import { createRetroArchRelay } from './retroarch-relay.mjs';

const fake = fileURLToPath(new URL('./fake-browser.mjs', import.meta.url));
const switches = ['--headless=new', '--remote-debugging-pipe', '--no-first-run',
  '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
  '--disable-backgrounding-occluded-windows', '--mute-audio', '--disable-dev-shm-usage',
  '--autoplay-policy=no-user-gesture-required'];
const setup = { room: 'a'.repeat(24), workerKey: 'b'.repeat(64), progress: 'all', camera: false, nativeCamera: false };
const gone = pid => {
  try { process.kill(pid, 0); return false; } catch { return true; }
};
const profileOf = start => start.args.find(argument => argument.startsWith('--user-data-dir=')).slice('--user-data-dir='.length);
const exists = path => stat(path).then(() => true, () => false);

async function until(description, done, ms = 4000) {
  const deadline = Date.now() + ms;
  while (!await done()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting until ${description}`);
    await delay(10);
  }
}

/** An executable that starts the stand-in with a script, and the places it works in. */
async function browser(t, launches = [{}], extra = {}) {
  const root = await mkdtemp(join(tmpdir(), 'sled-runtime-test-'));
  const record = join(root, 'record.jsonl');
  const scriptFile = join(root, 'script.json');
  await writeFile(scriptFile, JSON.stringify({ record, launches, ...extra }));
  const program = join(root, 'browser');
  await writeFile(program, `#!/bin/sh\nexec '${process.execPath}' '${fake}' --script-file '${scriptFile}' "$@"\n`, { mode: 0o755 });
  const profiles = join(root, 'profiles');
  await mkdir(profiles);
  const events = async () => (await readFile(record, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line));
  t.after(async () => {
    for (const { pid } of await events()) try { process.kill(pid, 'SIGKILL'); } catch { /* Already gone. */ }
    await rm(root, { recursive: true, force: true });
  });
  return { root, program, profiles, events };
}

test('starts the browser with its switches, a profile of its own and the given page', async t => {
  const { program, profiles, events } = await browser(t);
  const controller = new AbortController();
  const runtime = await launchDedicatedRuntime(program, setup, controller.signal,
    { url: 'http://127.0.0.1:4321/', args: ['--use-mock-keychain'], profileRoot: profiles });
  try {
    const [start, navigate] = await events();
    assert.equal(navigate.url, 'http://127.0.0.1:4321/');
    assert.deepEqual(navigate.setup, setup);
    const profile = profileOf(start);
    assert.ok(profile.startsWith(profiles + sep), 'the profile is inside the given directory');
    assert.ok((await stat(profile)).isDirectory());
    assert.deepEqual(start.args, [...switches, '--use-mock-keychain', `--user-data-dir=${profile}`, 'about:blank']);
  } finally {
    controller.abort();
    await runtime.exited;
  }
});

test('further environment variables reach the browser beside the inherited ones', async t => {
  const { program, profiles, events } = await browser(t);
  const controller = new AbortController();
  const runtime = await launchDedicatedRuntime(program, setup, controller.signal,
    { profileRoot: profiles, env: { BREAKPAD_DUMP_LOCATION: '/some/where else' } });
  try {
    const [start] = await events();
    assert.deepEqual(start.env, { HOME: process.env.HOME, BREAKPAD_DUMP_LOCATION: '/some/where else' });
  } finally {
    controller.abort();
    await runtime.exited;
  }
});

test('the page and the profile place default to the launcher\'s', async t => {
  const { program, events } = await browser(t);
  const controller = new AbortController();
  const runtime = await launchDedicatedRuntime(program, setup, controller.signal);
  try {
    const [start, navigate] = await events();
    assert.equal(navigate.url, 'http://127.0.0.1:8000/');
    assert.ok(profileOf(start).startsWith(join(tmpdir(), 'sled-netplay-')));
    assert.deepEqual(start.args.slice(0, switches.length), switches);
    assert.deepEqual(start.env, { HOME: process.env.HOME, BREAKPAD_DUMP_LOCATION: process.env.BREAKPAD_DUMP_LOCATION ?? null },
      'the environment is inherited as it is');
  } finally {
    controller.abort();
    await runtime.exited;
  }
});

test('an abort ends the browser, and exited resolves once its profile is removed', async t => {
  const { program, profiles, events } = await browser(t);
  const controller = new AbortController();
  const runtime = await launchDedicatedRuntime(program, setup, controller.signal, { profileRoot: profiles });
  const [start] = await events();
  controller.abort();
  await runtime.exited;
  assert.ok(gone(start.pid));
  assert.deepEqual(await readdir(profiles), []);
});

test('a browser that ignores the stop is killed after the grace', { timeout: 20_000 }, async t => {
  const { program, profiles, events } = await browser(t, [{ ignoreTerm: true }]);
  const controller = new AbortController();
  const runtime = await launchDedicatedRuntime(program, setup, controller.signal, { profileRoot: profiles, graceMs: 200 });
  const [start] = await events();
  const asked = performance.now();
  controller.abort();
  const ended = await Promise.race([runtime.exited.then(() => true), delay(3000).then(() => false)]);
  assert.ok(ended, 'exited resolves although the browser ignored the stop');
  assert.ok(performance.now() - asked >= 150, 'the browser was given its grace');
  assert.ok(gone(start.pid));
  assert.deepEqual(await readdir(profiles), []);
});

test('a browser behind a wrapper that stays in the way is still ended within the bound', { timeout: 20_000 }, async t => {
  const { root, profiles, events } = await browser(t);
  // No exec: the shell stays the child, and the browser behind it keeps the pipes open after the shell is gone.
  const wrapper = join(root, 'wrapper');
  await writeFile(wrapper, `#!/bin/sh\n'${process.execPath}' '${fake}' --script-file '${join(root, 'script.json')}' "$@"\n`, { mode: 0o755 });
  const controller = new AbortController();
  const runtime = await launchDedicatedRuntime(wrapper, setup, controller.signal, { profileRoot: profiles, graceMs: 200 });
  const [start] = await events();
  controller.abort();
  const ended = await Promise.race([runtime.exited.then(() => true), delay(3000).then(() => false)]);
  assert.ok(ended, 'exited resolves although the pipes were still held');
  assert.deepEqual(await readdir(profiles), []);
  await until('the browser behind the wrapper is gone', () => gone(start.pid));
});

test('a refused command rejects and leaves nothing', async t => {
  const { program, profiles, events } = await browser(t, [{ failCommand: 'Page.navigate' }]);
  await assert.rejects(launchDedicatedRuntime(program, setup, new AbortController().signal, { profileRoot: profiles }),
    /Refused by the stand-in/);
  // By the time the failure is reported, nothing is left: a caller that waits for it has waited for the cleanup.
  const [start] = await events();
  assert.ok(gone(start.pid));
  assert.deepEqual(await readdir(profiles), []);
});

test('an abort before the start leaves no profile and starts nothing', async t => {
  const { program, profiles, events } = await browser(t);
  const controller = new AbortController();
  controller.abort(new Error('Stopped before the start'));
  await assert.rejects(launchDedicatedRuntime(program, setup, controller.signal, { profileRoot: profiles }), /Stopped before the start/);
  assert.deepEqual(await readdir(profiles), []);
  assert.deepEqual(await events(), []);
});

test('a browser that cannot be started rejects and leaves no profile', async t => {
  const { root, profiles } = await browser(t);
  await assert.rejects(launchDedicatedRuntime(join(root, 'missing'), setup, new AbortController().signal, { profileRoot: profiles }));
  assert.deepEqual(await readdir(profiles), []);
});

test('a file that is not a program, or a directory, rejects and leaves no profile', async t => {
  const { root, profiles } = await browser(t);
  const notProgram = join(root, 'not a program');
  await writeFile(notProgram, 'This has the executable bit and nothing to execute.\n', { mode: 0o755 });
  for (const path of [notProgram, root]) {
    await assert.rejects(launchDedicatedRuntime(path, setup, new AbortController().signal, { profileRoot: profiles }));
    assert.deepEqual(await readdir(profiles), [], path === root ? 'a directory' : 'not a program');
  }
});

test('an unreadable message from the browser fails the start and nothing else', async t => {
  const { program, profiles, events } = await browser(t, [{ garbage: true }]);
  await assert.rejects(launchDedicatedRuntime(program, setup, new AbortController().signal, { profileRoot: profiles }),
    /unreadable message/);
  const [start] = await events();
  assert.ok(gone(start.pid));
  assert.deepEqual(await readdir(profiles), []);
});

test('a browser that ends by itself resolves exited', async t => {
  const { program, profiles, events } = await browser(t, [{ exitAfterMs: 50 }]);
  const runtime = await launchDedicatedRuntime(program, setup, new AbortController().signal, { profileRoot: profiles });
  await runtime.exited;
  const [start] = await events();
  assert.ok(gone(start.pid));
  assert.equal(await exists(profileOf(start)), false);
});

test('a room created through the relay reaches its worker and accepts its creator', { timeout: 20_000 }, async t => {
  const origin = 'http://127.0.0.1:4321';
  let program;
  let profiles;
  const relay = createRetroArchRelay({ port: 0, origins: [origin],
    startDedicated: (room, signal) => launchDedicatedRuntime(program, room, signal, { url: `${origin}/`, profileRoot: profiles }) });
  await once(relay, 'listening');
  const { events, ...made } = await browser(t, [{}], { netplayPort: relay.address().port });
  ({ program, profiles } = made);
  const creator = new WebSocket(`ws://127.0.0.1:${relay.address().port}`, { origin });
  // Registered before anything can stall, so that a failure cannot leave the relay or the worker behind.
  t.after(async () => {
    relay.stopDedicated();
    for (const client of relay.clients) client.terminate();
    creator.terminate();
    await new Promise(resolve => relay.close(resolve));
  });
  await once(creator, 'open');
  const room = 'c'.repeat(24);
  creator.send(JSON.stringify({ role: 'create', room, token: 'd'.repeat(64), identity: 'e'.repeat(64), progress: 'all' }));
  const answer = await Promise.race([
    once(creator, 'message').then(([message]) => JSON.parse(message.toString())),
    once(creator, 'close').then(([, reason]) => ({ closed: reason.toString() })),
    delay(8000).then(() => ({ closed: 'no answer' })),
  ]);
  const { type, slot, owner, seatKey } = answer;
  assert.deepEqual({ type, slot, owner }, { type: 'ready', slot: 0, owner: true }, JSON.stringify(answer));
  assert.match(seatKey, /^[a-f0-9]{32}$/);
  const [start, navigate] = await events();
  assert.equal(navigate.setup.room, room);
  assert.match(navigate.setup.workerKey, /^[a-f0-9]{64}$/);
  relay.stopDedicated();
  await until('the worker is gone', () => gone(start.pid));
});
