# P5 slice 2: the page's resumable download

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** "Download from server" fetches the room's archive as the chunks of slice 1, two at a time, checks each chunk's length and SHA-256 before it counts it, keeps the checked chunks in the origin private file system with the progress in IndexedDB, and after a reload or a cut on the same origin fetches only what is missing; where the manifest answers 404 (the Python launcher) it keeps the whole `/disc.zip`. DATA-05 and DATA-06 in the page.

**Architecture:** Two new page modules. `web/disc-parts.js` is the store of one archive's checked chunks: files `sledstorm-parts/<archiveSha256>/<index>` in the origin private file system, each written whole and committed before the progress record in IndexedDB (`sledstorm-disc-parts`, store `progress`, keyed by the archive's SHA-256) lists it; without either, the same interface in memory. `web/disc-download.js` is the protocol: read and check the manifest, fetch the missing chunks with two workers, check each one, pause on a busy server, follow a changed archive, check the whole archive at the end and hand back one `File` made of the parts; it also holds the whole `/disc.zip` download that `web/app.js` has today. `web/app.js` calls it from `sharedDiscFile` and removes the parts once the emulator holds the disc.

**Tech Stack:** Plain ES modules in the browser; `fetch` with a stream reader, `crypto.subtle.digest`, `navigator.storage.getDirectory()` and `FileSystemFileHandle.createWritable()`, IndexedDB. Tests with `node --test web/*.test.mjs` on Node's own `fetch`, `Response`, `Blob`, `File` and `crypto.subtle`, with stand-ins for the private file system and the record store; the browser APIs themselves are checked by hand in the pinned Chromium.

**Spec:** the owner's brief "Sled Storm Server — Node SEA", sections 11.4 (client algorithm steps 1 to 5), 11.5 and 15.2 (DATA-05, DATA-06), outside the repository; `docs/sea-server-plan.md`, "P5 Resumable delivery" and D92 to D95.

**Review base:** the state that slice 1 left, the ignored file `.superpowers/sdd/p5-slice-1-tree.tar`. On 2026-11-22 at 09:50, before the first change of this slice, all 227 files that Git does not ignore were equal to it. A commit of P3 to P5, if the owner asks for one, replaces it.

## Global Constraints

- No push, no release, no published binary. No per-task commit; the owner commits.
- Code, comments and committed documents in English. The owner is answered in Russian.
- The game disc, its hashes, private links, room identifiers, public host names and every token stay out of Git, logs, the status and standard output. Fixtures are synthetic bytes.
- No automated test starts the real Chromium, a tunnel, the network, the user's browser or a system dialog (D44, D49).
- The server, its routes, the archive's bytes and hashes, the chunk size (8 MiB), the disc identity and the room identity do not change in this slice.
- Under `local-only` the page never asks for the server's disc (DATA-01); nothing here changes which sources are offered.
- The client algorithm of brief §11.4: check the manifest and find checked parts of the same archive ID; ask only for missing chunks, 2 at a time per client; check SHA-256 and length before a part counts; save parts and update the progress record atomically, fetch corrupt ones again; at the end check the whole archive and hand it to the existing loader.
- Memory stays bounded: a chunk in flight is one buffer of its manifest length; the finished archive is a `File` over the stored parts, never a second copy in memory (brief §11.4). The emulator's own load of the whole disc stays a separate cost.
- Resume after a new Quick Tunnel host name is not promised (brief §11.5); this slice adds no text that suggests it. The portable ZIP from the parts, the quota, refused persistence, a missing private file system's warning and 1.1.0's Cache Storage copy are slice 3.

## Decisions taken with this plan

1. **The downloader's protocol (D96).** `GET /game-data/manifest` with `cache: 'no-store'`. A 404 means the server has no chunk routes (the Python launcher, `tools/play-online.py`): the page downloads the whole `/disc.zip` as today. Any other status, a network error or no answer within the answer deadline stops with `Could not download the game disc. Reload the invitation to try again.`, the whole download's message for a refused `/disc.zip`. A manifest counts only with `version: 1`, a `disc` and `pal` equal to the session info's (the identity the room was checked with), and an archive whose `sha256` and every chunk hash are 64 lowercase hex characters, whose `size` and `chunkSize` are positive safe integers, whose `chunkSize` is at most 64 MiB (`MAX_CHUNK_SIZE`; two chunks are in memory at once) and whose chunk count is `ceil(size / chunkSize)`; otherwise the download stops with `The server's game data changed. Reload the invitation to try again.` Missing chunks are fetched by two workers in index order from `/game-data/<sha256>/chunks/<index>`; a chunk's length is the manifest's (`min(chunkSize, size − index × chunkSize)`), read into one buffer of that length, so a longer or shorter answer is a failure. The time before an answer is the server's queue (D94): it has no stall deadline, only a cap of 5 minutes; once the answer has begun, 45 s without a byte is a stall (the deadline the whole download has today). A 503 with `Retry-After` is a pause of that many seconds, held between 1 and 30, which never counts as a failure; a 503 without it is the server's changed game files (D92) and stops the download with `The host's game files changed. Ask the host to start hosting again, then reload the invitation.` A request that the answer deadline cut before its answer began, or that a proxy answered with 504 or 524 (it gave up waiting for the server's answer), is a wait: it is asked again after 1 s and never counts as a failure, until the chunk has waited 30 minutes in all (`WAIT_BUDGET_MS`), which stops the download with `Game data stopped downloading. Reload the invitation to continue.` A 404 for a chunk reads the manifest again: the same archive counts as a failure of that chunk; another archive with the same `disc` and `pal` starts the download over on it (the old archive's parts are removed, never mixed), at most twice per download; anything else, a third archive or a manifest that now answers 404, stops it as a changed manifest does. Two workers that meet a 404 at once share one reading of the manifest, which a stop aborts. A network error, a stall, a wrong length, a wrong hash, another status or a part store that refuses the write is a failure of that chunk; it is asked again after 1, 2 and 4 s, and its fourth failure in a row stops the download with `Game data stopped downloading. Reload the invitation to continue.`, keeping every checked part. Pauses and waits neither count as failures nor end a run of them. Any other error of the chunked download (a storage error) reaches the player as that sentence, the parts kept. The whole `/disc.zip` gets the same deadlines (none before the answer but the cap, 45 s stall after). Cost if wrong: over a Quick Tunnel the edge answers 524 after about 100 s without an answer, so a request waits that long before it is asked again, at the back of the host's queue; a dead host behind an edge that answers 524 keeps a guest waiting up to 30 minutes per chunk (a host that is gone answers 502 at once, a failure). P6 measures the constants, which are exported from `web/disc-download.js`. The waits and their budget, the 64 MiB bound, the stopped message for storage errors and the run of failures across pauses came from the review (I2, m2, m5, m6).
2. **Where the parts live (D97).** The parts are files `<index>` in the directory `sledstorm-parts/<archiveSha256>` of the origin private file system, each written with `createWritable()` and committed by `close()`; only then is its index added to the progress record, one IndexedDB record per archive in database `sledstorm-disc-parts` (version 1, store `progress`, key the archive's SHA-256, value `{ size, chunkSize, chunks, done }`, `done` the sorted indices). A part on disk that the record does not list is not counted; a listed part whose file is missing or of another length is dropped from the record when the store opens. Record writes are made one after another from one in-memory copy, so two parts finished at once are both listed. A part whose length is not the manifest's is never kept. Opening the store for one archive removes every other archive's directory and record: an origin keeps the parts of one archive, and parts of two archives are never combined. One page of the origin holds the stored parts at a time, with a Web Lock (`sledstorm-disc-parts`, asked with `ifAvailable`, released by `remove()` or when the page unloads); a page that does not get it keeps its parts in memory, as below, and touches neither the directory nor the record. Where the private file system, `createWritable` or IndexedDB is missing or refuses when the store opens, the parts are kept in memory with the same interface and `persistent: false`: the download still checks every chunk and survives a cut while the page stays open, but not a reload (slice 3 tells the player so). A checked part that the private file system refuses to keep later (its quota, a full disk) stays in memory for that page, never listed: the download goes on, and a reload fetches that part again. Cost if wrong: a second tab of the same invitation downloads into memory and does not survive its own reload; parts kept in memory cost the browser's memory, as 1.1.0's whole download did. The lock and the parts kept in memory after a refused write came from the review (m1, I1).
3. **The whole archive is checked before it is handed over (D98).** When every part is counted, the page builds one `File` from the stored parts in order, refuses it with `Game data stopped downloading. …` unless its size is the archive's (the review's m3), and checks every chunk's SHA-256 over it, one chunk in memory at a time, as `matchingGameArchive` does for a saved ZIP (D74) but noting which chunks fail, so a part changed on disk after it was counted is caught; parts that fail are dropped and fetched again, and a second failed check of the whole archive stops the download with the changed-manifest message (`The server's game data changed. …`). This hashes each fetched chunk twice and each reused chunk once (about 700 MiB, a few seconds). Cost: the time of one more pass over the archive at the end of each download.
4. **The parts are a staging area (D99).** Once the emulator has read the disc (the page's existing `discardGameData` step after the game starts; EmulatorJS reads a `File` into memory before it starts), the archive's parts and record are removed, whatever was kept: a fixed address with "Keep game data" still keeps its copy in Cache Storage (`sledstorm-disc-v1`), filled from the finished `File`, and a Quick Tunnel's chosen save location still gets its ZIP, as in P4 (D91). So parts live only while a download is unfinished; a Quick Tunnel host name that never comes back leaves at most one unfinished archive in that origin's best-effort storage. Cost if wrong: a player who reloads after a finished download downloads again where no copy was kept; slice 3 decides whether the parts replace the Cache Storage copy.

## Phases

One phase per working session; each ends with `npm run verify --prefix server` passing.

| Phase | Tasks | State |
|---|---|---|
| 1 | This plan; Tasks 1 and 2: the part store, the downloader | Done 2026-11-22 |
| 2 | Tasks 3 and 4: the page uses the downloader, checks by hand in the pinned Chromium (DATA-05 on the owner's disc through a copy of the bundle, the Python launcher's fallback) | Done 2026-11-22 |
| 3 | Tasks 5 and 6: the independent review, the records | Done 2026-11-22 |

## Status

**Phase 1 is done (2026-11-22, 09:34 to 09:51).** Before the first change the working tree was checked equal to `.superpowers/sdd/p5-slice-1-tree.tar` (227 files). Task 1: `web/disc-parts.js` with 16 tests in `web/disc-parts.test.mjs`; Task 2: `web/disc-download.js` with 23 tests in `web/disc-download.test.mjs`. Both test files failed first (no module); eighteen mutants of the two modules were killed, two of them only after a test was added or sharpened (the ledger says which). D96 and D98 were refined while implementing (a manifest that cannot be read, two archive switches at most, a refused part write as a failure, the final check as a loop of its own); the decisions above carry those words. `npm run verify --prefix server`: all 11 checks passed in 156 s (web and panel 202 of 202, server 267 of 267 on both Node.js versions, network 73, smoke 30; `verify-phase-1.log` in the ledger folder). Nothing in the page calls the modules yet.

**Phase 2 is done (2026-11-22, 09:58 to 10:13).** Task 3: `sharedDiscFile` in `web/app.js` keeps its Cache Storage read, then calls `downloadDisc` with the session info, saves the returned `File` where it saved the whole download (the Quick Tunnel's chosen ZIP, the fixed address's Cache Storage copy), and chains `discard` into `discardGameData`, which the page runs once the game has started (D99); EmulatorJS replaces its game URL by the `File`'s name once it has read it, so nothing reads the parts afterwards. `app.js` imports the downloader statically, so the gateway's list of page files (`research/network/emulator-assets.mjs`) gained `/disc-download.js` and `/disc-parts.js` in both disc modes; the gateway's test that follows the page's imports failed first on exactly these two. `npm run verify --prefix server`: all 11 checks passed in 154 s (web and panel 202 of 202, network 73, server 267 on both Node.js versions, smoke 30). Task 4, alone and headless in the pinned Chromium, on a scratch copy of the bundle with the owner's disc (86 chunks): a fresh guest through the gateway's loopback port asked each chunk once and started the game, and no part was left afterwards; a guest whose browser was killed with SIGKILL at 40% kept 34 checked parts and, started again on the same origin, asked only chunks 34 to 85; a part changed on disk with its length kept was caught by the whole-archive check and asked again, once; under `python3 server.py` the manifest answered 404 and the page took the whole `/disc.zip`. The ledger has the details and what was not verified.

**Phase 3 is done (2026-11-22, 10:16 to 11:05).** Task 5: Fable 5.2 stopped at once on its usage limit; the review ran on Opus 5.5 from a diff against `.superpowers/sdd/p5-slice-1-tree.tar` (`slice-2.diff` and `review.md` in the ledger folder): no critical finding, three important (I1: a write refused by the private file system's quota or a full disk stopped every download at the same place; I2: four waits in the host's queue, cut by the answer deadline or a proxy's 524, stopped the download; I3: five mutants survived the tests), seven minor. All three important and six minor findings were fixed, test first or proved by mutants; the seventh (m7, two decision notes) is listed as open. D96, D97 and D98 above carry the fixes. Tests: `web/disc-parts.test.mjs` 19, `web/disc-download.test.mjs` 38 (the slice had 16 and 23); ten of the new tests failed before the code, the rest pin the reviewer's surviving mutants; 26 mutants of the fixes and of the review's survivors, all killed. In the pinned Chromium, headless, on synthetic bytes (`browser-check.mjs` in the ledger folder), the page's own modules with the browser's private file system, IndexedDB, Web Locks and `fetch`: 8 of 8 checks passed. `npm run verify --prefix server`: all 11 checks passed in 156 s (web and panel 220 of 220). Task 6: the records in `docs/sea-server-plan.md` and `CHANGELOG.md`, and `.superpowers/sdd/p5-slice-2-tree.tar` as slice 3's review base.

The slice is done. Next: P5 slice 3 (its first chat writes its task plan).

## Tasks

### Task 1: The part store

**Files:**
- Create: `web/disc-parts.js`
- Test: `web/disc-parts.test.mjs`

**Interfaces:**
- Produces: `openPartStore(archive, { root, records } = {}) → Promise<PartStore>`, where `archive` is the manifest's `{ sha256, size, chunkSize, chunks }`, `root` a `FileSystemDirectoryHandle` (default: `await navigator.storage.getDirectory()`) and `records` a `{ get(key), put(key, value), delete(key), keys() }` store (default: IndexedDB `sledstorm-disc-parts`/`progress`). With either missing or throwing, it returns `memoryPartStore(archive)`.
- Produces: `memoryPartStore(archive) → PartStore`.
- `PartStore`: `persistent: boolean`; `kept() → Promise<number[]>` (sorted listed indices that passed the open-time length check); `put(index, bytes: Uint8Array) → Promise<void>` (writes, commits, then lists); `drop(index) → Promise<void>`; `file() → Promise<File>` (all parts in order, named `disc.zip`; rejects unless every index is listed); `remove() → Promise<void>` (the archive's parts and record).
- Produces: `partLength(archive, index) → number`.

- [x] **Step 1: Write the failing tests**, over a synthetic archive of 10 bytes with `chunkSize` 4 (3 parts), with an in-memory stand-in for `FileSystemDirectoryHandle` (`getDirectoryHandle`, `getFileHandle`, `removeEntry` with `recursive`, `keys()`, file handles with `getFile()` and `createWritable()` whose writes appear only on `close()`) and a `Map` record store:
  - `a part counts after a reload only once it was written and listed`: `put(1, …)` on one store; a second `openPartStore` over the same root and records gives `kept()` `[1]`.
  - `a part file the record does not list is not counted`: a file `2` written into the archive's directory by hand; `kept()` is `[]`.
  - `a listed part of another length is dropped when the store opens`: the record lists 0, the file holds 3 bytes; `kept()` is `[]` and the stored record's `done` is `[]`.
  - `two parts finished at once are both listed`: `Promise.all([put(0), put(2)])`, then a fresh open gives `[0, 2]`.
  - `opening another archive removes the first one's parts and record`.
  - `the file is every part in order` (bytes equal the archive) and `rejects while a part is missing`.
  - `drop forgets a part` and `remove deletes the archive's directory and record`.
  - `without a private file system the parts stay in memory`: `openPartStore(archive, { root: null })` (and one whose `root` throws) gives `persistent === false` and the same `put`/`kept`/`file` behaviour.
- [x] **Step 2:** Run `node --test web/disc-parts.test.mjs`. Expected: FAIL (no module).
- [x] **Step 3:** Implement `web/disc-parts.js` as D97 says; the IndexedDB record store follows `web/game-data-folder.js`'s `inGameData` (one transaction per call, database closed after).
- [x] **Step 4:** Run it again. Expected: PASS.

### Task 2: The downloader

**Files:**
- Create: `web/disc-download.js`
- Test: `web/disc-download.test.mjs`

**Interfaces:**
- Consumes: `openPartStore`, `partLength`, and in tests `memoryPartStore` (Task 1). The final check is its own loop (D98), since `matchingGameArchive` does not say which chunk failed.
- Produces: `downloadDisc(info, options = {}) → Promise<{ file: File, chunked: boolean, discard: () => Promise<void> }>`. `info` is the session info (`disc`, `pal`). Options, all for tests: `fetch` (default `globalThis.fetch`), `openStore` (default `openPartStore`), `report(text)` (status lines), `sleep(ms)`, `deadlines: { answer, stall }` (defaults `ANSWER_DEADLINE_MS = 300_000`, `STALL_DEADLINE_MS = 45_000`), `retryDelays` (default `[1000, 2000, 4000]`). `discard` removes the parts (D99); for the whole download it does nothing. Errors are `Error`s whose message is one of D96's sentences.
- Produces: `downloadWhole(options) → Promise<File>` (the whole `/disc.zip`, D96's deadlines), `CONCURRENCY = 2`, `ANSWER_DEADLINE_MS`, `STALL_DEADLINE_MS`, `MAX_FAILURES = 4`.

- [x] **Step 1: Write the failing tests** with a synthetic archive of 10 bytes in chunks of 4 (and one of 9 chunks for concurrency), a stand-in `fetch` that answers from a table of routes and records every request, the memory store from Task 1 and a `sleep` that records its argument and resolves at once:
  - `the manifest's 404 falls back to the whole /disc.zip` (`chunked === false`, bytes equal; no chunk asked).
  - `every chunk is fetched, two at a time, and checked`: 9 chunks, never more than 2 requests open, the file equals the archive, `chunked === true`.
  - `checked parts are used again`: a store holding parts 0 and 2 → only chunk 1 asked (DATA-05).
  - `a corrupt chunk is never stored and is fetched again`: first answer for chunk 1 has the right length and wrong bytes; `put` is never called with them; the second answer completes (DATA-06).
  - `a chunk of the wrong length is fetched again` (one byte short, one byte long).
  - `a busy server is a pause, not a failure`: chunk 0 answers 503 with `Retry-After: 2` six times, then 200; `sleep` saw `2000` six times; the download completes.
  - `Retry-After is held between 1 and 30 seconds` (`0` → 1000, `120` → 30000).
  - `the time before an answer has no stall deadline`: with `stall: 30`, `answer: 1000`, chunk 0's headers come after 100 ms; it completes on the first request.
  - `a stalled answer is cut and asked again`: with `stall: 30`, the first body sends 1 byte and stops; the second completes.
  - `a 503 without Retry-After stops the download` with the host's changed-files message.
  - `a chunk's 404 follows another archive of the same disc`: chunk 1 answers 404, the next manifest names archive B (same `disc`, `pal`); every chunk of B is fetched, A's parts are removed, the file equals B.
  - `a chunk's 404 with another disc in the manifest stops the download`.
  - `a manifest that does not match the session stops the download before any chunk`: another `disc`; another `pal`; `version: 2`; a chunk count that does not fit the size; a hash in capitals.
  - `four failures in a row stop the download and keep the checked parts`: chunk 2 always 500; the error is the stopped message; the store still lists 0 and 1; `retryDelays` seen were 1000, 2000, 4000.
  - `a part changed after it was counted is fetched again`: the store's part 0 is listed with the right length and wrong bytes; it is fetched again and the file equals the archive.
  - `discard removes the parts`.
  - `the whole download has no stall deadline before its answer` and `a stalled whole download stops` with today's message `Game data stopped downloading. Reload the invitation to try again.`
- [x] **Step 2:** Run `node --test web/disc-download.test.mjs`. Expected: FAIL (no module).
- [x] **Step 3:** Implement `web/disc-download.js` as D96 and D98 say. One `AbortController` per request: its timer is the answer cap until `fetch` resolves, then the stall deadline, reset on every read. A failure that stops the download aborts the other worker's request.
- [x] **Step 4:** Run `node --test web/*.test.mjs`, then `npm run verify --prefix server` in the background. Expected: every check passes.

### Task 3: The page uses the downloader

**Files:**
- Modify: `web/app.js` (`sharedDiscFile` and the `discardGameData` chain); `research/network/emulator-assets.mjs` (the gateway's list of page files) and its test in `research/network/gateway.test.mjs`
- Test: `web/lobby-markup.test.mjs` only if the markup changes; the flow is checked in Task 4.

- [x] **Step 1:** `sharedDiscFile` keeps its Cache Storage read first (non-Quick-Tunnel origins with a disc identity); otherwise it calls `downloadDisc(info, { report: showStatus })` in place of its own fetch, saves the returned `file` exactly as it saves today's blob (the Quick Tunnel's chosen ZIP, D91; the fixed address's Cache Storage copy), and chains `discard` into `discardGameData` so the parts go once the game has started (D99). Status lines: `Downloading game data · N%`, `The server is busy · waiting to continue · N%`, `Checking game data…`.
- [x] **Step 2:** Run `node --test web/*.test.mjs admin/*.test.mjs` and `npm run verify --prefix server`. Expected: every check passes; `diff -rq` of `web/` against the built bundle's `Contents/Resources/web` shows no difference.

### Task 4: By hand

Alone and headless in the pinned Chromium (the owner allowed it for unattended chats), on a scratch copy of the built bundle with the tests' tunnel stand-in in `Contents/Resources/bin`, the probe off, `SLED_SERVER_HOME` in the scratch folder, the owner's disc under `shared-allowed`, ports 8000 and 8006. Nothing printed names the disc, a hash, a path, a link or a token.

- [x] **Step 1:** A guest through the gateway's loopback port: the download counts every chunk and the game starts; the parts are gone afterwards.
- [x] **Step 2:** DATA-05: the guest's browser is killed halfway through; a fresh start of the same profile on the same origin fetches only the chunks it lacked (the server's requests counted by a scratch proxy or the page's network log), and the game starts.
- [x] **Step 3:** DATA-06 in the page: a part changed in the profile's private file system between two runs is fetched again (a page script over `navigator.storage.getDirectory()`).
- [x] **Step 4:** The Python launcher (`python3 server.py`, no tunnel): the page falls back to the whole `/disc.zip` and the game starts.
- [x] **Step 5:** Record what was seen and what was not verified (what needs eyes; the Quick Tunnel origin itself).

### Task 5: The independent review

- [x] **Step 1:** The review on the most capable model that takes requests, from a diff against `.superpowers/sdd/p5-slice-1-tree.tar`, with the focus below; its final message is the report.
- [x] **Step 2:** Fix critical and important findings test first, and the cheap minor ones; list the rest as open.

### Task 6: Records

- [x] **Step 1:** `docs/sea-server-plan.md`: the slice's results, hand checks, what was not verified, what stays open, D96 to D99, the verification log, and a new "Where to continue" that names slice 3; `CHANGELOG.md`.
- [x] **Step 2:** Run every check on the final tree and make `.superpowers/sdd/p5-slice-2-tree.tar` the base of slice 3's review.

## Review Focus

1. Two parts of different archives never end up in one `File`: a chunk's 404, a changed manifest or a store opened for another archive while a worker still writes.
2. A part counts only after its bytes were checked and committed: an interrupted `createWritable`, a record write that fails, a reload between the file and the record.
3. Queue time in the server's limit never cuts a request, a 503 with `Retry-After` never ends a download, and a stall after the answer always does.
4. Memory: no path holds the whole archive in memory before the emulator does (the final check reads one chunk at a time; the `File` is made of stored parts).
5. A download that stops keeps its checked parts, and a reload on the same origin uses them; nothing promises the same after a new Quick Tunnel host name.
