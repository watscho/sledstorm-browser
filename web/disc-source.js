import { identifyDisc } from './disc-identity.js';
import { chosenDisc } from './local-disc.js';

// Where a player's disc comes from (brief §11.2, D87): their own CUE and BIN files, a ZIP they saved,
// or the server's download where the session offers it. The room compares the disc, not its source.

const isHash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);

/** The sources a session offers: the download only where the server gives the disc away (D73). */
export function offeredSources(info) {
  return info.discMode === 'shared' ? ['files', 'zip', 'download'] : ['files', 'zip'];
}

/**
 * The source chosen first (D87): the last one chosen on this address while offered, else the kind of a
 * copy remembered there (`remembered`, restoreCopy), else the download, else the files.
 */
export function initialSource(offered, last, remembered) {
  if (offered.includes(last)) return last;
  if (offered.includes(remembered)) return remembered;
  return offered.includes('download') ? 'download' : 'files';
}

/**
 * Refuses a disc that is not the room's when the session info names the room's disc (D74, D89). The
 * Python launcher's local mode names none, and the room then compares the players' identities.
 */
export function checkRoomDisc(info, disc) {
  if (isHash(info.disc) && disc !== info.disc)
    throw new Error('These game files are not the disc this room plays. Use the host\'s CUE and BIN files under the same names, or a ZIP of them.');
}

/** What a chosen disc keeps in the browser's blob store while the game runs (D86, D90). */
export const heldBytes = files => files.reduce((sum, file) => sum + (file.held ?? 0), 0);

/**
 * The disc of the files a player chose, with its identity: the exact copy of the room's archive as
 * `{ archive, disc, pal }` with the session info's identity (D74), any other choice as
 * `{ files, disc, pal, held }`, identified here and checked against the room's disc. `null` when
 * nothing is chosen. A refusal is final: no other source is tried.
 */
export async function copyDisc(list, info, report = () => {}) {
  const chosen = await chosenDisc(list, info.archive, report);
  if (!chosen) return null;
  if (chosen.archive) return { archive: chosen.archive, disc: info.disc, pal: info.pal };
  const { disc, pal } = await identifyDisc(chosen.files, report);
  checkRoomDisc(info, disc);
  return { files: chosen.files, disc, pal, held: heldBytes(chosen.files) };
}

// A copy chosen through the browser's picker is remembered for this address by its handles and the
// identity they gave (D88): no disc bytes go into the browser's storage. A store is
// `{ get(key), put(key, value), delete(key) }` (web/game-data-folder.js, gameDataStore).
const SOURCE = 'source';
// Wrapper 1.0 kept a Quick Tunnel's saved ZIP as `{ sha256, handle }` (its archive's checksum).
const LEGACY = 'selected';
const READ = { mode: 'read' };

/** Keeps a verified copy for this address. A browser that refuses storage still plays this time. */
export async function rememberCopy(store, { kind, handles, disc }) {
  try { await store.put(SOURCE, { kind, handles, disc }); }
  catch { /* Nothing is remembered; the player chooses again next time. */ }
}

/**
 * The copy chosen earlier on this address: `{ kind, handles, files }` when read access holds, so it is
 * used without a picker; `{ kind, handles }` when the browser must ask again, which Join does with its
 * click (reopenCopy); null when there is none, it was another disc, access was refused or a file is gone.
 */
export async function restoreCopy(store, info) {
  try {
    let record = await store.get(SOURCE);
    if (!record) {
      const legacy = await store.get(LEGACY);
      if (!legacy?.handle || !info.archive || legacy.sha256 !== info.archive.sha256) return null;
      record = { kind: 'zip', handles: [legacy.handle] };
    }
    const { kind, handles, disc } = record;
    if (!['files', 'zip'].includes(kind) || !Array.isArray(handles) || !handles.length) return null;
    if (isHash(disc) && isHash(info.disc) && disc !== info.disc) return null;
    const states = await Promise.all(handles.map(handle => handle.queryPermission(READ)));
    if (states.some(state => state !== 'granted' && state !== 'prompt')) return null;
    if (states.includes('prompt')) return { kind, handles };
    return { kind, handles, files: await Promise.all(handles.map(handle => handle.getFile())) };
  } catch { return null; }
}

/**
 * Asks again for read access to a remembered copy; call it first in the click of `button` (the launch
 * button's words, or the saved games list's), for its activation. A refusal may be retried; a file that
 * can no longer be read throws an error marked `gone`, and that copy must be chosen again.
 */
export async function reopenCopy({ kind, handles }, button = 'Join game') {
  const zip = kind === 'zip';
  for (const handle of handles) {
    if (await handle.queryPermission(READ) === 'granted') continue;
    if (await handle.requestPermission(READ) !== 'granted')
      throw new Error(`Allow access to ${zip ? 'your saved ZIP' : 'your game files'} to play. You can retry with ${button}.`);
  }
  try { return await Promise.all(handles.map(handle => handle.getFile())); }
  catch {
    throw Object.assign(new Error(zip
      ? 'Your saved ZIP was moved, renamed or deleted since you chose it. Choose it again.'
      : 'Your game files were moved, renamed or deleted since you chose them. Choose them again.'), { gone: true });
  }
}
