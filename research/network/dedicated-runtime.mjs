// One server-owned Chrome instance. The debugging transport is private stdio.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export async function launchDedicatedRuntime(chrome, setup, signal) {
  const profile = await mkdtemp(join(tmpdir(), 'sled-netplay-'));
  if (signal.aborted) {
    await rm(profile, { recursive: true, force: true });
    throw signal.reason;
  }
  const process = spawn(chrome, [
    '--headless=new', '--remote-debugging-pipe', '--no-first-run',
    '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
    '--disable-backgrounding-occluded-windows', '--mute-audio', '--disable-dev-shm-usage',
    '--autoplay-policy=no-user-gesture-required',
    '--user-data-dir=' + profile, 'about:blank',
  ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'] });
  const input = process.stdio[3];
  const output = process.stdio[4];
  const pending = new Map();
  let next = 0;
  let data = '';
  let stopped = false;
  function stop(error) {
    if (stopped) return;
    stopped = true;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    process.kill();
  }
  const abort = () => stop(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const exited = new Promise(resolve => process.once('close', () => {
    stop(new Error('Dedicated runtime closed'));
    signal.removeEventListener('abort', abort);
    rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    resolve();
  }));
  process.on('error', stop);
  input.on('error', stop);
  output.on('error', stop);
  output.setEncoding('utf8');
  output.on('data', chunk => {
    data += chunk;
    let end;
    while ((end = data.indexOf('\0')) >= 0) {
      const { id, result, error } = JSON.parse(data.slice(0, end));
      data = data.slice(end + 1);
      const request = pending.get(id);
      if (!request) continue;
      pending.delete(id);
      if (error) request.reject(new Error(error.message));
      else request.resolve(result);
    }
  });
  const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
    if (stopped) return reject(new Error('Dedicated runtime closed'));
    const id = ++next;
    pending.set(id, { resolve, reject });
    input.write(JSON.stringify({ id, method, params, sessionId }) + '\0');
  });
  try {
    const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
    await command('Page.enable', {}, sessionId);
    await command('Page.addScriptToEvaluateOnNewDocument', {
      source: 'window.sledDedicatedWorker = ' + JSON.stringify(setup),
    }, sessionId);
    await command('Page.navigate', { url: 'http://127.0.0.1:8000/' }, sessionId);
    return { exited };
  } catch (error) {
    stop(error);
    throw error;
  }
}
