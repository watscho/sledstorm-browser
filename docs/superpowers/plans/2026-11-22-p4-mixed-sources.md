# P4 slice 3: the player's screen and one room from mixed sources

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player chooses where the disc comes from, with the three choices of the brief's §11.2: their own game files, a saved ZIP, or the server's download where the server allows it. A copy chosen once is used again on the same address without a new picker or a new download, and one dedicated room takes players from all three sources at once, because the room compares the disc, not the way it came. DATA-02 end to end and the exit checks of P4.

**Architecture:** A new module of the page, `web/disc-source.js`, holds the logic of the choice: which sources a session offers, which one is preselected, what a chosen copy gives (the disc's files or the exact copy of the server's archive, with its identity, checked against the room's disc), and how a chosen copy is remembered and restored through handles of the File System Access API. It takes its storage and its handles as arguments, so its tests run in Node with stand-ins; `web/game-data-folder.js` gives it the real IndexedDB store and the pickers. `web/app.js` then asks it in the two places that need a disc (the start and the saved games list) whatever the disc policy, and the download keeps its current code. The server does not change: it already announces the room's disc identity under both policies (D74), and the gateway only gains the new module on its list.

**Tech Stack:** plain JavaScript modules of the page, run in Node.js for their tests (`node:test`, `File`, `crypto.subtle`, `DecompressionStream`); the File System Access API (`showOpenFilePicker`, `FileSystemFileHandle.queryPermission`, `requestPermission`) where the browser has it; IndexedDB for the handles.

**Spec:** the owner's brief "Sled Storm Server — Node SEA", sections 11.2, 11.3, 11.5 and 15.2 (DATA-02, and the exit checks of P4 in the stage table), outside the repository, and `docs/sea-server-plan.md`, "P4 Independent data sources".

**Review base:** the state that P4 slice 2 left, the ignored file `.superpowers/sdd/p4-slice-2-tree.tar`. On 2026-11-22, before the first change of this slice, all 220 files that Git does not ignore were equal to it, byte for byte. A commit of P3 and P4, if the owner asks for one, replaces it.

## Global Constraints

- No push, no release, no published binary. No per-task commit; the owner commits.
- Code, comments and committed documents in English. The owner is answered in Russian.
- The game disc, its hashes, private links, room identifiers, public host names and every token stay out of Git, logs, the status, the diagnostic report and standard output. Fixtures are made of synthetic bytes only.
- No automated test starts the real Chromium, a tunnel, the network, the user's browser or a system dialog (D44, D49).
- The disc identity's algorithm does not change (brief §11.3), and neither does the room identity's list of fields (P2): how the disc reached a player is not part of either.
- Under `local-only` the page never offers the download and never asks for `/disc.zip` through the gateway (DATA-01, slice 1); the gateway's refusals stay as they are.
- No disc bytes are copied into the browser's storage to remember a copy: only handles and the identity they gave (brief §11.5: a portable ZIP and a new choice solve reuse between addresses). The download's Cache Storage copy stays as 1.1.0 keeps it.
- Resumable delivery, chunk routes, OPFS and a limit on the host's delivery are P5, not this slice.
- `server.py` and `tools/play-online.py` keep working: the page they serve gains one module, which their static listener serves as it is.

## Decisions taken with this plan

1. **Three choices on one screen (D87).** The Game files tab holds one group of three choices, in the brief's order and words: "Use my game files", "Use saved ZIP", "Download from server"; the last only when the session offers the disc (`discMode` is `shared` after the gateway's header, D73). It is shown on every page whose disc is not fixed (not the dedicated worker, the lab or the console), the host's own page included. The preselected choice is the one made last on this address while it is still offered, else the kind of a copy remembered there (D88), else the download where it is offered, else the player's files. The launch summary gets a "Game data" row that names the choice and says whether it is ready; Join with nothing chosen opens the Game files tab and says what to choose. Under `shared-allowed` a guest may now play from their own files or ZIP, which the page did not offer before. Cost: a guest of a `shared-allowed` room sees a choice where 1.1.0 showed none; it is preselected to the download, as before.
2. **A chosen copy is remembered by its handles (D88).** Where the browser has `showOpenFilePicker` (Chromium), "my game files" and "saved ZIP" open it (several files for the first, one ZIP for the second), and once the page has checked the copy (when it is chosen, or at Join for a copy restored from an earlier visit) while it is still the chosen one, its handles and the disc identity they gave are kept for the address in the existing IndexedDB database `sledstorm-game-data`, under the key `source`. On a later visit: read access granted, the copy is used without a picker; access to be asked again (`prompt`), Join asks with its click, without a picker; access refused, a file gone, a record of another disc, or no record, nothing is restored; a file found gone after access is asked again refuses that copy at Join. Elsewhere the file inputs are used, and the choice lasts as long as the page: the help says so. The record of wrapper 1.0 (`selected`: a Quick Tunnel's saved ZIP with its archive's SHA-256) is read as a saved ZIP when that SHA-256 is the room's archive's. Cost: what Chrome asks when access is renewed is Chrome's; whether it asks once for all of an address's files or once per file is checked by hand (Task 7).
3. **The chosen copy is compared with the room's disc before joining (D89).** When the session info names the room's disc identity (the packaged server always does, D74; the Python launcher in its shared mode), the page refuses a copy whose identity differs, before it connects: `These game files are not the disc this room plays. Use the host's CUE and BIN files under the same names, or a ZIP of them.` Where it names none (the Python launcher's local mode, `disc: null`), the room compares, as before. Cost: none known; the room's own check (ROOM-05) stays.
4. **A compressed ZIP says what it costs (D90).** Each disc item that `readDiscZip` gives carries `held`: the bytes its `data` keeps in the browser's blob store, the entry's size when it was deflated and 0 when stored. When a chosen ZIP holds any, the page says how much the browser keeps while the game runs and that the CUE and BIN files, or an uncompressed ZIP such as the server's own archive, avoid it. This settles the first item of "Open after slice 2". Cost: one more field on the reader's items, which the identity ignores.
5. **The download stays as 1.1.0 does it (D91).** "Download from server" fetches the whole `/disc.zip`; on a stable address "Keep game data" keeps it in Cache Storage; on a Quick Tunnel the dialog offers "Save a ZIP and join", whose saved file then becomes the remembered saved ZIP and the last choice, and its "Use existing ZIP" now chooses the saved ZIP source, which takes any compatible ZIP (D89), not only the exact copy. Cost: none; P5 replaces the transfer.

## Phases

One phase per working session; each ends with `npm run verify --prefix server` passing.

| Phase | Tasks | State |
|---|---|---|
| 1 | This plan; Tasks 1 to 3: what a ZIP holds in memory, the choice's logic, remembering a copy | Done 2026-11-22 |
| 2 | Tasks 4 to 6: the screen, the page's two paths through the chosen source, the gateway and the smoke test | Done 2026-11-22 |
| 3 | Tasks 7 to 9: one room from three sources by hand, the review, the records and the end of P4 | Done 2026-11-22 |

## Status

**Phase 1 is done (2026-11-22).** Before the first change the working tree was checked equal to `.superpowers/sdd/p4-slice-2-tree.tar` (220 files, none differing), and no other chat in this folder was running. The plan's decisions are D87 to D91 in the main plan's table; the ledger has every ruling.

Task 1: each item of `readDiscZip` carries `held` (the entry's size when deflated, 0 when stored); its test failed first with `held` undefined.

Task 2: `web/disc-source.js` exports `offeredSources`, `initialSource`, `checkRoomDisc`, `heldBytes` and `copyDisc`; `web/disc-source.test.mjs` failed first on the missing module. DATA-02 in the page: the Unicode disc's own files, a deflated ZIP of it and the server's canonical archive give the room's identity (the last by the fast path); the ASCII disc is refused with D89's message where the room names its disc, and taken where it names none. D89's message was settled before the code as `These game files are not the disc this room plays. Use the host's CUE and BIN files under the same names, or a ZIP of them.`

Task 3: `rememberCopy`, `restoreCopy` and `reopenCopy` in `web/disc-source.js`, tested with a store of a `Map` and stand-in handles (access granted, to be asked, refused; a file gone; another disc; wrapper 1.0's record; a store that refuses); `reopenCopy` asks only the handles whose access does not hold. `web/game-data-folder.js` gives `gameDataStore` (the same database and object store as 1.0, through which 1.0's `selected` record now goes), `canKeepCopies` and `pickCopy`; the old dialog's functions stay until Task 5. Eight mutants of the new module were run in place and restored; all were killed.

The final `npm run verify --prefix server` passed all 11 checks in 154 s: the server tests 247 of 247 on Node.js 24.18.0 and on the pinned 26.13.1, the network modules 71 of 71, the web client and the panel's page 163 of 163, the packaged build, and its smoke tests 30 of 30. The log is `.superpowers/sdd/2026-11-22-p4-mixed-sources/verify-phase-1.log`. Nothing was checked by hand, and nothing changed on the screen: the page does not import the new module yet.

**Phase 2 is done (2026-11-22).** No other chat in this folder was running at its start. The ledger has every ruling; the ones that change what the plan said are named here.

Task 4: the Game files tab holds `fieldset#disc-source` with the three radios of D87, a "Choose files" and a "Choose ZIP" button over hidden inputs (`#disc-files`, `accept=".cue,.bin"`; `#disc-zip`, `accept=".zip"`), and the download's "Keep game data" block moved under its radio; the launch summary has a "Game data" row. `lobby.discSources(offered, initial, keeps)` replaces `lobby.discMode`, with `discSource`, `lastDiscSource`, `selectDiscSource`, `describeDisc` and `showDiscChoice`. The launch button turns green whenever the chosen copy is ready, and 1.1.0's `Join game · Ready` / `· ZIP selected` labels go; "Reset settings" no longer clears the chosen files. The panel's note under local-only now says `choose their own game files or a saved ZIP` (its test failed first on the old words); the guide has "What your guests choose".

Task 5: `web/app.js` takes the disc from the chosen source on both paths, whatever the policy: a copy of files or a ZIP through `copyDisc`, the download as before (`sharedDiscFile`). A copy is checked as soon as it is chosen (a ruling: another disc is refused and D90's notice shown before Join; the cost is that a deflated ZIP is inflated when chosen), and a copy restored from an earlier visit at Join, after `reopenCopy` where access must be asked again; D88's wording changed accordingly ("once the page has checked the copy"). A refusal is final for that copy. A load request keeps its own files as before. The lab and the console keep the server's disc where the session gives it. The Quick Tunnel dialog's "Use existing ZIP" chooses the saved ZIP source; a ZIP saved after a download is remembered by `rememberCopy`. 1.0's dialog functions left `web/game-data-folder.js` (`matchingGameArchive` stays, the ZIP reader uses it), and their four tests left `web/game-data-folder.test.mjs`. Step 4 ran in the pinned Chromium on `web/` with a stand-in session info (`page-load.mjs` in the ledger folder), not on the bundle (a ruling): three choices under the server's disc, two under the gateway's local header with a remembered download not brought back, Start with nothing chosen opening the tab, another disc refused with D89's message, the room's disc as files and as a deflated ZIP with D90's notice, no request for `/disc.zip`, no console error. It found a bug that was fixed: a source inside the closed tab could not be chosen, so "Use existing ZIP" would not have chosen the ZIP; the script shows it failing on the old code.

Task 6: `/disc-source.js` is on the gateway's list (the gateway test failed first with 403); the smoke test reads it, the group and both inputs through the gateway under local-only.

`npm run verify --prefix server` passed all 11 checks in 156 s: the server tests 247 of 247 on Node.js 24.18.0 and the pinned 26.13.1, the network modules 71 of 71, the web client and the panel's page 159 of 159, the packaged build, and its smoke tests 30 of 30 (`verify-phase-2.log` in the ledger folder). Nothing was checked by hand with a person or the real emulator.

**Phase 3 is done (2026-11-22).** The owner was away until 10:00 and asked that nobody be waited on, so the hand check ran alone and headless, with temporary ZIPs of the disc in the chat's scratch folder as in slice 2, deleted after. The ledger has every ruling; the review's report is `review.md` beside it.

Task 7: the bundle that phase 2's last full check built held the old guard of `lobby.selectDiscSource` (the file had been put back for the scripted load's check of the old code while that check built the bundle); rebuilt, and the hand check run on fresh copies. On a scratch copy of the bundle with the tests' tunnel stand-in, the real emulator and the owner's disc, under `shared-allowed`: the owner's page downloaded over loopback (controller 1); guests through the gateway's loopback port played from their own files (2), Finder's ZIP (3, with D90's notice) and the download (4), in one race on Pine Valley; a synthetic other disc was refused at once with D89's message. Each guest came back from the lobby with its copy and no new picker or download; a remembered copy with one byte changed was refused at Join and not played. Under `local-only` a fresh guest saw two choices, joined from its files without asking for `/disc.zip`, and its probes of `/disc.zip` got 403. The picker was a page script over the origin's private file system (`player.mjs` in the ledger folder drives each player): the real picker, Chrome's prompt to renew access and the Quick Tunnel dialog were not run.

Task 8: Opus 5.5 reviewed (Fable 5.2 stopped at once on its usage limit): no critical finding, two important and six minor, all checked against the code. Fixed, test first: a remembered copy found gone after access is asked again is refused with a plain message instead of a browser error repeated at every Join (I1); the last choice is preselected before a remembered copy, as D87 says, against the Task 5 interface that put the copy first, and a slow check of a copy left behind no longer replaces the remembered one (I2); a check of a copy no longer chosen does not write the status line (M1); the messages name the button pressed (M2); the game data dialog's joins start from the download, and a refused "Use existing ZIP" opens the Game files tab (M3); Join with a copy already refused opens the tab before any request (M4); each radio's help is read once and the memory notice is announced (M5); the tests that M6 found missing. Left open: an automated test of phase 2's `selectDiscSource` bug (the page's Node tests have no DOM; `page-load.mjs` shows it), and a stalled IndexedDB at load (not seen; the database's version does not change). The fixes were shown failing first by `web/disc-source.test.mjs`, `web/lobby-markup.test.mjs` and the scripted check `review-fixes.mjs`, and checked once more on the rebuilt bundle with the real emulator.

Task 9: the slice's and P4's records in `docs/sea-server-plan.md`, `CHANGELOG.md`, and the archive `.superpowers/sdd/p4-slice-3-tree.tar` as the base of P5's first review. `npm run verify --prefix server` passed all 11 checks in 154 s after the fixes (the web client and the panel's page 163 of 163); the final run on the tree with the records is in the verification log.

**Next:** P5, Resumable delivery, in a new session (see "Where to continue" in `docs/sea-server-plan.md`).

## Tasks

### Task 1: What a ZIP keeps in memory

**Files:**
- Modify: `web/disc-zip.js` (`readDiscZip`), `web/disc-zip.test.mjs`

**Interfaces:**
- Produces: each item of `readDiscZip(file, report)` is `{ name, size, data, held }`; `held` is `entry.size` when the entry was deflated, `0` when stored. `discFromZip` passes the items on unchanged.

- [x] **Step 1: Write the failing test** `a deflated entry says what it keeps in memory`: the fixture archive `zip -X -0 -r` (stored) gives `held` 0 on every item; the fixture `zip -r: deflated, names in UTF-8 without the flag, the CUE in a folder` gives `held === size` on each item whose entry is deflated and 0 on any stored one (read the methods from the archive's central directory in the test).
- [x] **Step 2:** Run `node --test web/disc-zip.test.mjs`. Expected: FAIL (`held` undefined).
- [x] **Step 3:** Set `held` where `readDiscZip` builds the items.
- [x] **Step 4:** Run `node --test "web/*.test.mjs"`. Expected: PASS.

### Task 2: The choice's logic

**Files:**
- Create: `web/disc-source.js`, `web/disc-source.test.mjs`

**Interfaces:**
- Consumes: `chosenDisc(list, archive, report)` from `web/local-disc.js`; `identifyDisc(files, report)` from `web/disc-identity.js`; Task 1's `held`.
- Produces, in `web/disc-source.js`:
  - `offeredSources(info): string[]`: `['files', 'zip', 'download']` when `info.discMode === 'shared'`, else `['files', 'zip']`.
  - `initialSource(offered: string[], last?: string): string`: `last` when offered, else `'download'` when offered, else `'files'`.
  - `checkRoomDisc(info, disc: string): void`: throws `Error` with D89's message when `info.disc` is 64 lowercase hexadecimal digits and differs from `disc`.
  - `heldBytes(files): number`: the sum of the items' `held` (missing counts 0).
  - `copyDisc(list, info, report?): Promise<null | { archive: File, disc, pal } | { files, disc, pal, held }>`: `null` for an empty list; the exact copy of `info.archive` gives `{ archive }` with the session info's `disc` and `pal` (D74); any other choice is identified with `identifyDisc`, checked with `checkRoomDisc`, and given with its `held`. A refusal of `chosenDisc` or of the check is final.

- [x] **Step 1: Write the failing tests** in `web/disc-source.test.mjs`, from `web/disc-identity.fixtures.json`:
  - `the sources a session offers`: `offeredSources({ discMode: 'shared' })` is `['files', 'zip', 'download']`; `{ discMode: 'local' }` gives `['files', 'zip']`.
  - `the preselected source never offers what the session does not`: `initialSource(['files', 'zip'], 'download') === 'files'`; `initialSource(['files', 'zip', 'download'], 'zip') === 'zip'`; `initialSource(['files', 'zip', 'download'], undefined) === 'download'`; `initialSource(['files', 'zip'], 'nonsense') === 'files'`.
  - `three sources of one disc give the room's identity` (DATA-02 in the page): for the Unicode disc, with `info = { discMode: 'shared', disc, pal, archive: manifestOf(canonical archive) }` (the helper of `disc-zip.test.mjs`, moved into the test file or a shared test helper): the CUE and BIN files give `{ files, disc, pal, held: 0 }`; the deflated ZIP fixture gives the same `disc` and `held > 0`; the canonical archive gives `{ archive }` with `info.disc`.
  - `another disc is refused before joining`: the ASCII disc's files against the Unicode disc's `info` reject with D89's message exactly; with `info.disc === null` they resolve with their own identity.
  - `heldBytes` adds the items' `held` and counts a missing one as 0.
- [x] **Step 2:** Run `node --test web/disc-source.test.mjs`. Expected: FAIL (no module).
- [x] **Step 3:** Implement `web/disc-source.js`.
- [x] **Step 4:** Run `node --test "web/*.test.mjs"`. Expected: PASS.

### Task 3: Remembering a chosen copy

**Files:**
- Modify: `web/disc-source.js`, `web/disc-source.test.mjs`, `web/game-data-folder.js`

**Interfaces:**
- Produces, in `web/disc-source.js` (a `store` is `{ get(key), put(key, value), delete(key) }`, each a promise; a handle is a `FileSystemFileHandle` or a stand-in with `name`, `getFile()`, `queryPermission({ mode })`, `requestPermission({ mode })`):
  - `rememberCopy(store, { kind: 'files' | 'zip', handles, disc }): Promise<void>`: puts `{ kind, handles, disc }` under `source`; a storage error is swallowed (it must not stop a start).
  - `restoreCopy(store, info): Promise<null | { kind, handles, files?: File[] }>`: reads `source`, or else the legacy `selected` (`{ sha256, handle }`, a saved ZIP when `sha256 === info.archive?.sha256`); `null` when there is none, when its `disc` is not `info.disc` while both are hashes, when any handle's permission is `denied`, or on any error; `{ kind, handles }` when a permission is `prompt`; `{ kind, handles, files }` when every one is `granted` and each `getFile()` resolved.
  - `reopenCopy(copy): Promise<File[]>`: `requestPermission({ mode: 'read' })` on each handle, called from Join's click; anything but `granted` throws `Allow access to your game files to join. You can retry with Join game.`; then `getFile()` on each.
- Produces, in `web/game-data-folder.js`: `gameDataStore` (the store over the database `sledstorm-game-data`, version 1, object store `handles`, as `archiveHandle` opens it today); `canKeepCopies` (`showOpenFilePicker` is a function); `pickCopy(kind): Promise<{ handles, files }>` (`showOpenFilePicker` with `multiple: kind === 'files'`, types `.cue`/`.bin` for files and `.zip` for a ZIP, `startIn: 'downloads'`). The functions of 1.0 that only the old dialog uses go when Task 5 no longer calls them.

- [x] **Step 1: Write the failing tests** with a store of a `Map` and stand-in handles:
  - `a remembered copy comes back without a picker while access holds`: remember `{ kind: 'files', handles: [cue, track], disc }`; `restoreCopy` with every permission `granted` gives the same `kind` and the files of `getFile()`.
  - `a copy whose access must be asked again waits for Join`: one permission `prompt` gives `{ kind, handles }` and no `files`; `reopenCopy` with `requestPermission` answering `granted` gives the files; answering `denied` rejects with the message above, and the record is still in the store.
  - `a refused, missing or foreign copy preselects nothing`: a permission `denied`, a `getFile()` that rejects, a record whose `disc` differs from `info.disc`, and an empty store each give `null`; a record with `disc` and `info.disc === null` is restored.
  - `the saved ZIP of wrapper 1.0 is read as a saved ZIP`: `selected` with the room's archive SHA-256 gives `{ kind: 'zip', handles: [handle], files }`; with another SHA-256, `null`.
  - `remembering survives a store that refuses`: a store whose `put` rejects resolves `rememberCopy`.
- [x] **Step 2:** Run `node --test web/disc-source.test.mjs`. Expected: FAIL.
- [x] **Step 3:** Implement the three functions, then `gameDataStore`, `canKeepCopies` and `pickCopy` in `web/game-data-folder.js` (browser glue, exercised by hand in Task 7).
- [x] **Step 4:** Run `npm run verify --prefix server` in the background. Expected: every check passes; the page does not import the module yet, so the gateway's list does not change.

### Task 4: The screen

**Files:**
- Modify: `web/index.html`, `web/lobby-ui.js`, `web/style.css`, `admin/index.html` and its test if it pins the note, `docs/sled-storm-server.md`

**Interfaces:**
- Consumes: `offeredSources`, `initialSource` (Task 2).
- Produces: in `web/index.html` a `fieldset#disc-source` with radios `name="disc-source"` and values `files`, `zip`, `download`, the labels of D87, a line of help under each, a "Choose files" and a "Choose ZIP" button with hidden file inputs `#disc-files` (`multiple`, `accept=".cue,.bin"`) and `#disc-zip` (`accept=".zip"`) for browsers without the picker, `#disc-selection` for what is chosen; the download's "Keep game data" moves under its radio. `lobby.discSources(offered, initial)` replaces `lobby.discMode(mode)`: it hides the download where it is not offered, checks `initial`, remembers the last choice in the lobby's settings (`discSource`), and fills a `#summary-disc` row ("Download from server", "My game files · ready", "Saved ZIP · choose a file"). `lobby.showDiscChoice()` opens the Game files tab and focuses the group.

- [x] **Step 1: Write the failing test** where a test pins words: the panel's note under `local-only` names what a guest chooses ("their own game files or a saved ZIP").
- [x] **Step 2:** Build the group and the summary row; replace the field's old wording ("or one ZIP that holds them"); under a radio without the picker, the help says the choice lasts until the page is reloaded. The guide's section for guests lists the three choices and which policy offers the download.
- [x] **Step 3:** Run `node --test "admin/*.test.mjs" "web/*.test.mjs"`. Expected: PASS.

### Task 5: The page's two paths through the chosen source

**Files:**
- Modify: `web/app.js`

**Interfaces:**
- Consumes: Tasks 2 and 3, Task 4's `lobby.discSources`, `lobby.showDiscChoice`, the radios and inputs.

- [x] **Step 1:** At load, after the session info: `offeredSources`, `restoreCopy(gameDataStore, info)` where `canKeepCopies`, `initialSource(offered, remembered kind or the lobby's last choice)`; a restored copy with `files` is shown as ready, one with only `handles` as "Press Join game to allow access again".
- [x] **Step 2:** The start path and the saved games list both take the disc from the chosen source: `files` or `zip` through `copyDisc` (after `reopenCopy` when access must be renewed, called first in Join's handler for its activation), whatever `discMode` is; `download` as today (`sharedDiscFile`). After `copyDisc` resolved for a picked or restored copy with handles, `rememberCopy`. A choice with `held > 0` shows D90's notice. Join with nothing chosen calls `lobby.showDiscChoice()` with the status `Choose your game files or a saved ZIP to join.`
- [x] **Step 3:** The Quick Tunnel dialog's "Use existing ZIP" picks a ZIP with `pickCopy('zip')` and selects the saved ZIP source; "Save a ZIP and join" and "Join without saving" stay. Remove what no longer has a caller in `web/game-data-folder.js`.
- [x] **Step 4:** Run `node --test "web/*.test.mjs"` and load the page once in the pinned Chromium from a scratch copy of the bundle (no console error at load, the group shows three choices under `shared-allowed` and two under `local-only`).

### Task 6: The gateway and the smoke test

**Files:**
- Modify: `research/network/emulator-assets.mjs`, `research/network/gateway.test.mjs`, `server/smoke/sea.test.mjs`

- [x] **Step 1: Write the failing tests:** the gateway test's list of served modules gains `/disc-source.js` (fails with 403); the smoke test reads `/disc-source.js` through the gateway under `local-only` and finds `name="disc-source"` and `accept=".cue,.bin"` in the page it serves.
- [x] **Step 2:** Add `/disc-source.js` to the gateway's list.
- [x] **Step 3:** Run `npm run verify --prefix server` in the background. Expected: every check passes.

### Task 7: By hand

Ask the owner first, in one question, whether the owner will watch (the real picker and Chrome's prompt to renew access need eyes or the Claude in Chrome extension) and whether temporary ZIPs of the disc may be made in the scratch folder (deleted after).

- [x] **Step 1:** One room under `shared-allowed`, on a scratch copy of the bundle with the tests' tunnel stand-in and the probe off, the real emulator, the default ports and the owner's disc: the owner's page downloads over loopback; guests through the gateway's loopback port with their own files, with a saved ZIP (Finder's Compress) and with the download. All four seated in one room, a race started.
- [x] **Step 2:** Under `local-only`: the guest's group offers two choices; no request for `/disc.zip`.
- [x] **Step 3:** Reuse: a guest who returns to the lobby, changes the image filter and joins again is not asked for a file and downloads nothing again; a guest's page reloaded on the same address starts with its copy and no picker (in the pinned Chromium the picker is replaced by a page script that returns handles of the origin's private file system, whose access is always granted); with the owner, the real picker and Chrome's prompt after a restart of the browser.
- [x] **Step 4:** A copy of another disc (synthetic) is refused before joining with D89's message; a remembered copy whose file was changed is refused at Join and not played.
- [x] **Step 5:** Record what was seen and what was not verified.

### Task 8: The independent review

- [x] **Step 1:** The review on the most capable model that takes requests, from a diff against the review base, with the focus below. It saves its findings as it goes; its final message is the report.
- [x] **Step 2:** Fix critical and important findings test first, and the cheap minor ones; list the rest as open.

### Task 9: Records and the end of P4

- [x] **Step 1:** `docs/sea-server-plan.md`: the slice's results, hand checks, what was not verified, what stays open, D87 to D91, the verification log, P4's exit checks and its state in the status table, and a new "Where to continue" that names P5. `CHANGELOG.md`.
- [x] **Step 2:** Run every check on the final tree, and make `.superpowers/sdd/p4-slice-3-tree.tar` the base of P5's first review.

## Review Focus

1. A remembered copy whose files were changed, moved or deleted since: refused at Join with a clear message, never played as the old disc, and no silent fall back to the download (Task 3's foreign-copy test, Task 7 step 4).
2. A player who cancels a picker or refuses access: stays on the screen with the other choices working, and nothing remembered is lost (Task 3's `denied` test; a cancelled picker is an `AbortError` that Task 5 ignores).
3. Under `local-only`, a last choice of `download` remembered from an earlier `shared-allowed` session on the same address never brings the download back (Task 2's `initialSource` test, Task 7 step 2).
4. A player who changes the source after choosing (files, then the download) gets the new source; the start path does not keep the old files (Task 5, by hand in Task 7).
5. A guest with another disc under `shared-allowed` is told before joining, and the room's own check still refuses a page that skipped it (Task 2's refusal test; ROOM-05 stays in the server's tests).
