const utf8 = new TextEncoder();
const hex = (bytes) => Array.from(bytes, (n) => n.toString(16).padStart(2, '0')).join('');
export async function selectedDisc(list) {
  if (!list.length) return null;
  const files = Array.from(list);
  const cues = files.filter((file) => /\.cue$/i.test(file.name));
  if (cues.length !== 1) throw new Error('Select one CUE and all its BIN tracks together');
  const cue = cues[0];
  const names = Array.from((await cue.text()).matchAll(/^FILE "([^"]+)" BINARY\s*$/gm), (match) => match[1]);
  if (names.length !== 11 || new Set(names).size !== names.length)
    throw new Error('This build requires the audited Europe CUE with eleven BIN tracks');
  const tracks = names.map((name) => {
    const track = files.find((file) => file.name === name);
    if (!track) throw new Error(`Missing local track: ${name}`);
    return track;
  });
  return [cue, ...tracks].map((data) => ({ name: data.name, size: data.size, data }));
}
export async function localDiscIdentity(files, bios, onProgress) {
  const parts = [utf8.encode('SledStorm-PAL-disc-and-OpenBIOS-v2')];
  for (const [i, file] of [...files, { name: 'openbios.bin', size: bios.length, data: new Blob([bios]) }].entries()) {
    onProgress(`Verifying local file ${i + 1}/${files.length + 1}: ${file.name}`);
    const length = new Uint8Array(8);
    new DataView(length.buffer).setBigUint64(0, BigInt(file.size), true);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', await file.data.arrayBuffer()));
    parts.push(utf8.encode(file.name), length, digest);
  }
  const total = parts.reduce((n, part) => n + part.length, 0);
  const wire = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) { wire.set(part, offset); offset += part.length; }
  return hex(new Uint8Array(await crypto.subtle.digest('SHA-256', wire)));
}
