import assert from 'node:assert/strict';
import { request } from 'node:http';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { startHostServer } from '../src/host-server.ts';

function call(port: number, method: string, path: string, headers: Record<string, string> = {}): Promise<{ status: number; body: string; headers: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const outgoing = request({ host: '127.0.0.1', port, method, path, headers }, incoming => {
      let body = '';
      incoming.setEncoding('utf8');
      incoming.on('data', (chunk: string) => { body += chunk; });
      incoming.on('end', () => resolve({ status: incoming.statusCode ?? 0, body, headers: incoming.headers }));
    });
    outgoing.on('error', reject);
    outgoing.end();
  });
}

test('the control listener answers only its own host, origin and credential', async () => {
  let quits = 0;
  const host = await startHostServer({ version: '9.9.9', onQuit: () => { quits += 1; } });
  const quitCount = () => quits;
  try {
    const bearer = { authorization: `Bearer ${host.token}` };
    const status = await call(host.port, 'GET', '/api/status', bearer);
    assert.equal(status.status, 200);
    assert.equal(status.headers['cache-control'], 'no-store');
    const report = JSON.parse(status.body) as Record<string, unknown>;
    assert.deepEqual(report, { application: 'Sled Storm Server', version: '9.9.9', instance: host.instance,
      pid: process.pid, startedAt: host.startedAt });
    assert.ok(!status.body.includes(host.token), 'the credential is never echoed');

    assert.equal((await call(host.port, 'GET', '/api/status')).status, 401);
    assert.equal((await call(host.port, 'GET', '/api/status', { authorization: `Bearer ${'0'.repeat(64)}` })).status, 401);
    assert.equal((await call(host.port, 'GET', '/api/status', { authorization: host.token })).status, 401);
    assert.equal((await call(host.port, 'GET', '/api/status', { ...bearer, host: 'attacker.example' })).status, 403);
    assert.equal((await call(host.port, 'GET', '/api/status', { ...bearer, host: `127.0.0.1:${host.port + 1}` })).status, 403);
    assert.equal((await call(host.port, 'GET', '/api/status', { ...bearer, host: `localhost:${host.port}` })).status, 200);
    assert.equal((await call(host.port, 'GET', '/api/status', { ...bearer, origin: 'https://attacker.example' })).status, 403);
    assert.equal((await call(host.port, 'GET', '/api/status', { ...bearer, origin: `http://127.0.0.1:${host.port}` })).status, 200);

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
