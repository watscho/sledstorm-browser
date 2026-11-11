import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSaveFile, decodeSaveFile, saveName, previewSize, MAX_SAVE_BYTES, STATE_BYTES } from './save-file.js';

const identity = { disc: '1'.repeat(64), core: '2'.repeat(64), bios: 'hle', adapter: 'pcsx-frame-gate-v3' };
function state() {
  const bytes = new Uint8Array(STATE_BYTES);
  bytes.set(new TextEncoder().encode('RASTATE'), 0);
  bytes.set(new TextEncoder().encode('STv4 PCSXra f29871d'), 16);
  new DataView(bytes.buffer).setUint32(0x29934d, 1, true);
  bytes[0x20000] = 79;
  return bytes;
}
const record = () => ({ identity, state: state(), name: 'Pine Valley · lap 2', savedAt: 1794420000000,
  kind: 'manual', settings: { progress: 'original', camera: true }, preview: new Uint8Array() });

async function alterHeader(file, mutate) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const magic = new TextEncoder().encode('SLEDSTORM-SAVE\n');
  const offset = magic.length + 4;
  const length = new DataView(bytes.buffer).getUint32(magic.length, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(offset, offset + length)));
  mutate(header);
  const changed = new TextEncoder().encode(JSON.stringify(header));
  const prefix = bytes.slice(0, offset);
  new DataView(prefix.buffer).setUint32(magic.length, changed.length, true);
  return new Blob([prefix, changed, bytes.subarray(offset + length)]);
}

test('portable saves round-trip the exact state, original date and gameplay settings', async () => {
  const original = record();
  const file = await encodeSaveFile(original);
  assert.ok(file.size < STATE_BYTES, 'normal states should compress');
  const restored = await decodeSaveFile(file, identity);
  for (const key of ['identity', 'state', 'savedAt', 'name', 'kind', 'settings', 'preview']) assert.deepEqual(restored[key], original[key]);
  assert.equal('biosFile' in restored, false);
});

test('imports reject a different disc, core, BIOS and future format before storage', async () => {
  const file = await encodeSaveFile(record());
  for (const [key, value, message] of [['disc', '3'.repeat(64), /different game disc/],
    ['core', '4'.repeat(64), /different emulator/], ['bios', '5'.repeat(64), /different BIOS/]])
    await assert.rejects(decodeSaveFile(file, { ...identity, [key]: value }), message);
  await assert.rejects(decodeSaveFile(await alterHeader(file, header => { header.version = 2; }), identity), /version/);
  await assert.rejects(decodeSaveFile(await alterHeader(file, header => { header.settings.progress = 'invalid'; }), identity), /game settings/);
});

test('corruption, incomplete payloads and oversized files cannot become imported saves', async () => {
  const file = await encodeSaveFile(record());
  await assert.rejects(decodeSaveFile(await alterHeader(file, header => { header.snapshot.sha256 = '0'.repeat(64); }), identity), /checksum/);
  const bytes = new Uint8Array(await file.arrayBuffer());
  await assert.rejects(decodeSaveFile(new Blob([bytes.subarray(0, -1)]), identity), /incomplete|sizes/);
  bytes[0] = 0;
  await assert.rejects(decodeSaveFile(new Blob([bytes]), identity), /not a Sled Storm/);
  await assert.rejects(decodeSaveFile({ size: MAX_SAVE_BYTES + 1, arrayBuffer() { throw new Error('Must not read'); } }, identity), /smaller than/);
});

test('raw save exports remain portable when compression is unavailable', async () => {
  const original = globalThis.CompressionStream;
  try {
    globalThis.CompressionStream = undefined;
    const input = record();
    const file = await encodeSaveFile(input);
    assert.ok(file.size > STATE_BYTES);
    assert.deepEqual((await decodeSaveFile(file, identity)).state, input.state);
  } finally { globalThis.CompressionStream = original; }
});

test('a compressed payload cannot expand beyond the pinned snapshot size', async () => {
  const original = await encodeSaveFile(record());
  const bytes = new Uint8Array(await original.arrayBuffer());
  const magicSize = new TextEncoder().encode('SLEDSTORM-SAVE\n').length;
  const headerSize = new DataView(bytes.buffer).getUint32(magicSize, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(magicSize + 4, magicSize + 4 + headerSize)));
  const oversized = new Uint8Array(STATE_BYTES + 1024); oversized.set(state());
  const payload = new Uint8Array(await new Response(new Blob([oversized]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());
  header.snapshot.payloadBytes = payload.length; header.snapshot.compression = 'gzip';
  const text = new TextEncoder().encode(JSON.stringify(header));
  const prefix = bytes.slice(0, magicSize + 4); new DataView(prefix.buffer).setUint32(magicSize, text.length, true);
  await assert.rejects(decodeSaveFile(new Blob([prefix, text, payload]), identity), /exceeds the supported size/);
});

test('names remain plain bounded text and oversized JPEG previews are rejected before decoding', () => {
  assert.equal(saveName('  hello\nworld  '), 'hello world');
  assert.equal(Array.from(saveName('🏁'.repeat(100))).length, 60);
  assert.equal(saveName(''), 'Untitled save');
  assert.equal(previewSize(new Uint8Array()), null);
  assert.throws(() => previewSize(new TextEncoder().encode('<svg/>')), /JPEG/);
  const jpeg = new Uint8Array([255, 216, 255, 192, 0, 11, 8, 255, 255, 255, 255, 1, 1, 17, 0, 255, 217]);
  assert.throws(() => previewSize(jpeg), /too large/);
});
