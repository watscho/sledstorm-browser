// Local input preferences. Never part of a room's authoritative identity.
export const BUTTONS = [
  ['up', 4, 'Navigate up', 'ArrowUp'], ['down', 6, 'Navigate down', 'ArrowDown'],
  ['left', 7, 'Steer left', 'ArrowLeft'], ['right', 5, 'Steer right', 'ArrowRight'],
  ['cross', 14, 'Accelerate / confirm', 'KeyS'], ['triangle', 12, 'Triangle / back', 'KeyW'],
  ['start', 3, 'Start / pause', 'Enter'], ['square', 15, 'Square', 'KeyA'],
  ['circle', 13, 'Circle', 'KeyD'], ['select', 0, 'Select', 'ShiftRight'],
  ['l1', 10, 'L1', 'KeyQ'], ['r1', 11, 'R1', 'KeyE'],
  ['l2', 8, 'L2', 'KeyZ'], ['r2', 9, 'R2', 'KeyC'],
];
export const CLASSIC = Object.fromEntries(BUTTONS.map(([id, , , code]) => [id, code]));
export const WASD = { ...CLASSIC, up: 'KeyW', down: 'KeyS', left: 'KeyA', right: 'KeyD',
  cross: 'Space', triangle: 'Backspace', square: 'KeyJ', circle: 'KeyK', r1: 'KeyE', l2: 'Digit1', r2: 'Digit3' };
export function validKey(code) {
  return typeof code === 'string' && (/^(Key[A-Z]|Digit[0-9]|Arrow(Up|Down|Left|Right))$/.test(code)
    || ['Space', 'Enter', 'Backspace', 'ShiftLeft', 'ShiftRight', 'ControlLeft', 'ControlRight'].includes(code));
}
export function normalizeBindings(value) {
  if (!value || !BUTTONS.every(([id]) => validKey(value[id]))
    || new Set(BUTTONS.map(([id]) => value[id])).size !== BUTTONS.length) return { ...CLASSIC };
  return Object.fromEntries(BUTTONS.map(([id]) => [id, value[id]]));
}
export function rebind(bindings, id, code) {
  if (!Object.hasOwn(CLASSIC, id) || !validKey(code)) throw new Error('Use a letter, number, arrow, Space, Enter, Shift, Ctrl or Backspace.');
  const result = normalizeBindings(bindings);
  const other = BUTTONS.find(([otherId]) => otherId !== id && result[otherId] === code);
  if (other) result[other[0]] = result[id];
  result[id] = code;
  return result;
}
export function keyMap(bindings) {
  const normalized = normalizeBindings(bindings);
  return Object.fromEntries(BUTTONS.map(([id, bit]) => [normalized[id], bit]));
}
export function keyLabel(code) {
  return ({ ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→', Space: 'Space',
    Backspace: 'Backspace', ShiftLeft: 'L Shift', ShiftRight: 'R Shift', ControlLeft: 'L Ctrl', ControlRight: 'R Ctrl' })[code]
    || code.replace(/^(Key|Digit)/, '');
}
export function presetFor(bindings) {
  return [ ['classic', CLASSIC], ['wasd', WASD] ].find(([, preset]) => BUTTONS.every(([id]) => bindings[id] === preset[id]))?.[0] || 'custom';
}

export function restoreKeyboardProfile(saved) {
  const bindings = normalizeBindings(saved?.bindings);
  const legacyPreset = presetFor(bindings);
  const preset = ['classic', 'wasd', 'custom'].includes(saved?.preset) ? saved.preset : legacyPreset;
  const customBindings = saved?.customBindings
    ? normalizeBindings(saved.customBindings)
    : preset === 'custom' ? bindings : null;
  return { preset, customBindings, bindings: preset === 'custom' ? customBindings : preset === 'wasd' ? WASD : CLASSIC };
}

export const STANDARD_GAMEPAD = Object.freeze([14, 13, 15, 12, 10, 11, 8, 9, 0, 3, 1, 2, 4, 6, 7, 5]);

export function sampleGamepad(pad, selected, profiles) {
  let devices = [];
  try { devices = Array.from(navigator.getGamepads?.() || []); } catch { /* Keyboard remains usable. */ }
  const gamepad = selected === -1 ? null : devices.find(pad => pad?.mapping === 'standard' && (selected == null || pad.index === selected));
  if (gamepad?.mapping === 'standard') {
    const map = profiles?.get(gamepad.id) || STANDARD_GAMEPAD;
    for (let i = 0; i < map.length; ++i) if (map[i] !== null && gamepad.buttons[i]?.pressed) pad &= ~(1 << map[i]);
    if (gamepad.axes[0] < -0.4) pad &= ~(1 << 7);
    if (gamepad.axes[0] > 0.4) pad &= ~(1 << 5);
    if (gamepad.axes[1] < -0.4) pad &= ~(1 << 4);
    if (gamepad.axes[1] > 0.4) pad &= ~(1 << 6);
  }
  return pad;
}
