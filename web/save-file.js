import { validateStateFormat } from './core-state.js';

export const MANUAL_SLOTS = 6;
export const AUTO_SLOTS = 3;
export const STATE_BYTES = 4456472;
export const MAX_SAVE_BYTES = 6 * 1024 * 1024;
export const MAX_PREVIEW_BYTES = 192 * 1024;
const MAGIC = new TextEncoder().encode('SLEDSTORM-SAVE\n');
const MAX_HEADER_BYTES = 8192;
const hex = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

export const saveDigest = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
  byte => byte.toString(16).padStart(2, '0')).join('');

export function saveName(value, fallback = 'Untitled save') {
  return Array.from(typeof value === 'string' ? value.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '')
    .slice(0, 60).join('') || fallback;
}

export function checkedIdentity(value) {
  if (!value || !hex(value.disc) || !hex(value.core) ||
      !(value.bios === 'hle' || hex(value.bios)) || value.adapter !== 'pcsx-frame-gate-v3')
    throw new Error('This save has an unsupported game or emulator identity.');
  return { disc: value.disc, core: value.core, bios: value.bios, adapter: value.adapter };
}

export function identityKey(identity) {
  const value = checkedIdentity(identity);
  return [value.disc, value.core, value.bios, value.adapter].join(':');
}

export function checkCompatibility(actual, expected) {
  actual = checkedIdentity(actual);
  expected = checkedIdentity(expected);
  if (actual.disc !== expected.disc) throw new Error('This save belongs to a different game disc. Select the matching disc before importing.');
  if (actual.core !== expected.core || actual.adapter !== expected.adapter)
    throw new Error('This save needs a different emulator build. Use its matching build.');
  if (actual.bios !== expected.bios) throw new Error('This save uses a different BIOS. Select the matching BIOS, or HLE, before importing.');
}

export function gameSettings(value) {
  if (value === undefined || value === null) return null;
  if (!['all', 'original'].includes(value.progress) || typeof value.camera !== 'boolean')
    throw new Error('The save contains invalid game settings.');
  return { progress: value.progress, camera: value.camera };
}

// Read JPEG dimensions before handing imported thumbnails to the image decoder.
// Previews are deliberately small and never contain executable SVG/HTML.
export function previewSize(bytes) {
  if (!bytes?.length) return null;
  if (!(bytes instanceof Uint8Array) || bytes.length > MAX_PREVIEW_BYTES ||
      bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes.at(-2) !== 0xff || bytes.at(-1) !== 0xd9)
    throw new Error('The save preview is not a supported JPEG image.');
  let offset = 2;
  while (offset + 4 < bytes.length) {
    if (bytes[offset++] !== 0xff) break;
    while (bytes[offset] === 0xff) offset++;
    const marker = bytes[offset++];
    if (marker === 0xda || marker === 0xd9) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    const length = bytes[offset] * 256 + bytes[offset + 1];
    if (length < 2 || offset + length > bytes.length) break;
    if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
      const height = bytes[offset + 3] * 256 + bytes[offset + 4];
      const width = bytes[offset + 5] * 256 + bytes[offset + 6];
      if (width < 1 || width > 640 || height < 1 || height > 480)
        throw new Error('The save preview is too large.');
      return { width, height };
    }
    offset += length;
  }
  throw new Error('The save preview is damaged.');
}

function checkedTime(value) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > Date.UTC(2200, 0, 1))
    throw new Error('The save contains an invalid date.');
  return value;
}

async function readBounded(stream, limit) {
  const reader = stream.getReader();
  const chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > limit) throw new Error('The save expands beyond the supported size.');
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel().catch(() => {});
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export async function encodeSaveFile(record) {
  validateStateFormat(record.state);
  const identity = checkedIdentity(record.identity);
  const preview = record.preview ?? new Uint8Array();
  previewSize(preview);
  let payload = record.state;
  let compression = 'none';
  if (typeof CompressionStream === 'function') {
    const packed = await readBounded(new Blob([payload]).stream().pipeThrough(new CompressionStream('gzip')), MAX_SAVE_BYTES);
    if (packed.length < payload.length) { payload = packed; compression = 'gzip'; }
  }
  const header = new TextEncoder().encode(JSON.stringify({
    format: 'sledstorm-save', version: 1, identity,
    name: saveName(record.name), savedAt: checkedTime(record.savedAt),
    kind: record.kind === 'auto' ? 'auto' : 'manual', settings: gameSettings(record.settings),
    snapshot: { bytes: STATE_BYTES, payloadBytes: payload.length, compression, sha256: await saveDigest(record.state) },
    preview: { bytes: preview.length, sha256: preview.length ? await saveDigest(preview) : null },
  }));
  const prefix = new Uint8Array(MAGIC.length + 4);
  prefix.set(MAGIC);
  new DataView(prefix.buffer).setUint32(MAGIC.length, header.length, true);
  return new Blob([prefix, header, payload, preview], { type: 'application/octet-stream' });
}

export async function decodeSaveFile(file, expectedIdentity) {
  if (!file || !Number.isSafeInteger(file.size) || file.size < MAGIC.length + 4 || file.size > MAX_SAVE_BYTES)
    throw new Error('Choose a Sled Storm save file smaller than 6 MiB.');
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!MAGIC.every((byte, index) => bytes[index] === byte)) throw new Error('This is not a Sled Storm save file. Choose a .sledsave file.');
  const headerSize = new DataView(bytes.buffer).getUint32(MAGIC.length, true);
  const start = MAGIC.length + 4;
  if (!headerSize || headerSize > MAX_HEADER_BYTES || start + headerSize > bytes.length)
    throw new Error('The save header is damaged.');
  let header;
  try { header = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(start, start + headerSize))); }
  catch { throw new Error('The save header is damaged.'); }
  if (header?.format !== 'sledstorm-save' || header.version !== 1) throw new Error('This save file version is not supported.');
  const identity = checkedIdentity(header.identity);
  checkCompatibility(identity, expectedIdentity);
  if (typeof header.name !== 'string' || !['manual', 'auto'].includes(header.kind)) throw new Error('The save metadata is damaged.');
  const settings = gameSettings(header.settings);
  const savedAt = checkedTime(header.savedAt);
  const snapshot = header.snapshot;
  const picture = header.preview;
  if (!snapshot || snapshot.bytes !== STATE_BYTES || !hex(snapshot.sha256) ||
      !Number.isSafeInteger(snapshot.payloadBytes) || snapshot.payloadBytes < 1 || snapshot.payloadBytes > MAX_SAVE_BYTES ||
      !['none', 'gzip'].includes(snapshot.compression) || !picture ||
      !Number.isSafeInteger(picture.bytes) || picture.bytes < 0 || picture.bytes > MAX_PREVIEW_BYTES ||
      (picture.bytes ? !hex(picture.sha256) : picture.sha256 !== null) ||
      start + headerSize + snapshot.payloadBytes + picture.bytes !== bytes.length)
    throw new Error('The save is incomplete or has invalid sizes.');
  const payload = bytes.subarray(start + headerSize, start + headerSize + snapshot.payloadBytes);
  let state;
  if (snapshot.compression === 'gzip') {
    if (typeof DecompressionStream !== 'function') throw new Error('This browser cannot open compressed saves. Use a current desktop browser.');
    try { state = await readBounded(new Blob([payload]).stream().pipeThrough(new DecompressionStream('gzip')), STATE_BYTES); }
    catch { throw new Error('The compressed save is damaged or exceeds the supported size.'); }
  } else state = payload.slice();
  try { validateStateFormat(state); }
  catch { throw new Error('The save contains an unsupported or damaged game snapshot.'); }
  if (await saveDigest(state) !== snapshot.sha256) throw new Error('The save checksum does not match. The file is damaged.');
  const preview = bytes.slice(start + headerSize + snapshot.payloadBytes);
  previewSize(preview);
  if (preview.length && await saveDigest(preview) !== picture.sha256) throw new Error('The save preview checksum does not match.');
  return { identity, name: saveName(header.name), kind: header.kind, savedAt, settings, state, preview };
}
