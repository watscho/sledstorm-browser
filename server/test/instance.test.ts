import assert from 'node:assert/strict';
import { once } from 'node:events';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { openSession, takeBootstrap } from '../../admin/session.js';
import { launch } from '../src/control.ts';
import { startHostServer } from '../src/host-server.ts';
import { findLiveInstance, instanceLockFile, readInstanceRecord, removeInstanceRecord, requestBootstrap, requestQuit,
  writeInstanceRecord, type InstanceRecord } from '../src/instance.ts';
import { ensureWritableRoots, type Paths } from '../src/paths.ts';
import { acquireInstanceLock } from '../src/platform/instance-lock.ts';
import { openBrowser } from '../src/platform/open-browser.ts';
import { appVersion } from '../src/version.ts';
import { panelRoot, standInControl } from './fixtures.ts';

async function temporaryPaths(): Promise<Paths & { remove(): Promise<void> }> {
  const root = await mkdtemp(join(tmpdir(), 'sled instance тест '));
  const paths = { resourceRoot: join(root, 'resources'), dataRoot: join(root, 'data'), cacheRoot: join(root, 'cache'),
    logRoot: join(root, 'logs'), tempRoot: root, profileRoot: join(root, 'cache', 'browser-profiles') };
  await ensureWritableRoots(paths);
  return { ...paths, remove: () => rm(root, { recursive: true, force: true }) };
}

/** A record of a server of this build: run from source, it has no build of its own and the placeholder version. */
const record = (overrides: Partial<InstanceRecord> = {}): InstanceRecord => ({
  instance: 'a'.repeat(16), pid: process.pid, port: 4321, token: 'b'.repeat(64),
  startedAt: '2026-11-15T00:00:00.000Z', version: appVersion, build: null, ...overrides,
});

test('the instance lock is exclusive until released', async () => {
  const paths = await temporaryPaths();
  try {
    const file = instanceLockFile(paths);
    const release = acquireInstanceLock(file);
    assert.ok(release, 'the first holder gets the lock');
    assert.equal(acquireInstanceLock(file), null, 'a second holder is refused');
    release();
    release();
    const again = acquireInstanceLock(file);
    assert.ok(again, 'the lock is free after release');
    again();
  } finally {
    await paths.remove();
  }
});

test('the instance record is private, validated and removed only by its owner', async () => {
  const paths = await temporaryPaths();
  try {
    assert.equal(await readInstanceRecord(paths), null);
    await writeInstanceRecord(paths, record());
    const file = join(paths.dataRoot, 'instance.json');
    assert.equal((await stat(file)).mode & 0o777, 0o600);
    assert.equal((await stat(paths.dataRoot)).mode & 0o777, 0o700);
    assert.deepEqual(await readInstanceRecord(paths), record());

    await removeInstanceRecord(paths, 'c'.repeat(16));
    assert.deepEqual(await readInstanceRecord(paths), record(), 'another instance does not remove it');
    await removeInstanceRecord(paths, record().instance);
    assert.equal(await readInstanceRecord(paths), null);

    for (const invalid of ['', 'not json', '[]', JSON.stringify({ ...record(), port: 70000 }),
      JSON.stringify({ ...record(), token: 'short' }), JSON.stringify({ ...record(), pid: '1' }),
      JSON.stringify({ ...record(), build: 'short' }), JSON.stringify({ ...record(), build: 1 })]) {
      await writeFile(file, invalid);
      assert.equal(await readInstanceRecord(paths), null, invalid);
    }

    // The build of the server's code is part of the record. A server of an earlier build wrote none.
    await writeInstanceRecord(paths, record({ build: 'd'.repeat(64) }));
    assert.deepEqual(await readInstanceRecord(paths), record({ build: 'd'.repeat(64) }));
    const { build: _build, ...earlier } = record();
    await writeFile(file, JSON.stringify(earlier));
    assert.deepEqual(await readInstanceRecord(paths), record({ build: null }));
  } finally {
    await paths.remove();
  }
});

test('only a server that proves the recorded identity counts as running', async () => {
  const paths = await temporaryPaths();
  let quits = 0;
  const host = await startHostServer({ panelRoot, version: '1.1.0', onQuit: () => { quits += 1; }, status: () => ({ state: 'idle' }),
    invitation: () => ({ url: null, localUrl: null }), control: standInControl().control });
  try {
    const live = record({ instance: host.instance, port: host.port, token: host.token });
    await writeInstanceRecord(paths, live);
    assert.deepEqual(await findLiveInstance(paths), live);

    await writeInstanceRecord(paths, { ...live, instance: 'd'.repeat(16) });
    assert.equal(await findLiveInstance(paths), null, 'the port answers, but as a different instance');
    await writeInstanceRecord(paths, { ...live, token: 'e'.repeat(64) });
    assert.equal(await findLiveInstance(paths), null, 'a stale credential is refused');
    assert.equal((await requestQuit({ ...live, token: 'e'.repeat(64) }))?.status, 401, 'and asks no quit of it');
    assert.equal(quits, 0);

    await writeInstanceRecord(paths, live);
    await host.close();
    assert.equal(await findLiveInstance(paths), null, 'a record without a listener is stale');
    assert.match(await readFile(join(paths.dataRoot, 'instance.json'), 'utf8'), /"instance"/, 'looking does not delete');
  } finally {
    await host.close();
    await paths.remove();
  }
});

/** What the launcher printed, line by line. Nothing reaches the terminal of the test run. */
function printed(t: TestContext): string[] {
  const lines: string[] = [];
  t.mock.method(console, 'log', (line: string) => { lines.push(line); });
  return lines;
}

test('the launcher opens the panel with a one-time token and prints none', async t => {
  const paths = await temporaryPaths();
  const host = await startHostServer({ panelRoot, version: '1.1.0', onQuit: () => {}, status: () => ({ state: 'idle' }),
    invitation: () => ({ url: null, localUrl: null }), control: standInControl().control });
  const lines = printed(t);
  try {
    await writeInstanceRecord(paths, record({ instance: host.instance, port: host.port, token: host.token }));
    const address = `http://127.0.0.1:${host.port}/`;
    const opened: string[] = [];
    const open = async (url: string) => { opened.push(url); };
    assert.equal(await launch(paths, { openPanel: true, open }), 0);
    assert.equal(await launch(paths, { openPanel: true, open }), 0);
    assert.equal(opened.length, 2);
    const tokens = opened.map(url => new RegExp(`^${address}#bootstrap=([a-f0-9]{64})$`).exec(url)?.[1] ?? '');
    assert.ok(tokens.every(Boolean), 'each launch opens the panel with a token');
    assert.notEqual(tokens[0], tokens[1], 'and each with its own');
    const said = { event: 'reused', pid: process.pid, url: address };
    assert.deepEqual(lines.map(line => JSON.parse(line) as unknown), [said, said], 'the address is printed without its token');
    assert.ok(!lines.join('\n').includes('bootstrap'));

    // The page's own module takes the token from the address it was opened with and gets a session for it.
    const send = (path: string, init?: RequestInit) => fetch(new URL(path, address), init);
    const sessions: (string | null)[] = [];
    for (const url of opened) {
      const location = new URL(url);
      const bootstrap = takeBootstrap(location, { replaceState() {} });
      sessions.push(await openSession({ fetch: send, storage: null, bootstrap }));
      assert.equal(await openSession({ fetch: send, storage: null, bootstrap }), null, 'the same link opened again is refused');
    }
    assert.match(String(sessions[0]), /^[a-f0-9]{64}$/);
    assert.match(String(sessions[1]), /^[a-f0-9]{64}$/);
    assert.notEqual(sessions[0], sessions[1], 'every tab has a session of its own');
    for (const session of sessions)
      assert.equal((await send('/api/status', { headers: { authorization: `Bearer ${session}` } })).status, 200);

    // A launch that opens no page asks for no token.
    assert.equal(await launch(paths, { openPanel: false, open }), 0);
    assert.equal(opened.length, 2);
    assert.deepEqual(JSON.parse(lines.at(-1)!), said);

    // The request of the launcher is the control credential's alone.
    assert.match(String(await requestBootstrap(record({ port: host.port, token: host.token }))), /^[a-f0-9]{64}$/);
    assert.equal(await requestBootstrap(record({ port: host.port, token: 'e'.repeat(64) })), null);
    assert.equal(await requestBootstrap(record({ port: host.port, token: sessions[0]! })), null, 'a session opens no other session');
  } finally {
    await host.close();
    await paths.remove();
  }
});

test('a server that gives no one-time token is opened by its plain address', async t => {
  // A server of an earlier build may still run after the application was replaced: it knows its status and no sessions.
  const paths = await temporaryPaths();
  let answer: { status: number; body: string } = { status: 404, body: '{"error":"Not found"}' };
  const older = createServer((incoming, response) => {
    const known = incoming.url === '/api/status' && incoming.headers.authorization === `Bearer ${record().token}`;
    const { status, body } = known ? { status: 200, body: JSON.stringify({ instance: record().instance }) } : answer;
    response.writeHead(status, { 'content-type': 'application/json' }).end(body);
  });
  older.listen(0, '127.0.0.1');
  await once(older, 'listening');
  const { port } = older.address() as AddressInfo;
  const lines = printed(t);
  try {
    await writeInstanceRecord(paths, record({ port }));
    const opened: string[] = [];
    const answers = [answer, { status: 201, body: '{"bootstrap":"short"}' }, { status: 201, body: 'not json' }, { status: 201, body: 'null' },
      { status: 200, body: JSON.stringify({ bootstrap: 'c'.repeat(64) }) }, { status: 201, body: JSON.stringify({ bootstrap: `${'c'.repeat(64)}&x=1` }) }];
    for (answer of answers)
      assert.equal(await launch(paths, { openPanel: true, open: async url => { opened.push(url); } }), 0, answer.body);
    assert.deepEqual(opened, answers.map(() => `http://127.0.0.1:${port}/`));
    assert.deepEqual(lines.map(line => (JSON.parse(line) as { url: string }).url), opened);
  } finally {
    older.close();
    older.closeAllConnections();
    await paths.remove();
  }
});

test('a launch keeps a server of another build while somebody may be in its room, or when it does not quit', async t => {
  // The other build's server: its record and its status say what it is. A launch that replaces it starts a
  // server of its own, so the launches here are the ones that keep it.
  const paths = await temporaryPaths();
  let host: unknown = { state: 'online', room: 'open', players: { connected: 1, reserved: 0 } };
  let quitAnswer = { status: 409, body: JSON.stringify({ error: 'Players are in the room.', players: { connected: 1, reserved: 0 } }) };
  const quits: string[] = [];
  const other = createServer((incoming, response) => {
    const answer = (status: number, body: string) => { response.writeHead(status, { 'content-type': 'application/json' }).end(body); };
    if (incoming.headers.authorization !== `Bearer ${record().token}`) return answer(401, '{}');
    if (incoming.url === '/api/status') return answer(200, JSON.stringify({ instance: record().instance, ...(host === undefined ? {} : { host }) }));
    if (incoming.url === '/api/session/bootstrap') return answer(201, JSON.stringify({ bootstrap: 'c'.repeat(64) }));
    if (incoming.url !== '/api/host/quit') return answer(404, '{}');
    let body = '';
    incoming.setEncoding('utf8');
    incoming.on('data', (chunk: string) => { body += chunk; });
    incoming.on('end', () => {
      quits.push(body);
      answer(quitAnswer.status, quitAnswer.body);
    });
  });
  other.listen(0, '127.0.0.1');
  await once(other, 'listening');
  const { port } = other.address() as AddressInfo;
  const lines = printed(t);
  const said: string[] = [];
  t.mock.method(console, 'error', (line: string) => { said.push(line); });
  try {
    await writeInstanceRecord(paths, record({ port, version: '1.0.0', build: 'd'.repeat(64) }));
    const url = `http://127.0.0.1:${port}/`;
    const opened: string[] = [];
    const launched = async () => {
      assert.equal(await launch(paths, { openPanel: true, open: async address => { opened.push(address); } }), 0);
      return JSON.parse(lines.at(-1)!) as unknown;
    };
    const kept = { event: 'reused', pid: process.pid, url, otherBuild: true };
    assert.deepEqual(await launched(), kept, 'a player is connected');
    host = { state: 'online', room: 'open', players: { connected: 0, reserved: 1 } };
    assert.deepEqual(await launched(), kept, 'a controller is kept for a player who is away');
    // A status that does not count the players is no proof that the room is empty.
    host = undefined;
    assert.deepEqual(await launched(), kept);
    host = { state: 'online', room: 'open', players: { connected: '0', reserved: 0 } };
    assert.deepEqual(await launched(), kept);
    assert.deepEqual(quits, [], 'none of them was asked to quit');
    assert.deepEqual(said, Array(4).fill('A server of another build is running and somebody may be in its room, so it keeps running.'));

    // The room looks empty and the server is asked to quit, without force, but it does not: a player came meanwhile.
    host = { state: 'online', room: 'open', players: { connected: 0, reserved: 0 } };
    assert.deepEqual(await launched(), kept);
    host = { state: 'idle', room: 'off', players: null };
    quitAnswer = { status: 500, body: 'not json' };
    assert.deepEqual(await launched(), kept);
    assert.deepEqual(quits, ['', '']);
    assert.deepEqual(said.slice(4), Array(2).fill('A server of another build is running and did not quit, so it keeps running.'));

    // It accepts the quit and is still there when the wait is over: it was not refused, it is slow.
    quitAnswer = { status: 202, body: JSON.stringify({ quitting: true }) };
    assert.equal(await launch(paths, { openPanel: true, open: async address => { opened.push(address); }, quitWait: 300 }), 0);
    assert.deepEqual(JSON.parse(lines.at(-1)!), kept);
    assert.deepEqual(said.slice(6), ['A server of another build is still quitting. Open Sled Storm Server again in a moment.']);
    assert.deepEqual(opened, Array(7).fill(`${url}#bootstrap=${'c'.repeat(64)}`), 'its page is opened, as for a server of this build');
  } finally {
    other.close();
    other.closeAllConnections();
    await paths.remove();
  }
});

test('the browser is given the panel\'s address and nothing else', async () => {
  const paths = await temporaryPaths();
  try {
    // A stand-in for the program that opens an address: it writes down how many arguments it got, and each.
    const opened = join(paths.tempRoot, 'opened.txt');
    const program = join(paths.tempRoot, 'stand-in open');
    await writeFile(program, `#!/bin/sh\nprintf '%s\\n' "$#" "$@" >> '${opened}'\n`, { mode: 0o755 });
    const token = 'c'.repeat(64);
    const panel = 'http://127.0.0.1:4321/';
    const others = ['http://localhost:4321/', 'https://127.0.0.1:4321/', 'http://127.0.0.1:4321', 'http://127.0.0.1/', 'http://127.0.0.1:432100/',
      'http://127.0.0.1.example:4321/', 'http://user@127.0.0.1:4321/', `${panel}index.html`, `${panel}?x=1`, `${panel}#room`, `${panel}#bootstrap=short`,
      `${panel}#bootstrap=${token}0`, `${panel}#bootstrap=${token.toUpperCase()}`, `${panel}#Bootstrap=${token}`, `${panel}#bootstrap=${token}&x=1`,
      `${panel}#bootstrap=${token}\n`, `${panel} -a Calculator`, '-a', 'file:///etc/passwd', ''];
    for (const url of others) await assert.rejects(openBrowser(url, program), /Refusing to open/, url);
    await assert.rejects(readFile(opened), 'nothing was run for an address that is not the panel\'s');
    await openBrowser(panel, program);
    await openBrowser(`${panel}#bootstrap=${token}`, program);
    assert.equal(await readFile(opened, 'utf8'), `1\n${panel}\n1\n${panel}#bootstrap=${token}\n`);
  } finally {
    await paths.remove();
  }
});
