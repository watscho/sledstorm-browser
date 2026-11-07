import { sampleGamepad } from '/session-client.js';

const port = 55435;
const toRetroPad = [2, null, null, 3, 4, 7, 5, 6, 12, 13, 10, 11, 9, 8, 0, 1];
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

function netplayEndpoint() {
  const endpoint = new URL('/netplay', location.href);
  endpoint.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (location.port === '8000') { endpoint.port = '8006'; endpoint.pathname = '/'; }
  return endpoint;
}

export function checkNetplayInvitation({ room, token }) {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(netplayEndpoint());
    const deadline = setTimeout(() => socket.close(), 8000);
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ role: 'check', room, token }));
    }, { once: true });
    socket.addEventListener('close', event => {
      clearTimeout(deadline);
      if (event.code === 1000 && event.reason === 'Room available') resolve();
      else reject(new Error(event.reason || 'Could not reach the room. Check the connection and try again.'));
    }, { once: true });
  });
}

export async function prepareNetplay(emulator, { invitation, identity, onInvite, onClose, onRoster, dedicated, worker, options }) {
  const room = worker ? { room: worker.room, token: worker.workerKey, v: 7 } : invitation ?? {
    room: hex(crypto.getRandomValues(new Uint8Array(12))),
    token: hex(crypto.getRandomValues(new Uint8Array(32))),
    v: 7,
  };
  const role = worker ? 'worker' : invitation ? 'guest' : dedicated ? 'create' : 'host';
  const client = role === 'guest' || role === 'create';
  const seatKey = `sled-netplay-seat:${room.room}`;
  const controllerStorage = `sled-controller-key:${room.room}`;
  let previousSeatKey;
  if (dedicated && invitation) {
    try {
      const saved = sessionStorage.getItem(controllerStorage) ?? localStorage.getItem(controllerStorage);
      if (/^[a-f0-9]{32}$/.test(saved ?? '')) previousSeatKey = saved;
    } catch { /* A browser without storage can still use a free controller. */ }
  }
  let rememberController = true;
  let preferredSlot;
  if (invitation) {
    try { preferredSlot = Number(sessionStorage.getItem(seatKey)); } catch { /* A free seat still works. */ }
  }
  const endpoint = netplayEndpoint();
  let socket;
  function connect() {
    socket = new WebSocket(endpoint);
    const handlers = new AbortController();
    const { signal } = handlers;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Could not reach the room. Try again.')), dedicated && client ? 82_000 : 12_000);
      function finish(error, value) {
        clearTimeout(timer);
        handlers.abort();
        if (error) reject(error);
        else resolve(value);
      }
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ role, room: room.room, token: room.token, identity, preferredSlot,
          previousSeatKey, ...options, roster: !worker }));
      }, { signal });
      socket.addEventListener('close', event => finish(new Error(event.reason || 'Could not connect to the room.')), { signal });
      socket.addEventListener('message', event => {
        let ready;
        try { ready = JSON.parse(event.data); } catch { return; }
        if (ready?.type === 'ready' && Number.isInteger(ready.slot) && ready.slot >= 0 && ready.slot <= 3) {
          finish(null, ready);
        }
      }, { signal });
    });
  }
  try {
    let ready;
    for (let attempt = 0; ; attempt++) {
      try {
        ready = await connect();
        break;
      } catch (error) {
        if (!previousSeatKey || error.message !== 'Controller is already connected') throw error;
        if (attempt === 0) {
          // A recently closed tab may still be releasing its connection.
          await new Promise(resolve => setTimeout(resolve, 2000));
        } else {
          previousSeatKey = undefined;
          rememberController = false;
        }
      }
    }
    const { slot, seatKey: controllerKey } = ready;
    const connection = { slot, socket, owner: ready.owner, publish: () => onInvite(room) };
    if (!worker) {
      connection.markSynchronized = () => {
        if (socket.readyState === WebSocket.OPEN) socket.send('{"type":"synchronized"}');
      };
      socket.addEventListener('message', event => {
        if (typeof event.data !== 'string') return;
        let message;
        try { message = JSON.parse(event.data); } catch { return; }
        if (message?.type === 'ownership') connection.owner = message.owner === true;
        else if (message?.type === 'roster' && Array.isArray(message.seats)) onRoster?.(message);
        else return;
        event.stopImmediatePropagation();
      });
    }
    if (controllerKey) {
      try { sessionStorage.setItem(controllerStorage, controllerKey); } catch { /* Optional. */ }
      if (rememberController) {
        try { localStorage.setItem(controllerStorage, controllerKey); } catch { /* Optional. */ }
      }
    }
    if (invitation && !dedicated) {
      try { sessionStorage.setItem(seatKey, String(slot)); } catch { /* A free seat still works. */ }
    }
    const { Module: module, gameManager: manager } = emulator;
    if (!module.sledInstallNetplay || !module._sled_netplay_status) throw new Error('RetroArch Netplay core is missing. Rebuild the emulator.');
    module.sledInstallNetplay(client ? 'guest' : role, socket, endpoint.href, port, room.room);
    socket.addEventListener('close', event => onClose(event.reason ||
      'Disconnected from the room. Open the invitation again to rejoin.'), { once: true });
    const config = '/home/web_user/.config/retroarch/retroarch.cfg';
    const existing = module.FS.readFile(config, { encoding: 'utf8' });
    module.FS.writeFile(config, existing + '\nnetplay_public_announce = "false"\nnetplay_nat_traversal = "false"\n'
      + 'pause_nonactive = "false"\nnetplay_check_frames = "0"\n'
      + (worker ? 'netplay_start_as_spectator = "true"\nnetplay_max_connections = "4"\n'
        + 'netplay_allow_slaves = "true"\nnetplay_require_slaves = "true"\n'
        : `netplay_request_device_p${slot + 1} = "true"\n`));
    const callMain = module.callMain;
    module.callMain = argv => callMain([
      '--port', String(port), ...(client ? ['--connect', '127.0.0.1'] : ['--host']), ...argv,
    ]);
    manager.getFrameNum = () => module._sled_frame_count();
    return connection;
  } catch (error) {
    socket.close();
    throw error;
  }
}

export function driveRetroPad(emulator, { keyMap, gamepadIndex }) {
  const { gameManager: manager, elements } = emulator;
  let keyboard = 0xffff;
  let last = 0xffff;
  manager.setKeyboardEnabled(false);
  manager.simulateInput = () => {}; // The lobby owns keyboard and gamepad bindings.
  const release = () => { keyboard = 0xffff; };
  window.addEventListener('blur', release);
  document.addEventListener('visibilitychange', release);
  elements.parent.addEventListener('focusout', release);
  const game = document.querySelector('#game');
  game.addEventListener('focusout', release);
  for (const type of ['keydown', 'keyup']) {
    game.addEventListener(type, event => {
      if (event.target.closest?.('input,select,textarea,button,[contenteditable="true"]')) return;
      const bit = keyMap[event.code];
      if (bit === undefined) return;
      if (type === 'keyup') keyboard |= 1 << bit;
      else if (!event.metaKey && !event.altKey) keyboard &= ~(1 << bit);
      event.preventDefault();
      event.stopImmediatePropagation();
    }, true);
  }
  return () => {
    const pad = document.hasFocus() && !document.hidden ? sampleGamepad(keyboard, gamepadIndex?.()) : 0xffff;
    const changed = pad ^ last;
    for (let bit = 0; bit < 16; bit++) {
      const button = toRetroPad[bit];
      if (button !== null && (changed & (1 << bit))) {
        manager.functions.simulateInput(0, button, Number(!(pad & (1 << bit))));
      }
    }
    last = pad;
  };
}
