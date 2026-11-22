import { checkDiscSize, cueTrackNames, nameKey } from './disc-sheet.js';
import { discFromZip } from './disc-zip.js';

/**
 * What the player chose in the game files field: their own CUE and BIN files (`{ files }`), or one ZIP
 * of them, read and checked in the page (`{ files }`, DATA-03) unless it is the exact copy of the
 * room's archive (`{ archive }`, D74). `archive` is the manifest that the session info announces, or
 * null. A ZIP's refusal is final: no other source is tried.
 */
export async function chosenDisc(list, archive, report = () => {}) {
  const files = Array.from(list);
  if (!files.length) return null;
  const zips = files.filter(file => /\.zip$/i.test(file.name));
  if (!zips.length) return { files: await selectedDisc(files) };
  if (files.length > 1) throw new Error('Choose either one ZIP or your CUE and all its BIN tracks.');
  return discFromZip(zips[0], archive, report);
}

// The player's own CUE and BIN files: the disc that the server would take from a folder holding them
// (web/disc-sheet.js), in the order its identity counts, each track named as the CUE spells it.
export async function selectedDisc(list) {
  if (!list.length) return null;
  const files = Array.from(list);
  const cues = files.filter((file) => /\.cue$/i.test(file.name));
  if (cues.length !== 1) throw new Error('Select one CUE and all its BIN tracks together');
  const cue = cues[0];
  checkDiscSize([cue.size]);
  const tracks = cueTrackNames(await cue.text(), cue.name).map((name) => {
    const matching = files.filter((file) => file !== cue && nameKey(file.name) === nameKey(name));
    if (!matching.length) throw new Error(`Missing local track: ${name}`);
    if (matching.length > 1) throw new Error(`Two chosen files match the track ${name}`);
    return { name, size: matching[0].size, data: matching[0] };
  });
  checkDiscSize([cue.size, ...tracks.map((track) => track.size)]);
  return [{ name: cue.name, size: cue.size, data: cue }, ...tracks];
}

// A gateway that refuses the disc says so with `X-Sled-Disc: local` (D73). The body comes from the
// origin behind it, which still serves the archive on its loopback address, so the header wins.
export function sessionDiscMode(info, gatewayDisc) {
  return gatewayDisc === 'local' ? 'local' : info.discMode;
}
