// A player for hand checks of a running server: the pinned Chromium, driven
// over private pipes, opens the game page, presses the start button and
// reports what the page and the emulator say. No automated test uses it,
// because it runs a real browser and needs a real server with a real disc.
//
//   node server/scripts/room-player.mjs <page or invitation link> [seconds]
//
// A line is printed when the page's message, the number of players or this
// player's controller changes, and once at the end. The link is never
// printed: it holds the room's token. Run several at once for several
// players. The browser gets a profile of its own, reaches nothing but this
// computer, and keeps its crash reports out of the user's Library.
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { pinnedChromium } from './fetch-chromium.mjs';

const [url, seconds = '60'] = process.argv.slice(2);
if (!url || !(Number(seconds) > 0)) {
  console.error('Usage: node server/scripts/room-player.mjs <page or invitation link> [seconds]');
  process.exit(2);
}
const browser = await pinnedChromium();
if (!browser) throw new Error('No pinned Chromium for this platform.');
const home = await mkdtemp(join(tmpdir(), 'sled-room-player-'));
const child = spawn(browser.executable, ['--headless=new', '--remote-debugging-pipe', '--no-first-run', '--use-mock-keychain',
  '--disable-background-networking', '--disable-component-update', '--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1',
  '--mute-audio', '--autoplay-policy=no-user-gesture-required', '--window-size=1280,800',
  `--user-data-dir=${join(home, 'profile')}`, 'about:blank'],
{ stdio: ['ignore', 'ignore', 'ignore', 'pipe', 'pipe'], env: { ...process.env, BREAKPAD_DUMP_LOCATION: join(home, 'crash-reports') } });

const pending = new Map();
const problems = new Set();
let next = 0;
let data = '';
child.stdio[4].setEncoding('utf8');
child.stdio[4].on('data', chunk => {
  data += chunk;
  for (let end; (end = data.indexOf('\0')) >= 0;) {
    const message = JSON.parse(data.slice(0, end));
    data = data.slice(end + 1);
    if (message.method === 'Runtime.exceptionThrown')
      problems.add(`exception: ${(message.params.exceptionDetails.exception?.description ?? message.params.exceptionDetails.text).slice(0, 160)}`);
    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error')
      problems.add(`console.error: ${message.params.args.map(argument => argument.value ?? argument.description ?? '').join(' ').slice(0, 160)}`);
    if (message.method === 'Network.loadingFailed' && !message.params.canceled) problems.add(`request failed: ${message.params.errorText}`);
    const request = pending.get(message.id);
    if (!request) continue;
    pending.delete(message.id);
    if (message.error) request.reject(new Error(message.error.message));
    else request.resolve(message.result);
  }
});
const command = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
  const id = ++next;
  pending.set(id, { resolve, reject });
  child.stdio[3].write(`${JSON.stringify({ id, method, params, sessionId })}\0`);
});

const started = performance.now();
const at = () => ((performance.now() - started) / 1000).toFixed(1).padStart(6);
const look = `(() => {
  const module = window.EJS_emulator?.Module;
  const net = field => module?._sled_netplay_status?.(field) ?? null;
  const launch = document.querySelector('#launch');
  const seats = [...document.querySelectorAll('#room-seats li')].map(item => item.textContent.trim().replace(/\\s+/g, ' '));
  return JSON.stringify({ status: document.querySelector('#status')?.textContent?.trim().slice(0, 100) ?? null,
    launch: launch ? (launch.disabled ? 'disabled' : 'enabled') : 'absent', players: net(1), frame: net(2), behind: net(5),
    controller: seats.find(seat => seat.includes('You')) ?? null,
    savedGamesHidden: document.querySelector('#saved-games')?.hidden ?? null, isolated: window.crossOriginIsolated });
})()`;
try {
  const { targetId } = await command('Target.createTarget', { url: 'about:blank' });
  const { sessionId } = await command('Target.attachToTarget', { targetId, flatten: true });
  for (const domain of ['Page', 'Runtime', 'Network']) await command(`${domain}.enable`, {}, sessionId);
  await command('Page.navigate', { url }, sessionId);
  const evaluate = async expression =>
    (await command('Runtime.evaluate', { expression, returnByValue: true, userGesture: true }, sessionId)).result?.value;
  const seen = async () => JSON.parse(await evaluate(look));
  const line = state => `${at()} s | ${state.status || '(no message)'} | players ${state.players} | ${state.controller ?? 'no controller'}`
    + ` | frame ${state.frame} | behind ${state.behind}`;
  let pressed = false;
  let last = '';
  while (performance.now() - started < Number(seconds) * 1000) {
    const state = await seen().catch(error => ({ status: `page not readable: ${error.message}` }));
    const key = JSON.stringify([state.status, state.players, state.controller]);
    if (key !== last) {
      console.log(line(state));
      last = key;
    }
    if (!pressed && state.launch === 'enabled') {
      pressed = true;
      console.log(`${at()} s | pressing the start button (saved games hidden: ${state.savedGamesHidden}, isolated: ${state.isolated})`);
      await evaluate("document.querySelector('#launch').click()");
    }
    await delay(1000);
  }
  console.log(`${line(await seen())} | end`);
} catch (error) {
  console.log(`failed: ${error.message}`);
  process.exitCode = 1;
} finally {
  console.log(`page problems: ${problems.size}${problems.size ? ` ${JSON.stringify([...problems].slice(0, 10))}` : ''}`);
  child.kill();
  await new Promise(resolve => { child.once('close', resolve); });
  await rm(home, { recursive: true, force: true, maxRetries: 3 });
}
