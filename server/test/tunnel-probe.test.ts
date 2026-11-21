// The probe is tested against a local gateway. No test resolves a public name or leaves this machine.
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import { createServer as createTcpServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { writeConfig } from '../src/config-store.ts';
import { createHostService } from '../src/host-service.ts';
import { createPublicGateway, listeningPort } from '../src/network.ts';
import { probeGateway, publicProbe, resolvePublic } from '../src/tunnel-probe.ts';
import { scratchPaths, writeGame } from './fixtures.ts';

const token = 'f'.repeat(48);

async function freePort(): Promise<number> {
  const server = createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const { port } = server.address() as AddressInfo;
  server.close();
  await once(server, 'close');
  return port;
}

/** A running local stack; resolves to the port of its gateway. */
async function gateway(t: TestContext): Promise<number> {
  const paths = await scratchPaths(t, 'probe');
  await writeConfig(paths, { version: 1, gameFolder: await writeGame(join(paths.root, 'game')), discPolicy: 'shared-allowed' });
  const host = createHostService({ paths, log: () => {}, gamePort: await freePort(), netplayPort: await freePort(),
    accessToken: token, tunnels: null, worker: null });
  t.after(() => host.stop());
  const status = await host.start();
  assert.equal(status.state, 'online', JSON.stringify(status.problem));
  return status.gatewayPort!;
}

const failure = (code: string) => Object.assign(new Error(code), { code });

test('the probe passes against a running gateway and relay', async t => {
  await probeGateway(`http://127.0.0.1:${await gateway(t)}`, token);
});

test('the probe can be pinned to an address while keeping the host name', async t => {
  const port = await gateway(t);
  await assert.rejects(probeGateway(`http://sled-probe.invalid:${port}`, token), 'the name itself does not resolve');
  await probeGateway(`http://sled-probe.invalid:${port}`, token, { address: '127.0.0.1' });
});

test('the probe fails for a wrong token, a closed port and a gateway without its relay', async t => {
  const port = await gateway(t);
  await assert.rejects(probeGateway(`http://127.0.0.1:${port}`, 'e'.repeat(48)), /access link/);
  await assert.rejects(probeGateway(`http://127.0.0.1:${await freePort()}`, token));

  // A gateway whose page works but whose Netplay relay is gone.
  const upstream = createServer((_request, response) => response.end('{}'));
  upstream.listen(0, '127.0.0.1');
  await once(upstream, 'listening');
  const lonely = createPublicGateway({ port: 0, upstream: (upstream.address() as AddressInfo).port, netplay: await freePort(),
    accessToken: token, discMode: 'shared', assetPaths: new Set(['/session-info']) });
  await once(lonely, 'listening');
  t.after(() => {
    lonely.close();
    lonely.closeAllConnections();
    upstream.close();
    upstream.closeAllConnections();
  });
  await assert.rejects(probeGateway(`http://127.0.0.1:${listeningPort(lonely)}`, token), /Netplay/);
});

test('public DNS is asked again until the name exists', async () => {
  const asked: string[] = [];
  const answers: (() => string[])[] = [() => { throw failure('ENOTFOUND'); }, () => { throw failure('ENODATA'); }, () => [],
    () => ['203.0.113.7', '203.0.113.8']];
  const address = await resolvePublic('synthetic-test.trycloudflare.com', new AbortController().signal, {
    intervalMs: 5,
    resolve4: async name => {
      asked.push(name);
      return answers[asked.length - 1]!();
    },
  });
  assert.equal(address, '203.0.113.7');
  assert.deepEqual(asked, Array(4).fill('synthetic-test.trycloudflare.com'));
});

test('a resolver failure of another kind is passed on', async () => {
  await assert.rejects(resolvePublic('synthetic-test.trycloudflare.com', new AbortController().signal,
    { intervalMs: 5, resolve4: async () => { throw failure('ETIMEOUT'); } }), { code: 'ETIMEOUT' });
});

test('an aborted wait stops asking', async () => {
  const controller = new AbortController();
  let asked = 0;
  const waiting = resolvePublic('synthetic-test.trycloudflare.com', controller.signal,
    { intervalMs: 5, resolve4: async () => { asked += 1; throw failure('ENOTFOUND'); } });
  setTimeout(() => controller.abort(), 60);
  await assert.rejects(waiting, { name: 'AbortError' });
  const then = asked;
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(asked, then);
});

test('the production probe waits for public DNS, then checks the gateway through that address', async t => {
  const port = await gateway(t);
  let asked = 0;
  await publicProbe(token, { intervalMs: 5, resolve4: async () => {
    asked += 1;
    if (asked < 3) throw failure('ENOTFOUND');
    return ['127.0.0.1'];
  } })(`http://sled-probe.invalid:${port}`, new AbortController().signal);
  assert.equal(asked, 3);
});

test('the production probe falls back to the system resolver when public DNS cannot be reached', async t => {
  const port = await gateway(t);
  await publicProbe(token, { intervalMs: 5, fallbackWaitMs: 20, resolve4: async () => { throw failure('ECONNREFUSED'); } })(
    `http://127.0.0.1:${port}`, new AbortController().signal);
});

test('the production probe keeps trying until it is aborted', async () => {
  const controller = new AbortController();
  const probing = publicProbe(token, { intervalMs: 5, resolve4: async () => ['127.0.0.1'] })(
    `http://127.0.0.1:${await freePort()}`, controller.signal);
  setTimeout(() => controller.abort(), 120);
  await assert.rejects(probing, { name: 'AbortError' });
});

test('an aborted probe lets go of a peer that never answers', async t => {
  const silent = createTcpServer(() => { /* Accepts and says nothing. */ });
  silent.listen(0, '127.0.0.1');
  await once(silent, 'listening');
  t.after(() => silent.close());
  const origin = `http://127.0.0.1:${(silent.address() as AddressInfo).port}`;
  for (const probe of [
    (signal: AbortSignal) => probeGateway(origin, token, { signal }),
    (signal: AbortSignal) => publicProbe(token, { resolve4: async () => ['127.0.0.1'] })(origin, signal),
  ]) {
    const controller = new AbortController();
    const asked = performance.now();
    setTimeout(() => controller.abort(), 100);
    await assert.rejects(probe(controller.signal));
    assert.ok(performance.now() - asked < 1000, `the probe returned ${Math.round(performance.now() - asked)} ms after it was asked`);
  }
});
