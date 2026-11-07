import { BUTTONS, CLASSIC, WASD, normalizeBindings, rebind, keyMap, keyLabel, presetFor } from './controls.js';

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
  let bindings = { ...CLASSIC }, listening = null, locked = false, storageWorks = true;
  try { bindings = normalizeBindings(JSON.parse(localStorage.getItem(storageKey))?.bindings); }
  catch { /* Unavailable or invalid storage starts with classic controls. */ }
  const hint = text => { $('#binding-status').textContent = text; };
  const render = () => {
    $('#control-preset').value = presetFor(bindings);
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
    try { localStorage.setItem(storageKey, JSON.stringify({ bindings })); storageWorks = true; }
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
    try { bindings = rebind(bindings, listening, event.code); listening = null; save(); }
    catch (error) { hint(error.message); }
  }, true);
  document.addEventListener('focusin', event => {
    if (listening && !event.target.closest?.('[data-binding]')) {
      listening = null; render(); hint('Key change cancelled.');
    }
  });
  $('#control-preset').addEventListener('change', () => {
    if ($('#control-preset').value === 'custom') { hint('Select a controller button below to create your layout.'); return; }
    bindings = { ...($('#control-preset').value === 'wasd' ? WASD : CLASSIC) }; listening = null; save();
  });
  $('#reset-controls').addEventListener('click', () => { bindings = { ...CLASSIC }; listening = null; save(); });
  // Preserve the chosen device while rebuilding the menu on hotplug.
  let signature;
  const updateGamepads = () => {
    let devices;
    try { devices = Array.from(navigator.getGamepads?.() || []).filter(Boolean); }
    catch { $('#gamepad-state').textContent = 'Controller access is unavailable. Keyboard controls still work.'; return; }
    const select = $('#gamepad-device');
    const next = devices.map(p => `${p.index}:${p.id}:${p.mapping}`).join('|');
    if (signature !== next) {
      signature = next;
      const previous = select.value;
      select.replaceChildren(new Option('Automatic · first standard controller', 'auto'), new Option('Keyboard only', 'off'));
      for (const pad of devices) select.add(new Option(`${pad.index + 1}. ${pad.id}${pad.mapping === 'standard' ? '' : ' · unsupported mapping'}`, String(pad.index), false, false));
      for (const option of select.options) if (option.value !== 'auto' && option.value !== 'off') option.disabled = devices.find(p => p.index === Number(option.value))?.mapping !== 'standard';
      select.value = [...select.options].some(o => o.value === previous) ? previous : 'auto';
    }
    const pad = select.value === 'off' ? null : devices.find(p => p.mapping === 'standard' && (select.value === 'auto' || p.index === Number(select.value)));
    $('#gamepad-name').textContent = pad ? pad.id : select.value === 'off' ? 'Keyboard only' : 'No supported controller detected';
    const active = pad && (pad.buttons.some(button => button.pressed) || pad.axes.some(axis => Math.abs(axis) > .4));
    $('#gamepad-indicator').classList.toggle('input-active', Boolean(active));
    $('#gamepad-state').textContent = pad ? (active ? 'Input detected · controls your player in this browser.' : 'Connected · press a button or move the left stick to test.')
      : select.value === 'off' ? 'Controller input is disabled for this browser.'
      : devices.length ? 'This controller does not expose a standard browser mapping. Use the keyboard.' : 'Connect by USB or Bluetooth, then press a button to let the browser detect it.';
  };
  $('#gamepad-device').addEventListener('change', updateGamepads);
  window.addEventListener('gamepadconnected', updateGamepads);
  window.addEventListener('gamepaddisconnected', updateGamepads);
  setInterval(updateGamepads, 250);
  updateGamepads(); render();
  return {
    reset() { if (!locked) { bindings = { ...CLASSIC }; listening = null; $('#gamepad-device').value = 'auto'; save(); updateGamepads(); } },
    lock() { locked = true; listening = null; render(); },
    options() { return { keyMap: keyMap(bindings), gamepadIndex: () => $('#gamepad-device').value === 'off' ? -1 : $('#gamepad-device').value === 'auto' ? null : Number($('#gamepad-device').value) }; },
  };
}
