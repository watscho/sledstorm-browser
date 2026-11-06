import test from 'node:test';
import assert from 'node:assert/strict';
import { canonicalStateDigest, captureState, encodeState, decodeState } from './core-state.js';
function state() {
  const data = new Uint8Array(4456472);
  data.set(new TextEncoder().encode('RASTATE'), 0);
  data.set(new TextEncoder().encode('STv4 PCSXra f29871d'), 16);
  new DataView(data.buffer).setUint32(0x29934d, 1, true);
  return data;
}
test('only audited GPU padding and serializer counter are excluded', () => {
  const a = state(), b = state();
  for (const [start, end] of [[0x298059, 0x29805d], [0x299395, 0x2996d5], [0x2996f5, 0x299755]]) b.fill(255, start, end);
  assert.equal(canonicalStateDigest(a), canonicalStateDigest(b));
  for (const offset of [0x9035, 0x209035, 0x299035, 0x299355, 0x2996d5, 0x299755, 0x400000]) {
    b[offset] ^= 1;
    assert.notEqual(canonicalStateDigest(a), canonicalStateDigest(b), offset.toString(16));
    b[offset] ^= 1;
  }
});
test('unknown core serialization formats fail closed', () => {
  assert.throws(() => canonicalStateDigest(new Uint8Array(32)), /state format/);
  const bytes = state(); bytes[16] ^= 1;
  assert.throws(() => canonicalStateDigest(bytes), /state format/);
});

test('snapshot capture copies data and preserves the pinned native buffer ownership', () => {
  const heap = new Uint8Array(4456472 + 64); heap[64] = 7;
  const freed = [];
  const captured = captureState({ HEAPU8: heap, _free: pointer => { freed.push(pointer); heap.fill(0); } }, () => '4456472|64|1');
  heap.fill(0);
  assert.equal(captured[0], 7); assert.deepEqual(freed, []);
  assert.throws(() => captureState({ HEAPU8: heap }, () => '4456472|999999|1'), /capture failed/);
});

test('snapshot transport preserves the pinned state bytes', () => {
  const bytes = state(); bytes[0x10000] = 73;
  assert.deepEqual(decodeState(encodeState(bytes)), bytes);
  assert.throws(() => decodeState('A'), /snapshot size/);
});
