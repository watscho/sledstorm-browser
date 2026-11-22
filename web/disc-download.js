// "Download from server" (D96 to D98): the room's archive as the server's chunks (D92), two requests at a time, each
// chunk checked for its manifest length and SHA-256 before the part store counts it (web/disc-parts.js), so a reload
// or a cut on the same origin fetches only what is missing. Where the manifest answers 404 (the Python launcher),
// the whole /disc.zip is downloaded as before.
import { openPartStore, partLength } from './disc-parts.js';

/** Requests at once per page (brief §11.4). */
export const CONCURRENCY = 2;
/** The longest wait for an answer to begin: a guest's request may wait in the host's queue meanwhile (D94). */
export const ANSWER_DEADLINE_MS = 300_000;
/** The longest gap between two pieces of an answer that has begun. */
export const STALL_DEADLINE_MS = 45_000;
/** The longest one chunk waits in all for answers that do not begin (the host's queue, a proxy's timeout). */
export const WAIT_BUDGET_MS = 1_800_000;
const WAIT_RETRY_MS = 1000;
/** The largest chunk the page takes from a manifest: two of them are in memory at once (the server's are 8 MiB, D92). */
export const MAX_CHUNK_SIZE = 64 * 1024 * 1024;
/** Failures in a row of one chunk that stop the download; its checked parts stay for a reload. */
export const MAX_FAILURES = 4;
const RETRY_DELAYS = [1000, 2000, 4000];
/** How many times one download follows the server to another archive of the same disc. */
const MAX_ARCHIVE_SWITCHES = 2;

const CHANGED = "The server's game data changed. Reload the invitation to try again.";
const HOST_CHANGED = "The host's game files changed. Ask the host to start hosting again, then reload the invitation.";
const STOPPED = 'Game data stopped downloading. Reload the invitation to continue.';
/** The stop of a download that saved nothing: a reload starts over (D101). */
const STOPPED_OVER = 'Game data stopped downloading. Reload the invitation to try again.';
const UNAVAILABLE = 'Could not download the game disc. Reload the invitation to try again.';

/** The sentences a stopped download shows; any other error is shown as a stop. */
const SENTENCES = new Set([CHANGED, HOST_CHANGED, STOPPED, STOPPED_OVER, UNAVAILABLE]);
/** A stop promises to continue only where the parts are saved (D101). */
const stopped = store => store?.persistent ? STOPPED : STOPPED_OVER;

const WONT_SAVE = ' · this browser does not save it, a reload starts over';
/** What the progress lines add for each reason the part store gives (D100, D101). */
const NOTES = {
  unsupported: WONT_SAVE,
  unavailable: WONT_SAVE,
  quota: ' · too little browser storage to save it, a reload starts over',
  busy: ' · another tab holds the saved download, a reload here starts over',
  full: ' · browser storage is full, a reload fetches the unsaved part again',
};
/** Read at every line: the persistent store's reason changes when the private file system refuses a write. */
const noteOf = store => NOTES[store.reason] ?? '';

/** A failure of one request that is asked again. */
class Failure extends Error {}
/** An answer that did not begin: the request waited in the host's queue too long, or a proxy gave up waiting for the
 *  server (504, 524). Asked again without counting as a failure, within the chunk's wait budget. */
class Wait extends Error {}
/** A busy server's answer: wait `ms`, then ask again; never a failure (D94). */
class Pause extends Error {
  constructor(ms) { super('The server is busy.'); this.ms = ms; }
}
/** The server now offers another archive of the same disc. */
class ArchiveChanged extends Error {
  constructor(manifest) { super(CHANGED); this.manifest = manifest; }
}

function sleep(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', abort); resolve(); }, ms);
    signal?.addEventListener('abort', abort, { once: true });
  });
}

function settings(options) {
  return {
    fetch: options.fetch ?? ((...args) => globalThis.fetch(...args)),
    openStore: options.openStore ?? openPartStore,
    report: options.report ?? (() => {}),
    sleep: options.sleep ?? sleep,
    deadlines: { answer: ANSWER_DEADLINE_MS, stall: STALL_DEADLINE_MS, wait: WAIT_BUDGET_MS, ...options.deadlines },
    retryDelays: options.retryDelays ?? RETRY_DELAYS,
  };
}

const HEX = /^[0-9a-f]{64}$/;
const isHash = value => typeof value === 'string' && HEX.test(value);
const isCount = value => Number.isSafeInteger(value) && value > 0;

/** Whether the manifest is version 1 of the session's disc, with an archive whose chunks fit its size. */
function fitsSession(manifest, info) {
  const archive = manifest?.archive;
  return manifest.version === 1 && typeof manifest.disc === 'string' && manifest.disc === info.disc
    && manifest.pal === info.pal && Boolean(archive) && isHash(archive.sha256) && isCount(archive.size)
    && isCount(archive.chunkSize) && archive.chunkSize <= MAX_CHUNK_SIZE && Array.isArray(archive.chunks)
    && archive.chunks.length === Math.ceil(archive.size / archive.chunkSize) && archive.chunks.every(isHash);
}

/** The manifest, or null where the server has no chunk routes (404). Anything else unexpected is a Failure; so is
 *  `signal`'s abort (a download that stops does not wait for the manifest). */
async function readManifest(o, signal) {
  const request = new AbortController();
  const abort = () => request.abort();
  const timer = setTimeout(abort, o.deadlines.answer);
  if (signal?.aborted) abort();
  signal?.addEventListener('abort', abort, { once: true });
  try {
    const response = await o.fetch('/game-data/manifest', { cache: 'no-store', signal: request.signal });
    if (response.status === 404) {
      response.body?.cancel().catch(() => {});
      return null;
    }
    if (response.status !== 200) {
      response.body?.cancel().catch(() => {});
      throw new Failure(UNAVAILABLE);
    }
    try { return (await response.json()) ?? {}; }
    catch (error) {
      if (request.signal.aborted) throw new Failure(UNAVAILABLE);
      return {};
    }
  } catch (error) {
    if (error instanceof Failure) throw error;
    throw new Failure(UNAVAILABLE);
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

/** The mark the listener puts on its 503 for game files changed since they were prepared (D92, D102); a proxy's 503
 *  has none. */
const hostChanged = response => response.headers.get('X-Sled-Game-Files') === 'changed';

function retryAfterMs(value) {
  const seconds = /^\d+$/.test(value.trim()) ? Number(value) : 2;
  return Math.min(30, Math.max(1, seconds)) * 1000;
}

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Runs `work(index, signal)` over `indices` with `count` workers; the first error stops the others and is thrown
 *  once every worker has settled, so nothing writes after it. */
async function runWorkers(indices, count, work) {
  const queue = [...indices];
  const stop = new AbortController();
  let failure;
  const worker = async () => {
    while (!stop.signal.aborted && queue.length) {
      const index = queue.shift();
      try { await work(index, stop.signal); }
      catch (error) {
        if (!failure) {
          failure = error;
          stop.abort(error);
        }
        return;
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(count, queue.length) }, worker));
  if (failure) throw failure;
}

/** Fetches what `store` lacks of `archive`, checks the whole archive and returns it as one File (D96, D98). */
async function fetchArchive(info, archive, store, o) {
  const received = new Map();
  let doneBytes = 0;
  let shown = -1;
  let busy = false;
  const progress = () => {
    let bytes = doneBytes;
    for (const value of received.values()) bytes += value;
    const percent = Math.min(100, Math.floor(bytes * 100 / archive.size));
    if (percent === shown && !busy) return;
    shown = percent;
    o.report((busy ? `The server is busy · waiting to continue · ${percent}%` : `Downloading game data · ${percent}%`)
      + noteOf(store));
  };

  // A chunk's 404 reads the manifest again, once for every worker that meets it at the same time. Both workers share
  // one stop signal, which ends that read too.
  let reread;
  async function followManifest(signal) {
    reread ??= readManifest(o, signal).finally(() => { reread = undefined; });
    const next = await reread;
    if (!next || !fitsSession(next, info)) throw new Error(CHANGED);
    if (next.archive.sha256 === archive.sha256) throw new Failure('The chunk was not found.');
    throw new ArchiveChanged(next);
  }

  async function requestPart(index, signal) {
    if (signal.aborted) throw signal.reason;
    const length = partLength(archive, index);
    const request = new AbortController();
    const abort = () => request.abort();
    signal.addEventListener('abort', abort, { once: true });
    // Until the answer begins, the request may wait in the host's queue: only the long answer deadline applies.
    let timer = setTimeout(abort, o.deadlines.answer);
    const stalling = () => {
      clearTimeout(timer);
      timer = setTimeout(abort, o.deadlines.stall);
    };
    try {
      let response;
      try {
        response = await o.fetch(`/game-data/${archive.sha256}/chunks/${index}`, { cache: 'no-store', signal: request.signal });
      } catch {
        // Cut by the answer deadline while it waited, not by a stop: the host's queue was long.
        if (request.signal.aborted && !signal.aborted) throw new Wait('No answer began.');
        throw new Failure('The request failed.');
      }
      if (response.status !== 200 || !response.body) {
        response.body?.cancel().catch(() => {});
        const retryAfter = response.headers.get('Retry-After');
        // By its headers alone: the host's changed game files stop the download, the host's busy limit is a pause, and
        // any other 503 (a proxy's) is a failure, asked again (D102).
        if (hostChanged(response)) throw new Error(HOST_CHANGED);
        if (response.status === 503 && retryAfter !== null) throw new Pause(retryAfterMs(retryAfter));
        if (response.status === 504 || response.status === 524) throw new Wait(`A proxy answered ${response.status}.`);
        if (response.status === 404) await followManifest(signal);
        throw new Failure(`The server answered ${response.status}.`);
      }
      stalling();
      // The length is the manifest's: the gateway streams a chunk without Content-Length (D95).
      const bytes = new Uint8Array(length);
      let filled = 0;
      const reader = response.body.getReader();
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          stalling();
          if (filled + value.byteLength > length) throw new Failure('The chunk is longer than the manifest says.');
          bytes.set(value, filled);
          filled += value.byteLength;
          received.set(index, filled);
          progress();
        }
      } catch (error) {
        reader.cancel().catch(() => {});
        throw error instanceof Failure ? error : new Failure('The chunk stopped arriving.');
      }
      if (filled !== length) throw new Failure('The chunk is shorter than the manifest says.');
      if (await sha256Hex(bytes) !== archive.chunks[index]) throw new Failure('The chunk does not match the manifest.');
      return bytes;
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    }
  }

  async function fetchPart(index, signal) {
    // Pauses and waits neither count as failures nor end a run of them.
    let waited = 0;
    for (let failures = 0; ;) {
      const asked = Date.now();
      try {
        const bytes = await requestPart(index, signal);
        try { await store.put(index, bytes); }
        catch { throw new Failure('The chunk could not be kept.'); }
        received.delete(index);
        doneBytes += bytes.byteLength;
        busy = false;
        progress();
        return;
      } catch (error) {
        received.delete(index);
        if (signal.aborted) throw signal.reason;
        if (error instanceof Pause) {
          busy = true;
          progress();
          await o.sleep(error.ms, signal);
          busy = false;
          continue;
        }
        if (error instanceof Wait) {
          waited += Date.now() - asked;
          if (waited >= o.deadlines.wait) throw new Error(stopped(store));
          await o.sleep(WAIT_RETRY_MS, signal);
          continue;
        }
        if (!(error instanceof Failure)) throw error;
        failures += 1;
        if (failures >= MAX_FAILURES) throw new Error(stopped(store));
        await o.sleep(o.retryDelays[Math.min(failures, o.retryDelays.length) - 1], signal);
      }
    }
  }

  const kept = new Set(await store.kept());
  for (const index of kept) doneBytes += partLength(archive, index);
  let missing = archive.chunks.map((_, index) => index).filter(index => !kept.has(index));
  o.report('Downloading game data…' + noteOf(store));
  for (let check = 0; ; check++) {
    await runWorkers(missing, CONCURRENCY, fetchPart);
    // The whole archive is checked chunk by chunk before it is handed over: a part changed on disk after it was
    // counted is dropped and fetched again, once (D98).
    o.report('Checking game data…');
    const file = await store.file();
    // Parts are kept at their manifest lengths, so this is a part changed on disk while the page was open; a reload
    // drops it when the store opens.
    if (file.size !== archive.size) throw new Error(stopped(store));
    missing = [];
    for (const [index, expected] of archive.chunks.entries()) {
      const offset = index * archive.chunkSize;
      const bytes = await file.slice(offset, offset + partLength(archive, index)).arrayBuffer();
      if (await sha256Hex(bytes) !== expected) missing.push(index);
    }
    if (!missing.length) return file;
    if (check === 1) throw new Error(CHANGED);
    for (const index of missing) {
      await store.drop(index);
      doneBytes -= partLength(archive, index);
    }
  }
}

/**
 * The server's disc as one File: chunked where the manifest answers (`chunked: true`; `discard` removes the parts
 * once the emulator holds the disc, D99), the whole /disc.zip where it answers 404. `info` is the session info whose
 * `disc` and `pal` the room was checked with. Errors carry a sentence for the player.
 */
export async function downloadDisc(info, options = {}) {
  const o = settings(options);
  let manifest;
  try { manifest = await readManifest(o); }
  catch { throw new Error(UNAVAILABLE); }
  if (!manifest) return { file: await downloadWhole(options), chunked: false, discard: async () => {} };
  if (!fitsSession(manifest, info)) throw new Error(CHANGED);
  let store;
  try {
    for (let switches = 0; ; switches++) {
      store = await o.openStore(manifest.archive);
      try {
        const file = await fetchArchive(info, manifest.archive, store, o);
        return { file, chunked: true, discard: () => store.remove() };
      } catch (error) {
        if (!(error instanceof ArchiveChanged)) throw error;
        // The parts of the archive the server no longer offers go; they never join the new one's (D97).
        await store.remove();
        if (switches === MAX_ARCHIVE_SWITCHES) throw new Error(CHANGED);
        manifest = error.manifest;
      }
    }
  } catch (error) {
    // A storage error is no sentence for the player: the download stopped, and its checked parts stay where saved.
    throw SENTENCES.has(error?.message) ? error : new Error(stopped(store));
  }
}

/** The whole /disc.zip: no stall deadline before the answer begins, only the answer deadline (D96). */
export async function downloadWhole(options = {}) {
  const o = settings(options);
  o.report('Downloading game data…');
  const transfer = new AbortController();
  let deadline, blob, expectedSize;
  const arm = ms => {
    clearTimeout(deadline);
    deadline = setTimeout(() => transfer.abort(), ms);
  };
  try {
    arm(o.deadlines.answer);
    const response = await o.fetch('/disc.zip', { cache: 'no-store', signal: transfer.signal });
    if (response.status !== 200) throw new Error(hostChanged(response) ? HOST_CHANGED : UNAVAILABLE);
    arm(o.deadlines.stall);
    expectedSize = Number(response.headers.get('x-sledstorm-disc-size') ?? response.headers.get('content-length'));
    let received = 0, shown = -1;
    const stream = response.body?.pipeThrough(new TransformStream({
      transform(chunk, controller) {
        received += chunk.byteLength;
        arm(o.deadlines.stall);
        const progress = expectedSize ? `${Math.min(100, Math.floor(received * 100 / expectedSize))}%`
          : `${Math.floor(received / 1048576)} MiB`;
        if (progress !== shown) o.report(`Downloading game data · ${progress}`);
        shown = progress;
        controller.enqueue(chunk);
      },
    }));
    blob = stream ? await new Response(stream).blob() : await response.blob();
  } catch (error) {
    if (transfer.signal.aborted) throw new Error(STOPPED_OVER);
    if (error instanceof TypeError) throw new Error('The game data download was interrupted. Reload the invitation to try again.');
    throw error;
  } finally {
    clearTimeout(deadline);
  }
  if (!blob.size || (expectedSize && blob.size !== expectedSize)) {
    throw new Error('The game disc download is incomplete. Reload the invitation to try again.');
  }
  return new File([blob], 'disc.zip');
}
