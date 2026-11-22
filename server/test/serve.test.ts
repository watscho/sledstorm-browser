// The server as a process, run from source with a stand-in browser: what `serve` does around the host
// service. No real browser, no tunnel and no network.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { connect, createServer, type AddressInfo } from 'node:net';
import { join } from 'node:path';
import test, { type TestContext } from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import { writeConfig } from '../src/config-store.ts';
import { scratchPaths, standInBrowser, writeGame } from './fixtures.ts';

const entry = fileURLToPath(new URL('../src/entry.ts', import.meta.url));

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

async function until(description: string, done: () => boolean | Promise<boolean>, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!await done()) {
    if (Date.now() > deadline) throw new Error(`Timed out waiting until ${description}`);
    await delay(10);
  }
}

/** A server that hosts a synthetic game with the stand-in browser, and the means to ask it as a command does. */
async function running(t: TestContext) {
  const paths = await scratchPaths(t, 'serve');
  await writeConfig(paths, { version: 1, gameFolder: await writeGame(join(paths.root, 'game')), discPolicy: 'shared-allowed', autoStart: true, roomOptions: { progress: 'all', camera: true } });
  const gamePort = await freePort();
  const netplayPort = await freePort();
  const browser = await standInBrowser(paths.root, { netplayPort });
  // `scratchPaths` lays its folders out as SLED_SERVER_HOME does.
  const child = spawn(process.execPath, [entry, 'serve'], { stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env,
    SLED_SERVER_HOME: paths.root, SLED_SERVER_RESOURCES: paths.resourceRoot, SLED_SERVER_CHROME: browser.program,
    SLED_SERVER_GAME_PORT: String(gamePort), SLED_SERVER_NETPLAY_PORT: String(netplayPort), SLED_SERVER_NO_BROWSER: '1' } });
  t.after(() => { child.kill('SIGKILL'); });
  let printed = '';
  let complaints = '';
  child.stdout.setEncoding('utf8').on('data', chunk => { printed += chunk; });
  child.stderr.setEncoding('utf8').on('data', chunk => { complaints += chunk; });
  const exited = once(child, 'exit') as Promise<[number | null, NodeJS.Signals | null]>;
  await until('the server is ready', () => printed.includes('"event":"ready"') || child.exitCode !== null);
  assert.equal(child.exitCode, null, complaints);
  const { port } = JSON.parse(printed.split('\n')[0] ?? '{}') as { port: number };
  const { token } = JSON.parse(await readFile(join(paths.dataRoot, 'instance.json'), 'utf8')) as { token: string };
  const ask = async (method: string, path: string) => {
    const response = await fetch(`http://127.0.0.1:${port}${path}`, { method, headers: { authorization: `Bearer ${token}` } });
    return { status: response.status, body: await response.json() as { error?: string; host?: { room: string } } };
  };
  const log = async () => (await readFile(join(paths.logRoot, 'server.log'), 'utf8')).split('\n').filter(Boolean);
  return { gamePort, netplayPort, exited, ask, log };
}

test('a quit is final: a start that is asked for while the server quits hosts nothing', { timeout: 30_000 }, async t => {
  const { gamePort, netplayPort, exited, ask, log } = await running(t);
  await until('the room is open', async () => (await ask('GET', '/api/status')).body.host?.room === 'open');

  assert.equal((await ask('POST', '/api/host/quit')).status, 202);
  // Hosting is being stopped and the listener still answers. A server that has already closed it
  // refuses the connection, which says the same.
  const late = await ask('POST', '/api/host/start').catch(() => null);
  if (late) assert.deepEqual(late, { status: 409, body: { error: 'The server is quitting.' } });

  assert.deepEqual(await exited, [0, null]);
  const lines = await log();
  const sinceQuit = lines.slice(lines.findIndex(line => line.endsWith('Stopping: quit request.')));
  assert.ok(sinceQuit.length > 0 && sinceQuit.at(-1)!.endsWith('Stopped.'), lines.join('\n'));
  assert.deepEqual(sinceQuit.filter(line => /Preparing the game files|is ready|The room is open|Starting an emulator/.test(line)), [],
    'nothing is hosted after the quit');
  assert.equal(await answers(gamePort), false);
  assert.equal(await answers(netplayPort), false);
});
