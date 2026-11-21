// One server-owned Chrome instance. The debugging transport is private stdio.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { env as inherited } from 'node:process';

/**
 * Starts the browser on the game page `url` as the worker described by `setup`.
 * `args` are further browser switches and `profileRoot` holds its temporary
 * profile. `env` adds environment variables to the inherited ones. A browser
 * that has not ended `graceMs` after it was told to is killed. `exited`
 * resolves once the browser is gone and its profile removed.
 */
export async function launchDedicatedRuntime(chrome, setup, signal,
  { url = 'http://127.0.0.1:8000/', args = [], profileRoot = tmpdir(), graceMs = 5000, env } = {}) {
  const profile = await mkdtemp(join(profileRoot, 'sled-netplay-'));
  if (signal.aborted) {
    await rm(profile, { recursive: true, force: true });
    throw signal.reason;
  }
  let process;
  try {
    process = spawn(chrome, [
      '--headless=new', '--remote-debugging-pipe', '--no-first-run',
      '--disable-background-timer-throttling', '--disable-renderer-backgrounding',
      '--disable-backgrounding-occluded-windows', '--mute-audio', '--disable-dev-shm-usage',
      '--autoplay-policy=no-user-gesture-required', ...args,
      '--user-data-dir=' + profile, 'about:blank',
    ], { stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], ...(env && { env: { ...inherited, ...env } }) });
  } catch (error) {
    // Some failures to start are thrown at once instead of arriving as an event; nothing owns the profile then.
    await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
    throw error;
  }
  const input = process.stdio[3];
  const output = process.stdio[4];
  const pending = new Map();
  let next = 0;
  let data = '';
  let stopped = false;
  let force;
  function stop(error) {
    if (stopped) return;
    stopped = true;
    for (const { reject } of pending.values()) reject(error);
    pending.clear();
    process.kill();
    // The timer does not keep its owner alive: a browser whose owner exits loses its pipes and ends by itself.
    force = setTimeout(() => process.kill('SIGKILL'), graceMs);
    force.unref();
  }
  const abort = () => stop(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  const exited = new Promise(resolve => {
    let ended = false;
    const end = async () => {
      if (ended) return;
      ended = true;
      stop(new Error('Dedicated runtime closed'));
      clearTimeout(force);
      signal.removeEventListener('abort', abort);
      // Whatever still holds the other ends of the pipes, the child of a wrapper for one, learns here
      // that its owner is done; a browser ends when its command pipe closes.
      input.destroy();
      output.destroy();
      await rm(profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => {});
      resolve();
    };
    // "exit" is the process itself. "close" also waits for the pipes, which something else may hold, and
    // it is all that a failed start gives.
    process.once('exit', end);
    process.once('close', end);
  });
  process.on('error', stop);
  input.on('error', stop);
  output.on('error', stop);
  output.setEncoding('utf8');
  output.on('data', chunk => {
    data += chunk;
    let end;
    while ((end = data.indexOf('\0')) >= 0) {
      let message;
      try {
        message = JSON.parse(data.slice(0, end));
      } catch {
        // Whatever sits at the other end is not the browser this runtime drives. End it; do not take the owner down.
        return stop(new Error('Dedicated runtime sent an unreadable message'));
      }
      const { id, result, error } = message;
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
    await command('Page.navigate', { url }, sessionId);
    return { exited };
  } catch (error) {
    stop(error);
    // The failure is reported once the browser is gone, so that whoever waits for it has waited for the cleanup.
    await exited;
    throw error;
  }
}
