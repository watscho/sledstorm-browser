// The rules of a disc, shared by the server (through server/src/network.ts) and the page, so that both
// take the same discs and give them the same identity whatever the source: a CUE sheet whose
// `FILE "…" BINARY` lines name its tracks beside it, matched by name in NFC and lower case (D75 to D77).

/** The largest CUE sheet read; a sheet of 99 tracks with CD-Text is a few kilobytes. */
export const CUE_LIMIT = 1024 * 1024;
/** A CD holds at most 99 tracks, so a sheet names at most 99 files. */
export const TRACK_LIMIT = 99;
/** The CUE and its tracks together: a 99-minute CD read raw is 1,047,816,000 bytes. */
export const DISC_LIMIT = 1024 ** 3;

export class DiscSheetError extends Error {}

/** The key a track's name is matched by, as a macOS volume matches names by default. */
export const nameKey = name => name.normalize('NFC').toLowerCase();

// A control character other than a tab, a line end or the end-of-file mark of old DOS editors (D85).
// Each archive that the emulator's own extractor takes (ZIP, 7z, RAR) has one in its first six bytes,
// so a sheet that is text is never unpacked by it.
const NOT_TEXT = /[\x00-\x08\x0b\x0c\x0e-\x19\x1b-\x1f]/;
// A track's name holds no control character at all, as no name in a player's ZIP does (D80).
const CONTROL = /[\x00-\x1f\x7f-\x9f]/;

/** The names of the CUE's tracks, in its order, spelled as it spells them. `cueName`, the CUE's own file
 *  name, is never one of them. */
export function cueTrackNames(text, cueName) {
  if (NOT_TEXT.test(text)) throw new DiscSheetError('The CUE file is not a text file.');
  // Some editors start the file with a byte order mark. The page's decoder removes one and the
  // server's none, so every leading mark goes.
  let start = 0;
  while (text.charCodeAt(start) === 0xfeff) start++;
  const sheet = text.slice(start);
  const names = Array.from(sheet.matchAll(/^FILE "([^"]+)" BINARY\s*$/gm), match => match[1]);
  if (!names.length) throw new DiscSheetError('The CUE file lists no BINARY tracks.');
  if (names.length > TRACK_LIMIT) throw new DiscSheetError(`The CUE file lists more than ${TRACK_LIMIT} tracks.`);
  const listed = new Set();
  for (const name of names) {
    if (CONTROL.test(name)) throw new DiscSheetError('The CUE file names a track with a control character in its name.');
    // A name read from the CUE is never a path.
    if (/[\\/]/.test(name)) throw new DiscSheetError(`The CUE file refers to a file outside its folder: ${name}`);
    const key = nameKey(name);
    if (cueName !== undefined && key === nameKey(cueName)) throw new DiscSheetError(`The CUE file lists itself as a track: ${name}`);
    if (listed.has(key)) throw new DiscSheetError(`The CUE file lists a track twice: ${name}`);
    listed.add(key);
  }
  return names;
}

/** `sizes`: the CUE's size, then its tracks'. The CUE's alone may be checked before its tracks are known. */
export function checkDiscSize(sizes) {
  if (sizes[0] > CUE_LIMIT) throw new DiscSheetError('The CUE file is larger than 1 MiB.');
  if (sizes.reduce((total, size) => total + size, 0) > DISC_LIMIT)
    throw new DiscSheetError('The game files are larger than a CD (1 GiB).');
}
