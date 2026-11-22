import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { chmod, cp, mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { connect, createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { WebSocket } from 'ws';
import { defaultConfig, readConfig, writeConfig } from '../src/config-store.ts';
import { createHostControl } from '../src/host-control.ts';
import { startHostServer, type HostServer } from '../src/host-server.ts';
import { createHostService, type HostService, type HostStatus } from '../src/host-service.ts';
import { createPanelSessions } from '../src/panel-sessions.ts';
import { FolderDialogError, type ChooseFolder } from '../src/platform/folder-dialog.ts';
import { stagePanel } from '../scripts/stage-resources.mjs';
import { panelRoot, scratch, scratchPaths, standInControl, writeGame } from './fixtures.ts';

function call(port: number, method: string, path: string, headers: Record<string, string> = {}, sent?: string): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, method, path, headers }, incoming => {
      let body = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk: string) => { body += chunk; });
      incoming.on('end', () => {
        // Whatever the listener answers: it sets no cookie, because a cookie for 127.0.0.1 goes to every
        // port of that address, and no page of another origin gets the answer as a resource.
        try {
          assert.equal(incoming.headers['set-cookie'], undefined, `${method} ${path} sets a cookie`);
          assert.equal(incoming.headers['cross-origin-resource-policy'], 'same-origin', `${method} ${path}`);
        } catch (error) {
          return reject(error as Error);
        }
        resolve({ status: incoming.statusCode ?? 0, body, headers: incoming.headers });
      });
    });
    outgoing.on('error', reject);
    outgoing.end(sent);
  });
}

const json = { 'content-type': 'application/json' };
const expired = { error: 'This link to the panel has expired. Open Sled Storm Server again.' };

/** What a WebSocket client is answered with, when the answer is not a socket. */
function upgrade(port: number, path: string, headers: Record<string, string> = {}): Promise<number | 'socket'> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${port}${path}`, { headers });
    socket.once('open', () => {
      socket.terminate();
      resolve('socket');
    });
    socket.once('unexpected-response', (outgoing, incoming) => {
      outgoing.destroy();
      resolve(incoming.statusCode ?? 0);
    });
    socket.once('error', reject);
  });
}

test('the panel trades a one-time token for a session', async () => {
  let quits = 0;
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => { quits += 1; }, status: () => ({ state: 'idle' }),
    invitation: () => ({ url: null, localUrl: null }), control: standInControl().control });
  const quitCount = () => quits;
  const bodies: string[] = [];
  const ask = async (...args: Parameters<typeof call>) => {
    const answer = await call(...args);
    bodies.push(answer.body);
    return answer;
  };
  try {
    const control = { authorization: `Bearer ${host.token}` };
    assert.equal((await ask(host.port, 'POST', '/api/session/bootstrap')).status, 401, 'a one-time token needs the control credential');
    assert.equal((await ask(host.port, 'GET', '/api/session/bootstrap', control)).status, 404);
    const minted = await ask(host.port, 'POST', '/api/session/bootstrap', control);
    assert.equal(minted.status, 201);
    assert.equal(minted.headers['cache-control'], 'no-store');
    const { bootstrap } = JSON.parse(minted.body) as { bootstrap: string };
    assert.match(bootstrap, /^[a-f0-9]{64}$/);
    const sent = JSON.stringify({ bootstrap });

    // Each refusal below leaves the token unused.
    assert.equal((await ask(host.port, 'POST', '/api/session', { 'content-type': 'text/plain' }, sent)).status, 415);
    assert.equal((await ask(host.port, 'POST', '/api/session', {}, sent)).status, 415);
    assert.equal((await ask(host.port, 'POST', '/api/session', json, 'bootstrap')).status, 400);
    assert.equal((await ask(host.port, 'POST', '/api/session', json, 'null')).status, 401);
    assert.equal((await ask(host.port, 'POST', '/api/session', json, JSON.stringify({ bootstrap, padding: 'x'.repeat(2000) }))).status, 413);
    // The same, sent in pieces without a declared length: the answer still arrives.
    assert.equal((await ask(host.port, 'POST', '/api/session', { ...json, 'transfer-encoding': 'chunked' },
      JSON.stringify({ bootstrap, padding: 'x'.repeat(200_000) }))).status, 413);
    assert.equal((await ask(host.port, 'POST', '/api/session', { ...json, origin: 'https://attacker.example' }, sent)).status, 403);
    assert.equal((await ask(host.port, 'POST', '/api/session', { ...json, origin: 'http://127.0.0.1:8000' }, sent)).status, 403,
      'the game page is another origin');
    assert.equal((await ask(host.port, 'POST', '/api/session', { ...json, host: 'rebound.example' }, sent)).status, 403);
    assert.equal((await ask(host.port, 'GET', '/api/session')).status, 401);
    assert.notEqual((await ask(host.port, 'POST', '/api/%73ession', json, sent)).status, 201);
    assert.notEqual((await ask(host.port, 'POST', '/api/session/', json, sent)).status, 201);

    const opened = await ask(host.port, 'POST', '/api/session', { ...json, origin: `http://127.0.0.1:${host.port}` }, sent);
    assert.equal(opened.status, 201);
    assert.equal(opened.headers['cache-control'], 'no-store');
    const { session } = JSON.parse(opened.body) as { session: string };
    assert.match(session, /^[a-f0-9]{64}$/);
    assert.notEqual(session, bootstrap);

    const again = await ask(host.port, 'POST', '/api/session', json, sent);
    assert.equal(again.status, 401, 'a token is good once');
    assert.deepEqual(JSON.parse(again.body), expired);
    const unknown = await ask(host.port, 'POST', '/api/session', json, JSON.stringify({ bootstrap: '0'.repeat(64) }));
    assert.equal(unknown.status, 401);
    assert.deepEqual(JSON.parse(unknown.body), expired);
    assert.equal((await ask(host.port, 'POST', '/api/session', json, JSON.stringify({ bootstrap: session }))).status, 401);
    assert.equal((await ask(host.port, 'POST', '/api/session', json, JSON.stringify({ bootstrap: host.token }))).status, 401);

    const panel = { authorization: `Bearer ${session}` };
    const status = await ask(host.port, 'GET', '/api/status', panel);
    assert.equal(status.status, 200);
    assert.equal((JSON.parse(status.body) as { instance: string }).instance, host.instance);
    assert.equal((await ask(host.port, 'GET', '/api/invitation', panel)).status, 409);
    assert.equal((await ask(host.port, 'GET', '/api/status', { authorization: `Bearer ${bootstrap}` })).status, 401,
      'a one-time token is not a credential');
    assert.equal((await ask(host.port, 'GET', '/api/status', { ...panel, origin: 'https://attacker.example' })).status, 403);
    assert.equal((await ask(host.port, 'GET', '/api/status', { ...panel, host: 'rebound.example' })).status, 403);

    const second = await ask(host.port, 'POST', '/api/session/bootstrap', panel);
    assert.equal(second.status, 403);
    assert.deepEqual(JSON.parse(second.body), { error: 'A panel session cannot open another one.' });

    assert.ok(bodies.every(body => !body.includes(host.token)), 'no answer carries the control credential');
    assert.equal(quitCount(), 0);
    assert.equal((await ask(host.port, 'POST', '/api/host/quit', panel)).status, 202, 'the panel can quit the server');
    for (let attempt = 0; quitCount() === 0 && attempt < 50; attempt++) await delay(10);
    assert.equal(quitCount(), 1);
  } finally {
    await host.close();
  }
});

test('a one-time token is refused by the listener after its minute', async () => {
  let clock = 0;
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => {}, status: () => ({}),
    invitation: () => ({ url: null, localUrl: null }), control: standInControl().control, sessions: createPanelSessions({ now: () => clock }) });
  try {
    const minted = await call(host.port, 'POST', '/api/session/bootstrap', { authorization: `Bearer ${host.token}` });
    clock = 60_000;
    const late = await call(host.port, 'POST', '/api/session', json, minted.body);
    assert.equal(late.status, 401);
    assert.deepEqual(JSON.parse(late.body), expired);
  } finally {
    await host.close();
  }
});

test('the control listener is no WebSocket endpoint', async () => {
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => {}, status: () => ({}),
    invitation: () => ({ url: null, localUrl: null }), control: standInControl().control });
  try {
    assert.equal(await upgrade(host.port, '/api/status'), 401);
    assert.equal(await upgrade(host.port, '/api/status', { authorization: `Bearer ${host.token}` }), 200, 'an answer, not a socket');
    assert.equal(await upgrade(host.port, '/api/session'), 401);
    assert.equal(await upgrade(host.port, '/api/host/quit', { authorization: `Bearer ${host.token}` }), 404);
    assert.equal(await upgrade(host.port, '/api/status', { authorization: `Bearer ${host.token}`, origin: 'https://attacker.example' }), 403);
  } finally {
    await host.close();
  }
});

test('the control listener answers only its own host, origin and credential', async () => {
  let quits = 0;
  const hostStatus = { state: 'needs_setup', tunnel: 'off' };
  let links: { url: string | null; localUrl: string | null } = { url: null, localUrl: null };
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => { quits += 1; }, status: () => hostStatus,
    invitation: () => links, control: standInControl().control });
  const quitCount = () => quits;
  try {
    const bearer = { authorization: `Bearer ${host.token}` };
    const status = await call(host.port, 'GET', '/api/status', bearer);
    assert.equal(status.status, 200);
    assert.equal(status.headers['cache-control'], 'no-store');
    const report = JSON.parse(status.body) as Record<string, unknown>;
    assert.deepEqual(report, { application: 'Sled Storm Server', version: '9.9.9', instance: host.instance,
      pid: process.pid, startedAt: host.startedAt, host: hostStatus });
    hostStatus.state = 'online';
    assert.equal((JSON.parse((await call(host.port, 'GET', '/api/status', bearer)).body) as { host: { state: string } }).host.state,
      'online', 'the status is read on every request');
    assert.ok(!status.body.includes(host.token), 'the credential is never echoed');

    assert.equal((await call(host.port, 'GET', '/api/status')).status, 401);
    assert.equal((await call(host.port, 'GET', '/api/status', { authorization: `Bearer ${'0'.repeat(64)}` })).status, 401);
    assert.equal((await call(host.port, 'GET', '/api/status', { authorization: host.token })).status, 401);
    assert.equal((await call(host.port, 'GET', '/api/status', { ...bearer, host: 'attacker.example' })).status, 403);
    assert.equal((await call(host.port, 'GET', '/api/status', { ...bearer, host: `127.0.0.1:${host.port + 1}` })).status, 403);
    assert.equal((await call(host.port, 'GET', '/api/status', { ...bearer, host: `localhost:${host.port}` })).status, 200);
    assert.equal((await call(host.port, 'GET', '/api/status', { ...bearer, origin: 'https://attacker.example' })).status, 403);
    assert.equal((await call(host.port, 'GET', '/api/status', { ...bearer, origin: `http://127.0.0.1:${host.port}` })).status, 200);

    assert.equal((await call(host.port, 'GET', '/api/invitation')).status, 401, 'the link needs the credential');
    const none = await call(host.port, 'GET', '/api/invitation', bearer);
    assert.equal(none.status, 409);
    assert.deepEqual(JSON.parse(none.body), { error: 'No room is open.' });
    // A room without a public address can still be played on this computer.
    links = { url: null, localUrl: 'http://127.0.0.1:8000/#room' };
    const local = await call(host.port, 'GET', '/api/invitation', bearer);
    assert.equal(local.status, 200);
    assert.deepEqual(JSON.parse(local.body), links);
    links = { url: 'https://synthetic-test.trycloudflare.com/access/' + 'a'.repeat(48) + '#room', localUrl: 'http://127.0.0.1:8000/#room' };
    const some = await call(host.port, 'GET', '/api/invitation', bearer);
    assert.equal(some.status, 200);
    assert.deepEqual(JSON.parse(some.body), links);

    assert.equal((await call(host.port, 'POST', '/api/host/quit')).status, 401);
    assert.equal((await call(host.port, 'POST', '/api/host/quit', { ...bearer, origin: 'null' })).status, 403);
    assert.equal((await call(host.port, 'GET', '/api/host/quit', bearer)).status, 404);
    assert.equal((await call(host.port, 'GET', '/api/unknown', bearer)).status, 404);
    assert.equal((await call(host.port, 'GET', '/%2e%2e/api/status', bearer)).status, 404);
    assert.equal((await call(host.port, 'GET', '/api/%73tatus', bearer)).status, 404);
    assert.equal((await call(host.port, 'GET', '//api/status', bearer)).status, 404);
    assert.equal((await call(host.port, 'GET', '/api/status?x=1', bearer)).status, 200);
    assert.equal(quitCount(), 0);

    const page = await call(host.port, 'GET', '/');
    assert.equal(page.status, 200);
    assert.match(String(page.headers['content-security-policy']), /default-src 'none'/);
    assert.ok(!page.body.includes(host.token) && !page.body.includes(host.instance));

    assert.equal((await call(host.port, 'POST', '/api/host/quit', bearer)).status, 202);
    for (let attempt = 0; quitCount() === 0 && attempt < 50; attempt++) await delay(10);
    assert.equal(quitCount(), 1);
  } finally {
    await host.close();
  }
  await assert.rejects(call(host.port, 'GET', '/'), 'the listener is closed');
});

const PANEL_POLICY = "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

test('the listener serves the panel\'s files and nothing else from the folder', async t => {
  const options = { version: '9.9.9', onQuit: () => {}, status: () => ({ state: 'idle' }), invitation: () => ({ url: null, localUrl: null }),
    control: standInControl().control };
  const host = await startHostServer({ panelRoot, ...options });
  try {
    const script = 'text/javascript; charset=utf-8';
    const files: Record<string, [string, string]> = { '/': ['index.html', 'text/html; charset=utf-8'], '/panel.css': ['panel.css', 'text/css; charset=utf-8'],
      '/session.js': ['session.js', script], '/view.js': ['view.js', script], '/controller.js': ['controller.js', script], '/panel.js': ['panel.js', script] };
    for (const [path, [name, type]] of Object.entries(files)) {
      const answer = await call(host.port, 'GET', path);
      assert.equal(answer.status, 200, path);
      assert.equal(answer.body, await readFile(join(panelRoot, name), 'utf8'), path);
      assert.deepEqual([answer.headers['content-type'], answer.headers['content-security-policy'], answer.headers['cache-control'],
        answer.headers['x-content-type-options'], answer.headers['referrer-policy']], [type, PANEL_POLICY, 'no-store', 'nosniff', 'no-referrer'], path);
      assert.ok(!answer.body.includes(host.token) && !answer.body.includes(host.instance), path);
      // The page is public on this computer, and still answers only as itself.
      assert.equal((await call(host.port, 'GET', path, { host: 'rebound.example' })).status, 403, path);
      assert.equal((await call(host.port, 'GET', path, { origin: 'http://127.0.0.1:8000' })).status, 403, path);
      assert.equal((await call(host.port, 'POST', path)).status, 404, path);
      assert.equal((await call(host.port, 'GET', `${path}?v=1`)).status, 200, path);
    }
    // The policy lets nothing run that is written into the page itself, so the page has nothing of the kind.
    const page = (await call(host.port, 'GET', '/')).body;
    assert.match(page, /<script type="module" src="\/panel\.js"><\/script>/);
    assert.match(page, /<link rel="stylesheet" href="\/panel\.css">/);
    assert.doesNotMatch(page, /<style|\sstyle=|\son[a-z]+=|<script>|https?:/);

    for (const path of ['/session.test.mjs', '/view.test.mjs', '/controller.test.mjs', '/page.test.mjs', '/index.html', '/../web/app.js', '/index.html%00',
      '/panel.js%00', '/panel.js/', '/%70anel.js', '//panel.js', '/./panel.js', '/admin/panel.js', '/PANEL.JS', '/panel.js.map', '/view', '/controller',
      '/.DS_Store', '/favicon.ico'])
      assert.equal((await call(host.port, 'GET', path)).status, 404, path);
  } finally {
    await host.close();
  }

  // A build that lost the folder says so, and its commands work as before.
  const bare = await startHostServer({ panelRoot: join(await scratch(t, 'panel'), 'admin'), ...options });
  try {
    const page = await call(bare.port, 'GET', '/');
    assert.deepEqual([page.status, page.headers['content-type'], page.body], [500, 'text/plain; charset=utf-8', 'This build is missing the control panel page.']);
    assert.equal((await call(bare.port, 'GET', '/panel.js')).status, 500);
    assert.equal((await call(bare.port, 'GET', '/api/status', { authorization: `Bearer ${bare.token}` })).status, 200);
  } finally {
    await bare.close();
  }
});

test('a server serves the page of its own build after the application was replaced', async t => {
  // A server that keeps running while the application is replaced in place must not serve the new page, which
  // talks to the routes of another build.
  const folder = join(await scratch(t, 'replaced'), 'admin');
  await cp(panelRoot, folder, { recursive: true });
  const before = await readFile(join(folder, 'panel.js'), 'utf8');
  const host = await startHostServer({ panelRoot: folder, version: '9.9.9', onQuit: () => {}, status: () => ({ state: 'idle' }),
    invitation: () => ({ url: null, localUrl: null }), control: standInControl().control });
  try {
    await writeFile(join(folder, 'panel.js'), '// the page of a newer build\n');
    await writeFile(join(folder, 'view.js'), '// the page of a newer build\n');
    const answer = await call(host.port, 'GET', '/panel.js');
    assert.deepEqual([answer.status, answer.body], [200, before]);
    assert.doesNotMatch((await call(host.port, 'GET', '/view.js')).body, /newer build/);
  } finally {
    await host.close();
  }
});

const nobody = { url: null, localUrl: null };
const bearer = (token: string) => ({ authorization: `Bearer ${token}` });

/** A session of the panel, as its page gets one. */
async function panelSession(host: HostServer): Promise<string> {
  const minted = await call(host.port, 'POST', '/api/session/bootstrap', bearer(host.token));
  const opened = await call(host.port, 'POST', '/api/session', json, minted.body);
  assert.equal(opened.status, 201, opened.body);
  return (JSON.parse(opened.body) as { session: string }).session;
}

/** A host service that does nothing: its status is what the test says, and `calls` keeps what was asked. */
function standInService(initial: Partial<HostStatus> = {}) {
  let status: HostStatus = { state: 'idle', problem: null, game: null, localUrl: null, gatewayPort: null, tunnel: 'off', mirror: 'off',
    room: 'off', players: null, roomOptions: null, ...initial };
  const calls: string[] = [];
  let closed = false;
  let starting = false;
  const service: HostService = {
    status: () => status,
    async start() {
      calls.push('start');
      return status;
    },
    async stop() { calls.push('stop'); },
    async close() {
      calls.push('close');
      closed = true;
    },
    closed: () => closed,
    starting: () => starting,
    configured() { calls.push('configured'); },
    newGame() {
      calls.push('newGame');
      return status.room !== 'off';
    },
    invitation: () => null,
    localInvitation: () => null,
  };
  return { service, calls, set(change: Partial<HostStatus>) { status = { ...status, ...change }; }, startingNow(value: boolean) { starting = value; } };
}

test('start and stop go through the control listener', async () => {
  const { control, calls } = standInControl();
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => {}, status: () => ({ state: 'idle' }), invitation: () => nobody, control });
  try {
    const command = bearer(host.token);
    for (const path of ['/api/host/start', '/api/room/stop']) {
      assert.equal((await call(host.port, 'POST', path)).status, 401, path);
      assert.equal((await call(host.port, 'POST', path, bearer('0'.repeat(64)))).status, 401, path);
      assert.equal((await call(host.port, 'GET', path, command)).status, 404, path);
      assert.equal((await call(host.port, 'POST', `${path}/`, command)).status, 404, path);
      assert.equal((await call(host.port, 'POST', path.replace('/api/', '/%61pi/'), command)).status, 404, path);
      assert.equal((await call(host.port, 'POST', path, { ...command, origin: 'https://attacker.example' })).status, 403, path);
      assert.equal((await call(host.port, 'POST', path, { ...command, origin: 'http://127.0.0.1:8000' })).status, 403, path);
      assert.equal((await call(host.port, 'POST', path, { ...command, host: 'rebound.example' })).status, 403, path);
    }
    assert.deepEqual(calls, [], 'a refused request asks nothing of the host');

    // Both answer at once, with the status of that moment: the work runs on.
    const started = await call(host.port, 'POST', '/api/host/start', command);
    assert.deepEqual({ status: started.status, body: JSON.parse(started.body) }, { status: 202, body: { host: { state: 'idle' } } });
    const stopped = await call(host.port, 'POST', '/api/room/stop', command);
    assert.deepEqual({ status: stopped.status, body: JSON.parse(stopped.body) }, { status: 202, body: { host: { state: 'idle' } } });
    assert.deepEqual(calls.splice(0), ['start', 'stop']);

    // A stop may carry a body, and only `"force": true` in it is force.
    const stop = (headers: Record<string, string>, sent?: string) => call(host.port, 'POST', '/api/room/stop', { ...command, ...headers }, sent);
    assert.equal((await stop(json, '{"force":true}')).status, 202);
    for (const sent of ['{"force":false}', '{"force":"yes"}', '{"force":1}', '{}', 'null', '[true]'])
      assert.equal((await stop(json, sent)).status, 202, sent);
    assert.deepEqual(calls.splice(0), ['stop --force', 'stop', 'stop', 'stop', 'stop', 'stop', 'stop']);
    assert.equal((await stop({ 'content-type': 'text/plain' }, '{"force":true}')).status, 415);
    assert.equal((await stop({}, '{"force":true}')).status, 415);
    assert.equal((await stop(json, 'force')).status, 400);
    assert.equal((await stop(json, JSON.stringify({ force: true, padding: 'x'.repeat(2000) }))).status, 413);
    assert.deepEqual(calls, [], 'a request that cannot be read stops nothing');

    // The panel's page may ask for both.
    const panel = bearer(await panelSession(host));
    assert.equal((await call(host.port, 'POST', '/api/host/start', panel)).status, 202);
    assert.equal((await call(host.port, 'POST', '/api/room/stop', panel)).status, 202);
    assert.equal((await call(host.port, 'POST', '/api/room/stop', { ...panel, ...json }, '{"force":true}')).status, 202);
    assert.deepEqual(calls, ['start', 'stop', 'stop --force']);
  } finally {
    await host.close();
  }
});

test('a stop with players needs force, and its refusal says how many are there', async t => {
  const hosting = standInService({ state: 'online', room: 'open', players: { connected: 1, reserved: 1 } });
  const paths = await scratchPaths(t, 'control');
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => {}, status: () => hosting.service.status(), invitation: () => nobody,
    control: createHostControl({ paths, service: hosting.service }) });
  try {
    const command = bearer(host.token);
    const stop = (sent?: string) => call(host.port, 'POST', '/api/room/stop', sent === undefined ? command : { ...command, ...json }, sent);
    const refusal = (players: object) => ({ status: 409, body: { error: 'Players are in the room.', players } });
    const answer = async (sent?: string) => {
      const { status, body } = await stop(sent);
      return { status, body: JSON.parse(body) as unknown };
    };
    assert.deepEqual(await answer(), refusal({ connected: 1, reserved: 1 }));
    assert.deepEqual(await answer('{"force":false}'), refusal({ connected: 1, reserved: 1 }));
    // A controller that is kept for a player who is away is a player to the room.
    hosting.set({ players: { connected: 0, reserved: 2 } });
    assert.deepEqual(await answer(), refusal({ connected: 0, reserved: 2 }));
    hosting.set({ players: { connected: 3, reserved: 0 } });
    assert.deepEqual(await answer('{}'), refusal({ connected: 3, reserved: 0 }));
    assert.deepEqual(hosting.calls, [], 'a refused stop stops nothing');

    assert.equal((await stop('{"force":true}')).status, 202);
    assert.deepEqual(hosting.calls.splice(0), ['stop']);
    hosting.set({ players: { connected: 0, reserved: 0 } });
    assert.equal((await stop()).status, 202, 'an empty room stops without force');
    hosting.set({ state: 'idle', room: 'off', players: null });
    assert.equal((await stop()).status, 202, 'and so does a host without a room');
    assert.deepEqual(hosting.calls, ['stop', 'stop']);
  } finally {
    await host.close();
  }
});

test('a quit with players needs force, and its refusal says how many are there', async t => {
  const hosting = standInService({ state: 'online', room: 'open', players: { connected: 1, reserved: 0 } });
  const paths = await scratchPaths(t, 'control');
  let quits = 0;
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => { quits += 1; }, status: () => hosting.service.status(),
    invitation: () => nobody, control: createHostControl({ paths, service: hosting.service }) });
  const quitAnswered = async () => {
    for (let attempt = 0; quits === 0 && attempt < 50; attempt++) await delay(10);
    return quits;
  };
  try {
    const command = bearer(host.token);
    const quit = (headers: Record<string, string> = {}, sent?: string) => call(host.port, 'POST', '/api/host/quit', { ...command, ...headers }, sent);
    const refusal = (players: object) => ({ status: 409, body: { error: 'Players are in the room.', players } });
    const answer = async (sent?: string) => {
      const { status, body } = sent === undefined ? await quit() : await quit(json, sent);
      return { status, body: JSON.parse(body) as unknown };
    };
    assert.deepEqual(await answer(), refusal({ connected: 1, reserved: 0 }));
    assert.deepEqual(await answer('{"force":false}'), refusal({ connected: 1, reserved: 0 }));
    // A controller that is kept for a player who is away is a player to the room.
    hosting.set({ players: { connected: 0, reserved: 1 } });
    assert.deepEqual(await answer('{"force":"yes"}'), refusal({ connected: 0, reserved: 1 }));
    // The panel's page is asked the same way.
    const panel = bearer(await panelSession(host));
    const { status, body } = await call(host.port, 'POST', '/api/host/quit', panel);
    assert.deepEqual({ status, body: JSON.parse(body) as unknown }, refusal({ connected: 0, reserved: 1 }));
    // A body that cannot be read quits nothing.
    assert.equal((await quit({ 'content-type': 'text/plain' }, '{"force":true}')).status, 415);
    assert.equal((await quit(json, 'force')).status, 400);
    assert.equal((await quit(json, JSON.stringify({ force: true, padding: 'x'.repeat(2000) }))).status, 413);
    await delay(50);
    assert.equal(quits, 0, 'a refused quit quits nothing');
    assert.deepEqual(hosting.calls, [], 'and asks nothing of the host');

    const forced = await answer('{"force":true}');
    assert.deepEqual(forced, { status: 202, body: { quitting: true } });
    assert.equal(await quitAnswered(), 1);
  } finally {
    await host.close();
  }
});

test('a new game goes through the control listener, and with players it needs force', async t => {
  const hosting = standInService({ state: 'online', room: 'open', players: { connected: 1, reserved: 1 } });
  const paths = await scratchPaths(t, 'control');
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => {}, status: () => hosting.service.status(), invitation: () => nobody,
    control: createHostControl({ paths, service: hosting.service }) });
  try {
    const command = bearer(host.token);
    const path = '/api/room/new-game';
    assert.equal((await call(host.port, 'POST', path)).status, 401);
    assert.equal((await call(host.port, 'POST', path, bearer('0'.repeat(64)))).status, 401);
    assert.equal((await call(host.port, 'GET', path, command)).status, 404);
    assert.equal((await call(host.port, 'POST', `${path}/`, command)).status, 404);
    assert.equal((await call(host.port, 'POST', path.replace('/api/', '/%61pi/'), command)).status, 404);
    assert.equal((await call(host.port, 'POST', path, { ...command, origin: 'https://attacker.example' })).status, 403);
    assert.equal((await call(host.port, 'POST', path, { ...command, origin: 'http://127.0.0.1:8000' })).status, 403);
    assert.equal((await call(host.port, 'POST', path, { ...command, host: 'rebound.example' })).status, 403);

    const answer = async (caller: Record<string, string>, sent?: string) => {
      const { status, body } = await call(host.port, 'POST', path, sent === undefined ? caller : { ...caller, ...json }, sent);
      return { status, body: JSON.parse(body) as unknown };
    };
    const refusal = (players: object) => ({ status: 409, body: { error: 'Players are in the room.', players } });
    assert.deepEqual(await answer(command), refusal({ connected: 1, reserved: 1 }));
    assert.deepEqual(await answer(command, '{"force":false}'), refusal({ connected: 1, reserved: 1 }));
    hosting.set({ players: { connected: 0, reserved: 1 } });
    const panel = bearer(await panelSession(host));
    assert.deepEqual(await answer(panel), refusal({ connected: 0, reserved: 1 }));
    assert.equal((await call(host.port, 'POST', path, { ...command, 'content-type': 'text/plain' }, '{"force":true}')).status, 415);
    assert.deepEqual(hosting.calls, [], 'a refused new game changes nothing');

    // The answer comes at once, with the status of that moment.
    assert.deepEqual(await answer(panel, '{"force":true}'), { status: 202, body: { host: hosting.service.status() } });
    hosting.set({ players: { connected: 0, reserved: 0 } });
    assert.equal((await answer(command)).status, 202, 'an empty room gets a new game without force');
    assert.deepEqual(hosting.calls.splice(0), ['newGame', 'newGame']);

    hosting.set({ state: 'idle', room: 'off', players: null });
    assert.deepEqual(await answer(command), { status: 409, body: { error: 'No room is open.' } });
    hosting.set({ state: 'online', room: 'open', players: { connected: 0, reserved: 0 } });
    await hosting.service.close();
    assert.deepEqual(await answer(command), { status: 409, body: { error: 'The server is quitting.' } });
    assert.deepEqual(hosting.calls, ['close'], 'a refused new game asks nothing of the host');
  } finally {
    await host.close();
  }
});

test('the diagnostic report goes through the control listener and names no folder', async t => {
  const hosting = standInService({ state: 'online', room: 'open', players: { connected: 1, reserved: 0 } });
  const paths = await scratchPaths(t, 'control');
  const folder = await writeGame(join(paths.root, 'Игры диск'));
  await writeConfig(paths, { ...defaultConfig, gameFolder: folder, discPolicy: 'local-only' });
  await writeFile(join(paths.logRoot, 'server.log'), `2026-11-21T10:00:00.000Z Seeded ${folder}\n`);
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => {}, status: () => hosting.service.status(), invitation: () => nobody,
    control: createHostControl({ paths, service: hosting.service }) });
  try {
    const command = bearer(host.token);
    const path = '/api/diagnostics/export';
    assert.equal((await call(host.port, 'POST', path)).status, 401);
    assert.equal((await call(host.port, 'POST', path, bearer('0'.repeat(64)))).status, 401);
    assert.equal((await call(host.port, 'GET', path, command)).status, 404);
    assert.equal((await call(host.port, 'POST', `${path}/`, command)).status, 404);
    assert.equal((await call(host.port, 'POST', path.replace('/api/', '/%61pi/'), command)).status, 404);
    assert.equal((await call(host.port, 'POST', path, { ...command, origin: 'https://attacker.example' })).status, 403);
    assert.equal((await call(host.port, 'POST', path, { ...command, origin: 'http://127.0.0.1:8000' })).status, 403);
    assert.equal((await call(host.port, 'POST', path, { ...command, host: 'rebound.example' })).status, 403);

    const exported = await call(host.port, 'POST', path, command);
    assert.equal(exported.status, 200);
    assert.ok(!exported.body.includes(folder) && !exported.body.includes(paths.root), 'the report names no folder');
    const report = JSON.parse(exported.body) as { version: string; startedAt: string; host: unknown; config: object; log: object };
    assert.deepEqual({ version: report.version, startedAt: report.startedAt }, { version: '9.9.9', startedAt: host.startedAt });
    assert.deepEqual(report.host, hosting.service.status());
    assert.deepEqual(report.config, { gameFolder: true, discPolicy: 'local-only', autoStart: true,
      roomOptions: { progress: 'all', camera: true }, problem: null });
    assert.deepEqual(report.log, { lines: ['2026-11-21T10:00:00.000Z Seeded <game folder>'], problem: null });

    // The panel's page asks with its session. A body of any kind is not read.
    const panel = bearer(await panelSession(host));
    assert.equal((await call(host.port, 'POST', path, panel)).status, 200);
    assert.equal((await call(host.port, 'POST', path, { ...panel, 'content-type': 'text/plain' }, 'x'.repeat(5000))).status, 200);
    assert.deepEqual(hosting.calls, [], 'a report changes nothing');
  } finally {
    await host.close();
  }
});

test('an empty room, or a host without one, quits without force', async t => {
  for (const players of [{ connected: 0, reserved: 0 }, null]) {
    const hosting = standInService(players ? { state: 'online', room: 'open', players } : { state: 'idle', room: 'off', players });
    const paths = await scratchPaths(t, 'control');
    let quits = 0;
    const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => { quits += 1; }, status: () => hosting.service.status(),
      invitation: () => nobody, control: createHostControl({ paths, service: hosting.service }) });
    try {
      const { status, body } = await call(host.port, 'POST', '/api/host/quit', bearer(host.token));
      assert.deepEqual({ status, body: JSON.parse(body) as unknown }, { status: 202, body: { quitting: true } }, JSON.stringify(players));
      for (let attempt = 0; quits === 0 && attempt < 50; attempt++) await delay(10);
      assert.equal(quits, 1);
    } finally {
      await host.close();
    }
  }
});

test('a start that builds the stack anew needs force while players are in the room', async t => {
  // The game files changed under a running stack. The status asks for a new start, and that start
  // ends the room as a stop does.
  const changed = { component: 'game-data' as const, message: 'The game files changed after they were prepared. Start the server again.' };
  const hosting = standInService({ state: 'degraded', problem: changed, room: 'open', players: { connected: 1, reserved: 1 } });
  const paths = await scratchPaths(t, 'control');
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => {}, status: () => hosting.service.status(), invitation: () => nobody,
    control: createHostControl({ paths, service: hosting.service }) });
  try {
    const command = bearer(host.token);
    const start = (headers: Record<string, string> = {}, sent?: string) => call(host.port, 'POST', '/api/host/start', { ...command, ...headers }, sent);
    const refusal = (players: object) => ({ status: 409, body: { error: 'Players are in the room.', players } });
    const answer = async (sent?: string) => {
      const { status, body } = sent === undefined ? await start() : await start(json, sent);
      return { status, body: JSON.parse(body) as unknown };
    };
    assert.deepEqual(await answer(), refusal({ connected: 1, reserved: 1 }));
    assert.deepEqual(await answer('{"force":false}'), refusal({ connected: 1, reserved: 1 }));
    hosting.set({ players: { connected: 0, reserved: 2 } });
    assert.deepEqual(await answer('{"force":"yes"}'), refusal({ connected: 0, reserved: 2 }));
    assert.deepEqual(hosting.calls, [], 'a refused start starts nothing');

    assert.equal((await start(json, '{"force":true}')).status, 202);
    assert.deepEqual(hosting.calls.splice(0), ['start']);
    // A body that cannot be read starts nothing.
    assert.equal((await start({ 'content-type': 'text/plain' }, '{"force":true}')).status, 415);
    assert.equal((await start(json, 'force')).status, 400);
    assert.equal((await start(json, JSON.stringify({ force: true, padding: 'x'.repeat(2000) }))).status, 413);
    assert.deepEqual(hosting.calls, []);

    hosting.set({ players: { connected: 0, reserved: 0 } });
    assert.equal((await start()).status, 202, 'an empty room is built anew without force');
    // A start that tries again what has failed, or finds nothing to do, leaves the room as it is.
    hosting.set({ players: { connected: 2, reserved: 1 }, problem: { component: 'tunnel', message: 'The public address is not available.' } });
    assert.equal((await start()).status, 202, 'a failed address is retried under the players');
    hosting.set({ state: 'online', problem: null });
    assert.equal((await start()).status, 202, 'a start on a host that is online changes nothing');
    assert.deepEqual(hosting.calls, ['start', 'start', 'start']);
  } finally {
    await host.close();
  }
});

test('a server that is quitting takes no start', async t => {
  const hosting = standInService({ state: 'online', room: 'open', players: { connected: 0, reserved: 0 } });
  const paths = await scratchPaths(t, 'control');
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => {}, status: () => hosting.service.status(), invitation: () => nobody,
    control: createHostControl({ paths, service: hosting.service }) });
  try {
    const callers = [bearer(host.token), bearer(await panelSession(host))];
    for (const caller of callers) assert.equal((await call(host.port, 'POST', '/api/host/start', caller)).status, 202);
    assert.deepEqual(hosting.calls.splice(0), ['start', 'start']);

    // The quit has begun: hosting is being stopped for good, and the listener still answers.
    await hosting.service.close();
    hosting.set({ state: 'stopping' });
    for (const caller of callers) {
      const { status, body } = await call(host.port, 'POST', '/api/host/start', caller);
      assert.deepEqual({ status, body: JSON.parse(body) as unknown }, { status: 409, body: { error: 'The server is quitting.' } });
    }
    assert.deepEqual(hosting.calls, ['close'], 'a start that is refused asks nothing of the host');
  } finally {
    await host.close();
  }
});

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, 'close');
  return port;
}

const answers = (port: number) => new Promise<boolean>(resolve => {
  const socket = connect(port, '127.0.0.1');
  socket.once('connect', () => {
    socket.destroy();
    resolve(true);
  });
  socket.once('error', () => resolve(false));
});

test('start and stop asked together, by a command and by the panel, end with one stack or none', { timeout: 30_000 }, async t => {
  // The real host service, with no room and no tunnel: what is counted here is the stack of the local game.
  const paths = await scratchPaths(t, 'control');
  await writeConfig(paths, { version: 1, gameFolder: await writeGame(join(paths.root, 'game')), discPolicy: 'shared-allowed', autoStart: true, roomOptions: { progress: 'all', camera: true } });
  const gamePort = await freePort();
  const lines: string[] = [];
  const service = createHostService({ paths, log: line => lines.push(line), gamePort, netplayPort: await freePort(), tunnels: null, worker: null });
  t.after(() => service.stop());
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => {}, status: () => service.status(), invitation: () => nobody,
    control: createHostControl({ paths, service }) });
  try {
    const callers = { command: bearer(host.token), panel: bearer(await panelSession(host)) };
    const ask = async (who: keyof typeof callers, action: 'start' | 'stop') => {
      const answer = await call(host.port, 'POST', action === 'start' ? '/api/host/start' : '/api/room/stop', callers[who]);
      assert.equal(answer.status, 202, `${who} ${action}: ${answer.body}`);
    };
    /** Stacks that were started and have not been stopped. */
    const stacks = () => lines.filter(line => line.includes('The local game page is ready')).length
      - lines.filter(line => line === 'The local game page is stopped.').length;
    const rounds: [keyof typeof callers, 'start' | 'stop'][][] = [
      [['command', 'start'], ['panel', 'start']],
      [['panel', 'stop'], ['command', 'start']],
      [['command', 'stop'], ['panel', 'start'], ['command', 'stop']],
      [['panel', 'start'], ['command', 'stop'], ['panel', 'start'], ['command', 'start']],
      [['command', 'stop'], ['panel', 'stop']],
    ];
    for (const round of rounds) {
      const told = round.map(([who, action]) => `${who} ${action}`).join(', ');
      // Each request is answered before the next is sent, and none of them waits for the host.
      for (const [who, action] of round) await ask(who, action);
      // The last request again, directly: it changes nothing and returns once the host has settled.
      const last = round.at(-1)![1];
      if (last === 'start') await service.start();
      else await service.stop();
      assert.equal(service.status().state, last === 'start' ? 'online' : 'idle', told);
      assert.equal(stacks(), last === 'start' ? 1 : 0, told);
      assert.equal(await answers(gamePort), last === 'start', told);
    }
  } finally {
    await host.close();
  }
});

test('the configuration is read and changed through the listener', async t => {
  const paths = await scratchPaths(t, 'control');
  const folder = await writeGame(join(paths.root, 'Игра folder'));
  const empty = join(paths.root, 'empty');
  await mkdir(empty);
  const hosting = standInService({ state: 'needs_setup' });
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => {}, status: () => hosting.service.status(), invitation: () => nobody,
    control: createHostControl({ paths, service: hosting.service }) });
  try {
    const command = bearer(host.token);
    const read = async (headers: Record<string, string> = command) => {
      const { status, body } = await call(host.port, 'GET', '/api/config', headers);
      return { status, body: JSON.parse(body) as Record<string, unknown> };
    };
    const change = async (value: unknown, headers: Record<string, string> = command) => {
      const { status, body } = await call(host.port, 'PUT', '/api/config', { ...headers, ...json }, typeof value === 'string' ? value : JSON.stringify(value));
      return { status, body: JSON.parse(body) as Record<string, unknown> };
    };
    const refused = (status: number, error: string) => ({ status, body: { error } });
    const notValid = refused(400, 'The configuration in the request is not valid.');
    const whileHosting = refused(409, 'Stop the room before changing the game folder or the disc policy.');

    assert.equal((await call(host.port, 'GET', '/api/config')).status, 401);
    assert.equal((await call(host.port, 'PUT', '/api/config', json, '{"autoStart":false}')).status, 401);
    assert.equal((await call(host.port, 'PUT', '/api/config', { ...command, ...json, origin: 'http://127.0.0.1:8000' }, '{"autoStart":false}')).status, 403);
    assert.deepEqual(await read(), { status: 200, body: { gameFolder: null, discPolicy: null, autoStart: true, roomOptions: { progress: 'all', camera: true }, problem: null } });

    // What is refused is refused in words, and nothing is written.
    assert.deepEqual(await change({ gameFolder: empty }), refused(400, 'Expected exactly one CUE file in the game folder.'));
    assert.deepEqual(await change({ gameFolder: join(paths.root, 'missing') }), refused(400, 'The game folder does not exist.'));
    assert.deepEqual(await change({ gameFolder: 'relative/folder' }), refused(400, 'The game folder must be given by its full path.'));
    assert.deepEqual(await change({ gameFolder: null }), refused(400, 'The game folder must be given by its full path.'));
    // A path of this length is a request like any other, not one that is too long to read.
    assert.deepEqual(await change({ gameFolder: `/${'x'.repeat(1500)}` }), refused(400, 'The game folder could not be read.'));
    assert.deepEqual(await change({ discPolicy: 'public' }), refused(400, 'Unknown disc policy.'));
    assert.deepEqual(await change({ gameFolder: folder, discPolicy: 'public' }), refused(400, 'Unknown disc policy.'));
    for (const value of [{ autoStart: 'yes' }, { rooms: 2 }, { autoStart: true, version: 2 }, [], null, 'true'])
      assert.deepEqual(await change(value), notValid, JSON.stringify(value));
    assert.equal((await change('{"autoStart":')).status, 400);
    assert.equal((await change({ autoStart: false, padding: 'x'.repeat(5000) })).status, 413);
    assert.equal((await call(host.port, 'PUT', '/api/config', { ...command, 'content-type': 'text/plain' }, '{"autoStart":false}')).status, 415);
    assert.deepEqual(await readdir(paths.dataRoot), [], 'a refused change writes nothing');
    assert.deepEqual(hosting.calls, [], 'and the host hears nothing of it');

    const saved = { gameFolder: folder, discPolicy: 'shared-allowed', autoStart: true, roomOptions: { progress: 'all', camera: true }, problem: null };
    assert.deepEqual(await change({ gameFolder: folder, discPolicy: 'shared-allowed' }), { status: 200, body: saved });
    assert.deepEqual(await readConfig(paths), { config: { version: 1, gameFolder: folder, discPolicy: 'shared-allowed', autoStart: true, roomOptions: { progress: 'all', camera: true } }, problem: null });
    assert.deepEqual(await read(), { status: 200, body: saved });
    // The host is told that what its status said about the configuration before is no longer so.
    assert.deepEqual(hosting.calls.splice(0), ['configured']);

    // While hosting is up, or on its way up or down, the folder and the policy stay; the switch does not.
    for (const state of ['preparing', 'starting', 'online', 'degraded', 'stopping'] as const) {
      hosting.set({ state });
      assert.deepEqual(await change({ discPolicy: 'local-only' }), whileHosting, state);
      assert.deepEqual(await change({ gameFolder: folder }), whileHosting, state);
      assert.deepEqual(await change({ autoStart: false, discPolicy: 'local-only' }), whileHosting, state);
    }
    // A start that was asked for a moment ago has not moved the status yet, and it reads the folder too.
    hosting.set({ state: 'idle' });
    hosting.startingNow(true);
    assert.deepEqual(await change({ gameFolder: folder }), whileHosting, 'a start is under way');
    assert.deepEqual(await change({ discPolicy: 'local-only' }), whileHosting, 'a start is under way');
    hosting.startingNow(false);
    hosting.set({ state: 'online' });
    assert.deepEqual(await read(), { status: 200, body: saved }, 'a refused change saves no part of itself');
    assert.deepEqual(await change({ autoStart: false }), { status: 200, body: { ...saved, autoStart: false } });
    assert.deepEqual((await readConfig(paths)).config, { version: 1, gameFolder: folder, discPolicy: 'shared-allowed', autoStart: false, roomOptions: { progress: 'all', camera: true } });
    assert.deepEqual(hosting.calls, [], 'the switch is not what a status spoke of, and a refused change is none');
    for (const state of ['failed', 'idle', 'needs_setup'] as const) {
      hosting.set({ state });
      assert.equal((await change({ discPolicy: state === 'idle' ? 'shared-allowed' : 'local-only' })).status, 200, state);
    }
    assert.deepEqual(hosting.calls.splice(0), ['configured', 'configured', 'configured']);

    // The panel's page reads and changes it too.
    const panel = bearer(await panelSession(host));
    assert.deepEqual(await change({ autoStart: true, discPolicy: 'shared-allowed' }, panel), { status: 200, body: saved });
    assert.deepEqual(await read(panel), { status: 200, body: saved });
    assert.deepEqual(hosting.calls.splice(0), ['configured'], 'a change of the configuration starts and stops nothing');

    // The room's options: both fields and nothing else, and only while nothing is hosted, because they are part of every link.
    const options = { progress: 'original', camera: false };
    for (const value of [{ progress: 'original' }, { camera: false }, { ...options, nativeCamera: true }, { progress: 'some', camera: true },
      { progress: 'all', camera: 'yes' }, null, [], 'all'])
      assert.deepEqual(await change({ roomOptions: value }), refused(400, 'The room options in the request are not valid.'), JSON.stringify(value));
    for (const state of ['preparing', 'starting', 'online', 'degraded', 'stopping'] as const) {
      hosting.set({ state });
      assert.deepEqual(await change({ roomOptions: options }), refused(409, "Stop the room before changing the room's options."), state);
      assert.deepEqual(await change({ roomOptions: options, discPolicy: 'shared-allowed' }), whileHosting, state);
    }
    hosting.set({ state: 'idle' });
    hosting.startingNow(true);
    assert.deepEqual(await change({ roomOptions: options }), refused(409, "Stop the room before changing the room's options."), 'a start is under way');
    hosting.startingNow(false);
    assert.deepEqual(await read(panel), { status: 200, body: saved }, 'a refused change of the options saves nothing');
    assert.deepEqual(await change({ roomOptions: options }, panel), { status: 200, body: { ...saved, roomOptions: options } });
    assert.deepEqual((await readConfig(paths)).config.roomOptions, options);
    assert.deepEqual(await read(), { status: 200, body: { ...saved, roomOptions: options } });
    assert.deepEqual(hosting.calls, [], 'the options are not what a status spoke of, and a refused change is none');

    // A file that cannot be used is said so, and the next change sets it aside.
    await writeFile(join(paths.dataRoot, 'config.json'), 'not json');
    const damaged = await read();
    assert.deepEqual({ ...damaged.body, problem: null }, { gameFolder: null, discPolicy: null, autoStart: true, roomOptions: { progress: 'all', camera: true }, problem: null });
    assert.match(String(damaged.body.problem), /damaged/);
    assert.deepEqual(await change({ autoStart: false }), { status: 200, body: { gameFolder: null, discPolicy: null, autoStart: false, roomOptions: { progress: 'all', camera: true }, problem: null } });
    assert.deepEqual((await readdir(paths.dataRoot)).sort(), ['config.json', 'config.json.bad']);
  } finally {
    await host.close();
  }
});

test('changes of the configuration that are asked together are all saved', async t => {
  const paths = await scratchPaths(t, 'control');
  const folder = await writeGame(join(paths.root, 'game'));
  const hosting = standInService({ state: 'needs_setup' });
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => {}, status: () => hosting.service.status(), invitation: () => nobody,
    control: createHostControl({ paths, service: hosting.service }) });
  try {
    const command = bearer(host.token);
    const change = async (value: object) => {
      const { status, body } = await call(host.port, 'PUT', '/api/config', { ...command, ...json }, JSON.stringify(value));
      return { status, body: JSON.parse(body) as Record<string, unknown> };
    };
    for (let round = 0; round < 12; round++) {
      await writeConfig(paths, { version: 1, gameFolder: null, discPolicy: null, autoStart: true, roomOptions: { progress: 'all', camera: true } });
      // Two controls of the panel changed one after the other, or two tabs. The folder takes long to
      // check and the switch does not, so the later request is ready to write first.
      const [chosen, switched, allowed] = await Promise.all([change({ gameFolder: folder }), change({ autoStart: false }),
        change({ discPolicy: 'shared-allowed' })]);
      assert.deepEqual([chosen.status, switched.status, allowed.status], [200, 200, 200], `round ${round}`);
      assert.deepEqual([chosen.body.gameFolder, switched.body.autoStart, allowed.body.discPolicy], [folder, false, 'shared-allowed'], `round ${round}`);
      assert.deepEqual(await readConfig(paths), { config: { version: 1, gameFolder: folder, discPolicy: 'shared-allowed', autoStart: false, roomOptions: { progress: 'all', camera: true } }, problem: null },
        `round ${round}: every change is in the file`);
    }
    assert.deepEqual(await readdir(paths.dataRoot), ['config.json']);
  } finally {
    await host.close();
  }
});

test('a configuration that cannot be saved is answered in a sentence', async t => {
  const paths = await scratchPaths(t, 'control');
  await writeConfig(paths, { version: 1, gameFolder: null, discPolicy: null, autoStart: true, roomOptions: { progress: 'all', camera: true } });
  const hosting = standInService({ state: 'needs_setup' });
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => {}, status: () => hosting.service.status(), invitation: () => nobody,
    control: createHostControl({ paths, service: hosting.service }) });
  // The folder of the file takes no new file: a full disk, or a folder that somebody locked.
  await chmod(paths.dataRoot, 0o500);
  try {
    const { status, body } = await call(host.port, 'PUT', '/api/config', { ...bearer(host.token), ...json }, '{"autoStart":false}');
    assert.deepEqual({ status, body: JSON.parse(body) as unknown }, { status: 500, body: { error: 'The configuration could not be saved.' } });
    assert.equal((await readConfig(paths)).config.autoStart, true);
    // The listener is none the worse for it.
    assert.equal((await call(host.port, 'GET', '/api/config', bearer(host.token))).status, 200);
  } finally {
    await chmod(paths.dataRoot, 0o700);
    await host.close();
  }
});

test('the folder in the file is the folder that is hosted, however a start and a change of it are asked together', { timeout: 30_000 }, async t => {
  const paths = await scratchPaths(t, 'control');
  const two = await writeGame(join(paths.root, 'two tracks'));
  const one = join(paths.root, 'one track');
  await mkdir(one);
  await writeFile(join(one, 'Track 01.bin'), randomBytes(3000));
  await writeFile(join(one, 'Game.cue'), 'FILE "Track 01.bin" BINARY\r\n  TRACK 01 MODE2/2352\r\n');
  // The real host service, with no room and no tunnel.
  const service = createHostService({ paths, log: () => {}, gamePort: await freePort(), netplayPort: await freePort(), tunnels: null, worker: null });
  t.after(() => service.stop());
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => {}, status: () => service.status(), invitation: () => nobody,
    control: createHostControl({ paths, service }) });
  try {
    const command = bearer(host.token);
    const start = () => call(host.port, 'POST', '/api/host/start', command);
    const change = () => call(host.port, 'PUT', '/api/config', { ...command, ...json }, JSON.stringify({ gameFolder: one }));
    for (let round = 0; round < 12; round++) {
      await service.stop();
      await writeConfig(paths, { version: 1, gameFolder: two, discPolicy: 'shared-allowed', autoStart: true, roomOptions: { progress: 'all', camera: true } });
      // Sent together, in either order. The change is taken or it is refused; what must not happen is
      // a host that runs one folder while the file names the other.
      const answers = await Promise.all(round % 2 ? [change(), start()] : [start(), change()]);
      const told = `round ${round}: ${answers.map(answer => answer.status).join(' and ')}`;
      const status = await service.start();
      assert.equal(status.state, 'online', told);
      const saved = (await readConfig(paths)).config.gameFolder;
      assert.ok(saved === one || saved === two, told);
      assert.equal(status.game?.tracks, saved === one ? 1 : 2, `${told}: the file names the folder of ${saved === one ? 'one track' : 'two tracks'}`);
    }
  } finally {
    await host.close();
  }
});

test('the bundle gets the files that the listener serves, and no other file of the folder', async t => {
  const root = await scratch(t, 'staged panel');
  // The folder as a developer's checkout may have it: the page, its tests, and what a file manager leaves behind.
  const source = join(root, 'admin');
  await cp(panelRoot, source, { recursive: true });
  for (const name of ['.DS_Store', 'notes.txt', 'extra.test.mjs']) await writeFile(join(source, name), 'not part of the page');
  const resources = join(root, 'resources');
  await stagePanel(resources, source);
  assert.deepEqual((await readdir(join(resources, 'admin'))).sort(), ['controller.js', 'index.html', 'panel.css', 'panel.js', 'session.js', 'view.js']);

  const { control } = standInControl();
  const host = await startHostServer({ panelRoot: join(resources, 'admin'), version: '9.9.9', onQuit: () => {}, status: () => ({ state: 'idle' }),
    invitation: () => nobody, control });
  try {
    for (const path of ['/', '/panel.css', '/session.js', '/view.js', '/controller.js', '/panel.js'])
      assert.equal((await call(host.port, 'GET', path)).status, 200, path);
  } finally {
    await host.close();
  }
});

/**
 * A dialog in place of the system's. It answers as the test says next, and `opened` keeps the signal of
 * every dialog that was shown. `wait` is a dialog that stays open until the test answers it or its signal ends it.
 */
function standInDialog() {
  let next: ChooseFolder = async () => null;
  const opened: AbortSignal[] = [];
  let answer: (folder: string | null) => void = () => {};
  const chooseFolder: ChooseFolder = signal => {
    opened.push(signal);
    return next(signal);
  };
  const wait: ChooseFolder = signal => new Promise((resolve, reject) => {
    answer = resolve;
    signal.addEventListener('abort', () => reject(new FolderDialogError('ended')));
  });
  return { chooseFolder, opened, wait, gives(work: ChooseFolder) { next = work; }, answer: (folder: string | null) => answer(folder) };
}

test('the game folder is chosen in a dialog on the server\'s computer', async t => {
  const paths = await scratchPaths(t, 'pick');
  const folder = await writeGame(join(paths.root, 'Игра "folder"'));
  const empty = join(paths.root, 'empty');
  await mkdir(empty);
  const hosting = standInService({ state: 'needs_setup' });
  const dialog = standInDialog();
  const logged: string[] = [];
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => {}, status: () => hosting.service.status(), invitation: () => nobody,
    control: createHostControl({ paths, service: hosting.service, chooseFolder: dialog.chooseFolder, log: line => logged.push(line) }) });
  try {
    const panel = bearer(await panelSession(host));
    const pick = async (headers: Record<string, string> = panel, sent?: string) => {
      const { status, body } = await call(host.port, 'POST', '/api/game-folder/pick', headers, sent);
      return { status, body: JSON.parse(body) as Record<string, unknown> };
    };
    const untouched = { gameFolder: null, discPolicy: null, autoStart: true, roomOptions: { progress: 'all', camera: true }, problem: null };
    const chosen = { ...untouched, gameFolder: folder };

    assert.equal((await pick({})).status, 401);
    assert.equal((await pick(bearer('0'.repeat(64)))).status, 401);
    assert.equal((await call(host.port, 'GET', '/api/game-folder/pick', panel)).status, 404);
    assert.equal((await call(host.port, 'POST', '/api/game-folder/pick/', panel)).status, 404);
    assert.equal((await call(host.port, 'POST', '/api/game-folder%2Fpick', panel)).status, 404);
    assert.equal((await pick({ ...panel, origin: 'http://127.0.0.1:8000' })).status, 403);
    assert.equal((await pick({ ...panel, host: 'rebound.example' })).status, 403);
    assert.equal(dialog.opened.length, 0, 'a request that is refused opens no dialog');

    // A cancel changes nothing, and writes no file.
    assert.deepEqual(await pick(), { status: 200, body: { picked: false, config: untouched } });
    assert.deepEqual(await readdir(paths.dataRoot), []);

    // What the dialog gives is checked as a folder that a request names would be.
    dialog.gives(async () => `${empty}/`);
    assert.deepEqual(await pick(), { status: 400, body: { error: 'Expected exactly one CUE file in the game folder.' } });
    dialog.gives(async () => 'Games');
    assert.deepEqual(await pick(), { status: 400, body: { error: 'The game folder must be given by its full path.' } });
    assert.deepEqual((await readConfig(paths)).config, defaultConfig);

    // The system's dialog ends a folder with a slash.
    dialog.gives(async () => `${folder}/`);
    assert.deepEqual(await pick(), { status: 200, body: { picked: true, config: chosen } });
    assert.equal((await readConfig(paths)).config.gameFolder, folder);
    assert.deepEqual(JSON.parse((await call(host.port, 'GET', '/api/config', panel)).body), chosen);

    // The folder comes out of the dialog only: nothing in a request names one.
    dialog.gives(async () => null);
    assert.deepEqual(await pick({ ...panel, ...json }, JSON.stringify({ gameFolder: empty, picked: true })), { status: 200, body: { picked: false, config: chosen } });
    // A cancel, a folder that is refused and a dialog that fails all keep the folder that was chosen before.
    dialog.gives(async () => empty);
    assert.equal((await pick()).status, 400);
    dialog.gives(async () => { throw new FolderDialogError('exit 1, error -1743'); });
    assert.deepEqual(await pick(), { status: 503, body: { error: 'The folder dialog could not be opened.' } });
    assert.equal((await readConfig(paths)).config.gameFolder, folder);
    // The log says why, in numbers that name no folder; nothing else of the dialog is logged.
    assert.deepEqual(logged, ['The folder dialog could not be shown (exit 1, error -1743).']);

    // A command may ask as well.
    dialog.gives(async () => folder);
    assert.deepEqual(await pick(bearer(host.token)), { status: 200, body: { picked: true, config: chosen } });
    // The host hears of each folder that was saved, two here, and of nothing else: a choice starts nothing.
    assert.deepEqual(hosting.calls, ['configured', 'configured']);
  } finally {
    await host.close();
  }
});

test('one folder dialog at a time, and none while hosting is up', async t => {
  const paths = await scratchPaths(t, 'pick');
  const folder = await writeGame(join(paths.root, 'game'));
  const hosting = standInService({ state: 'idle' });
  const dialog = standInDialog();
  const logged: string[] = [];
  const control = createHostControl({ paths, service: hosting.service, chooseFolder: dialog.chooseFolder, log: line => logged.push(line) });
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => {}, status: () => hosting.service.status(), invitation: () => nobody, control });
  try {
    const panel = bearer(await panelSession(host));
    const pick = async () => {
      const { status, body } = await call(host.port, 'POST', '/api/game-folder/pick', panel);
      return { status, body: JSON.parse(body) as Record<string, unknown> };
    };
    const shown = async (count: number) => {
      for (let attempt = 0; dialog.opened.length < count && attempt < 250; attempt++) await delay(10);
      assert.equal(dialog.opened.length, count);
    };
    const locked = { status: 409, body: { error: 'Stop the room before changing the game folder or the disc policy.' } };

    // The button pressed again while the dialog is behind another window.
    dialog.gives(dialog.wait);
    const first = pick();
    await shown(1);
    assert.deepEqual(await pick(), { status: 409, body: { error: 'The folder dialog is already open. Look for it among the windows.' } });
    assert.equal(dialog.opened.length, 1);
    dialog.answer(folder);
    assert.equal((await first).status, 200);
    // Once it is answered, the next one opens.
    const second = pick();
    await shown(2);
    dialog.answer(null);
    assert.deepEqual((await second).body.picked, false);

    // A running stack keeps the disc it prepared, so no dialog is shown for a choice that could not be saved.
    for (const state of ['preparing', 'starting', 'online', 'degraded', 'stopping'] as const) {
      hosting.set({ state });
      assert.deepEqual(await pick(), locked, state);
    }
    hosting.set({ state: 'idle' });
    hosting.startingNow(true);
    assert.deepEqual(await pick(), locked, 'a start is under way');
    assert.equal(dialog.opened.length, 2);

    // A start that is asked for while the dialog is open wins: the folder that is then chosen is not saved.
    hosting.startingNow(false);
    await writeConfig(paths, defaultConfig);
    const overtaken = pick();
    await shown(3);
    hosting.startingNow(true);
    dialog.answer(folder);
    assert.deepEqual(await overtaken, locked);
    assert.equal((await readConfig(paths)).config.gameFolder, null);
    hosting.startingNow(false);

    // A server that stops takes its dialog off the screen, and the request that waited is answered.
    const open = pick();
    await shown(4);
    assert.equal(dialog.opened[3]!.aborted, false);
    control.close();
    // The dialog did open; it is the server that goes away.
    assert.deepEqual(await open, { status: 409, body: { error: 'The server is quitting.' } });
    assert.equal(dialog.opened[3]!.aborted, true);
    control.close();
    assert.deepEqual(logged, [], 'a dialog that a quit ended did not fail');

    await hosting.service.close();
    assert.deepEqual(await pick(), { status: 409, body: { error: 'The server is quitting.' } });
    assert.equal(dialog.opened.length, 4);
  } finally {
    await host.close();
  }
});

test('a server without a dialog says so', async t => {
  const paths = await scratchPaths(t, 'pick');
  const hosting = standInService({ state: 'needs_setup' });
  const host = await startHostServer({ panelRoot, version: '9.9.9', onQuit: () => {}, status: () => hosting.service.status(), invitation: () => nobody,
    control: createHostControl({ paths, service: hosting.service }) });
  try {
    const answer = await call(host.port, 'POST', '/api/game-folder/pick', bearer(host.token));
    assert.deepEqual({ status: answer.status, body: JSON.parse(answer.body) }, { status: 503, body: { error: 'The folder dialog is not available.' } });
  } finally {
    await host.close();
  }
});
