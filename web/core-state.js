// Audited against PCSX-ReARMed f29871dde1742cafb0ab56ba33636a8600bbbd80:
// libpcsxcore/misc.c SaveState and plugins/gpulib/gpu.c GPUfreeze.
// GPUFreeze_t has 256 control words, but GPUfreeze initializes only 0..15 and
// 224..231. The remaining malloc bytes are neither restored nor console state.
const CORE_SIGNATURE = 'STv4 PCSXra f29871d';
const UNUSED = [[0x298059, 0x29805d], // save_counter: serializer bookkeeping
  [0x299395, 0x2996d5], [0x2996f5, 0x299755]];

export function canonicalStateDigest(bytes) {
  if (bytes.length !== 4456472 ||
      new TextDecoder().decode(bytes.subarray(0, 7)) !== 'RASTATE' ||
      new TextDecoder().decode(bytes.subarray(16, 16 + CORE_SIGNATURE.length)) !== CORE_SIGNATURE ||
      new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0x29934d, true) !== 1) {
    throw new Error('Unexpected PCSX state format. Synchronization stopped.');
  }
  let hash = 2166136261, range = 0;
  for (let i = 0; i < bytes.length; i++) {
    if (range < UNUSED.length && i === UNUSED[range][0]) {
      i = UNUSED[range++][1] - 1;
      continue;
    }
    hash = Math.imul(hash ^ bytes[i], 16777619);
  }
  return hash >>> 0;
}

export function encodeState(bytes) {
  let text = '';
  for (let offset = 0; offset < bytes.length; offset += 32768) {
    text += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
  }
  return btoa(text);
}

export function decodeState(text) {
  if (typeof text !== 'string' || text.length !== 5941964) throw new Error('Invalid snapshot size');
  const raw = atob(text), bytes = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  canonicalStateDigest(bytes); // Pinned format guard, before passing to native code.
  return bytes;
}

export function captureState(module, saveStateInfo) {
  const [sizeText, pointerText, success] = saveStateInfo().split('|');
  const size = Number(sizeText), pointer = Number(pointerText);
  if (success !== '1' || !Number.isSafeInteger(size) || !Number.isSafeInteger(pointer) ||
      size !== 4456472 || pointer < 1 || pointer + size > module.HEAPU8.length) throw new Error('Core snapshot capture failed');
  // Pinned frontend 6dd4353 retains save_data and frees it on the next call.
  // The JS side owns only this copy; freeing pointer here would double-free.
  return module.HEAPU8.slice(pointer, pointer + size);
}
