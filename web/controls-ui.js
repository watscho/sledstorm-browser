import { STANDARD_GAMEPAD } from '/session-client.js';
import { BUTTONS, CLASSIC, WASD, restoreKeyboardProfile, rebind, keyMap, keyLabel } from './controls.js';

// Hotspot centers in the illustration's SVG viewBox (0 14 128 94).
const controllerButtons = {
  l2: [30, 20], r2: [98, 20],
  l1: [30, 30], r1: [98, 30],
  up: [30, 42], triangle: [98, 39.5],
  left: [22, 50], right: [38, 50],
  select: [54, 50.5], start: [74, 50.5],
  square: [87, 50], circle: [109, 50],
  down: [30, 58], cross: [98, 60.5],
};

export function initControls() {
  const $ = selector => document.querySelector(selector);
  const storageKey = 'sledstorm.controls.v1';
  let { bindings, preset, customBindings } = restoreKeyboardProfile();
  let listening = null, locked = false, storageWorks = true;
  try { ({ bindings, preset, customBindings } = restoreKeyboardProfile(JSON.parse(localStorage.getItem(storageKey)))); }
  catch { /* Unavailable or invalid storage starts with classic controls. */ }
  const hint = text => { $('#binding-status').textContent = text; };
  const render = () => {
    $('#control-preset').value = preset;
    for (const button of document.querySelectorAll('[data-binding]')) {
      const [id, , label] = BUTTONS.find(([id]) => id === button.dataset.binding);
      const key = keyLabel(bindings[id]);
      button.querySelector('kbd').textContent = id === listening ? '…' : key === 'Backspace' ? '⌫' : key;
      button.title = `${label} · ${key}`;
      button.dataset.listening = String(id === listening);
      button.setAttribute('aria-label', `Change ${label}: ${key}`);
    }
    $('#play-controls').textContent = `${keyLabel(bindings.left)} / ${keyLabel(bindings.right)} to steer · ${keyLabel(bindings.cross)} to accelerate · ${keyLabel(bindings.start)} for Start · ${keyLabel(bindings.triangle)} to go back`;
  };
  const save = () => {
    try { localStorage.setItem(storageKey, JSON.stringify({ bindings, preset, customBindings })); storageWorks = true; }
    catch { storageWorks = false; }
    hint(storageWorks ? 'Saved in this browser. Select a controller button to change its key. Escape cancels.' : 'Storage unavailable. Controls apply to this session only.');
    render();
  };
  for (const [id, [x, y]] of Object.entries(controllerButtons)) {
    const [, , label] = BUTTONS.find(([buttonId]) => buttonId === id);
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'key-button';
    button.dataset.binding = id;
    button.style.left = `${x / 128 * 100}%`;
    button.style.top = `${(y - 14) / 94 * 100}%`;

    if (/^[lr][12]$/.test(id) || id === 'start' || id === 'select') {
      const name = document.createElement('span');
      name.className = 'controller-button-name';
      name.textContent = id === 'start' ? 'Start' : label;
      button.append(name);
    }
    button.append(document.createElement('kbd'));
    button.addEventListener('click', () => {
      if (locked) return;
      listening = listening === id ? null : id;
      hint(listening ? 'Press a new key. Escape cancels. If that key is in use, the two bindings swap.' : 'Key change cancelled.');
      render();
    });
    $('#key-bindings').append(button);
  }
  document.addEventListener('keydown', event => {
    if (!listening || locked) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (event.key === 'Escape') { listening = null; render(); hint('Key change cancelled.'); return; }
    if (event.metaKey || event.altKey || event.repeat) { hint('Use a single key without Command or Alt. Escape cancels.'); return; }
    try {
      bindings = customBindings = rebind(bindings, listening, event.code);
      preset = 'custom';
      listening = null;
      save();
    }
    catch (error) { hint(error.message); }
  }, true);
  document.addEventListener('focusin', event => {
    if (listening && !event.target.closest?.('[data-binding]')) {
      listening = null; render(); hint('Key change cancelled.');
    }
  });
  $('#control-preset').addEventListener('change', () => {
    preset = $('#control-preset').value;
    if (preset === 'custom') bindings = customBindings ??= bindings;
    else bindings = preset === 'wasd' ? WASD : CLASSIC;
    listening = null;
    save();
  });
  const resetKeyboard = () => { bindings = CLASSIC; preset = 'classic'; customBindings = null; listening = null; save(); };
  $('#reset-controls').addEventListener('click', resetKeyboard);
  const gamepadProfiles = new Map();
  const gamepadStorageKey = 'sledstorm.gamepads.v1';
  const selectionStorageKey = 'sledstorm.gamepad-selection.v1';
  let preferredDevice = 'auto';
  const actions = $('#gamepad-action');
  const bindButton = $('#bind-gamepad');
  const mappingStatus = $('#gamepad-binding-status');
  for (const [, bit, label] of BUTTONS) actions.add(new Option(label, String(bit)));
  actions.value = '14';
  try {
    const saved = JSON.parse(localStorage.getItem(selectionStorageKey));
    if (saved?.device === 'off' || (typeof saved?.device?.id === 'string' && Number.isInteger(saved.device.index)))
      preferredDevice = saved.device;
    if ([...actions.options].some(option => option.value === saved?.action)) actions.value = saved.action;
  } catch { /* Use default selections when storage is unavailable. */ }
  const rememberSelection = () => {
    try { localStorage.setItem(selectionStorageKey, JSON.stringify({ device: preferredDevice, action: actions.value })); }
    catch { /* The current selection still applies. */ }
  };
  try {
    for (const [id, map] of JSON.parse(localStorage.getItem(gamepadStorageKey) || '[]')) {
      if (typeof id === 'string' && Array.isArray(map) && map.length >= 16 && map.length <= 64 &&
          map.every(bit => bit === null || Number.isInteger(bit) && bit >= 0 && bit <= 15) &&
          new Set(map.filter(bit => bit !== null)).size === 16) gamepadProfiles.set(id, map);
    }
  } catch { /* Use the standard mapping when storage is unavailable. */ }
  let selectedPad;
  let capture;
  const buttonNames = ['A / ×', 'B / ○', 'X / □', 'Y / △', 'L1', 'R1', 'L2', 'R2',
    'Select', 'Start', 'L3', 'R3', 'D-pad up', 'D-pad down', 'D-pad left', 'D-pad right'];
  const describeMapping = () => {
    if (!selectedPad || capture) return;
    const map = gamepadProfiles.get(selectedPad.id) || STANDARD_GAMEPAD;
    const index = map.indexOf(Number(actions.value));
    mappingStatus.textContent = 'Current input: ' + (buttonNames[index] || 'Button ' + (index + 1));
  };
  const persistMappings = () => {
    try { localStorage.setItem(gamepadStorageKey, JSON.stringify([...gamepadProfiles])); }
    catch { mappingStatus.textContent += ' Storage is unavailable. This mapping applies for this session.'; }
  };
  const cancelCapture = () => {
    capture = undefined;
    bindButton.textContent = 'Press to bind';
    describeMapping();
  };
  actions.addEventListener('change', () => { rememberSelection(); cancelCapture(); });
  $('#reset-gamepad').addEventListener('click', () => {
    if (!selectedPad) return;
    gamepadProfiles.delete(selectedPad.id);
    cancelCapture();
    persistMappings();
  });
  window.addEventListener('keydown', event => {
    if (capture && event.key === 'Escape') {
      event.preventDefault();
      cancelCapture();
    }
  });
  bindButton.addEventListener('click', () => {
    if (capture) { cancelCapture(); return; }
    if (!selectedPad || locked) return;
    const active = capture = { id: selectedPad.id, index: selectedPad.index, neutral: false };
    bindButton.textContent = 'Cancel';
    mappingStatus.textContent = 'Release the buttons, then press the button you want to use.';
    const poll = () => {
      if (capture !== active) return;
      let pad;
      try { pad = navigator.getGamepads?.()[active.index]; } catch { /* Access was revoked. */ }
      if (!pad || pad.id !== active.id || pad.mapping !== 'standard') { cancelCapture(); return; }
      const index = pad.buttons.findIndex((button, index) => index < 64 && button.pressed);
      if (index < 0) active.neutral = true;
      else if (active.neutral) {
        const map = [...(gamepadProfiles.get(pad.id) || STANDARD_GAMEPAD)];
        const bit = Number(actions.value);
        const previous = map.indexOf(bit);
        while (map.length <= index) map.push(null);
        map[previous] = map[index];
        map[index] = bit;
        gamepadProfiles.set(pad.id, map);
        cancelCapture();
        persistMappings();
        return;
      }
      requestAnimationFrame(poll);
    };
    requestAnimationFrame(poll);
  });
  // Preserve the chosen device while rebuilding the menu on hotplug.
  let signature;
  let devices = [];
  const updateGamepads = () => {
    const report = message => { $('#gamepad-state').textContent = message; };
    try { devices = Array.from(navigator.getGamepads?.() || []).filter(Boolean); }
    catch { report('Controller access is unavailable. Keyboard controls still work.'); return; }
    const select = $('#gamepad-device');
    const next = devices.map(p => `${p.index}:${p.id}:${p.mapping}`).join('|');
    if (signature !== next) {
      signature = next;
      select.replaceChildren(new Option('Automatic · first standard controller', 'auto'), new Option('Keyboard only', 'off'));
      for (const pad of devices) select.add(new Option(`${pad.index + 1}. ${pad.id}${pad.mapping === 'standard' ? '' : ' · unsupported mapping'}`, String(pad.index), false, false));
      for (const option of select.options) if (option.value !== 'auto' && option.value !== 'off') option.disabled = devices.find(p => p.index === Number(option.value))?.mapping !== 'standard';
      const preferred = devices.filter(pad => pad.mapping === 'standard' && pad.id === preferredDevice.id);
      const selected = preferred.find(pad => pad.index === preferredDevice.index) || preferred[0];
      select.value = typeof preferredDevice === 'string' ? preferredDevice : selected ? String(selected.index) : 'auto';
    }
    const pad = select.value === 'off' ? null : devices.find(p => p.mapping === 'standard' && (select.value === 'auto' || p.index === Number(select.value)));
    selectedPad = pad;
    $('#gamepad-bindings').hidden = !pad;
    describeMapping();
    $('#gamepad-name').textContent = pad ? pad.id : select.value === 'off' ? 'Keyboard only' : 'No supported controller detected';
    const active = pad && (pad.buttons.some(button => button.pressed) || pad.axes.some(axis => Math.abs(axis) > .4));
    $('#gamepad-indicator').classList.toggle('input-active', Boolean(active));
    report(pad ? (active ? 'Input detected.' : 'Connected · press a button or move the left stick to test.')
      : select.value === 'off' ? 'Controller input is disabled for this browser.'
      : devices.length ? 'This controller does not expose a standard browser mapping. Use the keyboard.' : 'Connect by USB or Bluetooth, then press a button to let the browser detect it.');
  };
  $('#gamepad-device').addEventListener('change', event => {
    const value = event.target.value;
    const pad = devices.find(device => device.index === Number(value));
    preferredDevice = pad ? { id: pad.id, index: pad.index } : value === 'off' ? 'off' : 'auto';
    rememberSelection();
    cancelCapture();
    updateGamepads();
  });
  window.addEventListener('gamepadconnected', updateGamepads);
  window.addEventListener('gamepaddisconnected', updateGamepads);
  setInterval(updateGamepads, 250);
  updateGamepads(); render();
  return {
    reset() {
      if (locked) return;
      resetKeyboard();
      preferredDevice = $('#gamepad-device').value = 'auto';
      actions.value = '14';
      rememberSelection();
      updateGamepads();
    },
    lock() { locked = true; listening = null; cancelCapture(); render(); },
    options() { return { keyMap: keyMap(bindings), gamepadProfiles, gamepadIndex: () => $('#gamepad-device').value === 'off' ? -1 : $('#gamepad-device').value === 'auto' ? null : Number($('#gamepad-device').value) }; },
  };
}
