import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameSync, stateDigest } from './frame-sync.js';
import { canonicalStateDigest } from './core-state.js';

function fixture(moduleOverrides = {}) {
  let frame = 0;
  const requests = [], inputs = [], failures = [];
  const manager = { simulateInput() {}, setKeyboardEnabled() {}, toggleFastForward() {},
    toggleSlowMotion() {}, toggleRewind() {}, getFrameNum: () => frame,
    functions: { simulateInput: (...args) => inputs.push(args) } };
  const session = { exchange: (tick, state) => new Promise((resolve, reject) => requests.push({ tick, state, resolve, reject })),
    fail: reason => failures.push(reason) };
  const module = { ...moduleOverrides };
  const sync = new FrameSync({ module, manager, session, onStatus() {}, digest: () => 123 });
  return { sync, module, manager, requests, inputs, failures, advance: count => { frame += count; } };
}

test('frame gate blocks missing rows, applies four seats once and prefetches next row', async () => {
  const f = fixture();
  assert.equal(f.module.sledBeforeFrame(), false);
  assert.equal(f.requests.length, 0);
  f.sync.start();
  for (let i = 0; i < 5; i++) assert.equal(f.module.sledBeforeFrame(), false);
  assert.equal(f.requests.length, 1);
  assert.deepEqual([f.requests[0].tick, f.requests[0].state], [0, 123]);
  f.requests[0].resolve([65535 & ~(1 << 14), 65535 & ~(1 << 3), 65535, 65535]);
  await Promise.resolve();
  assert.equal(f.module.sledBeforeFrame(), true);
  assert.ok(f.inputs.some(([seat, button, value]) => seat === 0 && button === 0 && value === 1));
  assert.ok(f.inputs.some(([seat, button, value]) => seat === 1 && button === 3 && value === 1));
  f.advance(1); f.module.sledAfterFrame();
  assert.equal(f.sync.tick, 1);
  assert.equal(f.requests.length, 2);
  assert.equal(f.requests[1].state, null);
});

test('rejects a core iteration advancing zero or multiple frames', async () => {
  for (const delta of [0, 2]) {
    const f = fixture(); f.sync.start(); f.module.sledBeforeFrame();
    f.requests[0].resolve([65535, 65535, 65535, 65535]); await Promise.resolve();
    assert.equal(f.module.sledBeforeFrame(), true);
    f.advance(delta); f.module.sledAfterFrame();
    assert.match(f.failures[0], /expected exactly one/);
    assert.equal(f.module.sledBeforeFrame(), false);
  }
});

test('network rejection stops emulation and releases no speculative frame', async () => {
  const f = fixture(); f.sync.start(); f.module.sledBeforeFrame();
  f.requests[0].reject(new Error('disconnected'));
  await Promise.resolve(); await Promise.resolve();
  assert.equal(f.module.sledBeforeFrame(), false);
  assert.equal(f.sync.tick, 0);
  assert.deepEqual(f.failures, ['disconnected']);
});

test('state digest changes with content and remains unsigned', () => {
  assert.equal(stateDigest(new Uint8Array([1, 2, 3])), stateDigest(new Uint8Array([1, 2, 3])));
  assert.notEqual(stateDigest(new Uint8Array([1, 2, 3])), stateDigest(new Uint8Array([1, 2, 4])));
  assert.ok(stateDigest(new Uint8Array([255])) >= 0);
});

test('snapshot restore verifies the boundary without executing any core frames', () => {
  const bytes = new Uint8Array(4456472);
  bytes.set(new TextEncoder().encode('RASTATE'));
  bytes.set(new TextEncoder().encode('STv4 PCSXra f29871d'), 16);
  new DataView(bytes.buffer).setUint32(0x29934d, 1, true);
  const digest = canonicalStateDigest(bytes);
  const f = fixture({
    HEAPU8: new Uint8Array(0x440000 + 1),
    _malloc: () => 1, _free() {},
    _sled_unserialize_checkpoint: () => true,
  });
  f.manager.getState = () => bytes;
  assert.throws(() => f.sync.restore(bytes, 91, digest ^ 1), /exact console state/);
  assert.equal(f.sync.tick, 0);
  assert.equal(f.module.sledBeforeFrame(), false);
  f.sync.restore(bytes, 91, digest);
  assert.equal(f.sync.tick, 91);
  assert.equal(f.requests.length, 0);
  assert.equal(f.module.sledBeforeFrame(), false);
});

test('native mode counts real core callbacks rather than frontend iterations', async () => {
  let coreFrame = 0;
  const f = fixture({ _sled_frame_count: () => coreFrame }); f.sync.start();
  for (let i = 0; i < 10; i++) { assert.equal(f.module.sledBeforeFrame(), true); f.module.sledAfterFrame(); }
  assert.equal(f.requests.length, 0); assert.equal(f.sync.tick, 0);
  assert.equal(f.module.sledCoreBefore(), false);
  f.requests[0].resolve([65535, 65535, 65535, 65535]); await Promise.resolve();
  assert.equal(f.module.sledCoreBefore(), true); coreFrame++; f.module.sledCoreAfter();
  assert.equal(f.sync.tick, 1); assert.equal(f.manager.getFrameNum(), 1);
});

test('external input ownership prevents frontend gamepad callbacks from bypassing local preferences', () => {
  const session = { pad: 65535, fail() {} };
  const manager = { setKeyboardEnabled() {}, toggleFastForward() {}, toggleSlowMotion() {}, functions: {} };
  new FrameSync({ module: {}, manager, session, externalInput: true, onStatus() {}, digest: () => 0 });
  manager.simulateInput(0, 0, true);
  assert.equal(session.pad, 65535);
});
