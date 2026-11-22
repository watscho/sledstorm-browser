import assert from 'node:assert/strict';
import test from 'node:test';
import { launchMode, roomViewFlags } from './launch-mode.js';

test('Mac launches solo locally, including an old bookmark or saved game, and requires Netplay invitations for rooms', () => {
  const mac = { packaged: true, local: true, pathname: '/' };
  assert.equal(launchMode(mac), 'solo');
  assert.equal(launchMode({ ...mac, pathname: '/solo' }), 'solo');
  assert.equal(launchMode({ ...mac, invitationVersion: 8 }), 'room');
  assert.equal(launchMode({ ...mac, invitationVersion: 6 }), 'invalid');
  assert.equal(launchMode({ ...mac, local: false }), 'invalid');
  assert.equal(launchMode({ ...mac, local: false, invitationVersion: 8 }), 'room');
  assert.equal(launchMode({ ...mac, worker: true }), 'worker');
});

test('the experimental client still uses its original dispatcher', () => {
  assert.equal(launchMode({ packaged: false, local: true, pathname: '/', invitationVersion: 6 }), 'source');
});

test('split-screen and personal players keep the same shared hooks as the room worker', () => {
  const room = { camera: true, nativeCamera: true };
  assert.equal(roomViewFlags(room, { mode: 'worker' }), 2 | 16);
  assert.equal(roomViewFlags(room, { mode: 'room', raceView: 'split' }), 2 | 16 | 64);
  assert.equal(roomViewFlags(room, { mode: 'room', raceView: 'personal' }), 2 | 16 | 1 | 4);
  assert.equal(roomViewFlags(room, { mode: 'source' }), 2 | 16 | 1 | 4);
  assert.equal(roomViewFlags(room, { mode: 'source', worker: true }), 2 | 16);
  assert.equal(roomViewFlags({ camera: false }, { mode: 'room' }), 0);
});
