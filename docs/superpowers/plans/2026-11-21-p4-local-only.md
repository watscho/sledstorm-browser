# P4 slice 1: hosting under `local-only`

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A server whose disc policy is `local-only` hosts. Its room's emulator and the owner's own page on this computer load the disc from the loopback listener; the public gateway refuses every way to the disc; an invited player's page that reaches the room through the gateway asks for that player's own CUE and BIN files and joins the same room. DATA-01 and DATA-09 from the brief, and the first two of the three sources of DATA-02 in one room.

**Architecture:** The packaged server knows one room mode, the dedicated room it owns. The disc policy in the configuration no longer blocks a start; it decides only how the public gateway runs: `shared` with the archive on its list for `shared-allowed`, `local` without it for `local-only`. The loopback listener keeps serving `/disc.zip` under both policies, to the room's emulator and to a page on `127.0.0.1`. A gateway in its `local` mode marks the session info it passes with `X-Sled-Disc: local`, and the page then takes the path for its own files that 1.1.0 already has. Nothing in the room, its identity or its links depends on the policy.

**Tech Stack:** Node.js 26.13.1 single executable, TypeScript checked only, `node:test`. The page and the gateway are plain modules.

**Spec:** the owner's brief "Sled Storm Server — Node SEA", sections 4, 11.1, 11.2 and 15.2 (DATA-01, DATA-02, DATA-09), outside the repository, and `docs/sea-server-plan.md`, "P4 Independent data sources".

**Review base:** the state that P3 left. No commit holds it (`git log` ends at `54a64b3`), so it is the ignored file `.superpowers/sdd/p3-slice-3-tree.tar`. On 2026-11-21, before the first change of this slice, all 210 files that Git does not ignore were equal to it, byte for byte. A commit of P3, if the owner asks for one, replaces it.

## Global Constraints

- No push, no release, no published binary. No per-task commit; the owner commits.
- Code, comments and committed documents in English.
- The game disc, its hashes, private links, room identifiers, public host names and every token stay out of Git, logs, the status, the diagnostic report and standard output.
- No automated test starts the real Chromium, a tunnel, the network, the user's browser or a system dialog (D44, D49). No tunnel is opened in front of the owner's disc.
- The public gateway passes only what is on its list. A route that is not on the list is refused by the gateway, never by a rule of the loopback listener (brief §11.1).
- The room's identity, name, token and links do not depend on the disc policy (P2, `web/room-identity.js`).
- `server.py` and `tools/play-online.py` keep working: the gateway's change is a header that their page already handles through its body.

## Decisions taken with this plan

1. **One room mode; the policy decides the gateway (D72).** The packaged server's room is always dedicated. `shared-allowed` runs the gateway in its `shared` mode with `/disc.zip` on its list; `local-only` runs it in its `local` mode, whose list has no `/disc.zip`. The loopback listener serves `/disc.zip` under both policies, so the room's emulator and the owner's page on `127.0.0.1` load the disc there. The session info keeps `discMode: 'shared'`, which since 1.1.0 means "this origin serves the archive", and gains no policy field. Cost: under `local-only` a program on this computer that sends the listener's own Host header can read the disc, which the brief allows (§11.1, the loopback client); public delivery is closed by the gateway's list alone.
2. **The gateway that refuses the disc says so (D73).** A gateway in its `local` mode adds `X-Sled-Disc: local` to every answer for `/session-info` that it passes; the page then plays the session as `local`, with the player's own CUE and BIN files, whatever the body says. The page needs no rule about addresses: a page through the gateway on a loopback port, as in a hand check, is told the same as a page through the tunnel. Cost: the header is added for the Python launcher's local mode too, whose body already says `local`; a page that ignored the header would try `/disc.zip` and get the gateway's 403, and no such page ships.
3. **The archive's checksums stay in the session info under `local-only` (D74).** An invited player still gets `archive` (size, chunk size and the SHA-256 of the archive and of each chunk). They are checksums, not a way to the bytes, and the third slice checks a player's saved ZIP against them as the fast path of §11.3. Cost: a player can tell whether a ZIP of theirs is a byte copy of the host's archive; the disc identity already tells whether their files are the host's disc.
4. **The panel and the guide describe the second choice instead of refusing it.** The note `This version cannot host a room with the second choice yet.` goes; the choice says that invited players choose their own CUE and BIN files, and that the room and the game on this computer still load the disc from this server. The status gets nothing new. Cost: none.
5. **What DATA-01 calls the public disc routes** is every request the gateway might map to the disc: `/disc.zip` by GET and HEAD, with a query, with a trailing slash, with dot segments (`/./disc.zip`, `/emulator/../disc.zip`), with a doubled slash, percent-encoded (`/%64isc.zip`), in capitals, and the routes that P5 will add (`/game-data/manifest`, `/game-data/<sha256>/chunks/0`). Each is asked with a valid access cookie and must be refused with 403, but for the doubled slash: the gateway parses `//disc.zip` as the address of another host with the path `/`, forwards `/` and answers with the game page, never the disc (found in Task 2; the review of Task 7 found no target form that reaches the disc, and the gateway's parse, shared with the Python launcher, is not changed). Cost: a spelling not on the list is not proven; the gateway's list is exact on the parsed path, which is the real guarantee.

## Phases

One phase per working session; each ends with `npm run verify --prefix server` passing.

| Phase | Tasks | State |
|---|---|---|
| 1 | This plan and the stage's slices; Tasks 1 and 2: the gateway's header, hosting under `local-only` | Done 2026-11-21 |
| 2 | Tasks 3 to 5: the page's own files behind the gateway, the panel and the guide, the packaged build under `local-only` | Done 2026-11-21 |
| 3 | Tasks 6 to 8: by hand with the owner's disc, the review, the records | Done 2026-11-21 |

## Status

**Phase 1 is done (2026-11-21).** The stage is cut into three slices under "P4" in the main plan, and this plan is written with D72 to D74. Before the first change the working tree was checked equal to `.superpowers/sdd/p3-slice-3-tree.tar` (210 files, none differing).

Task 1: a gateway in its `local` mode adds `x-sled-disc: local` to every answer for `/session-info` it passes; in its `shared` mode it adds nothing (`research/network/public-server.mjs`). The extended gateway test failed first with `null !== 'local'`; the network modules pass 71 of 71.

Task 2: `EmulatorAssets.assetPaths` is now `assetPaths(mode)`, and `HostService.start()` no longer refuses `local-only`: the gateway runs in the mode of the policy with that mode's list, and the loopback listener, the session info (`discMode: 'shared'`, D72) and the room are the same under both policies. The new host test (`local-only hosts: …`) shows the room open with its emulator on the loopback origin, the loopback `/disc.zip` with the archive's bytes, the gateway's `/session-info` with the header and the same body, the cookie-less 401, and for each spelling of decision 5, by GET and HEAD, an answer that never carries the archive and is 403; `//disc.zip` is 200 with the game page, because the gateway reads it as another host's address with the path `/` (ledger; listed for the review). The same request under `shared-allowed` passes the archive. It failed first with `needs_setup` where `online` was expected, and the asset test with `assets.assetPaths is not a function`. The server tests pass 243 of 243 (one test replaced).

Nothing under `web/`, `admin/` or `server/smoke` changed, so the panel's note still says that the second policy cannot host; Task 4 changes it. Nothing was checked by hand.

The final `npm run verify --prefix server` passed all 11 checks in 156 s: the server tests 243 of 243 on Node.js 24.18.0 and on the pinned 26.13.1, the network modules 71 of 71, the web client and the panel's page 116 of 116, the packaged build, and its smoke tests 29 of 29. The log is `.superpowers/sdd/2026-11-21-p4-local-only/verify-phase-1.log`.

**Phase 2 is done (2026-11-21).**

Task 3: `web/local-disc.js` exports `sessionDiscMode(info, gatewayDisc)`, and `web/app.js` applies it to the session info as soon as the body is read, so every later reader sees `local` behind a gateway that sends `X-Sled-Disc: local`. The new `web/local-disc.test.mjs` covers the four combinations of body and header and gives `selectedDisc` its first tests (CUE first and the tracks in CUE order, a missing track named, two or no CUE sheets, a CUE that does not list eleven distinct tracks, an empty choice). It failed first on the missing export; the page's tests pass 72 of 72 and the gateway's test that every module the page imports is served passes.

Task 4: the panel's note under `local-only` reads "Invited players choose their own CUE and BIN files. The room and the game on this computer still load the disc from this server." `docs/sled-storm-server.md` drops the preview's limit, describes both choices under the first run, and its terminal table names both values of `--disc-policy`. The new page test failed first on the old note; the panel's tests pass 51 of 51. The old wording remains only in the task plans of P1 and P3, as history.

Task 5: the smoke test `the packaged server hosts under local-only, and its gateway gives no disc away` configures a staged copy with `local-only` and starts it: the room opens with its worker on the loopback origin, which answers `/disc.zip` with the archive; a player joins with the local link; through the gateway with the access cookie `/session-info` is 200 with `x-sled-disc: local` and the same body, seven spellings of the disc by GET and HEAD are 403, and `/disc.zip` without the cookie is 401; the bundle carries the page with `sessionDiscMode` and the panel with the new note. On the build of phase 1 every server-side assertion passed and it failed on the page's change (`/local-disc.js` without `sessionDiscMode`), as the plan expected; on the rebuilt bundle it passes.

The final `npm run verify --prefix server` passed all 11 checks in 153 s: the server tests 243 of 243 on Node.js 24.18.0 and on the pinned 26.13.1, the network modules 71 of 71, the web client and the panel's page 123 of 123, the packaged build, and its smoke tests 30 of 30. The log is `.superpowers/sdd/2026-11-21-p4-local-only/verify-phase-2.log`. Nothing was checked by hand.

**Phase 3 is done (2026-11-21).**

Task 6, by hand with the owner's disc, the owner watching the application's browser pane. The copy: the built bundle in a scratch folder with its `bin/cloudflared` replaced by the tests' stand-in (`server/test/fake-cloudflared.mjs`, which opens nothing and names a host that does not exist), `SLED_SERVER_TUNNEL_PROBE=off`, `SLED_SERVER_HOME` in the scratch folder, `SLED_SERVER_NO_BROWSER=1`, and `configure --disc-policy local-only`; with the stand-in, `invitation` prints the guests' link, whose access path the gateway's own loopback port takes. A first start on the game port 8100 left the room's real emulator unstarted after 75 s: the page reaches the room's relay on port 8006 only from port 8000, and from any other port at `/netplay` on its own origin, which only the gateway serves (open; a stand-in worker does not show it). On the default ports the room was open 4 s after the start.

- Step 1: the owner's page in the pane, on the local link, joined as controller 1 with nothing chosen; it took the disc from a copy that the pane's profile already kept for this origin. The same link in a fresh profile of the pinned Chromium (a scratch copy of `room-player.mjs`) showed no file choice, said `Downloading game data`, asked `/disc.zip` on loopback, and played as controller 2.
- Step 2: a guest in the pinned Chromium through `http://127.0.0.1:<gatewayPort>/access/<token>`: the page showed the file choice and hid the game data choice, took the owner's CUE and eleven BIN files through `DOM.setFileInputFiles`, verified them and joined as controller 2, with two players on both pages. From the owner's page, `multi-player quick race`: the guest's X, sent through the protocol, put its rider in the second slot, the race on Pine Valley started, and both throttles were held for 6 s; the owner's page showed 47 km/h, and the two pages' frame counts were 20762 and 20731, read 0.67 s apart. The guest stayed 420 s, LIVE to the end.
- Step 3: the guest's page asked for no `/disc.zip` of its own; asked from the page, `/disc.zip`, `/disc.zip?x=1` and `/%64isc.zip` answered 403, in three runs.
- The copy's log holds neither the access token nor the room's name, token or host name, and `tccd` logged nothing for the bundle. Not seen: the guest's own screen during the race (the pinned Chromium has no window).

Task 7: the review ran on Opus 5.5 from a diff against `.superpowers/sdd/p3-slice-3-tree.tar`; a first reviewer on Fable 5.2 was stopped by its usage limit before it wrote anything. Nothing critical or important; five minor findings, and no target form found that reaches the disc. Fixed: the panel's note and the guide say that a guest's files must be the host's files under the same names (the disc's identity counts each name) and that the guest's page takes only a CUE of eleven tracks, as the Europe disc's (the page test failed first on the note); `admin/view.test.mjs` no longer shows the old refusal; the host test of Task 2 gives both hosts the same game files and now shows the same loopback session info and the same local link, but for the room's name and token, under both policies (it passed at once, and failed when the session info or the link was made to depend on the policy); decision 5 and Task 5 say what the tests show. Not taken: a gateway that answers 400 to a target that does not start with a single `/`, because the gateway is shared with the Python launcher and `//disc.zip` reaches only the page; an automated test that the page behind the header never asks for `/disc.zip`, which needs a real browser (Task 6 shows it); and a refusal of `local-only` for a disc whose CUE does not list eleven tracks, left to slice 2, whose one disc identity for the server and the page decides which discs a guest's page takes.

Task 8: the main plan has the slice's results, hand checks, open items, verification log and a new "Where to continue"; `CHANGELOG.md` has the entry. `npm run verify --prefix server` passed all 11 checks in 155 s after the review's fixes (server 243 of 243 on Node.js 24.18.0 and 26.13.1, network 71 of 71, web and panel 123 of 123, the packaged build, smoke 30 of 30; `verify-phase-3-code.log`), and again on the final tree with the records (`verify-phase-3.log`). The state that the slice leaves is `.superpowers/sdd/p4-slice-1-tree.tar`, the base of slice 2's review.

**Next:** P4 slice 2, in a new session: its task plan first.

## Tasks

### Task 1: The gateway says when it refuses the disc

**Files:**
- Modify: `research/network/public-server.mjs`, `research/network/gateway.test.mjs`

**Interfaces:**
- Produces: in its `local` mode, the gateway's answer for `/session-info` carries `x-sled-disc: local`; in its `shared` mode it carries no such header. Nothing else changes.

- [x] **Step 1: Write the failing test.** In `emulator gateway protects the archive, preserves reshare access and excludes diagnostics`, for each mode: `info.headers.get('x-sled-disc')` is `'local'` for `local` and null for `shared`.
- [x] **Step 2:** Run `node --test research/network/gateway.test.mjs` from the repository's root. Expected: the new assertion fails.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `npm test --prefix research/network` (or the same `node --test`). Expected: pass.

### Task 2: The server hosts under `local-only`

**Files:**
- Modify: `server/src/host-service.ts`, `server/src/emulator-assets.ts`
- Modify: `server/test/host-service.test.ts`, `server/test/emulator-assets.test.ts`

**Interfaces:**
- Produces: `EmulatorAssets.assetPaths` becomes a function of the mode, `assetPaths(mode: 'local' | 'shared'): Set<string>`, the gateway's list for that mode.
- Produces: `HostService.start()` no longer answers `needs_setup` for `local-only`. The gateway runs with `discMode` and its list from the policy (decision 1); the runtime's archive, the session info and the room are the same under both policies.

- [x] **Step 1: Write the failing tests.** `host-service.test.ts`: replace `local-only waits for a later stage` with `local-only hosts: the room's emulator and the loopback page get the disc, the public gateway refuses every way to it` (DATA-01, DATA-09): with the stand-in browser, the host comes online with its room open and the stand-in worker loaded on the loopback origin; the session info on loopback is the same as under `shared-allowed`; `/disc.zip` on loopback answers 200 with the archive's bytes and SHA-256; through the gateway, after `/access/<token>`, `/session-info` answers 200 with `x-sled-disc: local`, and each request of decision 5 answers 403; the same `/disc.zip` under `shared-allowed` answers 200 through the gateway (the control). The test of a saved change of the configuration loses `local-only` as its "policy that cannot host" and keeps its two other cases. `emulator-assets.test.ts`: the list for `local` has no `/disc.zip`, the list for `shared` has it, both have `/session-info`.
- [x] **Step 2:** Run `npm test --prefix server`. Expected: the new tests fail, the older ones pass.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `npm run typecheck --prefix server && npm test --prefix server`. Expected: pass.

### Task 3: The page uses its own files where the gateway refuses the disc

**Files:**
- Modify: `web/local-disc.js`, `web/app.js`
- Test: `web/local-disc.test.mjs` (new)

**Interfaces:**
- Produces: `sessionDiscMode(info, gatewayDisc)`: `'local'` when `gatewayDisc` is `'local'`, otherwise `info.discMode`. `app.js` applies it to the session info as it reads it, before `lobby.discMode`.

- [x] **Step 1: Write the failing test.** `local-disc.test.mjs`: the four combinations of body and header; and `selectedDisc` (which has no test yet): one CUE with its eleven tracks in CUE order, a missing track named, two CUE sheets refused.
- [x] **Step 2:** Run `node --test "web/*.test.mjs"`. Expected: the new tests fail on the missing export.
- [x] **Step 3:** Implement, and use it in `app.js` where `/session-info` is read.
- [x] **Step 4:** Run `node --test "web/*.test.mjs"` and the gateway's test that every module the page imports is served. Expected: pass.

### Task 4: The panel and the guide

**Files:**
- Modify: `admin/index.html` (and its test if one pins the note), `docs/sled-storm-server.md`, `README.md` or `docs/README.md` only where they repeat the refusal

- [x] **Step 1: Write the failing test.** The panel page's test that reads `index.html`: the note under `local-only` no longer says the build cannot host, and says that players choose their own CUE and BIN files.
- [x] **Step 2:** Run `node --test "admin/*.test.mjs"`. Expected: fail.
- [x] **Step 3:** Change the note and the guide (decision 4). Search the repository for `not available in this build yet` and `cannot host a room with the second choice`: none remain.
- [x] **Step 4:** Run the page's tests. Expected: pass.

### Task 5: The packaged build under `local-only`

**Files:**
- Modify: `server/smoke/sea.test.mjs`

- [x] **Step 1: Write the failing smoke test.** `the packaged server hosts under local-only, and its gateway gives no disc away`: a staged copy with the stand-in browser and the synthetic emulator, `configure --disc-policy local-only`, a start; the room opens (its worker opened the loopback origin, which answers `/disc.zip` with the archive; the stand-in fetches nothing, and the real load was seen by hand in Task 6); `invitation` prints the links; through the gateway with the access cookie `/session-info` has `x-sled-disc: local` and `/disc.zip` answers 403; on loopback it answers 200.
- [x] **Step 2:** Run it on the build of phase 1. Expected: it fails where the page's or the panel's change of phase 2 is asked for, or passes if the server side suffices; record which.
- [x] **Step 3:** Run `npm run verify --prefix server`. Expected: every check passes.

### Task 6: By hand with the owner's disc

On a scratch copy of the built bundle without `Contents/Resources/bin`, with `SLED_SERVER_HOME` in a scratch folder, configured with the owner's game folder and `local-only`:

- [x] **Step 1:** The owner's page on `http://127.0.0.1:<gamePort>/` joins the room: it downloads the disc over loopback, with no file chosen.
- [x] **Step 2:** A second player through the gateway's own loopback port, `http://127.0.0.1:<gatewayPort>/access/<token>`, in the pinned Chromium: the page asks for the CUE and BIN files, gets the owner's files (set through the browser's protocol, not a dialog), and joins the same room. Both race.
- [x] **Step 3:** The same player's page tries `/disc.zip` on its origin: 403.
- [x] **Step 4:** Record what was seen, and what was not verified.

### Task 7: The independent review

- [x] **Step 1:** The review on the most capable model that takes requests, from a diff against the review base, with the focus below. It saves its findings as it goes; its final message is the report.
- [x] **Step 2:** Fix critical and important findings test first, and the cheap minor ones; list the rest as open.

### Task 8: Records

- [x] **Step 1:** `docs/sea-server-plan.md`: the slice's results under P4, what was not verified, what stays open, the verification log, the decisions, and a new "Where to continue". `CHANGELOG.md`.
- [x] **Step 2:** Run every check on the final tree.

## Review Focus

1. No request through the gateway, in any spelling, with or without the access cookie, reaches the disc under `local-only`; the loopback listener still refuses a foreign Host.
2. The room's emulator starts under `local-only`, and a stop, a start, a new game and a load of a save work as under `shared-allowed`.
3. The page through the gateway never tries `/disc.zip` under `local-only`; the page on loopback and the room's own page do not take the path for own files.
4. Nothing about the room, its identity or its links differs between the two policies.
