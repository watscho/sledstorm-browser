# P5 slice 1: the server's chunk routes and the host's delivery limit

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The packaged server offers its canonical archive in numbered pieces, `GET /game-data/manifest` and `GET /game-data/<archiveSha256>/chunks/<index>`, so that a page can fetch only the pieces it lacks (slice 2), and it bounds how many disc deliveries it runs at once. The gateway passes the two routes in its shared mode and refuses them in its local mode. DATA-06 on the server (another archive, a bad index), DATA-01 for the new routes.

**Architecture:** `server/src/game-data.ts` already streams the archive as headers around the user's own files; it gains a read of any byte range of that archive, and `archiveParts` becomes the range from 0 to the end, so one code path makes every byte. A chunk is the range `[index × chunkSize, min(size, (index + 1) × chunkSize))`, read through one handle per file touched and compared with the prepared state before and after, as now. A new module `server/src/delivery-limit.ts` holds a counting limit with a bounded queue; `server/src/runtime-http.ts` checks a chunk route's archive ID and index against the manifest before it opens anything, and runs every disc delivery (`/disc.zip` and the chunks) through one limit. `server/src/host-service.ts` hands the listener the manifest and the chunk reader with its change detection; `research/network/public-server.mjs` lets the two route shapes through in its shared mode only.

**Tech Stack:** TypeScript run directly by `node --test` (erasable syntax, D4), `node:fs/promises` file handles, `node:stream` pipelines; the gateway in plain JavaScript (`research/network`).

**Spec:** the owner's brief "Sled Storm Server — Node SEA", sections 11.1, 11.4 and 15.2 (DATA-01, DATA-06), outside the repository; `docs/sea-server-plan.md`, "P5 Resumable delivery".

**Review base:** the state that P4 left, the ignored file `.superpowers/sdd/p4-slice-3-tree.tar`. On 2026-11-22, before the first change of this slice, all 224 files that Git does not ignore were equal to it, except `docs/sea-server-plan.md`, whose paragraph "Unattended until 10:00" had been rewritten after the archive was made. A commit of P3 and P4, if the owner asks for one, replaces it.

## Global Constraints

- No push, no release, no published binary. No per-task commit; the owner commits.
- Code, comments and committed documents in English. The owner is answered in Russian.
- The game disc, its hashes, private links, room identifiers, public host names and every token stay out of Git, logs, the status, the diagnostic report and standard output. Fixtures are made of synthetic bytes only.
- No automated test starts the real Chromium, a tunnel, the network, the user's browser or a system dialog (D44, D49).
- The archive's bytes, its SHA-256 and its chunk hashes do not change: the stamp format stays `stored-v2`, the chunk size stays `DISC_CHUNK_SIZE` (8 MiB, brief §11.4), and neither the disc identity nor the room identity changes.
- Under `local-only` nothing of the disc passes the gateway (DATA-01); the loopback listener serves the new routes under both policies, as it serves `/disc.zip` (D72).
- A request never names a file: the listener maps an archive ID and an index to a range of the archive it prepared, and checks both before it opens a file (brief §11.4).
- `server.py` and `tools/play-online.py` keep working; they get no chunk routes (the page of slice 2 falls back to `/disc.zip` where the manifest answers 404).

## Decisions taken with this plan

1. **Two routes, the brief's (D92).** `GET` and `HEAD` of `/game-data/manifest` answer `{"version":1,"disc":…,"pal":…,"archive":{"sha256":…,"size":…,"chunkSize":…,"chunks":[…]}}` as `application/json` with `Cache-Control: no-store`; the manifest is the session info's `disc`, `pal` and `archive` (D74), so the page can check one against the other. `GET` and `HEAD` of `/game-data/<sha256>/chunks/<index>` answer the chunk as `application/octet-stream` with its exact `Content-Length` and `Cache-Control: no-store`. `<sha256>` must be the current archive's and `<index>` a decimal integer without a sign or leading zero below the number of chunks; anything else under `/game-data/` is 404 `Not found` before a file is opened. A private disc (`archive: null`) answers 404 on both routes; game files changed since they were prepared answer 503 as `/disc.zip` does. The query string is ignored, as for every route of the listener. Cost if wrong: a page that asks for a chunk of an archive the server has replaced gets 404 and must read the manifest again (slice 2), which is what the brief's "смена archive ID" asks.
2. **A chunk is a range of the streamed archive (D93).** `GameData.openChunk(index)` streams `[index × chunkSize, min(size, (index + 1) × chunkSize))` of the canonical archive in reads of at most 1 MiB, with the headers made in memory and the files read through one handle each, compared with their prepared state before and after (as `archiveParts` does). The whole archive is the same code over `[0, size)`. A file that changed ends the stream with `GameFilesChangedError`, so a chunk of two versions never arrives whole; the page's hash check (slice 2) catches what a change of the same size and time would still let through. Cost: none known; no archive is written to disk, as before.
3. **One limit on the guests' disc deliveries (D94).** The listener runs each `/disc.zip` and each chunk that the gateway forwards (it marks every request with `x-sled-gateway`; the review of phase 3) under one limit: at most 4 at once, up to 16 more waiting in order of arrival, and any further one gets 503 `The server is busy. Try again shortly.` with `Retry-After: 2`. A waiting request whose client goes leaves the queue; an active one frees its place when its answer ends or its client goes, and the pipeline then stops reading the files; an answer whose client stopped reading is cut 30 to 60 s later (`response.setTimeout` of 30 s: Node lets a timeout pass when the socket's write queue moved since the write was dispatched, which also keeps a slow but reading client; measured in phase 2's hand check). The manifest and the session info are outside the limit, and so is every delivery on this computer: the room's emulator, which loads `/disc.zip` at every session start under the relay's 75 s deadline, and the owner's page come over loopback without the mark and are never queued or refused (brief §11.1). With reads of 1 MiB, the four active deliveries hold a few MiB, never a disc. Cost if wrong: on a slow tunnel, four guests with two requests each (slice 2's concurrency, brief §11.4) take turns; deliveries on this computer are unbounded, as `/disc.zip` was before. The numbers are constants of `server/src/runtime-http.ts`; P6 measures them.
4. **The gateway passes the routes' shapes, not a prefix (D95).** In its shared mode the gateway lets `GET` and `HEAD` of `/game-data/manifest` and of paths matching `^/game-data/[a-f0-9]{64}/chunks/(?:0|[1-9][0-9]{0,6})$` through to the listener, which checks the archive ID and the bounds; in its local mode it refuses them with the 403 it gives `/disc.zip`. It compares the path that `new URL` gives, which keeps percent-encoding, and requires the path as sent (before `?`) to be that same path, since `new URL` settles dot segments; it forwards that path without the query and with its mark (D94), so an encoded or dotted form never matches and never reaches the listener. A chunk's `GET` of 200 streams through the gateway without its `Content-Length`, as `/disc.zip` does: a Quick Tunnel buffers a fixed-length answer (`docs/verification.md`, "HTTP response framing control"), and the page takes a chunk's length from the manifest. Cost: none known; the gateway stays a list of shapes, not a proxy.

## Phases

One phase per working session; each ends with `npm run verify --prefix server` passing.

| Phase | Tasks | State |
|---|---|---|
| 1 | This plan; Tasks 1 to 3: a chunk of the archive, the delivery limit, the listener's routes | Done 2026-11-22 |
| 2 | Tasks 4 to 6: the hosted server's routes, the gateway and the smoke test, a check by hand with the owner's disc | Done 2026-11-22 |
| 3 | Tasks 7 and 8: the independent review, the records | Done 2026-11-22 |

## Status

**Phase 1 is done (2026-11-22).** Before the first change the working tree was checked equal to `.superpowers/sdd/p4-slice-3-tree.tar` (224 files; only the paragraph "Unattended until 10:00" of `docs/sea-server-plan.md` differed, rewritten after the archive was made), and no other chat in this folder was running. P5 was cut into three slices (the table under "P5" in the main plan); this plan's decisions are D92 to D95 in the main plan's table, and the ledger `.superpowers/sdd/2026-11-22-p5-chunk-routes/progress.md` has every ruling. The ones that change what the plan said: a `HEAD` of `/disc.zip` or a chunk opens its source to refuse a changed disc and reads nothing, outside the limit; the last piece read from each file waits for the second comparison of the file, so a chunk inside one file is never complete when the file changed under it; and Task 4's code (the host hands the listener the manifest and `openChunk` through the change detection of `open`) was written in this phase so that the type check holds, its tests left to phase 2.

Tasks 1 to 3 went test first: `game-data.test.ts` (5 new tests) failed on `openChunk is not a function`, `delivery-limit.test.ts` (5) on the missing module, `runtime-http.test.ts` (7) with 6 failures (the bad-index test passed before the code, as a guard: the static files already answer 404). Eight mutants of the three modules, in place and restored, were all killed. `npm run verify --prefix server` passed all 11 checks in 156 s: the server tests 264 of 264 on Node.js 24.18.0 and the pinned 26.13.1, the network modules 71 of 71, the web client and the panel's page 163 of 163, the packaged build, and its smoke tests 30 of 30 (`verify-phase-1.log` in the ledger folder). One run of `game-data.test.ts` before it saw one descriptor more than expected in `an abandoned chunk closes its files`; it did not come back in three runs, a separate probe or the verify, and is watched. Nothing was checked by hand, and nothing passes the gateway yet.

**Phase 2 is done (2026-11-22).** Task 4's tests passed at once, because phase 1 had written its code; three mutants of `host-service.ts` were killed instead. The hosted disc of its multi-chunk test has a 9 MiB track, so the hosted archive has two chunks of the real size. Task 5's gateway test failed first (`GET /game-data/manifest` 403) and five mutants of `public-server.mjs` were killed; the smoke test's new lines failed against the bundle built before the change and passed after. Two rulings changed the plan's text: the gateway refuses a dotted spelling by comparing the path as sent with the parsed one (`new URL` settles dot segments, so comparing the parsed path alone would have let `/game-data/x/../manifest` through), and a chunk streams through the gateway without its `Content-Length` (Step 3's question, settled on the measurements of `docs/verification.md`). `npm run verify --prefix server` passed all 11 checks in 154 s: the server tests 266 of 266 on both Node.js versions, the network modules 72, the web client and panel 163, the build and its smoke tests 30 (`verify-phase-2.log`).

Task 6 ran alone and headless on a scratch copy of that bundle with the owner's disc (687 MiB in 86 chunks): every chunk matched the manifest and together they were `/disc.zip`; eight requests at once got four answers and four waits, at the same resident memory as an idle server; a client that went freed its place in 21 ms; the gateway passed a chunk under `shared-allowed` and refused the manifest and a chunk under `local-only`; no other spelling passed. It found that a client that stops reading loses its place 30 to 60 s later, not after 30 s: Node lets a socket's timeout pass when its write queue moved since the write was dispatched. That keeps a slow but reading client, so the code stays and D94's wording changed (ledger ruling). Not verified: a real Quick Tunnel in front of the routes, a page that uses them (slice 2), a disc changed during the check.

**Phase 3 is done (2026-11-22), and with it the slice.** The review ran on Opus 5.5 from a diff against `.superpowers/sdd/p4-slice-3-tree.tar` (Fable 5.2 stopped at once on its usage limit); its report is `review.md` in the ledger folder. It found nothing critical and held Review Focus 1 to 4 under its own probes. Focus 5 did not hold: every `/disc.zip` shared the four places with guests, and the room's emulator loads the disc at every session start, with a fresh profile, under the relay's 75 s deadline, so four long guest downloads could fail a new game or a restarted emulator; decision 3's cost line had said "once each at the start". Fixed test first: the gateway marks every request it forwards and the listener limits only marked deliveries (decisions 3 and 4 as they now read). The three minor findings (a HEAD outside the limit untested, a bounds test that could not tell the order of the checks, a verification row that said every test failed first) are fixed. Two tests failed before the code, the third was proved by a mutant, and five mutants were killed. The slice's results, what was not verified and what stays open are under "P5" in the main plan; the state it leaves is `.superpowers/sdd/p5-slice-1-tree.tar`, the base of slice 2's review.

## Tasks

### Task 1: A chunk of the archive

**Files:**
- Modify: `server/src/game-data.ts`, `server/test/game-data.test.ts`

**Interfaces:**
- Produces: `GameData.openChunk(index: number): Promise<Readable>`. It rejects with `RangeError('No such chunk.')` when `index` is not a safe integer in `[0, identity.archive.chunks.length)`, and with `GameFilesChangedError` when a source differs from the stamp before the first byte; a change found later ends the stream with that error. `openArchive()` keeps its contract.

- [x] **Step 1: Write the failing tests** in `server/test/game-data.test.ts`, with the existing fixture and `chunkSize: 1024`:
  - `every chunk is its slice of the archive`: for each index of `archive.chunks`, the collected chunk equals `whole.subarray(index * 1024, (index + 1) * 1024)` and its SHA-256 equals `archive.chunks[index]`; the chunks together equal the whole archive. Also with the `large()` fixture and `chunkSize: 3 * MiB` (chunks that start inside a file and span three files).
  - `a chunk outside the archive is refused before any file is opened`: `-1`, `chunks.length`, `1.5`, `NaN`, `Number.MAX_SAFE_INTEGER + 1` reject with `RangeError`.
  - `a chunk after a source changed is refused`: replace a track (other size) after preparing; `openChunk` of a chunk inside that track rejects with `GameFilesChangedError`.
  - `a track rewritten in place while its chunk is sent cuts the chunk short`: with `large()`, `drain` the chunk that holds `B.bin` and rewrite `B.bin` after its first bytes, as the existing in-place test does; the stream errors with `GameFilesChangedError` and delivers fewer bytes than the chunk.
  - `an abandoned chunk closes its files`: as the existing test for the archive, on a chunk.
- [x] **Step 2:** Run `node --test server/test/game-data.test.ts` from `server/`. Expected: FAIL (`openChunk` is not a function).
- [x] **Step 3:** Implement a range read `rangeParts(files, entries, start, end, signal?)` beside `archiveParts`, which becomes `rangeParts(…, 0, size)`, and `openChunk` in `prepareGameData`'s result (it checks the index, then `expectUnchanged`, then streams the range).
- [x] **Step 4:** Run `node --test "server/test/*.test.ts"` from `server/`. Expected: PASS.

### Task 2: The delivery limit

**Files:**
- Create: `server/src/delivery-limit.ts`, `server/test/delivery-limit.test.ts`

**Interfaces:**
- Produces: `class DeliveryBusyError extends Error`; `createDeliveryLimit({ active, waiting }: { active: number; waiting: number }): DeliveryLimit` with `acquire(signal: AbortSignal): Promise<() => void>` (resolves with a release function once a place is free; rejects at once with `DeliveryBusyError` when `active` run and `waiting` wait; rejects with `signal.reason` when the signal aborts while it waits, and leaves the queue) and the counts `running: number` and `queued: number`. Releasing twice frees one place.

- [x] **Step 1: Write the failing tests** in `server/test/delivery-limit.test.ts`:
  - `places are given in order and the queue is bounded`: `{ active: 2, waiting: 1 }`: two acquire at once, a third waits, a fourth rejects with `DeliveryBusyError`; releasing the first gives the place to the third; `running` and `queued` follow.
  - `a waiter that gives up leaves the queue`: `{ active: 1, waiting: 1 }`: the second waits, its signal aborts, it rejects with the signal's reason, `queued` is 0, a third waits instead of being refused, and the first release goes to the third.
  - `a second release frees nothing more`: release twice with one waiter queued behind two holders; one waiter is served and `running` stays at the limit.
  - `an aborted signal is refused at once`: `acquire` with an already aborted signal rejects and takes no place.
- [x] **Step 2:** Run `node --test test/delivery-limit.test.ts` from `server/`. Expected: FAIL (no module).
- [x] **Step 3:** Implement the module (an array of waiters; a release hands its place to the first waiter or lowers `running`).
- [x] **Step 4:** Run it again. Expected: PASS.

### Task 3: The listener's routes

**Files:**
- Modify: `server/src/runtime-http.ts`, `server/test/runtime-http.test.ts`

**Interfaces:**
- Consumes: Task 1's `openChunk`, Task 2's limit.
- Produces: `RuntimeHttpOptions.archive` becomes `{ size: number; manifest: { disc: string; pal: boolean; archive: ArchiveManifest }; open(): Promise<Readable>; openChunk(index: number): Promise<Readable> } | null`; `RuntimeHttpOptions.delivery?: { active: number; waiting: number; idleMs: number }`, default `{ active: 4, waiting: 16, idleMs: 30_000 }` (D94).

- [x] **Step 1: Write the failing tests** in `server/test/runtime-http.test.ts`, with a stand-in archive of a few synthetic chunks (`chunkSize` 4, the manifest made from the bytes):
  - `the manifest names the archive and its chunks`: `/game-data/manifest` is 200, `application/json`, `no-store`, and its body is `{ version: 1, disc, pal, archive }` exactly; HEAD has the length and no body; with `archive: null` it is 404.
  - `a chunk is its bytes`: each index gives 200, `application/octet-stream`, `no-store`, the exact `Content-Length` and the chunk's bytes (the last one shorter); HEAD sends the length and no body (it opens the chunk as GET does, to refuse a changed disc, and reads nothing, as `/disc.zip` does); `?x=1` is ignored.
  - `a chunk of another archive or a bad index reads nothing`: with an `openChunk` that counts its calls, each of `/game-data/<other sha>/chunks/0`, `/game-data/<SHA in capitals>/chunks/0`, `…/chunks/<count>`, `…/chunks/01`, `…/chunks/-1`, `…/chunks/1.0`, `…/chunks/1e1`, `…/chunks/x`, `…/chunks/`, `…/chunks/0/`, `…/chunks/%30`, `/game-data/`, `/game-data/manifest/x` is 404 and the count stays 0; with `archive: null` a valid chunk path is 404.
  - `a changed disc gives 503 for a chunk`: `openChunk` rejecting gives 503, for GET and HEAD.
  - `deliveries beyond the limit wait, and beyond the queue are refused`: `delivery: { active: 1, waiting: 1, idleMs: 30_000 }`, an endless stand-in stream for chunk 0 and a finite one for chunk 1: a raw client reads chunk 0 (holding the place); a second request for chunk 1 has no answer after 200 ms; a third (and a `/disc.zip`) gets 503 with `Retry-After: 2` and the message of D94; the first client goes; the second gets its chunk whole; the manifest answered 200 throughout.
  - `a waiting client that goes leaves the queue`: as above, the waiting client goes, a new request waits instead of 503, and is served once the first goes.
  - `a client that stops reading loses its place`: `idleMs: 300`; a raw client asks for the endless chunk 0 and never reads (`socket.pause()`); within 3 s a request for chunk 1 is served, and the endless stream was destroyed.
  - The existing `/disc.zip` tests keep passing with the new `archive` shape (the helper `disc(text)` gains a manifest and an `openChunk`).
- [x] **Step 2:** Run `node --test test/runtime-http.test.ts` from `server/`. Expected: FAIL.
- [x] **Step 3:** Implement: route `/game-data/manifest` and `/game-data/<sha>/chunks/<index>` after the query is cut and the path decoded (match the raw path, before decoding, for the chunk shape, so `%30` is not `0`); run the GET of `/disc.zip` and of a chunk through one `createDeliveryLimit` (a HEAD reads nothing and stays outside it), with an `AbortController` aborted on the response's `close`, `response.setTimeout(idleMs, () => response.destroy())` while it sends, and the release in a `finally` after `send`; a `DeliveryBusyError` answers D94's 503.
- [x] **Step 4:** Run `npm run verify --prefix server` in the background. Expected: every check passes (the host service still passes the old `archive` shape until Task 4: give it the new fields there in this phase, with `openChunk` from `GameData`, so the type check holds; its tests come in Task 4).

### Task 4: The hosted server's routes

**Files:**
- Modify: `server/src/host-service.ts`, `server/test/host-service.test.ts`

- [x] **Step 1: Write the failing tests** in `server/test/host-service.test.ts`, on a hosted synthetic disc: the listener's `/game-data/manifest` equals the session info's `disc`, `pal` and `archive`; every chunk's SHA-256 equals the manifest's; after a track changes, a chunk gets 503 and the status says the game files changed (as `/disc.zip` does today); under `local-only` the loopback listener still serves both routes.
- [x] **Step 2:** Run them. Expected: FAIL where Task 3's interim wiring lacks the change detection. (Phase 1 had written the wiring with its change detection, so they passed at once; three mutants of `host-service.ts` were killed instead.)
- [x] **Step 3:** `openChunk` in the host's `archive` object notes a change exactly as `open` does (written in phase 1).
- [x] **Step 4:** Run `node --test "test/*.test.ts"` from `server/`. Expected: PASS.

### Task 5: The gateway and the smoke test

**Files:**
- Modify: `research/network/public-server.mjs`, `research/network/gateway.test.mjs`, `server/smoke/sea.test.mjs`

- [x] **Step 1: Write the failing tests:** in `gateway.test.mjs`, a shared gateway over a stand-in upstream forwards `/game-data/manifest` and `/game-data/<64 hex>/chunks/0` and `…/chunks/12` (the upstream sees exactly that path, without a query), and refuses with 403, without asking the upstream, `/game-data/<64 hex>/chunks/01`, `/%67ame-data/manifest`, `/game-data/<64 hex>/chunks/%30`, `/game-data/<63 hex>/chunks/0`, `/game-data/x/../manifest`, `/game-data/manifest/` and a POST; a local gateway refuses all of them with 403. In the smoke test, through the gateway under `shared-allowed` a chunk's SHA-256 equals the manifest's; under `local-only` the manifest and a chunk get 403 (DATA-01).
- [x] **Step 2:** Run `npm test --prefix research/network`. Expected: FAIL.
- [x] **Step 3:** In the gateway's shared mode, accept the two shapes of D95 besides `assetPaths`. Settle, and record in the ledger, whether a chunk's `Content-Length` is moved to a header as `/disc.zip`'s is (`X-Sledstorm-Disc-Size`): that was done in 0.9.0-dev.2 because a Quick Tunnel buffers a fixed-length answer (`docs/verification.md`, "chunked trials"); a chunk's length is in the manifest, so the page needs no header, and an 8 MiB chunk buffered whole costs latency, not correctness.
- [x] **Step 4:** Run `npm run verify --prefix server` in the background. Expected: every check passes.

### Task 6: By hand

The owner is away until 10:00 on 2026-11-22: the check runs alone on a scratch copy of the bundle without `Contents/Resources/bin`, with `SLED_SERVER_HOME` in the scratch folder, the owner's disc, and the gateway reached on its loopback port with the tests' tunnel stand-in and the probe off. No hash, name or path of the disc is printed: each comparison prints only whether it held.

- [x] **Step 1:** Under `shared-allowed`, over loopback: the manifest equals the session info's archive; every chunk's SHA-256 equals the manifest's and the chunks together have the SHA-256 of `/disc.zip`.
- [x] **Step 2:** Eight chunk requests at once: four answer, the rest wait and are then served; the server's resident memory during them (`ps -o rss=`), against an idle server.
- [x] **Step 3:** A client that goes in the middle of a chunk frees its place (a waiting request is then served).
- [x] **Step 4:** Through the gateway's loopback port with the access cookie: a chunk under `shared-allowed`; 403 for the manifest and a chunk under `local-only`.
- [x] **Step 5:** Record what was seen and what was not verified.

### Task 7: The independent review

- [x] **Step 1:** The review on the most capable model that takes requests, from a diff against the review base, with the focus below. It saves its findings as it goes; its final message is the report.
- [x] **Step 2:** Fix critical and important findings test first, and the cheap minor ones; list the rest as open.

### Task 8: Records

- [x] **Step 1:** `docs/sea-server-plan.md`: the slice's results, hand checks, what was not verified, what stays open, D92 to D95, the verification log, and a new "Where to continue" that names slice 2. `CHANGELOG.md`.
- [x] **Step 2:** Run every check on the final tree, and make `.superpowers/sdd/p5-slice-1-tree.tar` the base of slice 2's review.

## Review Focus

1. A chunk path in another spelling (capitals, a leading zero, percent-encoding, a trailing slash, a dot segment, a huge number) never opens a file on the listener and never passes the gateway (Task 3's and Task 5's lists).
2. A client that goes or stops reading in the middle of a chunk frees its place and stops the reads; nothing waits forever behind it (Task 2, Task 3's last three tests, Task 6 step 3).
3. Game files that change while chunks are served: no chunk mixes two versions, and the host is told (Task 1's change tests, Task 4).
4. Under `local-only` nothing of the disc passes the gateway, whatever the path's spelling (Task 5).
5. The room's emulator and the owner's page get the disc at the start while guests are downloading: they wait in the queue, they are not refused (D94's sizes; Task 3's waiting test, Task 6 step 2). (The review found that waiting was itself too long for the emulator's 75 s deadline; since then they are outside the limit, Task 7.)
