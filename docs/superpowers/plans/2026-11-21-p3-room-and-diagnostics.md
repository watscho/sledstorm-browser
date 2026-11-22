# P3 slice 3: the room from the panel, and diagnostics

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The owner runs the room from the panel and can tell what went wrong without a terminal: a new game in the same room, the room's options, a quit that asks about players at the server, a diagnostic report without secrets, a newer build that takes over from an older server, and the behavior at logout and under App Translocation known and written down, with instructions for the packaged path.

**Architecture:** The server gains three operations behind the control listener, each with a command of the executable: a new game for the room (`POST /api/room/new-game`), the diagnostic report (`POST /api/diagnostics/export`), and a quit that, like a stop, needs `force` with players in the room. The room's options become part of the saved configuration and are applied at a start. The launcher learns to tell a server of another build and to replace it when its room is empty. The page gets the new controls on the same three modules as in slice 2: `view.js` decides what is shown, `controller.js` sends the requests, `panel.js` writes the view into the document.

**Tech Stack:** Node.js 26.13.1 single executable, TypeScript checked only, `node:test`. The page is plain modules, no framework and no build step.

**Spec:** the owner's brief "Sled Storm Server — Node SEA", sections 4, 9, 12 and 13 (outside the repository), and `docs/sea-server-plan.md`, "P3 Browser admin and macOS launch", with what slices 1 and 2 left open.

**Review base:** the state that slice 2 left. No commit holds it (`git log` ends at `54a64b3`), so it is the ignored file `.superpowers/sdd/p3-slice-2-tree.tar`. On 2026-11-21, before the first change of this slice, all 205 files that Git does not ignore were equal to it, byte for byte.

## Global Constraints

- No push, no release, no published binary. No per-task commit; the owner commits.
- Code, comments and committed documents in English.
- The game disc, its hashes, private links, room identifiers, public host names and every token stay out of Git, logs, the status, the diagnostic report and standard output. The folder's path leaves the server only in the answers about the configuration, to a command or to the panel.
- No automated test starts the real Chromium, a tunnel, the network, the user's browser or a system dialog (D44, D49).
- A loopback address is not authorization: every control route needs a credential, the listener's own Host and no foreign Origin. Control routes match the raw request path (D12). Nothing public reaches a new route: `server/test/public-boundary.test.ts` asks for each.
- With a player connected or a controller kept, nothing that ends the players' game happens without `force`: a stop, a start that builds the stack anew, a new game and a quit. A signal from the system is not asked.
- The room's name and token, and so both links, stay as they are for the whole time that hosting is up; a new game does not change them.
- Whatever the server answers is put into the page as text. The page's content security policy stays as it is.
- A file that is added to `admin/` is added to the listener's list in `server/src/host-server.ts` and to `stagePanel` in `server/scripts/stage-resources.mjs`.
- `server.py` and `tools/play-online.py` keep working. No change under `web/` or `research/network` is expected in this slice.

## Decisions taken with this plan

1. **A quit with players in the room needs `force` at the server**, like a stop (D42): `POST /api/host/quit` answers 409 with the counts, and the command is `quit [--force]`. A signal from the system (`SIGTERM` at logout, `SIGINT`, `SIGHUP`) quits without asking, as before. This replaces the half of D52 that asked from the page's last reading. Cost: a script that quit with players connected now needs `--force`; a server of an earlier build ignores the body and quits.
2. **A new game ends the room's session and opens the next one at once, in the same room.** `POST /api/room/new-game` and the command `new-game [--force]`, with `force` while somebody is in the room. The players are told `The host started a new game. Open the invitation again to join.`; the next session opens under the same name and token without a pause, and the count of failed sessions starts again. In a room that has failed it is a start of the room, in a room whose session is starting it changes nothing, and without a room it is refused with `No room is open.` Cost: everyone in the room is disconnected and comes back through the link, and for a few seconds two emulators exist, as during a load.
3. **The room's options are a saved preference**: `config.json` gains `roomOptions: { progress, camera }`, the web client's defaults `{ "progress": "all", "camera": true }` when absent, and stays at version 1 (as `autoStart` did, D43). They change only while nothing is hosted, like the folder and the policy, because they are part of the room's identity and of every link; a start applies them. Separate cameras on the verified PAL disc are its native camera. Any other disc plays with the original progression and a shared camera, whatever is saved, as now (D37). The status names the options of the room that runs. Cost: to change them the room is stopped and the players get new links; a build before this one drops the key when it rewrites the file.
4. **The diagnostic report is made by the server and saved by the page.** `POST /api/diagnostics/export`, no body, answers a JSON report; the command `diagnostics` prints it. It holds the application and version, the runtime manifest of the build (versions and checksums of its parts, no secret), the system and the architecture, the time and the uptime, the host's status, the configuration without the folder's path (whether one is set, the policy, the switch, the options, the file's problem), which parts the build has, and the last 200 lines of the server's log, at most 64 KB. Each line of the log goes through a filter that replaces the saved folder, the user's home folder, every run of 16 or more hexadecimal digits, any host name under `trycloudflare.com` and the fragment of any address. Cost: the log already carries none of that (D19), so the filter is the second line of defense, and it may hide a number that would have helped.
5. **A launch that finds a server of another build replaces it when nobody is in its room.** The instance record gains `build`, the `server.sha256` of the runtime manifest that the server read at its start, null for a server run from source. A launch whose own build (or, when either has none, whose version) differs asks that server to quit without `force`, waits for it to go and starts its own; with somebody in the room it opens that server's page as before and prints that the older server keeps running. Cost: opening a second copy of another build stops the first copy's hosting while its room is empty, and an invitation that was handed out for it stops working.
6. **App Translocation and logout are checked by hand on a copy of the built bundle, and changed only if the check shows a fault.** A server that is ended by the system at logout gets `SIGTERM` and quits as on a quit request; the hand check says whether macOS waits for it and whether anything is left. A quarantined copy that macOS translocates needs the owner's approval in the system's own dialogs, which the session cannot give; without it the check is recorded as not verified, for P6 and the signed build.

## Phases

One phase per working session; each ends with `npm run verify --prefix server` passing.

| Phase | Tasks | State |
|---|---|---|
| 1 | This plan; Tasks 1 to 3: a quit that asks, a new game, the room's options | Done 2026-11-21 |
| 2 | Tasks 4 and 5: the diagnostic report, a server of another build | Done 2026-11-21 |
| 3 | Tasks 6 and 7: the page's new controls, the instructions for the packaged path | Done 2026-11-21 |
| 4 | Tasks 8 to 10: by hand (the new controls, a replaced application, logout, App Translocation), the review, the records | Done 2026-11-21 |

## Status

**All four phases are done (2026-11-21).**

**Phase 1.** Tasks 1 to 3 are complete; nothing under `admin/`, `web/` or `research/network` changed. A quit with a player connected or a controller kept needs `force` at the server: `POST /api/host/quit` answers 409 with the counts, and the command is `quit [--force]` (D60). `POST /api/room/new-game` and the command `new-game [--force]` end the room's session and open the next one at once under the same links, through `RoomKeeper.renew()` (D61). `config.json` has `roomOptions`, changed only at rest, applied by `roomOptionsFor` at a start, and named by the status (D62). The control listener's boundary test asks for the new route, and the self-test's stand-in control has the new methods.

Every new test failed first: the listener's test of a quit with players on 202 where 409 was expected; the keeper's three tests on `room.renew is not a function`; the host's and the listener's tests of a new game on the missing method and route; the configuration's tests on the missing key and sentences, and the host's test file on the missing `roomOptionsFor`. The two smoke tests that changed or are new failed first on the build of slice 2 (`quit was expected to fail`, and the usage text where the sentence for players was expected). One test that pins what was there passed at once: an empty room, or a host without one, quits without force.

The first `npm run verify --prefix server` of the phase failed one smoke test, `the first run, as the page asks for it`, with 26 of 27, and kept no text of the failure. It did not come again in twelve runs of that test alone, four runs of the whole smoke suite and two runs of the build followed by the suite; its cause is not known and is left for the review of Task 9. `server/scripts/verify.mjs` now keeps the whole output of a failed check in `dist/verify/` and prints the path, with a test that failed first. The final run passed all 11 checks in 143 s: the server tests 234 of 234 on Node.js 24.18.0 and on the pinned 26.13.1 (222 before the slice), the network modules 71 of 71, the web client and the panel's page 107 of 107, the packaged build, and its smoke tests 27 of 27 (26 before). Nothing was checked by hand in this phase.

**Phase 2.** Tasks 4 and 5 are complete; nothing under `admin/`, `web/` or `research/network` changed. `POST /api/diagnostics/export` and the command `diagnostics` give the diagnostic report of decision 4 (D63); the command makes it itself when no server runs, with no host. The report is assembled by `HostControl.diagnostics`, from `server/src/diagnostics.ts` (`scrubLine`, `readLogTail`, `diagnosticReport`) and the new `server/src/runtime-manifest.ts`, which the plan's file list did not name. The instance record has `build`, and a launch replaces a server of another build when its status says that nobody is in its room (D64). Two deviations from decision 5, recorded in D64: a record without a build is another build (decision 5 compared versions then, which would have kept a packaged server of slice 2), and the launcher prints `otherBuild: true`, not `older: true`, because the running server may be the newer one. The unit tests' instance records now carry the version of the code under test and `build: null`, so that they describe a server of the same build.

Every new test failed first: `diagnostics.test.ts` on the missing module, the listener's report test on 404, the record test and the launcher's test on the missing `build` and on a launch that reused the other build's server without a word; the two new smoke tests failed on the build before them (the usage text for `diagnostics`, and `reused` where `replaced` was expected). The final `npm run verify --prefix server` passed all 11 checks in 150 s: the server tests 240 of 240 on Node.js 24.18.0 and on the pinned 26.13.1 (234 after phase 1), the network modules 71 of 71, the web client and the panel's page 107 of 107, the packaged build, and its smoke tests 29 of 29 (27 after phase 1). Nothing was checked by hand in this phase; the replacement of a real application is Task 8, step 2.

**Phase 3.** Tasks 6 and 7 are complete; nothing under `server/src`, `web/` or `research/network` changed. The page has the room's options (two choices of progress and "Separate cameras", locked as the setup is, with a note about the disc), `New game` beside the stop, and `Save diagnostics` beside Quit (D66, D67). A stop, a new game and a quit each send their request and ask from the server's 409 with its counts, and the second press says `force`; Quit is sent while the folder's request is under way (D65). A press now ends once the page shows what the server said after it, also when the page's own reading overtook the press's reading (D68). `docs/sled-storm-server.md` is the owner's guide to the packaged path, with a pointer in `README.md`, in `docs/README.md` and in "Build and run the current result"; every control, command, label and folder in it was checked against the page, `main.ts` and `paths.ts`.

Every new test failed first: the view's tests on the missing parts (`options`, `newGame`, `diagnostics`) and on Quit disabled during the folder's request; the controller's on `newGame is not a function`, on a quit that asked from the last reading, and on the missing `setOptions` and `saveDiagnostics`; the page's on the missing elements; the extended smoke test `the first run, as the page asks for it` on the build of phase 2 with `panel.setOptions is not a function`. The test of a press that a reading overtook failed with `the press waits for the newer reading` before D68. Three tests of this phase were wrong at first and were corrected, not the code: a stand-in status that still counted nobody after "a player joined", a dialog answered before the quit that ends it (the server answers the quit first), and a refusal's sentence expected to go when the dialog's request ended (a sentence stays until the next press).

The first run of that smoke test in this phase, on the build of phase 2, failed on a comparison of views before the page's first new request, and its text was not kept; fourteen runs after it, on both builds, did not fail there. Two races were found that fit: the one fixed by D68, and a reading before the server's start at launch, after which the page rightly shows "Needs setup" without the server's sentence; the smoke test now waits for that sentence. Which of the two it was, if either, is not known.

The final `npm run verify --prefix server` passed all 11 checks in 151 s: the server tests 240 of 240 on Node.js 24.18.0 and on the pinned 26.13.1 (unchanged), the network modules 71 of 71, the web client and the panel's page 116 of 116 (107 after phase 2), the packaged build, and its smoke tests 29 of 29. Nothing was checked by hand in this phase; the new controls in a real browser, and the file that "Save diagnostics" saves under the page's content security policy, are Task 8, step 1.

**Phase 4.** Tasks 8 to 10 are done. The real logout was checked at the end of the working session: with a copy of the final build hosting a room and the pane seated, the owner logged out and back in; the server logged `Stopping: SIGTERM.` 0.17 s after loginwindow's point of no return and `Stopped.` 76 ms later, nothing of the copy was left, macOS did not wait for it, and the owner saw only the usual question. The server had been started from a shell of the desktop application, so a logout with a server opened by a double click is not verified. The owner allowed every check to run alone; the Chrome extension was not connected. By hand, on scratch copies of the build without the tunnel program and the owner's disc: the room's options before a start and the room that a start made with them (`nativeCamera` with the verified PAL disc's camera), "New game" with the pane seated (the question, the players' sentence, the same link joined again), "Quit server" asked from the server's 409, Quit with the folder dialog open, and "Save diagnostics", whose file was saved by the pinned Chromium (the application's browser pane saves no download) and holds no folder or secret. A replaced application: with the old server of the slice 2 build (rebuilt from the snapshot) and a seated player the old server stayed; once the player had left, opening again replaced it within a tenth of a second. That hand check also found that the kept old server served the new build's page from the replaced bundle, so its Quit did not ask: the review found the same, and D69 fixes it. App Translocation: a quarantined copy approved by the owner in System Settings ran from the translocated bundle with its launcher gone, through a start, a new game and a stop and start, and the pane played. The details are in the main plan under "Hand checks of slice 3" and in the ledger.

The review, on Opus 5.5 after Fable 5.2 hit its usage limit, found no critical issue, one important (D69) and five minor: the quadratic filter (D70), the slow quit (D71) and two sentences of the guide are fixed, the stale stage row is closed by the records, and three emulators for up to 5 s during a load's new game stay open. Every fix has a test that failed first, but the guide; the review's two missing keeper tests are one pinned test. The server tests are 243 of 243 (240 before the review). The final `npm run verify --prefix server` is recorded in the main plan's verification log and in the ledger.

**Next:** stage P4, as "Where to continue" in the main plan says.

## Review Focus

1. A new game asked with players in the room, during a load, while the room restarts, after it failed, twice in a row, and together with a stop or a quit: the same links throughout, never a third emulator, the count of failures reset, and the players told in a sentence.
2. A quit with players: no way through the page or a command quits a room that has players without `force`; a signal from the system still quits; a dialog that is open closes.
3. The room's options never change while hosting is up; a disc other than the verified PAL one never gets unlocked content or separate cameras; the options in a link and in the room's identity always agree.
4. The diagnostic report: no folder path, token, session, invitation, room name or token, disc hash or public host name, even when the log holds one; a bounded size; a log that is missing, huge or not text.
5. A server of another build: never replaced with players in its room, never two stacks, never a loop of launches; a server of the same build is reused.

---

### Task 1: A quit that asks about players

**Files:**
- Modify: `server/src/host-control.ts`, `server/src/host-server.ts`, `server/src/instance.ts`, `server/src/control.ts`, `server/src/main.ts`
- Modify: `server/test/host-server.test.ts`, `server/test/fixtures.ts`, `server/test/public-boundary.test.ts`, `server/smoke/sea.test.mjs`

**Interfaces:**
- Produces: `HostControl.quit(force: boolean): InTheRoom | null`. With a player connected or a controller kept, and no `force`, it returns who is there; otherwise null. It quits nothing itself: the listener hands an accepted quit to the server.
- Produces: `POST /api/host/quit` takes the optional body of a stop. 202 `{ quitting: true }`, then the server quits; 409 `{ error: 'Players are in the room.', players }` without `force` while somebody is in the room; 415, 400 and 413 for a body that cannot be read, and no quit.
- Produces: `requestQuit(record, force = false): Promise<HostingAnswer | null>`.
- Produces: `quit [--force]`. A refusal prints `Players are in the room: 1 connected, 0 away with a controller kept. Add --force to quit anyway.` and exits 1; any other argument prints the usage and exits 2.

- [x] **Step 1: Write the failing tests.** `host-server.test.ts`: `a quit with players needs force, and its refusal says how many are there` (with `createHostControl` over the stand-in service: 409 with the counts for no body, `{"force":false}` and a kept controller; `onQuit` not called; `{"force":true}` is 202 and `onQuit` runs once; an empty room and a host without a room quit without force; a body that cannot be read quits nothing). `fixtures.ts`: the stand-in control writes down `quit` and `quit --force`. `public-boundary.test.ts`: the stand-in control's calls stay empty (unchanged assertion, now covering `quit` through the control). Smoke, in `the packaged server opens its room before any player, seats the first one, and quit ends its worker`: `quit` with the seated player exits 1 with the sentence and the server runs on; `quit --force` stops it.
- [x] **Step 2:** Run `npm test --prefix server`. Expected: the new tests fail, the older ones pass.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `npm run typecheck --prefix server && npm test --prefix server`. Expected: pass.

### Task 2: A new game for the room

**Files:**
- Modify: `server/src/room.ts`, `server/src/host-service.ts`, `server/src/host-control.ts`, `server/src/host-server.ts`, `server/src/instance.ts`, `server/src/control.ts`, `server/src/main.ts`
- Modify: `server/test/room.test.ts`, `server/test/host-service.test.ts`, `server/test/host-server.test.ts`, `server/test/fixtures.ts`, `server/test/public-boundary.test.ts`, `server/smoke/sea.test.mjs`

**Interfaces:**
- Produces: `RoomKeeper.renew(): boolean`. `open` or `restoring`: the session is stopped with `The host started a new game. Open the invitation again to join.`, and the next one opens at once, with the count of failed sessions at zero. `restarting`: the pause ends now, the count at zero. `failed`: as `start()`. `starting`: nothing. `off`: nothing, and false. True in every other case. The log says `The host started a new game.`
- Produces: `HostService.newGame(): boolean`: false without a stack that has a room, else the keeper's `renew()`.
- Produces: `HostControl.newGame(force: boolean): InTheRoom | Refusal | null`: 409 `The server is quitting.`; 409 `No room is open.` while the status's room is `off`; the players without `force` while somebody is in the room; otherwise it asks the service and returns null.
- Produces: `POST /api/room/new-game`, with the optional body of a stop: 202 `{ host }`, or the refusals above.
- Produces: `requestNewGame(record, force)` and the command `new-game [--force]`, printing `{ event: 'new-game', host }`. A refusal for players prints `Players are in the room: … A new game disconnects them. Add --force to start one anyway.`

- [x] **Step 1: Write the failing tests.** `room.test.ts`: `a new game ends the session and opens the next at once, without counting a failure` (stand-in sessions; with one pause of 5 s, a session that ends by itself makes the room `restarting`, and `renew()` opens the next at once; that session's own end is followed by the pause again, not by `failed`; `renew()` on an open room stops its session with the sentence and opens another without waiting); `a new game in a room that is loading a save ends the load with the session`; `a new game starts a failed room again, and changes nothing in a room that is off or starting`. `host-service.test.ts`: `a new game opens a new session of the same room, and the links stay` (stand-in browser: the second worker has the same room name; `invitation()` and `localInvitation()` are unchanged; `newGame()` is false without a stack). `host-server.test.ts`: `a new game goes through the control listener, and with players it needs force` (the spellings, origins and hosts of the stop test; 409 with the counts; `force` gives 202 and one `newGame`; `No room is open.`; `The server is quitting.`). `public-boundary.test.ts`: the stand-in control writes down `new-game`; nothing reaches it. Smoke: `a new game for the packaged server's room keeps its links` (stand-in browser and synthetic emulator: `new-game` gives the event, a second worker for the same room appears, `invitation` prints the same links; with a seated player `new-game` exits 1 with the sentence and `new-game --force` disconnects that player with the sentence).
- [x] **Step 2:** Run `npm test --prefix server`. Expected: fail.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `npm run typecheck --prefix server && npm test --prefix server`. Expected: pass.

### Task 3: The room's options

**Files:**
- Modify: `server/src/config-store.ts`, `server/src/host-control.ts`, `server/src/host-service.ts`, `server/src/control.ts`
- Modify: `server/test/config-store.test.ts`, `server/test/host-server.test.ts`, `server/test/host-service.test.ts`, and the stand-ins of the configuration and the status

**Interfaces:**
- Produces: `type RoomPreference = { progress: 'all' | 'original'; camera: boolean }`; `HostConfig.roomOptions: RoomPreference`, `{ progress: 'all', camera: true }` when the file has no key; a key that is not an object with exactly these two valid fields is a damaged file.
- Produces: `SavedConfig.roomOptions`. `PUT /api/config` takes `roomOptions` with both fields and nothing else, or answers 400 `The room options in the request are not valid.`; while hosting is up or a start is under way, 409 `Stop the room before changing the room's options.` (a request that also names the folder or the policy gets the sentence of slice 1). A change of the options alone does not call `configured()`.
- Produces: `roomOptionsFor(pal: boolean, chosen: RoomPreference): RoomOptions`. The verified PAL disc: the chosen progression and camera, with `nativeCamera: true` exactly when the camera is on. Any other disc: `{ progress: 'original', camera: false }`.
- Produces: `HostStatus.roomOptions: { progress, camera } | null`, the options of the room while a stack with a room is up.
- Produces: `configure` keeps `autoStart` and `roomOptions`.

- [x] **Step 1: Write the failing tests.** `config-store.test.ts`: `the room options are the web client's defaults unless the file says otherwise, and anything else is a damaged file`; the round trip of a written configuration with options; `configure keeps the switch and the room options`. `host-service.test.ts`: `the room's options follow the disc` (`roomOptionsFor` for both discs and both camera values: `nativeCamera` only with the PAL disc's camera); `a disc other than the verified PAL one plays with the original progression and a shared camera, whatever is saved` (stand-in browser and a synthetic disc with `all` and camera saved: the status's `roomOptions` and the options in `localInvitation()`'s fragment are `original` and no camera, and no `nativeCamera`). `host-server.test.ts`, in `the configuration is read and changed through the listener`: the options are read and saved; a partial object, an extra field, an unknown progression or a camera that is not a boolean is 400; while online, 409 with the sentence; `configured` is not counted for the options alone.
- [x] **Step 2:** Run `npm test --prefix server`. Expected: fail.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `npm run verify --prefix server`. Expected: pass.

### Task 4: The diagnostic report

**Files:**
- Create: `server/src/diagnostics.ts`, `server/test/diagnostics.test.ts`
- Modify: `server/src/host-control.ts` or `server/src/serve.ts` (where the report is assembled), `server/src/host-server.ts`, `server/src/instance.ts`, `server/src/control.ts`, `server/src/main.ts`
- Modify: `server/test/host-server.test.ts`, `server/test/fixtures.ts`, `server/test/public-boundary.test.ts`, `server/smoke/sea.test.mjs`

**Interfaces:**
- Produces: `scrubLine(line: string, secrets: { folder: string | null; home: string }): string`, the filter of decision 4.
- Produces: `readLogTail(file: string, { lines = 200, bytes = 65536 }): Promise<string[]>`, the last whole lines; a missing file gives none; bytes that are not UTF-8 are replaced.
- Produces: `diagnosticReport({ paths, version, status, config, now, startedAt }): Promise<object>` with the fields of decision 4. The runtime manifest is read from the resource root, or null.
- Produces: `POST /api/diagnostics/export`, no body read, control credential or panel session: 200 with the report.
- Produces: `requestDiagnostics(record)` and the command `diagnostics`, printing the report.

- [x] **Step 1: Write the failing tests.** `diagnostics.test.ts`: `the filter takes out folders, tokens, public names and fragments` (each kind, two on one line, a folder with spaces and non-ASCII letters, the home folder as a prefix of the saved one); `the tail of the log is its last whole lines, within the bound`; `a report holds no secret even when the log does` (a log seeded with the folder, a 64-digit token, an invitation link with its fragment and a `trycloudflare.com` name: none of them in the report's JSON, and the status, the configuration without the path and the manifest are there). `host-server.test.ts`: the route's credentials, spellings and methods. `public-boundary.test.ts`: nothing reaches it. Smoke: `the diagnostic report of the packaged server names no folder and no secret` (configured server: `diagnostics` prints a report with the manifest's versions, and neither the folder nor the instance token appears in it).
- [x] **Step 2:** Run the tests. Expected: fail.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `npm run typecheck --prefix server && npm test --prefix server`. Expected: pass.

### Task 5: A server of another build

**Files:**
- Modify: `server/src/instance.ts`, `server/src/serve.ts`, `server/src/control.ts`
- Modify: `server/test/instance.test.ts`, `server/smoke/sea.test.mjs`

**Interfaces:**
- Produces: `InstanceRecord.build: string | null`; a record without the key reads as null. `serve` records the `server.sha256` of its resource root's manifest, or null.
- Produces: `launch` compares the record's build and version with its own (decision 5). Another build, nobody in its room: `requestQuit(record)`, wait until the record's server is gone (at most `QUIT_WAIT_MS`), start its own and print `{ event: 'replaced', pid, url }`. Somebody in the room, or a quit that is refused or not finished in time: open that server's page as before and print `{ event: 'reused', pid, url, older: true }`.

- [x] **Step 1: Write the failing tests.** `instance.test.ts`: a record with and without `build`. Smoke: `a launch of another build replaces an idle older server, and leaves one with players` (two staged copies whose manifests differ in `server.sha256`, one data location: the second launch quits the first server and starts its own, one server throughout; with a seated player the second launch reuses the first and says so; a launch of the same build reuses it).
- [x] **Step 2:** Run the tests. Expected: fail.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `npm run verify --prefix server`. Expected: pass.

### Task 6: The page's new controls

**Files:**
- Modify: `admin/index.html`, `admin/panel.css`, `admin/panel.js`, `admin/view.js`, `admin/controller.js`
- Modify: `admin/view.test.mjs`, `admin/controller.test.mjs`, `admin/page.test.mjs`, `server/smoke/sea.test.mjs`

**Interfaces:**
- `panelView` gains: `options: { progress, camera, locked, note }` from the configuration, locked as the setup is, and `note` saying that unlocked content and separate cameras need the verified PAL disc, or, while a room runs with another disc, that it plays with the original progression and a shared camera; `newGame: { shown, enabled, label }`, shown while a room exists, `New game`, or `New game anyway` while `confirming` is `'newGame'`; `diagnostics: { enabled }`.
- `createPanel` gains `newGame()`, `setOptions(change)` and `saveDiagnostics()`, and a dependency `save(name, text)` that the page implements with a `Blob` and a link with `download`. A quit sends `POST /api/host/quit` and asks from the server's 409 with its counts, as a stop does; the question no longer comes from the last reading.
- While the folder's request is under way, Quit stays enabled; a quit then ends the dialog (the server's `close()`), and the folder's request is answered `The server is quitting.`

- [x] **Step 1: Write the failing tests.** `view.test.mjs`: the options for both discs, locked while hosting; `New game` and its question; Quit enabled during the folder's request only. `controller.test.mjs`: `a new game with players asks first, then sends force`; `a quit is asked about from the server's refusal, not from the last reading` (the last reading counts nobody, the server answers 409, the page asks, the second press sends force); `a quit during the folder's dialog is sent`; `the options are saved by one request`; `the diagnostic report is saved as a file named by the date`. `page.test.mjs`: the new elements exist once and are written as text. Smoke: the requests of the page for the options, a new game and the report, each with a session.
- [x] **Step 2:** Run `node --test "admin/*.test.mjs"` and the smoke tests. Expected: fail.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `npm run verify --prefix server`. Expected: pass.

### Task 7: Instructions for the packaged path

**Files:**
- Create: `docs/sled-storm-server.md`
- Modify: `README.md` (a short section that points to it), `docs/sea-server-plan.md` ("Build and run the current result")

- [x] **Step 1:** Write what an owner needs: what the build is and is not yet (an internal preview, ad-hoc signed), moving it to Applications, the first run, the folder dialog and the disc policy, start, invitation, "Open game", a new game, the room's options, stop and quit with players, the switch for starting at launch, the diagnostic report and where the data, the log and the cache are, what happens at logout and on replacing the application, and how to remove it. Every sentence names what the build does today; nothing that was not checked is promised.
- [x] **Step 2:** Check every name of a control, command and folder against the code and the page.

### Task 8: The real thing, by hand

A copy of the built bundle without the tunnel program, `SLED_SERVER_HOME` in a scratch folder. Ask the owner first, in one question, for what only eyes or the Chrome extension can see.

- [x] **Step 1:** On the owner's disc: the room's options before a start and the room that a start makes with them; "New game" with the pane seated asks, disconnects the pane with the sentence and the same link joins again; "Quit server" with the pane seated asks from the server's answer; Quit with the folder dialog open ends the dialog; "Save diagnostics" saves a file, which is read for folders, tokens, links and host names.
- [x] **Step 2:** A replaced application: with the copy's server running and its room empty, the copy is replaced by a newer build and opened: the old server quits and the new one serves the page. With a seated player: the old server stays.
- [x] **Step 3:** Logout, if the owner agrees to log out and back in: the log says how the server ended, nothing of the copy is left, and macOS did not wait for it. Otherwise `SIGTERM` with a room and a seated player, and the real logout recorded as not verified.
- [x] **Step 4:** App Translocation, if the owner agrees to approve a quarantined copy in the system's dialogs: the path the server runs from, and whether its resources stay readable after the launcher has gone, through a start and a new game. Otherwise recorded as not verified.

### Task 9: Review

- [x] **Step 1:** One independent reviewer on the most capable model, from a diff against the review base, with this plan's Review Focus. It saves its findings as it goes.
- [x] **Step 2:** Fix critical and important findings test first, and the minor ones that are cheap and clearly right.

### Task 10: Records

- [x] **Step 1:** `docs/sea-server-plan.md`: slice 3 results under P3, what was not verified, what stays open, the verification log, the decisions, the stage's status and a new "Where to continue". `CHANGELOG.md`.
- [x] **Step 2:** Run every check on the final tree.
