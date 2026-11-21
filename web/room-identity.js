// The identity of a room: what two emulators must have in common to play one
// game together. The server computes it for its room and every player's page
// computes it for itself; a player whose identity differs is not let in.
//
// It is made from a fixed, versioned list of fields. How the disc reaches a
// player is not among them: no archive checksum, no disc policy, no address.
// Whatever else an input carries, and the order of its keys, does not count.
// Changing the list or the form below changes every identity, so it comes with
// a new protocol name and a new invitation version.
export const invitationVersion = 8;
export const roomProtocol = 'retroarch-netplay-v8';

const sha256 = /^[a-f0-9]{64}$/;
const isHash = value => typeof value === 'string' && sha256.test(value);

/** The canonical text that is hashed. Throws when a listed field is missing or mistyped. */
export function roomIdentityText({ disc, core, adapter, native, bios, options } = {}) {
  const need = (valid, field) => {
    if (!valid) throw new Error(`The room identity needs a valid ${field}.`);
  };
  need(isHash(disc), 'disc');
  need(isHash(core), 'core');
  need(typeof adapter === 'string' && adapter !== '', 'adapter');
  need(typeof native === 'object' && native !== null && !Array.isArray(native), 'native build');
  const files = Object.entries(native).sort(([first], [second]) => (first < second ? -1 : first > second ? 1 : 0));
  need(files.length > 0 && files.every(([, hash]) => isHash(hash)), 'native build');
  need(bios === 'HLE' || isHash(bios), 'BIOS');
  need(typeof options === 'object' && options !== null, 'room options');
  const { progress, camera, nativeCamera } = options;
  need(['all', 'original'].includes(progress) && typeof camera === 'boolean' && (nativeCamera !== true || camera), 'room options');
  return JSON.stringify(['sled-room-identity', 1, roomProtocol, disc, core, adapter, files, bios, progress, camera, nativeCamera === true]);
}

/** Resolves to 64 hexadecimal digits. */
export async function roomIdentity(input) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(roomIdentityText(input)));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
