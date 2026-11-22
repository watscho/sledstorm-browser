# P3 slice 1: access to the panel, and the operations behind its buttons

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser on the server's computer gets into the control listener through a one-time token and a session of its own; through that session, or the control credential, the host can be started, stopped and configured; and nothing public reaches any of it.

**Architecture:** The control listener (`server/src/host-server.ts`) keeps its Host, Origin and raw-path checks and gains sessions. The launcher asks it, with the control credential of the instance record, for a one-time token and opens the panel page with that token in the fragment; the page trades it for a session token, keeps that in `sessionStorage` and sends it as a bearer header. No cookie is used. The host service learns to retry what failed inside a running stack, to count the room's players and to stop on request, and the configuration gains `autoStart`. The page is a small resource directory, `admin/`, which slice 2 turns into the real panel.

**Tech Stack:** Node.js 26.13.1 single executable, TypeScript checked only, `ws` 8.22.1, `node:test`. The page is plain modules, no framework and no build step.

**Spec:** the owner's brief "Sled Storm Server — Node SEA", sections 4, 9, 12 and 13 with HOST-01 and AUTH-01 (outside the repository), and `docs/sea-server-plan.md`, "P3 Browser admin and macOS launch".

**Review base:** `54a64b3`, the commit that closes P2.

## Global Constraints

- No push, no release, no published binary. No per-task commit; the owner commits.
- Code, comments and committed documents in English.
- The game disc, its hashes, private links, room identifiers and every token stay out of Git, logs, the status and standard output. That now includes the one-time tokens and the sessions of the panel.
- No automated test starts the real Chromium, a tunnel, the network, the user's browser or a system dialog.
- A loopback address is not authorization. Every control route needs a credential, the listener's own Host and no foreign Origin.
- Control routes match the raw request path (D12): an encoded or dotted spelling of a route is not a route.
- The public gateway keeps its allowlist and gets no route to the control listener.
- An invitation never carries the control credential, a session or a folder path.
- Closing a page stops nothing.
- The local game origin stays `http://127.0.0.1:8000`, and the panel is always opened on `127.0.0.1`, never on `localhost`: they are different origins.
- `server.py` and `tools/play-online.py` keep working. No change under `web/` is expected in this slice; a change under `research/network` needs a ruling in the ledger.

## Decisions taken with this plan

1. **The panel's session is a bearer token that the page keeps, not a cookie.** A cookie for `127.0.0.1` is sent to every port of that address: to the game page's origin, and to any other local web server the user opens. It would also be a credential that a page of another origin could ride on. A token in `sessionStorage` belongs to the panel's origin with its port, and a request without the header is simply not authorized. Cost: a panel address opened from the history or a bookmark has no session, and every tab has its own; the page then says to open the application again, which is one double click.
2. **A one-time token is good once and for 60 s**, and the listener keeps the eight newest. **A session lasts until the server quits**, and the listener keeps the sixteen newest. Both are 32 random bytes, kept by their SHA-256. Cost: the seventeenth open tab ends the first one's session.
3. **Only the control credential makes a one-time token.** A session cannot make another session. Cost: none seen; the panel has no "open in another tab".
4. **A start request retries what failed inside a running stack**: the public address (D24) and a room that has failed, in the same room with the same links. It builds the stack anew only when none is up, or when the game files changed. While the room is restarting by itself, a start request changes nothing. This answers the point that P2 left open. Cost if wrong: a failed room that needs a wholly new stack is reached by stop and start.
5. **"Stop room" stops hosting**: the room, the relay, the gateway, the tunnels and the local game page. The control listener and the panel stay. The next start makes a new room and a new address. With a player connected, or a controller kept for one, the request must say `force`. The brief's states go from `online` through `stopping` to `idle`, and a public address without a room is of no use. Cost: no way to close the room and keep the address; none is asked for.
6. **The game folder and the disc policy cannot be changed while hosting is up**; `autoStart` can, at any time. The file stays at version 1: `autoStart` is optional there and true when absent. Cost: the owner stops the room to change the folder; an older build that rewrites the file drops the switch.
7. **The status counts the room's players**: `players: { connected, reserved }`, null without an open room. A player who is still loading counts as connected.
8. **The panel's files are the resource directory `admin/`**, staged to `Contents/Resources/admin` and served by the control listener from a fixed list of names. Cost: one more staged directory; nothing is embedded in the executable.
9. **The executable gains the commands `start` and `stop`**, so that the smoke tests and the hand checks drive the same routes as the panel.

Added by the review of phase 4:

10. **A start that builds the stack anew needs `force` while somebody is in the room**, as a stop does. That is the start after the game files changed; a start that tries again what has failed leaves the room and needs none. Cost: the owner who follows the status's advice reads a refusal first.
11. **A quit is the last word.** Hosting is stopped for good; a start that is asked for while the server quits is answered 409 and changes nothing. Between other requests the later one still wins.
12. **A session goes by its last use, not by its age**: of more than sixteen, the one that was not used for longest ends. Decision 2 said the sixteen newest.

## Phases

One phase per working session; each ends with `npm run verify --prefix server` passing.

| Phase | Tasks | State |
|---|---|---|
| 1 | This plan; Task 1, sessions on the control listener | Done 2026-11-21 |
| 2 | Tasks 2 and 3, the host's operations and their routes | Done 2026-11-21 |
| 3 | Tasks 4 and 5, the page, the launcher and the public boundary | Done 2026-11-21 |
| 4 | Tasks 6 to 8: by hand, the review, the records | Done 2026-11-21 |

## Status

**Phase 1 is done (2026-11-21).** P3 was cut into three slices, recorded in `docs/sea-server-plan.md` under "P3 Browser admin and macOS launch" with the decisions D38 to D43. Task 1 is complete: the control listener makes one-time tokens for a command that holds the control credential, trades one for a session, and answers its other routes to either. `server/src/panel-sessions.ts` is new; `server/src/host-server.ts` and its tests changed. Three unit tests failed first on the missing module and two listener tests on the missing routes; `npm test --prefix server` gives 182 of 182 (176 before). `npm run verify --prefix server` passed on the final code, all 11 checks: the server tests 182 of 182 on Node.js 24.18.0 and on the pinned 26.13.1, the network modules 71 of 71, the web client 66 of 66, the packaged build, and its smoke tests 18 of 18. The records were written after that run; `git diff --check` is clean with them.

What Task 1 settled beyond its text:

- The exchange route is the only one without a credential, and it is that route only as `POST /api/session` by its raw path. `GET /api/session`, `/api/session/` and an encoded spelling answer 401 like any other unknown caller.
- A request for the exchange that is refused for its type, its length, its Origin or its Host leaves the one-time token unused. A token that is asked for after its minute is spent by that request.
- A body longer than 1024 bytes is answered 413 and the connection is closed, whether its length was declared or not. Measured with a raw connection whose body never ends.
- `the control listener is no WebSocket endpoint` passed before any change: Node.js answers an upgrade request as an ordinary one while nothing listens for `upgrade`. The test stays as a pin for AUTH-01.
- `startHostServer` takes `sessions` for a test with a clock. Nothing else constructs sessions.
- Nothing uses the new routes yet: the launcher still opens the plain address and the page is still the placeholder. Both change in phase 3.

**Phase 2 is done (2026-11-21).** Tasks 2 and 3 are complete. A start request on a stack that is up tries again what has failed there, the room under its name and token and the public address, and builds a new stack only when none is up or the game files changed. The status counts the room's players. The configuration has `autoStart`, and the server starts hosting at launch only when it says so. The control listener has `POST /api/host/start`, `POST /api/room/stop`, and `GET` and `PUT /api/config`, for the control credential or a panel session, and the executable has the commands `start` and `stop [--force]`. `server/src/host-control.ts` is new; nothing under `web/` or `research/network` changed.

In Task 2, seventeen tests failed first: the seven new ones, and ten older ones whose expected status gained `players` or whose sentences changed. Two more tests, for the room keeper and for the tunnel, failed first with the part still `failed` after the start that its own report asked for. In Task 3 the four listener tests failed first on the missing module, and the two smoke tests on the build of phase 1: `start` printed the usage with exit code 2, and the saved configuration had no `autoStart`. `npm run verify --prefix server` passed on the final code, all 11 checks: the server tests 195 of 195 on Node.js 24.18.0 and on the pinned 26.13.1 (182 before), the network modules 71 of 71, the web client 66 of 66, the packaged build, and its smoke tests 20 of 20 (18 before). Only the counts in the records changed after that run; `git diff --check` is clean with them. Nothing was checked by hand in this phase: that is Task 6.

What Tasks 2 and 3 settled beyond their text:

- The relay lets a released room name be opened again. Measured with a probe before any test: a session ends, `releaseRoom`, then `createRoom` under the same name opens and starts a second emulator.
- `players` is null while the relay has no session of the room: off, between two sessions, failed. Otherwise it is counted from the session, also before its emulator listens, because a guest who joins then is seated as `loading`. The count is taken when the status is asked for and is not part of the stored status.
- On a stack that is up, a start request calls `start` on the room keeper and on the primary tunnel. Each is a no-op unless its part has given up, so a restarting room and a retrying address keep their own pace, and the request resolves once both are settled. A stack that is up in state `starting`, after a start that a stop interrupted and a later start asked for again, is waited for and not rebuilt.
- `RoomKeeper.start()` starts a failed room even while the run that gave it up has not returned. Before, `run` was cleared two microtasks after the report of the failure, and the host's retry reached `start` one microtask later than that. The tunnel's `start()` had the same gap of one microtask and is closed the same way, with a test of its own in `server/test/tunnel.test.ts`.
- A server whose configuration says no auto start and names no game folder is `idle`, not `needs_setup`, until a start is asked for. The panel of slice 2 reads the configuration to know that setup is needed.
- The `configure` command keeps the `autoStart` of the file it replaces.
- The game origin's answer for a disc that changed, `503` on `/disc.zip`, ends with `Start the server again.` as the two sentences of the status do.
- The rules of the three operations are in `server/src/host-control.ts`: `createHostControl({ paths, service })` gives `start()`, `stop(force)`, `config()` and `configure(change)`. `startHostServer` takes it as `control`, and it is required. `standInControl()` in `server/test/fixtures.ts` is one that does nothing and records what was asked; `server/src/self-test.ts` has its own. `server/test/host-server.test.ts` has `panelSession(host)` and `standInService(status)` for the tests of phase 3.
- Both routes answer 202 with the status of that moment, before the host has taken the request: a `stop` on an online host prints `stopping` with `host.state` still `online`. A caller reads the status to see the result.
- A stop without a body is a stop without force. With a body, only `"force": true` is force, and a body that cannot be read (415, 400, 413) stops nothing.
- `PUT /api/config` saves all of a request or nothing. Beyond the plan's two sentences it answers 400 `The configuration in the request is not valid.` for a body that is no object, an unknown key or an `autoStart` that is no boolean, `The game folder must be given by its full path.` for a folder that is no absolute path, and `The game folder could not be read.` for a file system error that `findDisc` has no sentence for. Its body may be 4096 bytes, because a path may be 1024; the other bodies stay at 1024.
- The `stop` command prints its own sentence for the refusal: `Players are in the room: 1 connected, 0 away with a controller kept. Add --force to stop it anyway.` The route's `error` stays `Players are in the room.` with `players` beside it.
- `start` and `stop` do not start a server: without one they print `The server is not running.` and exit with 1.

**Phase 3 is done (2026-11-21).** Tasks 4 and 5 are complete. The control listener serves the panel's page from the resource directory `admin/`: four addresses, with a content security policy that lets the page run its own files and talk to its own listener, and nothing else of the folder. The page takes the one-time token from its address, trades it for a session, keeps the session for its tab, and shows that it is connected, the version and the state of the host. The launcher asks the running server for a token with the control credential and opens the panel with it; what it prints is the address alone. `admin/` is staged into the bundle without its tests, and the self-test loads the page from there. `server/test/public-boundary.test.ts` asks the real gateway, its mirror listener and the game origin for every route of the control listener, in nine spellings, with three methods and with every credential a caller could bring, and nothing reaches the control listener. Nothing under `web/` or `research/network` changed.

In Task 4 the tests of `admin/session.test.mjs` failed first on the missing module; `the listener serves the panel's files and nothing else from the folder` failed on the placeholder page; the three tests of the launcher in `server/test/instance.test.ts` failed on the missing module and the missing `requestBootstrap`; and the two smoke tests failed on the build of phase 2, which had no `admin` in its resources and opened nothing through the stand-in. The tests of Task 5 passed at once, as the plan expected. To see that they can fail, `/api/status` was added to the gateway's list of paths for one run: the test failed on `GET /api/status`, answered 404 by the game origin where 403 by the gateway was expected, and passed again with the list restored.

`npm run verify --prefix server` passed on the final code, all 11 checks in 131 s: the server tests 200 of 200 on Node.js 24.18.0 and on the pinned 26.13.1 (195 before), the network modules 71 of 71, the web client and the panel's page 70 of 70 (66 before, as the web client alone), the packaged build, and its smoke tests 23 of 23 (20 before). The records were written during and after that run; `git diff --check` is clean with them.

The page has no automated run in a browser, so it was opened once in the desktop application's browser pane, from a scratch copy of the built bundle without the tunnel program and with `SLED_SERVER_HOME` in a scratch folder. This is not the hand check of the slice, which is Task 6. Opened with a token, the page said that it is connected, with the version, `Needs setup` and the sentence of the problem; the address had no fragment, the tab kept a session, and no cookie existed. A reload kept the session. The same link opened again gave `This page is not connected to the server. Open Sled Storm Server again.` and left no session in the tab. The console showed that refusal and nothing else, so the content security policy stops nothing that the page needs. The server's log held no token. Task 6 still has to show the default browser opened by `open`, two tabs, the address from the history, and the game page's origin and another site asking the panel's port.

One run went wrong. The first run of the HOST-01 smoke test, against the build of phase 2, cleared `SLED_SERVER_NO_BROWSER`, and that build, which knew nothing of the stand-in opener, opened the default browser twice on the placeholder page of a server that the test then stopped. The stand-in now wins over the switch and the test keeps the switch set, so a build that does not know the stand-in opens nothing (D44).

What Tasks 4 and 5 settled beyond their text:

- `startHostServer` takes `panelRoot`, and it is required: the server gives `<resources>/admin`, the tests give `panelRoot` of `server/test/fixtures.ts`, which is the repository's own `admin/`. That folder holds the page's test file, so the refusal of `/session.test.mjs` is tested on a file that exists.
- The page's four addresses need no credential, because the files hold no secret. They are answered to `GET` only, by their raw path, with the listener's Host and Origin checks before them, and a query is ignored. `/index.html` is not one of them. A file that cannot be read is answered 500 `This build is missing the control panel page.`, as plain text; the routes under `/api/` work on.
- A new link is a new start: `openSession` with a token first lets go of what the tab kept, so a token that is refused leaves no session, also in a tab that had a good one. Cost: a used link pasted into a connected tab disconnects it; opening the application again connects it.
- `admin/session.js` has a fourth function, `forgetSession(storage)`: the page lets go of a session that the server answers with 401, as after a restart of the server. What the tab kept is used only when it has the form of a session.
- A browser that gives the page no storage, or refuses to write, still gets a session from its token; it lasts until the page is reloaded. Tested as `a tab that keeps nothing still gets a session from its token`.
- The page reads the status once and shows the state in words, with the sentence of the problem when there is one. It does not follow the status; that comes with the panel of slice 2.
- `launch` takes `open`, by default `openBrowser`, and a launch that opens no page asks for no token. `openBrowser(url, program)` runs `program` in place of `/usr/bin/open`; the executable takes it from `SLED_SERVER_OPENER`, which must be a full path (D44).
- A server that gives no token, such as one of an earlier build that is still running after the application was replaced, is opened by its plain address. Tested with a stand-in server that knows its status and nothing else.
- The tests of the launcher are in `server/test/instance.test.ts`, where the instance record's helpers are, not in `server/test/host-server.test.ts`. One of them trades the launcher's token with the page's own module, `admin/session.js`, against the real listener.
- The self-test's `http` check loads the page's four addresses from the resources of the build it runs in.
- The check `web client` of `verify.mjs` is now `web client and panel page`.
- Task 5 asks three spellings more than its text: `/../api/…`, the route with a query, and the absolute form that names the control listener's own address. It asks the game origin as well, which is not public but is what a game page could reach: `GET` is answered 404 there, or 400 in the absolute form, and the other methods 405. The mirror listener's port is read from the launch record of the stand-in tunnel program. The test makes 3795 requests and 120 attempts to open a WebSocket, and it writes down whatever the control listener is asked for: nothing.
- The two routes that do not exist yet, `/api/game-folder/pick` and `/api/diagnostics/export`, are asked for like the others. The stages that add them have nothing to add to this test.

**Phase 4 is done (2026-11-21), and the slice with it.** Task 6, the hand check, ran on a scratch copy of the built bundle without the tunnel program, with `SLED_SERVER_HOME` in a scratch folder. Task 7, the review, found nothing critical, three important defects and ten minor ones; the three and six of the minor ones are fixed, each with a test that failed first. Task 8, the records, is in `docs/sea-server-plan.md` under "P3 Browser admin and macOS launch", with what was not verified and what stays open, and in `CHANGELOG.md`.

What the hand check saw:

- `open` on the bundle started one server and gave the default browser, Chrome, the panel's address with a one-time token; a few seconds later that token was used. A second `open` and three at once kept the same server, each launch with a token of its own. The launcher ran `/usr/bin/open` through a script that noted the address first.
- The page in Chrome was not read: the Chrome extension was not connected. The page was read in the application's browser pane from a fresh address: connected, the version, the state and its sentence; the address without its fragment; a session in the tab's storage and no cookie; a reload kept it; the address that Chrome had used gave `This page is not connected to the server. Open Sled Storm Server again.` and left no session.
- With every tab of the pane closed the server ran on. `stop` with one player in the room was refused with exit code 1 and the counts; `stop --force` went to `idle` and the player read `Dedicated server stopped`; `start` opened a new room; `stop` on an empty room and on an idle host was taken; two `start` at once made one stack.
- From the game page on port 8000 and from a one-page stand-in on another local port, no answer of the control listener could be read, no WebSocket opened and the panel could not be framed; the server ran on with its room. The same requests sent directly were answered 403 with a foreign Origin or Host, to a preflight too, and 401 without a credential.
- `quit` left no process and no listener. The log held no token and no folder.

What the review changed, beyond the tasks' text:

- `HostService` has `close()`, `closed()` and `starting()`. `serve` closes the service when it stops, so a start that is asked for during a quit, and the start at launch, cannot bring hosting back. `server/test/serve.test.ts` is new: it runs the server as a process from source with the stand-in browser.
- `POST /api/host/start` takes the same optional body as the stop: `{ "force": true }`. It answers 409 `{ error: 'Players are in the room.', players }` when the start would build the stack anew with somebody in the room, and 409 `{ error: 'The server is quitting.' }` once a quit has begun. `HostControl.start(force)` returns the refusal. The command is `start [--force]`, with a sentence of its own for the refusal.
- `PUT /api/config` is carried out one request at a time, and each reads the file that the one before it wrote. `writeConfig` writes to a temporary file with a name of its own. A file that cannot be written is answered 500 `The configuration could not be saved.` The folder and the policy are also refused while a start is under way, which is before the status has moved, and a start waits for a change that is being saved.
- A start that is asked for during a start joins it and tries nothing again.
- A session that is used moves to the end of the sixteen.
- Every answer of the control listener carries `Cross-Origin-Resource-Policy: same-origin`. The test of the public boundary uses that header as the mark of the listener's own answers: no answer through the gateway, the mirror listener or the game origin carries it.
- `stagePanel` in `server/scripts/stage-resources.mjs` copies the page's four files by name.

Not fixed, and listed under the slice in `docs/sea-server-plan.md`: the one-time token on the launcher's command line can be read by another account of the computer; `admin/panel.js` has no automated test; `start` and `stop` against an older server that still runs print `Not found`; a start request leaves a mirror that has given up alone.

**Next: slice 2 of P3**, the panel and the first run, with a task plan of its own.

## Review Focus

1. A page of another site, or the game page on port 8000, open in the same browser as the panel: it cannot read the status and cannot start, stop or quit. No cookie exists, and a foreign Origin is refused.
2. A host name that resolves to `127.0.0.1` (DNS rebinding): refused by the Host check, on every route, the session exchange included.
3. The token in the address: gone from the address bar once the page has it; a reload keeps the session; the same link opened again is refused in a sentence that says what to do.
4. Start asked twice, start during a stop, stop during a start, from the panel and the command line at once: the latest wins and one stack exists.
5. Stop with players in a race: refused without `force`, and the refusal says how many are there.

---

### Task 1: Sessions on the control listener

**Files:**
- Create: `server/src/panel-sessions.ts`, `server/test/panel-sessions.test.ts`
- Modify: `server/src/host-server.ts`, `server/test/host-server.test.ts`

**Interfaces:**
- Produces: `createPanelSessions({ bootstrapMs = 60_000, maxBootstraps = 8, maxSessions = 16, now = () => performance.now() }): PanelSessions` with `mintBootstrap(): string`, `exchange(bootstrap: string): string | null` and `has(session: string): boolean`. Tokens are 64 hexadecimal digits.
- Produces: `startHostServer` takes an optional `sessions: PanelSessions`, for tests with a clock.
- Produces: `POST /api/session/bootstrap`, control credential only: 201 `{ bootstrap }`. With a session: 403 `{ error: 'A panel session cannot open another one.' }`.
- Produces: `POST /api/session`, no credential, `Content-Type: application/json`, body `{ "bootstrap": "<token>" }` of at most 1024 bytes: 201 `{ session }`. A token that is unknown, used or too old: 401 `{ error: 'This link to the panel has expired. Open Sled Storm Server again.' }`. Another content type: 415. A longer body: 413. Not JSON: 400.
- Produces: every other `/api/` route takes the control credential or a session as `Authorization: Bearer <token>`.

- [x] **Step 1: Write the failing tests.**
  - `panel-sessions.test.ts`: `a one-time token opens one session, once` (the session is 64 hexadecimal digits and differs from the token; `has(session)` is true and `has(bootstrap)` false; a second exchange, an unknown token and text that is no token give null); `a one-time token that waited a minute is refused` (a clock in the test: good at 59 999 ms, null at 60 000 ms, and null again afterwards); `only the newest tokens and sessions are kept` (of nine tokens the first is refused and the other eight work; of seventeen sessions the first is gone and the others stay).
  - `host-server.test.ts`: `the panel trades a one-time token for a session` (`/api/session/bootstrap` gives 401 without a credential, 201 with the control credential and 404 for `GET`; `/api/session` gives 201 once and 401 with the sentence the second time; 415 for `text/plain`, 400 for text that is not JSON, 413 for a body of 2000 bytes, 403 for a foreign Origin and for another Host; with the session `GET /api/status` gives 200, `/api/session/bootstrap` 403 and `POST /api/host/quit` 202; no response carries the control credential); `the control listener is no WebSocket endpoint` (a `ws` client on `/api/status` gets 401 without a credential and 200, not 101, with one).
- [x] **Step 2:** Run `npm test --prefix server`. Expected: the new tests fail, the older ones pass.
- [x] **Step 3:** Implement. Sessions and tokens are kept by their SHA-256, in the order they were made. The exchange route is matched before the credential check, by its raw path and method.
- [x] **Step 4:** Run `npm run typecheck --prefix server && npm test --prefix server`, then `npm run verify --prefix server`. Expected: pass.

### Task 2: What start, stop and the configuration mean on the host

**Files:**
- Modify: `server/src/host-service.ts`, `server/src/config-store.ts`, `server/src/serve.ts`, and `server/src/room.ts` only if the keeper needs it (it did, and `server/src/tunnel.ts` with it), `server/src/control.ts`, `server/src/runtime-http.ts`
- Modify: `server/test/host-service.test.ts`, `server/test/config-store.test.ts`, `server/test/room.test.ts`, `server/test/tunnel.test.ts`, `server/test/tunnel-probe.test.ts`

**Interfaces:**
- Produces: `HostConfig` gains `autoStart: boolean`. Absent in the file it is `true`; a value that is not a boolean makes the file damaged. `defaultConfig.autoStart` is `true`.
- Produces: `HostStatus` gains `players: { connected: number; reserved: number } | null`: null without an open room; `connected` counts the seats `connected` and `loading`, `reserved` the seats `reserved`.
- Produces: `HostService.start()` on a stack that is up: a failed room is opened again under the same name and token (`RoomKeeper.start()`), a failed or retrying address is retried as today, both when both failed; a room that is `restarting` is left alone; a `game-data` problem rebuilds the stack.
- Produces: the sentences of a failed room and of changed game files end with `Start the server again.` in place of `Quit the server and open it again.`
- Produces: `serve` starts hosting at launch only when the configuration says `autoStart`.

- [x] **Step 1:** Write the failing tests: `a start request opens a failed room again, with the same links` (stand-in browser that fails four sessions, then works); `a start request leaves a restarting room alone`; `a start request after the game files changed builds the stack anew`; `the status counts connected and kept controllers and names nobody`; `autoStart is true unless the file says false, and anything else is a damaged file`; `a server whose configuration says no auto start is idle until asked` (smoke, in Task 3). Also written: `a start request retries a failed room and a failed address together`, `configure keeps the switch for starting at launch`, and `a failed room can be started again from the very report of its failure` for the keeper. The tests' room has two pauses, so three sessions fail before the one that works.
- [x] **Step 2:** Run `npm test --prefix server`. Expected: fail.
- [x] **Step 3:** Implement. Whether the relay lets a released room name be opened again is checked first; if it does not, that is a ruling.
- [x] **Step 4:** Run `npm run typecheck --prefix server && npm test --prefix server`. Expected: pass.

### Task 3: The routes and the commands

**Files:**
- Create: `server/src/host-control.ts` (added in phase 2: the rules of the three operations)
- Modify: `server/src/host-server.ts`, `server/src/serve.ts`, `server/src/control.ts`, `server/src/instance.ts`, `server/src/main.ts`, `server/src/self-test.ts`
- Modify: `server/test/host-server.test.ts`, `server/test/fixtures.ts`, `server/test/instance.test.ts`, `server/smoke/sea.test.mjs`

**Interfaces:**
- Consumes: Task 1's credentials; Task 2's `players`, `start` and `autoStart`.
- Produces: `POST /api/host/start`: 202 `{ host }` at once; the start runs on.
- Produces: `POST /api/room/stop`, optional JSON body `{ "force": true }`: 409 `{ error: 'Players are in the room.', players }` when `connected + reserved > 0` without `force`; otherwise 202 `{ host }`.
- Produces: `GET /api/config`: 200 `{ gameFolder, discPolicy, autoStart, problem }`. The folder path leaves the server here only, never in the status.
- Produces: `PUT /api/config`, JSON body with any of `gameFolder`, `discPolicy`, `autoStart`: 200 with the saved configuration; 400 with the sentence of `GameFolderError` or `Unknown disc policy.`; 409 `{ error: 'Stop the room before changing the game folder or the disc policy.' }` while the host state is not `needs_setup`, `idle` or `failed`.
- Produces: the commands `start` and `stop [--force]`, printing `{ event: 'starting' | 'stopping', host }`, or the refusal on standard error with exit code 1.

- [x] **Step 1:** Write the failing tests: `start and stop go through the control listener` (a stand-in `control` object records the calls; 401 without a credential; a session may call both); `a stop with players needs force`, and its refusal says how many are there (Review Focus 5); `start and stop asked together, by a command and by the panel, end with one stack or none` (with the real host service and no browser; Review Focus 4); `the configuration is read and changed through the listener` (a folder without a disc is refused in words and the file is unchanged; a change during hosting is refused; `autoStart` alone is taken at any time); smoke: `the packaged server starts and stops hosting on request and keeps running`, `a server whose configuration says no auto start is idle until asked`.
- [x] **Step 2:** Run `npm test --prefix server`. Expected: fail.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `npm run verify --prefix server`. Expected: pass.

### Task 4: The page and the launcher

**Files:**
- Create: `admin/index.html`, `admin/panel.css`, `admin/session.js`, `admin/panel.js`, `admin/session.test.mjs`
- Modify: `server/src/host-server.ts`, `server/src/control.ts`, `server/src/instance.ts`, `server/src/platform/open-browser.ts`, `server/scripts/stage-resources.mjs`, `server/scripts/verify.mjs`, `server/test/fixtures.ts`, and, added in phase 3, `server/src/main.ts`, `server/src/serve.ts`, `server/src/self-test.ts`
- Modify: `server/test/host-server.test.ts`, `server/test/instance.test.ts` (added in phase 3: the launcher's tests), `server/smoke/sea.test.mjs`

**Interfaces:**
- Consumes: Task 1's routes.
- Produces: `admin/session.js`: `takeBootstrap(location, history): string | null` reads `#bootstrap=<64 hexadecimal digits>` and replaces the address with one without a fragment, whatever the fragment held; `openSession({ fetch, storage, bootstrap }): Promise<string | null>` trades the token, or returns the session that `storage` already holds under `sled-panel-session`; `api(session, path, init)` sends the bearer header.
- Produces: the page shows the application, its version and the host state when it has a session, and otherwise `This page is not connected to the server. Open Sled Storm Server again.`
- Produces: the listener serves `/`, `/panel.css`, `/session.js` and `/panel.js` from `<resources>/admin`, with `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`. Without the directory, `/` answers 500 with a sentence that names the build.
- Produces: `requestBootstrap(record): Promise<string | null>` in `instance.ts`. `launch` opens `http://127.0.0.1:<port>/#bootstrap=<token>`, or the plain address when no token can be had, and prints the address without the fragment. `openBrowser` accepts exactly these two forms.
- Produces: `stage-resources.mjs` copies `admin/` without its tests; `verify.mjs` runs `admin/*.test.mjs` with the web client's.

- [x] **Step 1:** Write the failing tests: `the token leaves the address and is traded once`, `a reload keeps the session and a refused token leaves none`, `a fragment that is no token is removed and ignored` (admin); `the listener serves the panel's files and nothing else from the folder` (`/session.test.mjs`, `/../web/app.js` and `/index.html%00` are 404); `the launcher opens the panel with a one-time token and prints none`; smoke: `the bundle carries the panel and no test files`, `a second launch gets a new one-time token for the same server` (HOST-01). Also written: `a tab that keeps nothing still gets a session from its token` (admin), `a server that gives no one-time token is opened by its plain address` and `the browser is given the panel's address and nothing else`.
- [x] **Step 2:** Run the tests. Expected: fail.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `npm run verify --prefix server`. Expected: pass.

### Task 5: Nothing public reaches the control listener (AUTH-01)

**Files:**
- Create: `server/test/public-boundary.test.ts`
- Modify: `server/smoke/sea.test.mjs`

- [x] **Step 1:** Write the tests, against the real gateway in front of the real game origin, with the control listener running in the same process: for each of `/api/status`, `/api/invitation`, `/api/config`, `/api/session`, `/api/session/bootstrap`, `/api/host/start`, `/api/host/quit`, `/api/room/stop`, `/api/game-folder/pick` and `/api/diagnostics/export`; with `GET`, `POST` and `PUT`; spelled plainly and as `/%61pi/…`, `/api%2F…`, `//api/…`, `/./api/…`, `/web/../api/…`; with and without the gateway's access cookie; with the control credential in the header; and with the control listener's own address as `Host`: the answer is 400, 401 or 403, never carries `instance`, and the control operations were not called. A WebSocket upgrade to the same paths, through the gateway and through its mirror listener, is refused. The links of `/api/invitation` and the reply of `/session-info`, with its headers, carry neither the control credential nor a session nor the game folder. These pass at once if the boundary holds; a failure is a finding.
- [x] **Step 2:** Smoke: the same sample through the gateway port of the packaged server, and the page's own files asked through the gateway: 403.
- [x] **Step 3:** Run `npm run verify --prefix server`. Expected: pass.

### Task 6: The real thing, by hand

A copy of the built bundle without the tunnel program, `SLED_SERVER_HOME` in a scratch folder, opened with `open`.

- [x] **Step 1 (HOST-01):** Open the bundle: the default browser shows the page with a session, and the address has no fragment. Open it again: one server, a second tab with a session of its own. Reload: still connected. Open the first address from the history: not connected, with the sentence.
- [x] **Step 2:** Close every tab: the server runs on. `stop`, `start` and `status` from the command line; `stop` with a player in the room is refused without `--force`.
- [x] **Step 3 (AUTH-01):** From the game page's console on port 8000, and from a page of another site, `fetch` the status and `POST` quit on the panel's port: no answer is readable and the server runs on.
- [x] **Step 4:** `quit`: nothing is left running.

### Task 7: Review

- [x] **Step 1:** One independent reviewer on the most capable model, from a diff against `54a64b3`, with this plan's Review Focus.
- [x] **Step 2:** Fix critical and important findings test first, and the minor ones that are cheap and clearly right.

### Task 8: Records

- [x] **Step 1:** `docs/sea-server-plan.md`: slice 1 results under P3, what was not verified, the verification log, a new "Where to continue". `CHANGELOG.md`. "Build and run the current result" for the new commands.
- [x] **Step 2:** Run every check on the final tree.
