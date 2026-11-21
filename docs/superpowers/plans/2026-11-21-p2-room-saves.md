# P2 slice 2: saving in the server's room, and loading inside the same room

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A player who is alone in the room of the packaged server can save, and can load a save into that same room: the room's name, token and invitation stay, and a refusal or a failure leaves the running game untouched.

**Architecture:** The Netplay relay gains a restore of its own for a room that the server owns. The only player asks on a connection of its own, the relay checks the player's right and then the save, starts a second emulator with the save beside the running one, and swaps the two when the new one listens; until then every failure ends the new one and nothing else. The host tells the relay which saves fit its game and reports the room as `restoring` meanwhile. The web client stops deciding by "no invitation": it saves when the room says the player may, sends the save through a small module of its own, and returns to the room with the controller key it already keeps.

**Tech Stack:** Node.js 26.13.1 single executable, TypeScript checked only, `ws` 8.22.1, the existing web client modules, `node:test`.

**Spec:** the owner's brief "Sled Storm Server — Node SEA", sections 7 to 9 and SAVE-01 to SAVE-04 (outside the repository), and `docs/sea-server-plan.md`, "P2 Server-owned rooms" with its restore chain.

## Global Constraints

- No push, no release, no published binary. No per-task commit; the owner commits.
- Code, comments and committed documents in English.
- The game disc, its hashes, private links, room identifiers, tokens and seat keys stay out of Git, logs and the status.
- No automated test starts the real Chromium, a tunnel or the network.
- The save library, manual slots, autosaves, `.sledsave` export and import, identity validation and the overwrite confirmation stay as they are. The stored format does not change and nothing is migrated.
- Saving and loading depend on the state of the room and on the player's right in it, never on having started the server, on the `create` role, or on having no invitation.
- A load never replaces the game under another connected player or while a controller is kept for one.
- Format, length and compatibility of a save are checked before the live room is touched. A failed load leaves the room running.
- The room's name, token, identity and invitation do not change with a load.
- The local game origin stays `http://127.0.0.1:8000`; the 1.1.0 library lives there.
- `server.py` and `tools/play-online.py` keep working: a room made by a browser keeps `release-for-load` and its tests.
- `web/app.js` grows by as little as possible; new logic goes into modules of its own.

## Decisions taken with this plan

1. **The restore has a connection of its own.** The plan's table said "over its room socket". That socket carries the live Netplay input in binary, and behind the public address the gateway numbers and reorders those packets; a 4.4 MB save cannot travel in that stream. The player opens a second connection with role `restore`, the room token and its seat key. Cost if wrong: one more connection per load; the seat key, already the credential for a controller, is also the credential for a load.
2. **The new emulator starts before the old one stops**, as the table says. Phase 4 measures the two together and decides whether the fallback of the open point is needed.
3. **Compatibility is the library's own identity** (disc, core, BIOS, adapter, as `identityKey` in `web/save-file.js` writes them): the host gives the room the one key that fits its game, with `hle` as BIOS, and the request must carry the same. A state does not name its disc, so the server takes the declared key from the only player in the room. Cost if wrong: a player who lies loads a state of another game into a room only that player is in.
4. **After the swap the room stays closed to others until its player is back**, or until the kept controller lapses (`reservedMs`, 60 s), so that this player is the first peer and owns the room again. Cost: when the player never returns, others wait up to a minute.
5. **A room that is loading a save keeps the host `online`.** The room is there and its links are good; `room: 'restoring'` says the rest.
6. **Before joining, the page shows and manages the library but does not load from it** in a server's room: loading needs the player to be alone in the room, which only a joined player can be. The list says so. Cost: one more step for the owner; an automatic load after joining can follow if wanted.

## Phases

One phase per working session; each ends with `npm run verify --prefix server` passing.

| Phase | Tasks | State |
|---|---|---|
| 1 | This plan; Task 1, the relay | Done 2026-11-21 |
| 2 | Tasks 2 and 3, the host and the packaged server | Done 2026-11-21 |
| 3 | Tasks 4 and 5, the web client | Done 2026-11-21 |
| 4 | Tasks 6 to 8: the real game by hand, the measurement, the review, the records | Done 2026-11-21 |

## Status

**Phase 1 is done (2026-11-21).** Task 1 is complete: the relay loads a save inside a server's room. Fourteen new relay tests failed first and pass; `npm test --prefix research/network` gives 63 of 63, and `npm run verify --prefix server` passed on the final tree. Nothing outside `research/network/retroarch-relay.mjs` and its test file changed, so no player can reach the new role yet: the host does not give its room `saves` until Task 2.

What Task 1 settled beyond its text:

- A load holds the room from the moment it is asked for, so a second request is refused, but the room is `restoring` and closed to others only from the moment a good save has arrived. A player who joins in between voids the load.
- The player leaving, or the request connection closing, before the new emulator listens calls the load off. The new emulator is stopped and the room is as it was.
- When the room itself ends during a load, the request is told the room's reason and both emulators are stopped.
- An emulator that was replaced can no longer end the room or report a race: what an emulator's end means is decided by what it is to the room at that moment.
- `status()` and `roomStatus()` gained `restoring`; one older assertion that compared the whole status was extended by that field.
- The last test of the plan's list checks a browser-made room only for the refusal of the new role; its `release-for-load` is covered by the older tests.

**Phase 2 is done (2026-11-21).** Tasks 2 and 3 are complete. The host opens its room with `saves`, the save library's key for its game with `hle` as BIOS, and with `onRestoring`; `RoomState` has `restoring`; `server/src/network.ts` describes `saves`, `onRestoring`, `restoring` and `transferMs` and exports `identityKey` from `web/save-file.js`. Three keeper tests and four host tests failed first and pass, and the smoke test of Task 3 failed against the build of phase 1 (`ready` carried no `restore`) and passes against the new one. `npm run verify --prefix server` passed on the final tree: the server tests 174 of 174 on Node.js 24.18.0 and on the pinned 26.13.1, the network modules 63 of 63, the web client 56 of 56, the packaged smoke tests 18 of 18. A player of the server's room now gets `restore: true` in `ready`; no page uses it until phase 3.

What phase 2 settled beyond its text:

- The keeper takes `restoring` only from the session the room runs on, and only between `open` and `restoring`. What a session says after it ended, or while the keeper stops it, changes nothing; a third keeper test covers a stop during a load.
- The relay says that a load is over just before a room that ends during a load says that it ended. So the keeper's log line for the end of a load is `The load of the saved game is over.`, which claims nothing about the room; the line for its start is `The room is loading a saved game.`
- A room that is `restoring` counts as working for a start request. Without that, `start` on a host whose public address was down would have waited for the player of a load, up to a minute. A fourth host test covers it; it is not in the task's list.
- The host test of the two links runs with the tunnel stand-in, so that the public link is checked too.
- The stand-in browser (`research/network/fake-browser.mjs`) gained `listenAfterMs`, so that a test can look while two emulators run, and it records a save it was started with by its length and SHA-256 instead of 5.9 MB of text. `server/test/fixtures.ts` gained `validState()`. Both files are outside the task's list.
- `identityKey` cannot throw in the host: the disc hash and the core hash are checked before it is called. It is called outside the `try` that reports a damaged `native-build.json`.

**Phase 3 is done (2026-11-21).** Tasks 4 and 5 are complete. `web/room-restore.js` holds the page's side of a load: `restoreInRoom`, `rememberRejoin`, `takeRejoin` and `loadInRoom`. The connection of `prepareNetplay` has `restore(state, save)` when the room's `ready` says `restore: true`, and the gateway serves the new module. In `web/app.js` the save library opens for the maker of a room, as before, and for every player of a server's room; there, saving and loading follow the room's word (`restore` in `ready`, and owning the room) together with the older conditions; a load goes through `loadInRoom`; and the page that reloads after it takes its request, applies the settings and joins by the invitation without sending a state. `Saved games` is shown before joining a server's room, and its list cannot load there and says why. Eight new tests failed first (the module did not exist, the connection had no `restore`, the gateway answered 403) and pass. `npm run verify --prefix server` passed on the final tree: the server tests 174 of 174 on Node.js 24.18.0 and on the pinned 26.13.1, the network modules 64 of 64, the web client 63 of 63, the packaged smoke tests 18 of 18.

What phase 3 settled beyond its text:

- `loadInRoom(connection, storage, record, options)` is in the module, with two tests of its own, and not in `web/app.js`: the request that keeps the settings and files, the load, the withdrawal of that request when the room refuses, the remembered way back, and the reload.
- The page that comes back from a load does not ask the room first. The relay answers `check` with "loading a saved game" until that player is back, so a page that asked would lock itself out for the minute its controller is kept. This holds for the whole page load: a Join pressed by hand, after a return that did not start by itself, joins the same way.
- A load in a server's room writes the room's progression and camera into the request, not the save's. The room identity includes them, and a page that came back with other values would be refused.
- The player's room connection closing during a load is held back and reported as a lost room only if the load then fails. A second `restore` while one runs, or on a closed connection, is refused in the page.
- `restoreInRoom` has no deadline of its own. The relay bounds the transfer and the start of the emulator and closes the request each time. On a connection that dies without a close event the dialog waits until the browser gives the connection up.
- `web/save-manager.js` changed, outside the task's list: the note of the list before joining is the context's reason when it gives one, and the two sentences that said a load starts a new room follow the context's `keepsRoom` (`Loading keeps the room and its invitation.`, `The room and its invitation stay the same.`). `trackSoloSave` in `web/solo-save.js` passes `keepsRoom` on as a tenth parameter.
- Where nothing else explains a pause in a server's room, the reason is `Saving and loading are not available in this room right now.` The older sentence tells the player to start a new solo room, which nobody can do there.
- The save library opens in a server's room only on the Netplay transport.

Looked at in a browser, against a stand-in origin: the web client as it is, a made-up `/session-info` of a server's room, no disc, no emulator and no room. The lobby shows `Saved games`; the list of a library with one save says `Join the room to load a save. Saves load from the game menu while you play alone.`, its `Load game` is disabled and its export is not. A plain Join asks the room first. A page reloaded with a remembered request takes it once, applies its settings and goes on to join without asking the room first. Nothing here ran the emulator: saving, the load itself and the return to the game are for Task 6.

For the hand check of phase 4, beyond the text of Task 6:

- The page is back in the room inside the minute its controller is kept (`reservedMs`): the reload fetches the emulator and the disc again. If it is not, the room opens to everybody and the player joins as a new one; note the seconds.
- Sound after the page came back by itself: the reload has no click of the player before the game starts.
- The dialog while playing in a server's room: the hint and the confirmation name the room that stays; with a second player the buttons are there and the reason is shown.
- A save made under another progression or camera setting, loaded into the room: the room keeps its own options. What the game shows then is not known.
- A load asked through the public address was not run by any test: the save goes through the gateway as one message of 4.4 MB (the gateway takes 8 MB). No tunnel is opened in front of the owner's disc, so this stays open unless the owner decides otherwise.

**Phase 4 is done (2026-11-21), and with it the slice.** Tasks 6 to 8 are complete. The results, what was not verified and what stays open are in `docs/sea-server-plan.md` under "P2 Server-owned rooms"; the ledger has every decision as a `Ruling:` line.

What phase 4 settled beyond its text:

- The hand check was driven through a real browser, with clicks and keys on the page; `server/scripts/room-player.mjs` was the second player. SAVE-01 to SAVE-04 passed, and so did every point of the list above except the load through the public address, which stays open.
- The open point: two emulators ran together for 6 to 9 s with a summed resident memory of 3.2 to 3.9 GB on a 16 GB machine, and no load failed. The fallback is not planned.
- Step 5 ran `python3 server.py`, the developer's launcher without a tunnel. `tools/play-online.py` opens a public address in front of the disc and was not started.
- Found by hand and fixed test first: the game origin confirmed a browser's kept copy by its date, so a browser that had just run wrapper 1.1.0 at the same address ran the 1.1.0 client against the packaged server. `server/src/runtime-http.ts` now answers 304 only to a matching `ETag`.
- The review found nothing critical. Fixed test first: a room takes no new load while an emulator of the last one exists, nor for `retryMs` (5 s) after a load that did not complete; `transferMs` is 60 s; a load ends when its player is let go; the room answers a `check` from the player of a load, known by the controller key; `restoreInRoom` gives up after 150 s (decision of Task 4 overturned); the emulator's files are served with `no-cache`.
- After the fixes, two loads in a row ran once more on the final build, with the pinned Chromium as the player.
- A page in the background (the browser pane hidden) refused to load a save, by the check that wrapper 1.1.0 makes after its backup autosave. Seen once; not traced further; recorded as open.

**Next: P3.** See "Where to continue" in `docs/sea-server-plan.md`.

## Review Focus

1. The player's page keeps sending live input while the save uploads: the game is not disturbed, and nothing of the save reaches the emulator's Netplay stream.
2. Another player opens the link during the seconds a save is loading: told to try again, not that the room is gone, and not seated in the emulator that is about to end.
3. The new emulator cannot start, or never listens: it is stopped, the old game goes on, and the player reads why.
4. The player closes the tab during the load, or right after it and never returns: the room does not stay closed; it opens again when the kept controller lapses.
5. A save of another disc, of another build, or made with a custom BIOS, and a file that is damaged or cut short: refused in words before anything starts.

---

### Task 1: The relay loads a save inside a server's room

**Files:**
- Modify: `research/network/retroarch-relay.mjs`, `research/network/retroarch-relay.test.mjs`

**Interfaces:**
- Produces: `createRoom({ room, token, identity, progress, camera, nativeCamera, saves?, onRestoring? })`. `saves` is the identity key of the saves that fit this room, a string of 1 to 256 characters; without it the room offers no restore. `onRestoring(active: boolean)` is called when the room starts and stops loading a save.
- Produces: the `ready` message of a player in a server's room carries `restore: true` when the room has `saves`. `status()` and `roomStatus()` carry `restoring: boolean`.
- Produces: relay option `transferMs` (default 10 000), how long a save may take to arrive.
- Produces: role `restore`. First message `{ role: 'restore', room, token, seatKey, save }`. The relay answers `{"type":"restore","state":"send"}`, then, after the binary save, `{"type":"restore","state":"starting"}`, then `{"type":"restore","state":"done"}` and closes with code 1000. Every refusal and failure closes with code 1008 and one of these reasons:
  - `Invalid invitation`: no such room of the server, or a wrong token.
  - `The room is not available for loading a save. Try again when playing alone.`: the seat key is not that of the room's owner, the owner is not connected and synchronized, another player or a kept controller is there, a race runs, the emulator does not listen yet, or a load is already under way. Checked when asked and again when the save has arrived.
  - `This save belongs to a different game or emulator build.`: `save` differs from the room's `saves`.
  - `Invalid game save`: not binary, or refused by `validateStateFormat`.
  - `Save transfer timed out`.
  - `The saved game could not be started. The room is unchanged.`: the new emulator did not start, ended, lost its connection, or did not listen within `startupMs`.
- Produces: from the valid save until its player is back or the kept controller lapses, `check` and `guest` are refused with `The room is loading a saved game. Try again in a moment.`, except the `guest` that returns with the seat key of the load. At the swap the player's room connection closes with code 1000 and `Saved game loaded`, and its controller is kept for `reservedMs`.

- [x] **Step 1: Write the failing tests** in `retroarch-relay.test.mjs`, on `ownedRoom` (which gains `saves` in its room, a `validState()` helper that builds 4 456 472 bytes passing `validateStateFormat`, and a worker per emulator start):
  - `a player alone in the server's room loads a save into it`: `starts` has two entries with one room name and different worker keys, the second with the save in base64; the first emulator's signal is not aborted before the second listens and is aborted after; `status()` passes `restoring: true` and ends `false`; input sent by the player during the upload reaches the first worker's stream unchanged (Review Focus 1).
  - `the player returns to the same controller and owns the room again`: after the swap a `guest` with `previousSeatKey` gets the same slot and `owner: true`; `restoring` is false; a second player then gets controller 2.
  - `others are told to try again while a save is loading and until its player is back`: `check` and `guest` during the start and after the swap; the room opens by itself after `reservedMs` (Review Focus 2 and 4).
  - `a load is refused and the room is untouched`: a second player, a kept controller, a race, a seat key that is not the owner's, a wrong token, a second load during the first; `starts.length` stays 1 and the player stays connected (SAVE-02).
  - `a save that is damaged, cut short, of another game, or sent as text is refused before anything starts` (Review Focus 5).
  - `a player who joins while the save is on its way voids the load`.
  - `a save that does not arrive in time is given up`, with `transferMs: 50`.
  - `a new emulator that cannot start, or never listens, is stopped and the old one keeps the room`: the second start throws, and, in a second case, never connects with `startupMs: 100`; the player is still seated and playing (Review Focus 3).
  - `the player leaving during a load cancels it`: the new emulator's signal is aborted and the room is open to a new player.
  - `the room ending during a load ends both emulators`: the old worker's connection closes; `ended` resolves; both signals are aborted.
  - `a room made by a browser, and a server's room without saves, have no restore`: `ready` carries no `restore: true`, the role is refused with `Invalid invitation`, and `release-for-load` behaves as before.
- [x] **Step 2:** Run `npm test --prefix research/network`. Expected: the new tests fail, the older ones pass.
- [x] **Step 3:** Implement. An emulator of a room becomes a record of its own (worker key, abort controller, connection); what its end means is decided by whether it is the room's current one (the room ends), the one being started (the load fails) or a retired one (nothing).
- [x] **Step 4:** Run `npm test --prefix research/network`, then `npm run verify --prefix server -- --quick`. Expected: pass.

### Task 2: The host reports a room that is loading a save

**Files:**
- Modify: `server/src/network.ts`, `server/src/room.ts`, `server/src/host-service.ts`
- Modify: `server/test/room.test.ts`, `server/test/host-service.test.ts`

**Interfaces:**
- Consumes: Task 1's `saves`, `onRestoring` and `restoring`; `identityKey` from `web/save-file.js`, exported through `network.ts`.
- Produces: `RoomState` gains `'restoring'`. `keepRoom({ open })` takes `open: (events: { restoring(active: boolean): void }) => RoomSession`; `restoring(true)` moves an `open` room to `restoring` and `restoring(false)` moves it back; a session that ends while `restoring` is followed by a new one like any other.
- Produces: the host opens its room with `saves: identityKey({ disc, core, adapter, bios: 'hle' })`. With the room `restoring` the host stays `online` and both invitation links are returned unchanged.

- [x] **Step 1:** Write the failing tests: `a room that loads a save is restoring and then open again`, `a session that ends while a save is loading is followed by a new one` (room); `a player alone loads a save through the host: two emulators run for a moment, one remains, and the links are the same`, `a save that cannot start leaves the room open and the host online`, `the status of a room that is loading a save names no room and no key` (host, with the stand-in browser).
- [x] **Step 2:** Run `npm test --prefix server`. Expected: fail.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `npm run typecheck --prefix server && npm test --prefix server`. Expected: pass.

### Task 3: The packaged server

**Files:**
- Modify: `server/smoke/sea.test.mjs`

- [x] **Step 1:** Add `a saved game is loaded into the room of the packaged server and the invitation stays the same`: a player joins the staged server's room, sends a valid state, a second stand-in browser is launched with it and the first ends; `invitation` prints the same links before and after. Expected: fail against the old build.
- [x] **Step 2:** Run `npm run verify --prefix server`. Expected: pass.

### Task 4: The page's side of a load

**Files:**
- Create: `web/room-restore.js`, `web/room-restore.test.mjs`
- Modify: `research/network/emulator-assets.mjs` (the public paths), `research/network/gateway.test.mjs`, `web/retroarch-netplay.js`, `web/retroarch-netplay.test.mjs`

**Interfaces:**
- Consumes: Task 1's role `restore` and `ready.restore`.
- Produces: `restoreInRoom({ url, room, token, seatKey, save, state, onStarting?, WebSocket? })` resolving when the relay says `done` and rejecting with the relay's reason, or with `Could not reach the room. Check the connection and try again.` when the connection ends without one. The state is sent only after `send`.
- Produces: `rememberRejoin(id)` and `takeRejoin()` over `sessionStorage`, key `sled-room-rejoin`: the request to come back with after the reload, taken once.
- Produces: the connection of `prepareNetplay` gets `restore(state, save)` when `ready.restore === true`. It uses the room, the token and the controller key of that connection, and marks the connection so that its closing is not reported as a lost room.

- [x] **Step 1:** Write the failing tests: `a save is sent only when the room asks for it, and the load ends when the room says so`, `a refusal is given in the room's words`, `a connection that ends without a word is a lost connection`, `the way back is remembered once`, `the gateway serves the restore module`, `a player of a server's room can load into it, and a guest of a browser's room cannot`.
- [x] **Step 2:** Run `node --test web/*.test.mjs && npm test --prefix research/network`. Expected: fail.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run both. Expected: pass.

### Task 5: Saving by the room's word in the page

**Files:**
- Modify: `web/app.js`, and `web/solo-save.js` or `web/lobby-ui.js` only where a sentence or a hidden control needs it

**Interfaces:**
- Consumes: Task 4's `restore`, `rememberRejoin`, `takeRejoin`; `identityKey`; the session info's `serverRoom`.
- Produces: the save storage opens for the maker of a room, as before, and for every player of a server's room. Such a player may save and load when `retroRoom.restore` exists, the player owns the room, and the existing conditions hold (synchronized, sole controller, no multiplayer race).
- Produces: a load in a server's room: autosave, `prepareLoad` for the settings and files, `retroRoom.restore(record.state, identityKey(storage.identity))`, `rememberRejoin`, reload. On failure the request is cancelled, the dialog shows the reason and the game goes on. After the reload the page takes the request, applies its settings and joins with the invitation, without sending a state.
- Produces: `Saved games` is shown before joining a server's room; its list cannot load there and says `Join the room to load a save. Saves load from the game menu while you play alone.`

- [x] **Step 1:** Implement; `web/app.js` has no unit test.
- [x] **Step 2:** Run `npm run verify --prefix server`. Expected: pass. The behavior is checked in Task 6.

### Task 6: The real thing, by hand

A copy of the built bundle without the tunnel program, `SLED_SERVER_HOME` in a scratch folder, the owner's disc.

- [x] **Step 1 (SAVE-01, SAVE-04):** Join alone with the local link, save to a slot, play on, load the slot. The game shown is the saved moment; the log shows a second worker starting and the first ending; `invitation` prints the same links before and after; a second player then joins with the same link.
- [x] **Step 2 (SAVE-02):** With a second player, saving and loading are paused with their reason, and a forged `restore` request is refused with the game running on. A damaged `.sledsave` is refused at import. A kept controller blocks a load.
- [x] **Step 3 (SAVE-03):** In one browser profile, make a save with wrapper 1.1.0 (`acc8e35`) on `http://127.0.0.1:8000`, then open the local link of the packaged server: the save is listed, and it loads in the room.
- [x] **Step 4 (the open point):** Measure the resident memory of both emulators' process trees during a load, the peak and the seconds between the start of the second and the end of the first. Record the answer; when the cost is not acceptable, plan the fallback of the open point.
- [x] **Step 5:** Start the developer launcher once with the changed client and load a save in a room it made.

### Task 7: Review

- [x] **Step 1:** One independent reviewer on the most capable model, from a diff against `5b2973043340526c98194cadb862f7934d9d55e7`, with this plan's Review Focus.
- [x] **Step 2:** Fix critical and important findings test first, and the minor ones that are cheap and clearly right.

### Task 8: Records

- [x] **Step 1:** `docs/sea-server-plan.md`: slice 2 results, what was not verified, the verification log, a new "Where to continue" for P3. `CHANGELOG.md`. `docs/README.md` if needed.
- [x] **Step 2:** Run every check on the final tree.
