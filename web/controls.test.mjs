import test from 'node:test';
import assert from 'node:assert/strict';
import { BUTTONS, CLASSIC, WASD, normalizeBindings, rebind, keyMap, presetFor } from './controls.js';

test('presets map every physical key to one PS1 button and recover corrupt preferences', () => {
  for (const bindings of [CLASSIC, WASD]) {
    assert.deepEqual(normalizeBindings(bindings), bindings);
    assert.equal(Object.keys(keyMap(bindings)).length, BUTTONS.length);
    assert.equal(keyMap(bindings)[bindings.cross], 14);
    assert.equal(keyMap(bindings)[bindings.start], 3);
  }
  for (const value of [null, {}, 'bad', { ...CLASSIC, cross: CLASSIC.up }, { ...CLASSIC, cross: 'Escape' }]) {
    assert.deepEqual(normalizeBindings(value), CLASSIC);
  }
  assert.equal(presetFor(CLASSIC), 'classic'); assert.equal(presetFor(WASD), 'wasd');
});

test('rebinding swaps conflicting keys without mutating defaults or losing a button', () => {
  const updated = rebind(CLASSIC, 'cross', 'ArrowUp');
  assert.equal(updated.cross, 'ArrowUp'); assert.equal(updated.up, 'KeyS');
  assert.equal(new Set(Object.values(updated)).size, BUTTONS.length);
  assert.equal(CLASSIC.cross, 'KeyS'); assert.equal(presetFor(updated), 'custom');
  assert.throws(() => rebind(CLASSIC, 'unknown', 'KeyV'));
  assert.throws(() => rebind(CLASSIC, 'cross', 'Escape'));
});
