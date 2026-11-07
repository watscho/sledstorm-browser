import { CLASSIC } from '/controls.js';

const retroPad = {
  cross: 0, square: 1, select: 2, start: 3, up: 4, down: 5, left: 6, right: 7,
  circle: 8, triangle: 9, l1: 10, r1: 11, l2: 12, r2: 13,
};
const keys = new Map(Object.entries(CLASSIC).map(([button, code]) => [code, retroPad[button]]));
const start = document.querySelector('#start');
const status = document.querySelector('#status');
const invite = document.querySelector('#invite');
const params = new URLSearchParams(location.search);
const role = params.has('guest') ? 'guest' : 'host';
const camera = params.has('camera');
const netplayPort = 55435;

function waitForTransport(socket) {
  const handlers = new AbortController();
  const { signal } = handlers;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => finish(new Error('Netplay transport timed out.')), 6000);
    function finish(error) {
      clearTimeout(timeout);
      handlers.abort();
      if (error) reject(error);
      else resolve();
    }
    socket.addEventListener('close', () => finish(new Error('Netplay transport closed. Check that the host is running and the guest seat is free.')), { signal });
    if (role === 'host') socket.addEventListener('open', () => finish(), { signal });
    else socket.addEventListener('message', event => { if (event.data === 'ready') finish(); }, { signal });
  });
}

function installKeyboard(emulator) {
  const { gameManager, elements } = emulator;
  const pressed = new Set();
  gameManager.setKeyboardEnabled(false);
  for (const type of ['keydown', 'keyup']) {
    elements.parent.addEventListener(type, event => {
      const button = keys.get(event.code);
      const down = type === 'keydown';
      if (button === undefined || (down && (event.ctrlKey || event.metaKey || event.altKey))) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (event.repeat) return;
      if (down) pressed.add(button);
      else pressed.delete(button);
      // Netplay maps the first local RetroPad onto the assigned remote slot.
      gameManager.functions.simulateInput(0, button, Number(down));
    }, true);
  }
  const release = () => {
    for (const button of pressed) gameManager.functions.simulateInput(0, button, 0);
    pressed.clear();
  };
  elements.parent.addEventListener('blur', release);
  window.addEventListener('blur', release);
}

start.textContent = role === 'host' ? 'Host game' : 'Join game';
start.addEventListener('click', async () => {
  start.disabled = true;
  status.textContent = 'Loading game…';
  let socket;
  try {
    const response = await fetch('/retroarch-lab-info');
    if (!response.ok) throw new Error('Start the server with --retroarch-lab.');
    const info = await response.json();
    const address = 'ws://127.0.0.1:8007/' + info.token;

    Object.assign(window, {
      EJS_player: '#game',
      EJS_core: 'pcsx_rearmed',
      EJS_gameName: 'Sled Storm Europe',
      EJS_gameUrl: '/disc.zip',
      EJS_pathtodata: '/emulator/',
      EJS_paths: { 'pcsx_rearmed-wasm.data': '/retroarch-lab-core.data' },
      EJS_disableCue: true,
      EJS_startOnLoaded: true,
      EJS_threads: false,
      EJS_disableAutoLang: true,
      EJS_disableLocalStorage: true,
      EJS_disableDatabases: true,
      EJS_defaultOptions: { pcsx_rearmed_multitap: 'port 1', rewindEnabled: 'disabled' },
      EJS_ready() {
        const manager = window.EJS_GameManager.prototype;
        const getConfig = manager.getRetroArchCfg;
        manager.getRetroArchCfg = function (...args) {
          const config = getConfig.apply(this, args);
          return config + '\nnetplay_public_announce = "false"\nnetplay_nat_traversal = "false"\n'
            + 'netplay_request_device_p' + (role === 'host' ? '1' : '2') + ' = "true"\n';
        };
        manager.mountFileSystems = async function () {
          this.mkdir('/data');
          this.mkdir('/data/saves');
        };
        const emulator = Object.getPrototypeOf(window.EJS_emulator);
        const startGame = emulator.startGame;
        emulator.startGame = async function (...args) {
          try {
            socket = new WebSocket(address + '/' + role);
            // The relay sends "ready" before any host bytes. The next task
            // delivering WebSocket data runs after callMain installs SOCKFS.
            await waitForTransport(socket);
            this.Module.sledInstallNetplay(role, socket, address, netplayPort);
            const callMain = this.Module.callMain;
            this.Module.callMain = argv => callMain([
              '-v', '--log-file', '/netplay.log', '--port', String(netplayPort),
              ...(role === 'host' ? ['--host'] : ['--connect', '127.0.0.1']), ...argv,
            ]);
            startGame.apply(this, args);
          } catch (error) {
            socket?.close();
            status.textContent = error.message;
          }
        };
      },
      EJS_onGameStart() {
        const emulator = window.EJS_emulator;
        installKeyboard(emulator);
        if (camera) emulator.Module._sled_view_configure(role === 'guest' ? 1 : 0, 3);
        status.textContent = role === 'host' ? 'Host started' : 'Guest started';
        if (role === 'host') {
          invite.href = camera ? '?guest&camera' : '?guest';
          invite.target = '_blank';
          invite.hidden = false;
        }
      },
    });
    const loader = document.createElement('script');
    loader.src = '/emulator/loader.js';
    loader.onerror = () => { status.textContent = 'Could not load the emulator.'; };
    document.body.append(loader);
  } catch (error) {
    status.textContent = error.message;
  }
});
