import test from 'node:test';
import assert from 'node:assert/strict';
import { invitationUrl, parseInvitation, recoveryUrl } from './invitation.js';

test('guest resharing restores private access after the gateway redirect', () => {
  const room = { room: 'a'.repeat(24), token: 'b'.repeat(64) };
  const options = { progress: 'all', camera: true };
  const path = '/access/' + 'c'.repeat(48);
  const host = invitationUrl('https://game.example/?dev=1', path, room, options);
  const redirected = new URL(host); redirected.pathname = '/';
  const invitation = parseInvitation(redirected.hash);
  const guest = invitationUrl(redirected.href, path, invitation, options);
  assert.equal(guest, host);
  assert.deepEqual(parseInvitation(new URL(guest).hash), { v: 6, ...room, ...options });
  assert.equal(new URL(host).search, '');
});

test('malformed and outdated invitations fail before disc loading', () => {
  assert.equal(parseInvitation(''), null);
  for (const hash of ['#garbage', '#' + btoa(JSON.stringify({ v: 5 })), '#' + btoa('{}')])
    assert.throws(() => parseInvitation(hash), /Invalid or outdated/);
});

test('a loopback host shares the private HTTPS room without downloading through the tunnel', () => {
  const room = { v: 7, room: '1'.repeat(24), token: '2'.repeat(64) }, options = { progress: 'all', camera: true };
  const path = '/access/' + '3'.repeat(48);
  const shared = new URL(invitationUrl('http://127.0.0.1:8000/?dev=1', path, room, options, 'https://game.example'));
  assert.equal(shared.origin, 'https://game.example');
  assert.equal(shared.pathname, path);
  assert.deepEqual(parseInvitation(shared.hash), { ...room, ...options });
  assert.throws(() => invitationUrl('http://127.0.0.1:8000/', path, room, options, 'http://game.example'), /Invalid public/);
});

test('a private controller recovery link is never included in a reshared invitation', () => {
  const room = { v: 7, room: '1'.repeat(24), token: '2'.repeat(64) };
  const options = { progress: 'all', camera: true };
  const shared = invitationUrl('https://game.example/', '/', room, options);
  const key = '4'.repeat(32);
  const personal = recoveryUrl(shared, key);
  const recovered = parseInvitation(new URL(personal).hash);
  assert.equal(recovered.recovery, key);
  assert.equal(invitationUrl(personal, '/', recovered, options), shared);
  assert.throws(() => parseInvitation(new URL(recoveryUrl(shared, 'bad')).hash), /Invalid or outdated/);
});

test('the experimental native camera setting travels with the room invitation', () => {
  const room = { v: 7, room: '1'.repeat(24), token: '2'.repeat(64) };
  const options = { progress: 'all', camera: true, nativeCamera: true };
  const link = invitationUrl('https://game.example/?nativeCamera=1', '/', room, options);
  assert.deepEqual(parseInvitation(new URL(link).hash), { ...room, ...options });
  const invalid = invitationUrl(link, '/', room, { ...options, camera: false });
  assert.throws(() => parseInvitation(new URL(invalid).hash), /Invalid or outdated/);
});
