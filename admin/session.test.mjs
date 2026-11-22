import test from 'node:test';
import assert from 'node:assert/strict';
import { api, forgetSession, openSession, takeBootstrap } from './session.js';

const token = 'a'.repeat(64);
const session = 'b'.repeat(64);
const KEY = 'sled-panel-session';

/** The parts of a browser tab that the module touches: its address, its history and its own storage. */
function tab(hash, kept = {}, search = '') {
  const location = { pathname: '/', search, hash };
  const replaced = [];
  const history = { replaceState(_state, _title, url) { replaced.push(url); } };
  const values = new Map(Object.entries(kept));
  const storage = {
    getItem: key => values.get(key) ?? null,
    setItem(key, value) { values.set(key, String(value)); },
    removeItem(key) { values.delete(key); },
  };
  return { location, history, storage, replaced, values };
}

/** A server that gives one answer and keeps what it was asked. */
function server(status, body) {
  const requests = [];
  const fetch = async (path, init) => {
    requests.push({ path, ...init });
    return { status, json: async () => body };
  };
  return { fetch, requests };
}

test('the token leaves the address and is traded once', async t => {
  const { location, history, storage, replaced, values } = tab(`#bootstrap=${token}`);
  const bootstrap = takeBootstrap(location, history);
  assert.equal(bootstrap, token);
  assert.deepEqual(replaced, ['/'], 'the address is replaced by one without the token');
  const kept = tab(`#bootstrap=${token}`, {}, '?from=launch');
  takeBootstrap(kept.location, kept.history);
  assert.deepEqual(kept.replaced, ['/?from=launch'], 'only the fragment goes');

  const { fetch, requests } = server(201, { session });
  assert.equal(await openSession({ fetch, storage, bootstrap }), session);
  assert.deepEqual(requests, [{ path: '/api/session', method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bootstrap: token }) }]);
  assert.deepEqual([...values], [[KEY, session]], 'the tab keeps the session, not the token');

  // From then on the page asks with its session.
  const asked = [];
  t.mock.method(globalThis, 'fetch', async (path, init) => {
    asked.push({ path, ...init });
    return { status: 200 };
  });
  assert.equal((await api(session, '/api/status')).status, 200);
  await api(session, '/api/room/stop', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{"force":true}' });
  assert.deepEqual(asked, [
    { path: '/api/status', headers: { Authorization: `Bearer ${session}` } },
    { path: '/api/room/stop', method: 'POST', body: '{"force":true}',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session}` } },
  ]);
});

test('a reload keeps the session and a refused token leaves none', async () => {
  const reloaded = tab('', { [KEY]: session });
  assert.equal(takeBootstrap(reloaded.location, reloaded.history), null);
  assert.deepEqual(reloaded.replaced, [], 'an address without a fragment is left as it is');
  const silent = server(500, {});
  assert.equal(await openSession({ fetch: silent.fetch, storage: reloaded.storage, bootstrap: null }), session);
  assert.deepEqual(silent.requests, [], 'a reload asks nothing of the server');

  // A link that was used before, or waited too long: the page is not connected, whatever the tab held.
  const refusals = [
    server(401, { error: 'This link to the panel has expired. Open Sled Storm Server again.' }).fetch,
    server(201, { session: 'short' }).fetch,
    server(201, null).fetch,
    server(200, { session }).fetch,
    async () => ({ status: 201, json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } }),
    async () => { throw new TypeError('Failed to fetch'); },
  ];
  for (const [index, fetch] of refusals.entries()) {
    const stale = tab(`#bootstrap=${token}`, { [KEY]: session });
    const bootstrap = takeBootstrap(stale.location, stale.history);
    assert.equal(await openSession({ fetch, storage: stale.storage, bootstrap }), null, `refusal ${index}`);
    assert.deepEqual([...stale.values], [], `refusal ${index}`);
  }

  // What the tab kept is used only when it has the form of a session.
  for (const value of ['', 'short', `${session}0`, session.toUpperCase(), '<script>']) {
    const odd = tab('', { [KEY]: value });
    assert.equal(await openSession({ fetch: silent.fetch, storage: odd.storage, bootstrap: null }), null, value);
  }
  assert.equal(await openSession({ fetch: silent.fetch, storage: tab('').storage, bootstrap: null }), null, 'a new tab has none');

  // A session that the server no longer knows is let go of.
  forgetSession(reloaded.storage);
  assert.deepEqual([...reloaded.values], []);
  assert.equal(await openSession({ fetch: silent.fetch, storage: reloaded.storage, bootstrap: null }), null);
});

test('a fragment that is no token is removed and ignored', () => {
  const others = ['#bootstrap=short', `#bootstrap=${token}0`, `#bootstrap=${token.toUpperCase()}`, `#Bootstrap=${token}`,
    `#x&bootstrap=${token}`, `#bootstrap=${token}&x=1`, `#bootstrap=${'g'.repeat(64)}`, '#room'];
  for (const hash of others) {
    const { location, history, replaced } = tab(hash);
    assert.equal(takeBootstrap(location, history), null, hash);
    assert.deepEqual(replaced, ['/'], hash);
  }
});

test('a tab that keeps nothing still gets a session from its token', async () => {
  const blocked = {
    getItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
    setItem() { throw new DOMException('The quota has been exceeded.', 'QuotaExceededError'); },
    removeItem() { throw new DOMException('The operation is insecure.', 'SecurityError'); },
  };
  for (const storage of [null, blocked]) {
    assert.equal(await openSession({ fetch: server(201, { session }).fetch, storage, bootstrap: token }), session);
    assert.equal(await openSession({ fetch: server(201, { session }).fetch, storage, bootstrap: null }), null, 'and has none after a reload');
    forgetSession(storage);
  }
});
