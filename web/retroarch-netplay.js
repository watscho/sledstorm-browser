import { sampleGamepad } from '/session-client.js';

const port = 55435;
const toRetroPad = [2, null, null, 3, 4, 7, 5, 6, 12, 13, 10, 11, 9, 8, 0, 1];
const hex = bytes => Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');

export async function prepareNetplay(emulator, { invitation, identity, onInvite, onClose }) {
  const room = invitation ?? {
    room: hex(crypto.getRandomValues(new Uint8Array(12))),
    token: hex(crypto.getRandomValues(new Uint8Array(32))),
    v: 7,
  };
  const role = invitation ? 'guest' : 'host';
  const seatKey = `sled-netplay-seat:${room.room}`;
  let preferredSlot;
  if (invitation) {
    try { preferredSlot = Number(sessionStorage.getItem(seatKey)); } catch { /* A free seat still works. */ }
  }
  const endpoint = new URL('/netplay', location.href);
  endpoint.protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  if (location.port === '8000') { endpoint.port = '8006'; endpoint.pathname = '/'; }
  const socket = new WebSocket(endpoint);
  const handlers = new AbortController();
  const { signal } = handlers;
  let slot;
  try {
    slot = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error('Could not reach the room. Try again.')), 12_000);
      function finish(error, slot) {
        clearTimeout(timer);
        handlers.abort();
        if (error) reject(error);
        else resolve(slot);
      }
      socket.addEventListener('open', () => {
        socket.send(JSON.stringify({ role, room: room.room, token: room.token, identity, preferredSlot }));
      }, { signal });
      socket.addEventListener('close', event => finish(new Error(event.reason || 'Could not connect to the room.')), { signal });
      socket.addEventListener('message', event => {
        let ready;
        try { ready = JSON.parse(event.data); } catch { return; }
        if (ready?.type === 'ready' && Number.isInteger(ready.slot) && ready.slot >= 0 && ready.slot <= 3) {
          finish(null, ready.slot);
        }
      }, { signal });
    });
    if (invitation) {
      try { sessionStorage.setItem(seatKey, String(slot)); } catch { /* A free seat still works. */ }
    }
    const { Module: module, gameManager: manager } = emulator;
    if (!module.sledInstallNetplay || !module._sled_netplay_status) throw new Error('RetroArch Netplay core is missing. Rebuild the emulator.');
    module.sledInstallNetplay(role, socket, endpoint.href, port, room.room);
    socket.addEventListener('close', event => onClose(event.reason || 'Disconnected from the room.'), { once: true });
    const config = '/home/web_user/.config/retroarch/retroarch.cfg';
    const existing = module.FS.readFile(config, { encoding: 'utf8' });
    module.FS.writeFile(config, existing + '\nnetplay_public_announce = "false"\nnetplay_nat_traversal = "false"\n'
      + 'pause_nonactive = "false"\nnetplay_check_frames = "0"\n'
      + `netplay_request_device_p${slot + 1} = "true"\n`);
    const callMain = module.callMain;
    module.callMain = argv => callMain([
      '--port', String(port), ...(invitation ? ['--connect', '127.0.0.1'] : ['--host']), ...argv,
    ]);
    manager.getFrameNum = () => module._sled_frame_count();
    return { slot, socket, publish: () => onInvite(room) };
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
    const pad = sampleGamepad(keyboard, gamepadIndex?.());
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
