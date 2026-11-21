import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { invitationVersion, roomIdentity, roomIdentityText, roomProtocol } from './room-identity.js';

// The recorded identities were computed outside this module, from the canonical text.
const fixtures = JSON.parse(await readFile(new URL('./room-identity.fixtures.json', import.meta.url), 'utf8'));
const [{ input: base }] = fixtures;
const copy = value => JSON.parse(JSON.stringify(value));

test('the fixtures give the recorded identities', async () => {
  assert.equal(fixtures.length, 4);
  for (const { name, input, text, identity } of fixtures) {
    assert.equal(roomIdentityText(input), text, name);
    assert.equal(await roomIdentity(input), identity, name);
  }
  assert.equal(new Set(fixtures.map(fixture => fixture.identity)).size, fixtures.length);
});

test('the invitation version and the protocol go together', () => {
  assert.equal(invitationVersion, 8);
  assert.equal(roomProtocol, 'retroarch-netplay-v8');
});

test('fields outside the list and their order do not count', async () => {
  // What /session-info looks like on two servers: other keys, another order, another way of sending the disc.
  const shuffled = {
    dedicated: true, roomCheck: true, discMode: 'local', pal: true,
    archive: { sha256: 'f'.repeat(64), size: 1, chunkSize: 1, chunks: ['f'.repeat(64)] },
    options: { nativeCamera: true, camera: true, progress: 'all', volume: 3 },
    bios: base.bios, native: Object.fromEntries(Object.entries(base.native).reverse()),
    adapter: base.adapter, core: base.core, disc: base.disc,
  };
  assert.equal(await roomIdentity(shuffled), fixtures[0].identity);
});

test('each listed field counts', async () => {
  const other = '9'.repeat(64);
  const changes = [
    input => { input.disc = other; },
    input => { input.core = other; },
    input => { input.adapter = 'pcsx-frame-gate-v4'; },
    input => { input.native['pcsx_rearmed_libretro.wasm'] = other; },
    input => { input.native['another.wasm'] = other; },
    input => { input.bios = other; },
    input => { input.options.progress = 'original'; },
    input => { input.options.nativeCamera = false; },
    input => { input.options = { progress: 'all', camera: false }; },
  ];
  const identities = [fixtures[0].identity];
  for (const change of changes) {
    const input = copy(base);
    change(input);
    identities.push(await roomIdentity(input));
  }
  assert.equal(new Set(identities).size, identities.length, 'every change gives an identity of its own');
});

test('the native camera counts only when it is on', async () => {
  const off = { ...copy(base), options: { progress: 'all', camera: true, nativeCamera: false } };
  assert.equal(await roomIdentity(off), fixtures[2].identity);
});

test('a missing or mistyped field is refused', async () => {
  const broken = [
    ['disc', input => { delete input.disc; }],
    ['disc', input => { input.disc = null; }],
    ['disc', input => { input.disc = 'A'.repeat(64); }],
    ['core', input => { input.core = 'short'; }],
    ['adapter', input => { input.adapter = ''; }],
    ['native build', input => { input.native = {}; }],
    ['native build', input => { input.native = ['c'.repeat(64)]; }],
    ['native build', input => { input.native['pcsx_rearmed_libretro.js'] = 7; }],
    ['BIOS', input => { input.bios = 'hle'; }],
    ['room options', input => { delete input.options; }],
    ['room options', input => { input.options.progress = 'everything'; }],
    ['room options', input => { input.options.camera = 'yes'; }],
    ['room options', input => { input.options = { progress: 'all', camera: false, nativeCamera: true }; }],
  ];
  for (const [field, change] of broken) {
    const input = copy(base);
    change(input);
    await assert.rejects(roomIdentity(input), new RegExp(`needs a valid ${field}`), field);
  }
  await assert.rejects(roomIdentity(), /needs a valid/);
});
