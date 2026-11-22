// The supervisor is tested against a scripted stand-in. No test opens a real tunnel.
import assert from 'node:assert/strict';
import { chmod, readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { createTunnel, type TunnelOptions, type TunnelState } from '../src/tunnel.ts';
import { scratch } from './fixtures.ts';

export const fakeCloudflared = fileURLToPath(new URL('./fake-cloudflared.mjs', import.meta.url));

interface Launch {
  pid: number;
  args: string[];
  home: string;
  env: string[];
}

const gone = (pid: number) => {
  try { process.kill(pid, 0); return false; } catch { return true; }
};

async function tunnel(t: TestContext, launches: object[], extra: Partial<TunnelOptions> = {}) {
  const root = await scratch(t, 'tunnel');
  const record = join(root, 'launches.jsonl');
  const lines: string[] = [];
  const seen: [TunnelState, string | null][] = [];
  const instance = createTunnel({
    name: 'primary',
    command: { command: process.execPath, args: [fakeCloudflared, '--script', JSON.stringify({ record, launches })] },
    port: 4567, protocol: 'auto', homeRoot: root, log: line => lines.push(line),
    onChange: () => seen.push([instance.state(), instance.origin()]),
    ...extra,
    timing: { readyMs: 2000, probeMs: 2000, pollMs: 20, lostMs: 200, restartDelaysMs: [30, 30], stableMs: 60_000, graceMs: 500,
      ...extra.timing },
  });
  t.after(() => instance.stop());
  const started = async (): Promise<Launch[]> =>
    (await readFile(record, 'utf8').catch(() => '')).split('\n').filter(Boolean).map(line => JSON.parse(line) as Launch);
  const until = async (description: string, done: () => boolean | Promise<boolean>, ms = 6000) => {
    const deadline = Date.now() + ms;
    while (!await done()) {
      if (Date.now() > deadline) throw new Error(`Timed out waiting until ${description}; state ${instance.state()}, seen ${JSON.stringify(seen)}`);
      await delay(10);
    }
  };
  return { instance, lines, seen, started, until, root };
}

test('a tunnel comes online and reports its address', async t => {
  const { instance, until, seen } = await tunnel(t, [{ readyAfterMs: 100 }]);
  assert.equal(instance.state(), 'off');
  assert.equal(instance.origin(), null);
  instance.start();
  instance.start();
  await until('online', () => instance.state() === 'online');
  assert.match(String(instance.origin()), /^https:\/\/synthetic-\d+\.trycloudflare\.com$/);
  assert.deepEqual(seen.map(([state]) => state), ['starting', 'online']);
  assert.equal(seen[0]![1], null, 'no address while starting');
});

test('the address is hidden until the probe passes', async t => {
  let pass!: () => void;
  const probed: string[] = [];
  const { instance, until } = await tunnel(t, [{}], {
    probe: (origin, signal) => new Promise<void>((resolve, reject) => {
      probed.push(origin);
      pass = resolve;
      signal.addEventListener('abort', () => reject(signal.reason));
    }),
  });
  instance.start();
  await until('the probe runs', () => probed.length === 1);
  await delay(100);
  assert.equal(instance.state(), 'starting');
  assert.equal(instance.origin(), null);
  pass();
  await until('online', () => instance.state() === 'online');
  assert.equal(instance.origin(), probed[0]);
});

test('a tunnel that never becomes ready fails within its deadline and leaves no process', async t => {
  const { instance, until, started } = await tunnel(t, [{ neverReady: true }], { timing: { readyMs: 200, restartDelaysMs: [] } });
  instance.start();
  await until('failed', () => instance.state() === 'failed', 3000);
  assert.equal(instance.origin(), null);
  const launches = await started();
  assert.equal(launches.length, 1);
  await until('its process is gone', () => gone(launches[0]!.pid));
});

test('a probe that never passes fails within its deadline', async t => {
  const { instance, until, started } = await tunnel(t, [{}], {
    probe: (_origin, signal) => new Promise<void>((_resolve, reject) => signal.addEventListener('abort', () => reject(signal.reason))),
    timing: { probeMs: 200, restartDelaysMs: [] },
  });
  instance.start();
  await until('failed', () => instance.state() === 'failed', 3000);
  assert.equal(instance.origin(), null);
  const [launch] = await started();
  await until('its process is gone', () => gone(launch!.pid));
});

test('a tunnel that dies is restarted with a new address', async t => {
  const { instance, until, started, seen } = await tunnel(t, [{ exitAfterMs: 300 }, {}]);
  instance.start();
  await until('online', () => instance.state() === 'online');
  const first = instance.origin();
  await until('online with another address', () => instance.state() === 'online' && instance.origin() !== first);
  assert.deepEqual(seen.map(([state]) => state), ['starting', 'online', 'retrying', 'online']);
  assert.equal(seen[2]![1], null, 'the old address is not handed out while restarting');
  const launches = await started();
  assert.equal(launches.length, 2);
  assert.ok(gone(launches[0]!.pid));
});

test('restarts are bounded and a new start tries again', async t => {
  const { instance, until, started } = await tunnel(t, [{ exitAfterMs: 20 }], { timing: { restartDelaysMs: [20, 20] } });
  instance.start();
  await until('failed', () => instance.state() === 'failed');
  assert.equal((await started()).length, 3, 'one launch and two restarts');
  await delay(200);
  assert.equal((await started()).length, 3, 'nothing more is started after the budget is spent');
  instance.start();
  await until('it tries again', async () => (await started()).length > 3);
  await until('failed again', () => instance.state() === 'failed');
});

test('a failed tunnel can be started again from the very report of its failure', async t => {
  let asked = false;
  const made = await tunnel(t, [{ neverReady: true }, { readyAfterMs: 50 }], {
    timing: { readyMs: 150, restartDelaysMs: [] } as TunnelOptions['timing'],
    onChange() {
      if (made.instance.state() !== 'failed' || asked) return;
      asked = true;
      made.instance.start();
    },
  });
  made.instance.start();
  await made.until('online', () => made.instance.state() === 'online');
  assert.equal(asked, true);
  assert.equal((await made.started()).length, 2);
});

test('a tunnel that stayed online gets its restart budget back', async t => {
  const { instance, until, started } = await tunnel(t, [{ exitAfterMs: 350 }, { exitAfterMs: 350 }, { exitAfterMs: 350 }, {}],
    { timing: { restartDelaysMs: [20], stableMs: 150 } });
  instance.start();
  await until('the fourth launch is online', async () => (await started()).length === 4 && instance.state() === 'online', 8000);
});

test('a lost connection counts as a failure', async t => {
  const { instance, until, started, seen } = await tunnel(t, [{ lostAfterMs: 250 }, {}]);
  instance.start();
  await until('online', () => instance.state() === 'online');
  const first = instance.origin();
  await until('online with another address', () => instance.state() === 'online' && instance.origin() !== first);
  assert.ok(seen.some(([state, origin]) => state === 'retrying' && origin === null));
  const launches = await started();
  assert.ok(gone(launches[0]!.pid), 'the program that lost its connection was stopped');
});

test('a hostname outside trycloudflare.com is refused', async t => {
  const { instance, until, seen } = await tunnel(t, [{ badHostname: 'tunnel.attacker.example' }], { timing: { restartDelaysMs: [] } });
  instance.start();
  await until('failed', () => instance.state() === 'failed');
  assert.ok(seen.every(([, origin]) => origin === null));
});

test('stop during a start leaves no process', async t => {
  const { instance, until, started } = await tunnel(t, [{ readyAfterMs: 60_000 }]);
  instance.start();
  await until('the program runs', async () => (await started()).length === 1);
  await instance.stop();
  await instance.stop();
  assert.equal(instance.state(), 'off');
  const [launch] = await started();
  assert.ok(gone(launch!.pid));
  await delay(150);
  assert.equal((await started()).length, 1, 'a stopped tunnel is not restarted');
});

test('the log names neither the address nor the metrics port', async t => {
  const { instance, until, lines, started } = await tunnel(t, [{ exitAfterMs: 250 }, {}]);
  instance.start();
  await until('online twice', async () => (await started()).length === 2 && instance.state() === 'online');
  await instance.stop();
  const log = lines.join('\n');
  assert.ok(lines.length >= 3, log);
  assert.ok(!/trycloudflare|synthetic-\d+/.test(log), log);
  for (const launch of await started()) {
    const metrics = launch.args[launch.args.indexOf('--metrics') + 1]!;
    assert.ok(!log.includes(metrics.split(':')[1]!), log);
  }
});

test('the program gets the launcher\'s arguments and a private empty home', async t => {
  const { instance, until, started, root } = await tunnel(t, [{}], { protocol: 'http2' });
  instance.start();
  await until('online', () => instance.state() === 'online');
  const [launch] = await started();
  const metrics = launch!.args[launch!.args.indexOf('--metrics') + 1]!;
  assert.match(metrics, /^127\.0\.0\.1:\d+$/);
  assert.deepEqual(launch!.args, ['tunnel', '--url', 'http://127.0.0.1:4567', '--metrics', metrics, '--protocol', 'http2', '--no-autoupdate']);
  assert.ok(launch!.home.startsWith(root) && launch!.home !== root, 'a directory of its own');
  assert.deepEqual(await readdir(launch!.home), []);
  assert.ok(launch!.env.includes('HOME') && !launch!.env.includes('PATH') && !launch!.env.includes('NODE_OPTIONS'),
    'the environment of the server is not passed on');
  await instance.stop();
  await assert.rejects(readdir(launch!.home), 'the private home is removed with the program');
});

test('a probe that ignores its signal cannot hold up the deadline or a stop', { timeout: 20_000 }, async t => {
  const stubborn = () => new Promise<void>(() => { /* Never settles, whatever happens to its signal. */ });
  const late = await tunnel(t, [{}], { probe: stubborn, timing: { probeMs: 200, restartDelaysMs: [] } });
  const asked = performance.now();
  late.instance.start();
  await late.until('failed', () => late.instance.state() === 'failed', 3000);
  assert.ok(performance.now() - asked < 1500, 'the probe deadline holds');

  const held = await tunnel(t, [{}], { probe: stubborn, timing: { probeMs: 60_000 } });
  held.instance.start();
  await held.until('the program runs', async () => (await held.started()).length === 1);
  await delay(100);
  const stopping = performance.now();
  await held.instance.stop();
  assert.ok(performance.now() - stopping < 1000, 'stop does not wait for the probe');
  assert.ok(gone((await held.started())[0]!.pid));
});

test('a tunnel told to keep trying never gives up', { timeout: 20_000 }, async t => {
  const { instance, until, started, seen } = await tunnel(t, [{ exitAfterMs: 0 }, { exitAfterMs: 0 }, { exitAfterMs: 0 }, { exitAfterMs: 0 }, {}],
    { keepTrying: true, timing: { restartDelaysMs: [20] } });
  instance.start();
  await until('the fifth launch is online', async () => (await started()).length === 5 && instance.state() === 'online');
  assert.ok(!seen.some(([state]) => state === 'failed'));
});

test('a launch that cannot be cleaned up fails the tunnel, not the server', { timeout: 20_000 }, async t => {
  const { instance, until, root } = await tunnel(t, [{ litterHome: true, exitAfterMs: 100 }], { timing: { restartDelaysMs: [] } });
  try {
    instance.start();
    await until('failed', () => instance.state() === 'failed');
    await delay(50);
  } finally {
    for (const entry of await readdir(root)) await chmod(join(root, entry, 'kept'), 0o700).catch(() => {});
  }
});
