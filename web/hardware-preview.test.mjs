import test from 'node:test';
import assert from 'node:assert/strict';
import { packetEnd } from '../research/emulator/sled-enge-adapter.js';

test('a shaded snow line consumes both colors and both coordinates', () => {
  const words = Uint32Array.of(0x50f8f8f8, 0x00800050, 0x00404040, 0xffff0068, 0xe6000000);
  assert.equal(packetEnd(words, 0, words.length), 4);
  assert.equal(packetEnd(words, 4, words.length), 5);
});

test('polyline termination follows the flat or shaded word stride', () => {
  const flat = Uint32Array.of(0x48ffffff, 0, 1, 2, 0x50005000);
  const shaded = Uint32Array.of(0x58ffffff, 0, 0x303030, 1, 0x202020, 2, 0x50005000);
  assert.equal(packetEnd(flat, 0, flat.length), flat.length);
  assert.equal(packetEnd(shaded, 0, shaded.length), shaded.length);
  assert.ok(packetEnd(shaded, 0, shaded.length - 1) > shaded.length - 1);
  assert.ok(packetEnd(Uint32Array.of(0xa0000000), 0, 1) > 1);
});
