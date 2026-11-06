import test from 'node:test';
import assert from 'node:assert/strict';
import { unlockPal } from './pal-profile.js';

test('unlock applies only to initialized PAL menus and preserves unrelated bytes', () => {
  const ram = new Uint8Array(0x200000), view = new DataView(ram.buffer);
  ram[42] = 99;
  assert.equal(unlockPal(ram), false);
  view.setUint32(0xc3ca0, 1, true);
  assert.equal(unlockPal(ram), true);
  assert.equal(view.getUint16(0xc2ec0, true), 8);
  assert.equal(view.getUint16(0xc2ec2, true), 6);
  assert.ok(ram.subarray(0xd7438, 0xd7470).every(value => value === 2));
  assert.equal(ram[42], 99);
  assert.equal(unlockPal(ram), false);
  view.setUint16(0xc2ecc, 0, true);
  assert.equal(unlockPal(ram), true); // Restore a reset secret/mirror flag too.
  view.setUint32(0xd6980, 1, true);
  view.setUint16(0xc2ecc, 0, true);
  assert.equal(unlockPal(ram), false); // Never rewrite progress during a race.
});

