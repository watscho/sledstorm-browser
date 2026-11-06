import test from 'node:test';
import assert from 'node:assert/strict';
import { FrameHistory } from './frame-history.mjs';
test('compact history preserves null/unsigned checksums and four seats across chunk boundaries', () => {
  const history = new FrameHistory();
  const rows = Array.from({ length: 4097 }, (_, tick) => ({ type: 'frame', tick,
    pads: [tick, 65535, 1, 0], state: tick % 2 ? null : 0xffffffff }));
  for (const row of rows) history.push(row);
  assert.deepEqual(history.slice(4094, 5000), rows.slice(4094));
  assert.equal(history.chunks.reduce((bytes, chunk) => bytes + chunk.byteLength, 0), 131072);
  history.slice(0, 1)[0].pads[0] = 999;
  assert.equal(history.slice(0, 1)[0].pads[0], 0);
  history.clear(); assert.equal(history.length, 0); assert.equal(history.chunks.length, 0);
});
