# P5 slice 3: fallbacks, the portable ZIP and the end of P5

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The resumable download of slice 2 becomes honest where it cannot keep its parts and safe where storage runs short: the part store estimates the quota before it keeps parts and says why it keeps them in memory, the player is told when a reload starts over, the host's changed game files are named by the server instead of guessed from a bare 503, the page asks for persistent storage only where something is meant to stay, a copy or ZIP that could not be saved is told, and DATA-05 to DATA-08 are checked by hand on the owner's disc. Then the review, the records and P5's exit.

**Architecture:** `web/disc-parts.js` gains a quota check and a `reason` on every store; `web/disc-download.js` turns the store's state into its progress lines and its stopped sentence, and reads the server's mark on a changed-files 503; `server/src/runtime-http.ts` sets that mark; `web/app.js` and `web/game-data-folder.js` ask for persistence on a stable address that keeps game data and tell the player what was not saved. The portable ZIP, the Cache Storage copy and the parts' lifetime keep slice 2's shape (D99); this plan records why.

**Tech Stack:** Plain ES modules in the browser (`navigator.storage.estimate()`, `navigator.storage.persist()`, the origin private file system, IndexedDB, Web Locks); TypeScript on Node for the server; tests with `node --test` over stand-ins; the browser itself by hand in the pinned Chromium, with the DevTools protocol's `Storage.overrideQuotaForOrigin` for a small quota.

**Spec:** the owner's brief "Sled Storm Server — Node SEA", sections 11.2, 11.4 (step 5), 11.5 and 15.2 (DATA-05 to DATA-08), outside the repository; `docs/sea-server-plan.md`, "P5 Resumable delivery" ("Open after slice 2") and D91 to D99.

**Review base:** the state that slice 2 left, the ignored file `.superpowers/sdd/p5-slice-2-tree.tar`. On 2026-11-22 at 11:18, before the first change of this slice, all 232 files that Git does not ignore were equal to it. The archive was absent from the checkout used for phase 3. The review scope and substitute comparison are recorded below.

## Global Constraints

- No push, no release, no published binary. No per-task commit; the owner commits.
- Code, comments and committed documents in English. The owner is answered in Russian.
- The game disc, its hashes, private links, room identifiers, public host names and every token stay out of Git, logs, the status and standard output. Fixtures are synthetic bytes.
- No automated test starts the real Chromium, a tunnel, the network, the user's browser or a system dialog (D44, D49).
- The archive's bytes and hashes, the chunk size (8 MiB), the routes' shapes, the delivery limit, the disc identity and the room identity do not change. The server's only change is a header on its changed-files 503 (D102).
- Under `local-only` the page never asks for the server's disc (DATA-01); nothing here changes which sources are offered.
- Brief §11.5: estimate the quota before saving, handle its exhaustion and a refusal of persistent storage, feature-detect every storage API; resume after a reload or a cut on the same origin is required; resume after a new Quick Tunnel host name is not promised; without the private file system, a safe fallback (own files, or the download without persistence with an explicit warning), and no promise of resuming where nothing is saved.
- DATA-07: a quota failure, a cancelled picker and a missing private file system each end in a fallback the player can understand, and no existing file or save is lost. DATA-08: a new Quick Tunnel host name promises nothing of the old origin's storage, and the saved ZIP can be chosen again.

## Decisions taken with this plan

1. **The quota before parts are kept (D100).** The part store takes a `storage` stand-in for `navigator.storage` (the browser's by default). After it holds the lock, has removed other archives and has checked the listed parts, and only when a part is still missing, it asks `storage.estimate()`; when `quota − usage` is less than the missing parts' bytes plus `QUOTA_MARGIN` (64 MiB, room for the saves library and the estimate's error), it releases the lock and returns the memory store with `reason: 'quota'`, writing nothing and leaving the archive's listed parts and record for a later page with more room. An estimate that is missing, throws or does not give two numbers is no answer: the parts are kept, and a write the private file system refuses later stays in memory (D97). A complete set of parts is never re-downloaded because of the quota. Every store says why it keeps parts in memory: `reason` is `'unsupported'` (no private file system, `createWritable` or IndexedDB), `'unavailable'` (storage refused when the store opened, as in some private windows), `'busy'` (another page of the origin holds the stored parts), `'quota'`, or, on the persistent store, `null` until the private file system refuses a write and `'full'` after it. The Cache Storage copy is not counted (D104). Cost if wrong: the estimate is coarse (Chrome pads it), so a quota just above the need may still refuse writes, which then stay in memory; a margin too large sends a nearly full browser to memory, which 1.1.0 always used. P6 can tune the margin, which is exported.
2. **What the player is told (D101).** The downloader's progress lines (`Downloading game data…`, `Downloading game data · N%`, `The server is busy · waiting to continue · N%`) carry the store's reason as a note: none for a persistent store with `reason: null`; ` · this browser does not save it, a reload starts over` for `'unsupported'` and `'unavailable'`; ` · too little browser storage to save it, a reload starts over` for `'quota'`; ` · another tab holds the saved download, a reload here starts over` for `'busy'`; ` · browser storage is full, a reload fetches the unsaved part again` for `'full'`. `Checking game data…` carries none. A download that stops says `Game data stopped downloading. Reload the invitation to continue.` only when its store is persistent; a store in memory says `Game data stopped downloading. Reload the invitation to try again.` (the whole download's sentence), for a run of failures, a spent wait budget and a storage error alike. Cost if wrong: a longer status line, which wraps (`#status` has `overflow-wrap: anywhere`).
3. **The host's changed game files are named (D102).** Every 503 that the loopback listener sends because the game files changed since they were prepared (`/disc.zip` and a chunk, `GET` and `HEAD`) carries `X-Sled-Game-Files: changed`; the delivery limit's 503 does not. The gateway already forwards the upstream's headers as they are; a test pins it. The page reads a chunk's 503 by its headers: the mark is the host's changed game files (`The host's game files changed. …`, the download stops); otherwise `Retry-After` is a pause (D96); a 503 with neither is a failure, asked again after 1, 2 and 4 s. The whole `/disc.zip` gives the host's sentence for a marked 503 and `Could not download the game disc. …` for any other refusal, as today. This closes the review's note of slice 2 (a bare 503 that any proxy could send stopped the download). Cost: one header; the Python launcher sends no 503 for the disc.
4. **Persistent storage where something is meant to stay (D103).** On a stable address (not `*.trycloudflare.com`) where the page keeps game data (the owner's page, or a guest with "Keep game data"), `sharedDiscFile` asks for persistent storage before the download through `askToKeepStorage()` in `web/game-data-folder.js`: `persisted()` first, `persist()` only when it says false, never awaited by the download and never throwing. On a Quick Tunnel address it never asks: a temporary origin made persistent would keep an orphaned download out of the browser's reach. A refusal (Chrome refuses silently unless the address is bookmarked, installed or much used) changes nothing visible: the parts and the kept copy stay best-effort, the browser may clear them under storage pressure, the store reads a cleared part as missing and fetches it again, and the Cache Storage read finds no copy and downloads. Cost if wrong: Firefox shows its own prompt on a stable address that keeps game data; a cleared copy is downloaded again.
5. **The Cache Storage copy stays, and the parts still go at the start (D104).** The parts do not replace 1.1.0's Cache Storage copy (`sledstorm-disc-v1`): the Python launcher has no chunk routes and still needs that copy for its whole download, a 1.1.0 copy keeps working without a migration, and the copy is keyed by the disc identity, so it survives a rebuilt archive of the same disc where parts, keyed by the archive, would not. D99 stays: the parts go once the game has started, the review's note (a reload right after the start downloads again where nothing was kept) being the cost 1.1.0 always had. While the copy is written from a finished download, the origin briefly holds the parts and the copy (two archives); a copy that the browser refuses (a quota), and a Quick Tunnel ZIP that could not be written, are told once the game is running, through the action notice: `Game data was not kept in this browser: there is not enough storage. It downloads again next time.` and `The game data ZIP could not be saved. The game runs without it.` Cost if wrong: a player near the quota who asked to keep game data downloads it again next time, and is told so.
6. **The portable ZIP and a new host name (D105).** The portable ZIP is the Quick Tunnel's chosen save location (D91), written from the parts once the whole archive is checked and before they go, so it is the exact copy of the server's archive and a later page takes it on the fast path (D74). Where the save picker is missing (Safari, Firefox) the page adds no ordinary download of the archive: the player has their own files, a saved ZIP through the file input, and the download, with persistent parts where the browser has the private file system and D101's note where it has not, which is brief §11.5's fallback. A new Quick Tunnel host name is a new origin: its storage has no parts, no record, no remembered copy and no last source, so the page downloads from the start, and nothing says otherwise (the progress lines speak of no earlier download; "to continue" follows only a stop on the same origin with saved parts, D101). The saved ZIP is chosen again under "Use saved ZIP" or the dialog's "Use existing ZIP". A cancelled picker (`AbortError`) keeps every earlier choice: the remembered copy, the chosen ZIP destination and the source. Cost if wrong: a Safari or Firefox player on a Quick Tunnel cannot save a ZIP from the page and downloads again at every new host name.

## Phases

One phase per working session; each ends with `npm run verify --prefix server` passing.

| Phase | Tasks | State |
|---|---|---|
| 1 | This plan; Tasks 1 to 3: the quota and the reasons, what the player is told, the host's changed game files named | Done 2026-11-22 |
| 2 | Tasks 4 and 5: the page's persistence and saved-copy notices, checks by hand in the pinned Chromium (DATA-05 to DATA-08 on the owner's disc through a copy of the bundle) | Done 2026-11-22 |
| 3 | Tasks 6 and 7: the independent review, the records and P5's exit | Done 2026-11-22 |

## Status

**Phase 1 is done (2026-11-22, 11:13 to 11:40).** Before the first change the working tree was checked equal to `.superpowers/sdd/p5-slice-2-tree.tar` (232 files). Task 1: `web/disc-parts.js` asks `storage.estimate()` for the missing parts plus `QUOTA_MARGIN` and gives every store a `reason`; `web/disc-parts.test.mjs` 26 tests (was 19). Task 2: `web/disc-download.js` adds the store's note to its progress lines and says "to continue" only for a persistent store; Task 3: the listener's changed-files 503 carries `X-Sled-Game-Files: changed`, the gateway forwards it, the page stops on the mark alone and asks a bare 503 again; `web/disc-download.test.mjs` 46 tests (was 38), new assertions in `server/test/runtime-http.test.ts`, one new test in `research/network/gateway.test.mjs`. New tests failed before the code, except where the ledger says a mutant proves them; 36 mutants, 35 killed and 1 equivalent. `npm run verify --prefix server`: all 11 checks passed in 157 s (web and panel 235 of 235, server 267 of 267 on both Node.js versions, network 74, smoke 30; `verify-phase-1.log` in the ledger folder). `web/app.js` is unchanged; the decisions above hold as written.

**Phase 2, Task 4 is done (2026-11-22, 11:41 to 11:50).** The owner was asked first whether they would watch the hand checks and chose to watch. Task 4: `askToKeepStorage(storage)` and `unsavedGameDataNotice(where, error)` in `web/game-data-folder.js`; `web/game-data-folder.test.mjs` 6 tests (was 2). `web/app.js`: `sharedDiscFile` calls `askToKeepStorage()` when `keep && cacheAllowed`, before `downloadDisc` (D103); a refused Cache Storage put and a ZIP that `saveGameArchive` could not write set `gameDataNotice`, which `renderStatus` shows through `showActionNotice` at the moment the room would show LIVE, and `EJS_onGameStart` shows at once under `?lab` and `?console`, which have no room (D104). A refusal of the browser copy other than `QuotaExceededError` says `Game data was not kept in this browser. It downloads again next time.` (no cause named); a failure of `rememberCopy` after the ZIP was written warns in the console only. 9 mutants of `web/game-data-folder.js`, all killed (`m-keep.json` in the ledger folder). `npm run verify --prefix server`: all 11 checks passed in 156 s (web and panel 239 of 239, server 267 of 267 on both Node.js versions, network 74, smoke 30; `verify-phase-2.log`); `web/` and `admin/` equal the built bundle except their test files.

At 11:50 the owner said to stop by 11:59, record the state as it is, commit and push. Task 5 was being prepared: `player.mjs` and `drive.mjs` are copied into this slice's ledger folder, and `player.mjs` is extended (a visible window with `HEADED=1`; `QUOTA`, `NOOPFS`; a `*.trycloudflare.com` name mapped to 127.0.0.1 and treated as secure, so the page takes its Quick Tunnel path on the gateway's loopback port; `picker cancel|ok`; a save picker stand-in into the private folder `saved`; `saved-check`; `tab2` and `@2 <command>`). It passes `node --check` and has not run yet. Planned for Task 5: host an APFS clone (`cp -cpR`) of `game/` in the scratch folder, so that Step 5 can `touch` a BIN of the clone and the owner's files are never changed; `copy.sh` from slice 2 configures `$repo/game` and needs that change.

**Phase 2, Task 5 is done (2026-11-22).** This checkout started at `20c2064`,
the pushed branch tip, and contained the owner's game files. The earlier
ledger scripts and built bundle were missing. The pinned toolchain, emulator
and macOS application were rebuilt. The hand-check driver
(`node .cache/p5-manual-check/check.mjs` from the repository root) ran
Chromium 158.0.8127.0 in visible windows with separate profiles and the
bundle's loopback gateway. The temporary host used an APFS clone of the
disc and a stand-in for `cloudflared`. The owner authorized freeing the
normal ports from the previous Python launcher. The browser profiles, test
bundle, disc clone and portable ZIP were removed after each run.

The low-quota run reproduced a `NotReadableError` after 86 successful
chunk requests, while reading a slice of the assembled file during archive
verification. `web/disc-parts.js` now stores checked memory parts as byte
arrays and streams them in archive order into one completed blob before
returning a `File`. The reread still checks every chunk. The pinned browser
reports the 256 MiB DevTools override to the page with
`--disable-features=StaticStorageQuota` on the test profile. That run now
reaches LIVE. Chromium rejected the real Cache Storage write with
`QuotaExceededError` and the player saw the expected notice. A separate run
used a controlled cache refusal with an earlier cache entry, which survived
alongside the save and the remembered ZIP handle. All 11 browser scenarios
passed on the rebuilt application. `npm run verify --prefix server` passed
all 11 checks in 184 s after the browser runs.

**Phase 3 review, 2026-11-22.** GPT-6.2 Astra reviewed Tasks 1 through 5
in the current sources, the working diff from `20c2064` for the memory
archive fix, and the relevant source and test history from `54a64b3`
through `20c2064`. The last commit includes P3, P4 and P5 through Task 4,
so that history cannot reconstruct the exact slice 2 diff. The reviewed
paths cover the part store, downloader, cache and portable ZIP paths in
the web client, plus the changed-files response in the listener and
gateway. The review report is `review.log` in this slice's ledger folder.

The wait budget now includes the delay after 504 and 524, and the
remaining budget caps the next answer deadline. The game can use parts
when either the private file system or IndexedDB refuses a write. Memory
parts and any saved parts are streamed into one completed blob. The last
failed write can update the note at 100%. A stop offers to continue only
when at least one part is saved. The changed-files mark is read on 503.
Opening and writing the browser cache can both result in the saved-copy
notice. The local console and lab give it temporary priority over their
normal status. The persistence request also covers a kept cache hit.

Six Node regression cases and four pinned Chromium checks with synthetic
bytes failed before the fixes and passed after them. The Chromium driver
is `.cache/p5-review/browser-check.mjs`; `review-browser.log` records the
large archive and console checks. The earlier packaged room runs remain
the evidence for DATA-05 to DATA-08. The complete `npm run verify --prefix
server` run passed all 11 checks in 158 s. The P5 exit record and the next
P6 step are in `docs/sea-server-plan.md`.

## Tasks

### Task 1: The quota and the reasons

**Files:**
- Modify: `web/disc-parts.js`
- Test: `web/disc-parts.test.mjs`

**Interfaces:**
- Produces: `openPartStore(archive, { root, records, locks, storage } = {})`; `storage` stands in for `navigator.storage` (`{ estimate() }`), defaulting to it only on the browser path (an injected `root` without `storage` asks no estimate).
- Produces: `memoryPartStore(archive, reason = 'unsupported')`; every `PartStore` has `reason: null | 'unsupported' | 'unavailable' | 'busy' | 'quota' | 'full'` (a getter on the persistent store).
- Produces: `QUOTA_MARGIN = 64 * 1024 * 1024`.

- [x] **Step 1: Write the failing tests** (the existing stand-ins; `storage` is `{ estimate: async () => ({ quota, usage }) }` with a counter):
  - `the parts are kept in memory when the quota is too small for what is missing`: 10-byte archive, nothing listed, `quota: QUOTA_MARGIN + 9, usage: 0` → `persistent === false`, `reason === 'quota'`, no file in the archive's directory, no record written; with `QUOTA_MARGIN + 10` → `persistent === true`.
  - `the estimate counts only the parts still missing`: parts 0 and 1 listed (8 bytes), `quota: QUOTA_MARGIN + 2` → persistent, `kept()` `[0, 1]`.
  - `a complete set of parts is used without asking for the quota`: all three listed, `estimate` throws if called → persistent, `kept()` `[0, 1, 2]`, the counter 0.
  - `an estimate that cannot be read does not stop parts being kept`: `storage` `{}`, an `estimate` that throws, one that resolves `{}` → each persistent.
  - `a store that falls back for the quota leaves the parts, the record and the lock`: part 0 listed; a too-small quota gives the memory store; a second open over the same root, records and locks with a large quota is persistent and counts part 0.
  - `every store in memory says why`: `root: null` → `'unsupported'`; a `root` whose `getDirectoryHandle` throws → `'unavailable'`; a lock held by another page → `'busy'`; the default open in Node → `'unsupported'`; `memoryPartStore(archive).reason` → `'unsupported'`.
  - `a refused write marks the persistent store full`: `reason` `null` before, `'full'` after a `put` that `onClose` refuses.
- [x] **Step 2:** Run `node --test web/disc-parts.test.mjs`. Expected: the new tests FAIL.
- [x] **Step 3:** Implement D100 in `web/disc-parts.js`: the estimate after the open-time check and before the first record write; the lock released on the quota's fallback.
- [x] **Step 4:** Run it again. Expected: PASS, 19 earlier tests included.

### Task 2: What the player is told

**Files:**
- Modify: `web/disc-download.js`
- Test: `web/disc-download.test.mjs`

**Interfaces:**
- Consumes: `PartStore.persistent`, `PartStore.reason`, `memoryPartStore(archive, reason)` (Task 1).
- Produces: D101's notes on the progress lines and its two stopped sentences; `downloadDisc`'s signature and result do not change.

- [x] **Step 1: Write the failing tests** (`openStore` returning `memoryPartStore(archive, reason)`, or a persistent stand-in `{ ...memoryPartStore(archive), persistent: true, reason }`):
  - `a download kept in memory says a reload starts over`: reason `'unsupported'`; every `Downloading game data` line ends with ` · this browser does not save it, a reload starts over`; `Checking game data…` has no note.
  - `each reason has its own note`: `'unavailable'`, `'quota'`, `'busy'`, `'full'` and a persistent `null` give D101's five endings (none for `null`) on the `· 100%` line.
  - `the busy server's line carries the note`: a 503 with `Retry-After` under reason `'quota'` → `The server is busy · waiting to continue · 0% · too little browser storage to save it, a reload starts over`.
  - `a stopped download in memory says to try again, a saved one to continue`: chunk 2 always 500 → memory store: `Game data stopped downloading. Reload the invitation to try again.`; persistent store: `… to continue.`
  - `a spent wait budget and a storage error in memory say to try again`: a chunk answering 524 past `deadlines.wait`, and a `file()` that throws, each with a memory store.
- [x] **Step 2:** Run `node --test web/disc-download.test.mjs`. Expected: the new tests FAIL.
- [x] **Step 3:** Implement D101: the note read from the store at each report (the persistent store's `reason` changes during a download); the stopped sentence chosen from the store that the download was using; both sentences in `SENTENCES`.
- [x] **Step 4:** Run it again. Expected: PASS.

### Task 3: The host's changed game files named

**Files:**
- Modify: `server/src/runtime-http.ts` (the two changed-files `plain(response, 503, CHANGED)` calls in `deliver`), `web/disc-download.js` (`requestPart`, `downloadWhole`)
- Test: `server/test/runtime-http.test.ts`, `research/network/gateway.test.mjs`, `web/disc-download.test.mjs`

**Interfaces:**
- Produces: the header `X-Sled-Game-Files: changed` on the listener's changed-files 503, read by the page as `response.headers.get('X-Sled-Game-Files') === 'changed'`.

- [x] **Step 1: Write the failing tests:**
  - `server/test/runtime-http.test.ts`: in `a changed disc gives 503` and `a changed disc gives 503 for a chunk`, the header is `changed` for `GET` and `HEAD`; where the limit refuses a guest with 503, the header is absent.
  - `research/network/gateway.test.mjs`: `the host's changed-files answer reaches a guest with its mark`: the upstream stand-in answers a chunk with 503 and the header; a guest through the shared gateway sees 503 and `changed`.
  - `web/disc-download.test.mjs`: `a 503 without Retry-After stops the download` becomes `a 503 marked as the host's changed game files stops the download` (the mark → the host's sentence); new `a bare 503 is a failure, asked again` (one bare 503, then 200: completes, `retryDelays` saw 1000; four bare 503 in a row: the stopped sentence); new `the whole download names the host's changed game files` (manifest 404, `/disc.zip` 503 with the mark → the host's sentence; without it → `Could not download the game disc. …`).
- [x] **Step 2:** Run `node --test web/disc-download.test.mjs research/network/gateway.test.mjs` and `npm test --prefix server`. Expected: the new assertions FAIL (the gateway's may pass at once; it pins forwarding that exists).
- [x] **Step 3:** Implement D102 on both sides.
- [x] **Step 4:** Run `node --test web/*.test.mjs admin/*.test.mjs research/network/*.test.mjs`, then `npm run verify --prefix server` in the background. Expected: every check passes.

### Task 4: The page's persistence and saved-copy notices

**Files:**
- Modify: `web/game-data-folder.js` (`askToKeepStorage`), `web/app.js` (`sharedDiscFile`, the game's start)
- Test: `web/game-data-folder.test.mjs`

**Interfaces:**
- Produces: `askToKeepStorage(storage = navigator.storage) → void`: reads `persisted()`, calls `persist()` only when it resolved false; never throws, never awaited by its caller.

- [x] **Step 1: Write the failing tests:** `askToKeepStorage asks only when storage is not yet persistent` (a stand-in whose `persisted` resolves false then true: `persist` called once, then not); `askToKeepStorage never throws` (no `storage`, no `persist`, a `persisted` that rejects).
- [x] **Step 2:** Run `node --test web/game-data-folder.test.mjs`. Expected: FAIL.
- [x] **Step 3:** Implement it; in `sharedDiscFile`, call it when `keep && cacheAllowed` before `downloadDisc` (D103). Note a refused Cache Storage put and a failed ZIP save (`saveGameArchive` rejecting) and show D104's sentence with `showActionNotice` once the game is running: where the status then shows the room's progress, at the moment the room is LIVE. A cancelled picker keeps every earlier choice (D105): no change is expected; Task 5 checks it.
- [x] **Step 4:** Run `node --test web/*.test.mjs admin/*.test.mjs` and `npm run verify --prefix server`. Expected: every check passes; `diff -rq` of `web/` against the built bundle's `Contents/Resources/web` shows no difference.

### Task 5: By hand

The hand checks used the pinned Chromium in visible windows at the owner's request. Guests came through the loopback gateway of a scratch copy of the application, with the tests' tunnel stand-in, the probe off, `SLED_SERVER_HOME` in the scratch folder, the cloned disc under `shared-allowed`, and ports 8000 and 8006. The driver read page status and request counts over private DevTools pipes.

- [x] **Step 1. DATA-05.** SIGKILL at about 40%. The same profile on the same origin reused 34 saved chunks, requested only the 52 missing chunks, reached LIVE and discarded its progress record.
- [x] **Step 2. DATA-06 in the page.** Changing one byte of a saved chunk caused one request for that chunk. Seven other saved chunks were reused, and the game reached LIVE. The server part of DATA-06 was checked in slice 1.
- [x] **Step 3. DATA-07.** A 256 MiB quota showed the low-storage message
  and reached LIVE after the archive fix. The saves library and remembered
  ZIP handle survived. With `navigator.storage.getDirectory` disabled, the
  fallback message appeared, and a run of unmarked 503 responses ended with
  "try again". With two tabs the second showed the message about the other
  tab holding the parts. Picker cancellations in the game data dialog and
  under "Use saved ZIP" preserved the existing choices, including a
  previously chosen ZIP destination. The browser cache quota refusal and a
  refused portable ZIP write each showed D104's notice at game start. The
  stable-address check called `persist()` once with a refusal stand-in. The
  temporary-address check made zero calls.
- [x] **Step 4. DATA-08.** The portable ZIP matched the bytes served by `/disc.zip`. Restarting hosting changed the gateway port and the mapped hostname. The new origin started at 0% and the saved ZIP selected under "Use saved ZIP" reached LIVE with zero disc requests after selection.
- [x] **Step 5. D102.** Changing the timestamp of a track in the APFS clone during the download produced a marked 503 through the gateway and the host's changed-files message. The guest made zero further chunk requests after that message. The original track's timestamp matched its starting value.
- [x] **Step 6.** The visible windows used local stand-ins for Quick Tunnel and the operating-system pickers. A real public tunnel, native picker dialogs, a physical disk full, and non-Chromium browsers remain unverified in this phase.

### Task 6: The independent review

- [x] **Step 1:** GPT-6.2 Astra reviewed the scope above with the focus below. The exact slice 2 archive was unavailable and the substitute comparison is recorded.
- [x] **Step 2:** Fixed the six review findings and the two follow-up findings. The remaining qualification checks are under P5 in `docs/sea-server-plan.md`.

### Task 7: Records and P5's exit

- [x] **Step 1:** `docs/sea-server-plan.md` records the results, limits, decisions D100 to D105 and the next P6 step. `CHANGELOG.md` records the player-facing changes.
- [x] **Step 2:** All 11 checks passed. `.superpowers/sdd/p5-slice-3-tree.tar` contains the 233-file final P5 tree for the first P6 review.

## Review Focus

1. No download kept in memory promises to continue: every progress line and every stopped sentence of a memory store, for any reason, says a reload starts over or to try again; only a persistent store says to continue (Task 2's tests).
2. The quota check never costs checked parts and never blocks a download: no estimate when nothing is missing, an unreadable estimate keeps the parts, a fallback leaves parts, record and lock for the next page (Task 1's tests).
3. A 503 is a pause, a failure or the host's changed files by its headers alone: no proxy's 503 stops a download at once, and the host's mark survives the gateway (Task 3's tests).
4. Nothing of one origin is promised on another: on a new host name no line speaks of earlier progress, and the saved ZIP starts the game there (Task 5, Step 4).
5. No fallback loses existing data: the saves library, the remembered copy, the chosen ZIP destination and the Cache Storage copy survive a quota fallback, a cancelled picker and a refused persistence (Task 1's fallback test; Task 5, Step 3).
