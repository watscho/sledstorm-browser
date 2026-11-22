# P3 slice 2: the panel and the first run

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A double click on the application leads, without a terminal, to a page where the owner chooses the game folder in the system's dialog, chooses the disc policy once, starts the server, copies the invitation, opens the game on this computer, stops the room and quits.

**Architecture:** The server gains one operation, the system folder dialog: a fixed AppleScript run by `execFile`, behind `POST /api/game-folder/pick`. Everything else that the page needs exists since slice 1. The page stays plain modules without a build step and is cut in three: `view.js` turns what the server answered into what the page shows, as data; `controller.js` asks the server once a second and carries out the buttons; `panel.js` puts the view into the document. The first two are tested with `node:test`; the third is checked in a browser.

**Tech Stack:** Node.js 26.13.1 single executable, TypeScript checked only, `node:test`. `/usr/bin/osascript` for the dialog. The page is plain modules, no framework and no build step.

**Spec:** the owner's brief "Sled Storm Server — Node SEA", sections 4, 9, 12 and 13 with APP-01 and SAVE-03 (outside the repository), and `docs/sea-server-plan.md`, "P3 Browser admin and macOS launch".

**Review base:** the state that slice 1 left. No commit holds it (`git log` ends at `54a64b3`), so it is the ignored file `.superpowers/sdd/p3-slice-1-tree.tar`. On 2026-11-21, before the first change of this slice, all 197 files that Git does not ignore were equal to it.

## Global Constraints

- No push, no release, no published binary. No per-task commit; the owner commits.
- Code, comments and committed documents in English.
- The game disc, its hashes, private links, room identifiers and every token stay out of Git, logs, the status and standard output. The folder's path leaves the server only in the answers about the configuration, to a command or to the panel.
- No automated test starts the real Chromium, a tunnel, the network, the user's browser or a system dialog. A test of the dialog names a stand-in program.
- No text of a request reaches the script of the dialog or a shell. The route of the dialog reads no body.
- A cancel in the dialog changes nothing.
- A loopback address is not authorization: every control route needs a credential, the listener's own Host and no foreign Origin. Control routes match the raw request path (D12).
- Closing a page stops nothing.
- Whatever the server answers is put into the page as text, never as markup. The page's content security policy stays as it is.
- An invitation never carries the control credential, a session or a folder path.
- The local game origin stays `http://127.0.0.1:8000`, and the panel is always opened on `127.0.0.1`.
- A file that is added to `admin/` is added to the listener's list in `server/src/host-server.ts` and to `stagePanel` in `server/scripts/stage-resources.mjs`.
- `server.py` and `tools/play-online.py` keep working. No change under `web/` or `research/network` is expected in this slice.

## Decisions taken with this plan

1. **The folder is chosen in the system's dialog, shown by `/usr/bin/osascript` with a fixed script that the server runs by `execFile`.** P0 decided against a native shim, so `NSOpenPanel` of our own is not at hand; the brief names the fixed AppleScript. The route takes no body, so nothing of a request can reach the script. Cost: the dialog belongs to `osascript`, not to the application, and whether macOS then lets the server read a folder under `Documents`, `Desktop` or `Downloads` without a second prompt is not known before the hand check of phase 4.
2. **The request for the dialog stays open until the dialog is answered, and one dialog is open at a time.** A second request meanwhile is answered 409. A cancel answers 200 with `picked: false` and the configuration as it was. A chosen folder goes through the same check and the same save as `PUT /api/config`. A folder that is refused leaves the configuration as it was. A quit ends an open dialog. Cost: a page that is closed or reloaded leaves its dialog on the screen, and the folder that is then chosen is still saved; the page that is open next reads it.
3. **`SLED_SERVER_FOLDER_DIALOG` names a stand-in for `osascript`, by its full path, and a server that was started with `SLED_SERVER_NO_BROWSER=1` and no stand-in has no dialog.** The switch now means that the server shows nothing on the user's screen. In the code, the operations of the host have no dialog unless they are given one; only `serve` gives the system's. So a test that forgets the stand-in gets a refusal, not a dialog on the owner's screen. Cost: a hand check of the dialog starts the server by a double click or `open`, without that switch.
4. **A saved change of the game folder or the disc policy returns a host that is at rest with a problem of its configuration or its game files to `idle`.** The sentence was about the configuration before the change. Without this the page would show `Choose the game folder and the disc policy to start hosting.` right after both were chosen. A problem of the build (emulator, runtime) stays. Cost: the status of a host at rest no longer says what the last start found once the owner has changed what it complained about; the next start says it anew.
5. **The page follows the server by asking**: the status, the configuration and, while a room exists, the invitation, once a second. No event stream: the control listener is no WebSocket endpoint, and that is pinned by a test. Cost: the page is up to a second behind, more in a hidden tab, and a public address that changed is shown a second late.
6. **Setup is what the configuration says**, not the host state: the page shows setup as unfinished while the game folder or the disc policy is missing or the file has a problem (taken over from slice 1). The folder and the policy can be changed while the host is `needs_setup`, `idle` or `failed`; otherwise their controls are disabled, and what the server still refuses is shown in its own sentence.
7. **"Open game" is a link to the room's address on this computer**, the `localUrl` of the invitation, opened in a new tab without an opener and without a referrer. The panel is opened in the default browser, and a link opens in the same browser, where the library of saves of `http://127.0.0.1:8000` is. No route is added. Cost: a panel that the owner moved to another browser opens the game there, with that browser's library.
8. **"Copy invite link" writes the guests' link to the clipboard**; `127.0.0.1` is a secure context. When the browser refuses, the page selects the link in its field and says to copy it by hand. Without a public address there is no link to copy, the page says so, and "Open game" still works.
9. **A stop with players is confirmed in the page**: the server's 409 with its counts turns the button into "Stop anyway", which sends `force`. Quit asks the same way when the status that the page last read counts players. The quit route itself stays unconditional, as the `quit` command is; whether the server should refuse it is slice 3. Cost: a player who joins between the page's last reading and the click on Quit is not asked about.
10. **The second disc policy is offered with a note that this version cannot host with it yet.** Nothing is chosen in advance: sharing is never switched on without a choice (D16). The server stays the judge and says its own sentence at a start. P4 removes the note.

## Phases

One phase per working session; each ends with `npm run verify --prefix server` passing.

| Phase | Tasks | State |
|---|---|---|
| 1 | This plan; Tasks 1 and 2, what the page needs from the server | Done 2026-11-21 |
| 2 | Tasks 3 and 4, what the page shows and what its buttons do | Done 2026-11-21 |
| 3 | Task 5, the page itself, in the bundle and in a browser | Done 2026-11-21 |
| 4 | Tasks 6 to 8: by hand, the review, the records | Done 2026-11-21 |

## Status

**Phase 1 is done (2026-11-21).** Tasks 1 and 2 are complete. The server shows the system's folder dialog on its own computer: `POST /api/game-folder/pick` runs `/usr/bin/osascript` with a fixed script, waits for the answer, and saves the folder that was chosen as `PUT /api/config` would, or changes nothing after a cancel. A saved change of the folder or the policy tells the host, which goes back to `idle` when what its status said was about the configuration before. `server/src/platform/folder-dialog.ts` and `server/test/folder-dialog.test.ts` are new; nothing under `admin/`, `web/` or `research/network` changed.

In Task 1 the four tests of the adapter and the listener's test file failed first on the missing module; with the adapter written, the three tests of the route failed on `404 Not found` where 200, 409 and 503 were expected. The two smoke tests failed the same way on the build of slice 1. In Task 2 the test of the host failed first with `configured is not a function`, and two tests of the listener on the counts of `configured`. `npm run verify --prefix server` passed on the final code, all 11 checks in 136 s: the server tests 221 of 221 on Node.js 24.18.0 and on the pinned 26.13.1 (213 before), the network modules 71 of 71, the web client and the panel's page 70 of 70, the packaged build, and its smoke tests 25 of 25 (23 before). The records were written during and after that run; `git diff --check` is clean with them. Nothing was checked by hand in this phase.

Nobody has seen the dialog. Its script was compiled with `osacompile` and never run, and what a cancel looks like was measured with `osascript -e 'error number -128'`: exit code 1 and `0:17: execution error: User canceled. (-128)` on the standard error. Whether `tell me to activate` brings the dialog in front of the browser, and which privacy prompts follow a choice, is Task 6.

What Tasks 1 and 2 settled beyond their text:

- The answers of the route, as the page of phase 2 will read them: 200 `{ picked: false, config }` after a cancel, with the configuration as it was; 200 `{ picked: true, config }` with the saved one, where `config` has the form of `GET /api/config`; 400 `{ error }` with the sentence that `PUT /api/config` has for such a folder; 409 `Stop the room before changing the game folder or the disc policy.`, before any dialog, in every state but `needs_setup`, `idle` and `failed` and while a start is under way; 409 `The folder dialog is already open. Look for it among the windows.`; 409 `The server is quitting.`; 503 `The folder dialog is not available.` on a server without one; 503 `The folder dialog could not be opened.` when it failed or was ended.
- A cancel is exit code 1 with `(-128)` in the standard error, and nothing else is: the same message with another exit code, and a number that only begins like it, are failures. An answer that is no full path is a failure too. The adapter passes on nothing of what the program printed, because those words may name the user's folders; its one message is `The folder dialog could not be shown.`
- The system's answer ends a folder with a slash and one line break. Only the line break is taken off; `findDisc` settles the rest, and what is saved is the real path.
- The route does not read a body. A request that names a folder gets the dialog like any other, and its folder is ignored.
- A folder from the dialog is saved through the same queue and under the same rule as a change by `PUT /api/config`. A start that is asked for while the dialog is open therefore wins: the folder that is then chosen is answered 409 and not saved.
- `HostControl.close()` ends an open dialog, and the request that waited is answered 503. `serve` calls it first when it stops. A server that is killed leaves its dialog on the screen: no guard process (D26) is spent on a window that holds no address. For the review of Task 7.
- `serve` chooses the dialog: the stand-in that `SLED_SERVER_FOLDER_DIALOG` names, which must be a full path; none with `SLED_SERVER_NO_BROWSER=1` or on a system other than macOS; the system's otherwise. The smoke test `a server that may show nothing has no folder dialog` pins that every staged copy, which is always launched with that switch, answers 503.
- The smoke tests ask the route with the control credential of the instance record, as the AUTH-01 smoke test does, not with a session through the stand-in opener. A session's way into the route is tested on the listener.
- The AUTH-01 smoke test asks the gateway of the packaged server for `/api/game-folder/pick` as for the other routes; it passed at once, as a test of a boundary that holds does. The unit test of the boundary asked for the route since slice 1, and its stand-in now writes down a `pick`.
- `HostService.configured()` takes back a `config` or a `game-data` problem of a host in `needs_setup` or `failed`, which includes the sentence of a policy that cannot host yet. It leaves a host that runs, a start that is under way and a problem of the build as they are. `HostControl` calls it where a change is saved, when the change held the folder or the policy, so a folder from the dialog needs no call of its own, and a change of `autoStart` alone, or a refused change, makes none.
- `standInControl()` in `server/test/fixtures.ts` has `pickFolder`, which writes down `pick`, and `close`. `standInService()` in `server/test/host-server.test.ts` writes down `configured`, and that file has `standInDialog()`: a dialog that answers what the test says next, or stays open until the test answers it or its signal ends it.

**Phase 2 is done (2026-11-21).** Tasks 3 and 4 are complete. `admin/view.js` turns what the server answered into what the page shows, as data, and `admin/controller.js` reads the server once a second and carries out the buttons; each has its tests beside it. No page loads them yet: the page is still the one of slice 1, and the two modules are neither served by the listener nor staged into the bundle. No file of the server, of `web/` or of `research/network` changed.

In Task 3 the tests failed first on the missing module, and then, against a module that gave an empty view, each of the eleven on an assertion of its own. Task 4 went the same way: the missing module, then each of the thirteen against a panel whose buttons did nothing. With both modules written, 45 single changes were made to them, one at a time, each breaking one rule: a second press that is sent, a body without its type, a link of any scheme, a question that outlives the players, a reading that was overtaken and is shown, and so on. Every one made a test fail. `npm run verify --prefix server` passed on the final code, all 11 checks in 137 s: the server tests 221 of 221 on Node.js 24.18.0 and on the pinned 26.13.1, unchanged, the network modules 71 of 71, the web client and the panel's page 94 of 94 (70 before), the packaged build, and its smoke tests 25 of 25. The records were written during and after that run; `git diff --check` is clean with them. Nothing was checked by hand in this phase, and nothing could be: no page loads the modules.

What Tasks 3 and 4 settled beyond their text:

- The two views have the same parts, and a control that is absent is null. `disconnected(sentence)` gives `application`, `version: null`, `headline: 'Not connected'`, the sentence, `details: []`, and null for `setup`, `game`, `start`, `stop`, `quit`, `players`, `invite`, `openGame` and `autoStart`. A test compares the keys of both views. `details` is a list of pairs, `['Room', 'open']`.
- A button that is not shown is not enabled: `start` and `stop` carry `enabled: false` with `shown: false`.
- Whatever the server sent leaves the view as text: a string as it is, anything else as its JSON, and what a status does not name at all as `unknown`. The states are looked up in a map, so `constructor` is a state that the page does not know, like any other. A view holds strings, booleans and null, nothing else, which a test checks on views of odd answers.
- A link is offered only when it begins with `http://` or `https://`. `openGame` and the invitation become an `href` and the clipboard's text in Task 5, the one place where the server's text is more than text.
- While the folder's request is under way, the sentence is `The folder dialog is open. Look for it among the windows.`, below a sentence of the page's own and above the problem of the status. A second press in the same tab sends nothing, so the server's sentence for a second dialog would never be seen there.
- One track is `1 track`. `view.js` has a third export, `inTheRoom(players)`, the words for the counts: the controller's question counts the players of the server's refusal.
- A reading asks for the status, then the configuration, then the invitation unless the status says that the room is `off`. A status that is not a 200 with an object shows no server, with `The server gave an answer that this page cannot read.`, and the page reads on. A configuration or an invitation counts only from a 200; without one the page shows the rest. A 401 on any of the three, or on a button's request, lets go of the session and ends the reading.
- A reading that was overtaken by a later one is dropped. After a request is answered, the buttons stay as they were until the reading that follows it is shown.
- A sentence of the page's own lasts until the next press, as planned, and gives way earlier once the status says something new: another state or another problem. The reading that follows the sentence is where it begins, so a refusal is not lost to the reading of its own request. Without this, `The link is copied.` would hide the sentence of a public address that failed later.
- A question about the players is taken back by any other press, and by a reading that counts nobody in the room: the page has no button for "no".
- Every press waits for the answer of the one before, Quit included, and the folder's request lasts as long as its dialog. With the dialog open, the page cannot quit the server; the `quit` command can, and a page that is loaded again has its buttons back. Copying the link is no request: it works meanwhile.
- Before the first reading, without a server and after the end, a button sends nothing. After a quit that was accepted, nothing more is asked, the reading ends when it is next due, and the session is kept.
- Any 2xx is a request that was taken. `PUT /api/config` and a stop with force carry `Content-Type: application/json`; the other requests have no body. The stand-in server of the tests answers a body without that type with 415, as the listener does.
- Two more sentences of the page's own: `The server did not answer. Try again.`, for a button's request without an answer when the reading after it finds the server; and `The server refused the request (500).`, for a refusal that has no sentence.
- A start that the server refuses for players in the room, which it does after the game files changed, shows the server's `Players are in the room.` The page has no "Start anyway": the room is stopped first, which asks.
- `copyInvite()` resolves to false when nothing was copied: without a link it says nothing, and after a refusal of the browser it says `Select the link and copy it.` The page of Task 5 then selects the link.
- Every test of the controller is bounded to 5 s. On Node.js 24.18.0 the runner does not end a test whose promise never settles: a run with the guard against a second press taken out stood for 137 s until it was stopped.

What Task 5 takes over:

- `panel.js` gives `createPanel` its `ask`: a request through `api` of `admin/session.js`, answered as `{ status, body }` with the JSON body or null, rejected when the server cannot be reached. `wait` is a timer, `lost` is `forgetSession`, `clipboard` is `navigator.clipboard.writeText`.
- Open: a request that the server never answers holds the reading, and the page shows its last view for as long. Whether `ask` gives up a `GET` after a few seconds is decided in Task 5. The folder's request must not be bounded: it lasts as long as its dialog.
- The radio buttons and the switch are written from the view at every reading. A press that the server refused therefore goes back by itself, and while its request is under way a control shows what is saved, disabled.
- Neither module is served or staged. Both lists of the page's files gain `view.js` and `controller.js` in Task 5, with the test that compares them with what the page loads.

**Phase 3 is done (2026-11-21).** Task 5 is complete. The page is rebuilt on the two modules. `admin/index.html` holds every part of the page and every word that is the page's own; `admin/panel.js` connects, gives the controller its way to the server and writes each view into the document; `admin/panel.css` gives it its look. The listener serves `/view.js` and `/controller.js` beside the four files of slice 1, and the bundle carries them. `admin/page.test.mjs` is new. `server/src/host-server.ts`, `server/scripts/stage-resources.mjs` and `server/src/self-test.ts` changed by one list each. `admin/view.js`, `admin/controller.js` and `admin/session.js` did not change, and nothing under `web/` or `research/network` did.

The tests came first. Of the eleven tests of `admin/page.test.mjs`, ten failed against the page of slice 1: the two modules lay in the folder and were not loaded, and the document had none of the elements. The eleventh, `the page writes text and sets no markup`, passed at once, as a test of a rule that the old page kept as well; it failed later, when `innerHTML` was written into the script on purpose. Two tests of the listener failed on `404` for `/view.js` and on the four names of the staged folder. Three smoke tests failed on the build of phase 2: four names in the bundle, `404` for `view.js`, and the first run on the missing `controller.js`. With the page written, ten of the eleven passed, and the last one waited for the two lists.

Then 49 single changes were made to the script, the document and the two lists, one at a time, each breaking one rule: a button that sends another button's request, a reading without its bound, a bound on the folder's request, a link that is kept after it is gone, a choice that is not written back, a control that stays shown without a server, a file that is missing from one list. 48 made a test fail. The one that did not keeps the old lines of the details in a list that is hidden, which nobody sees. One change was not caught at first: an answer that is cut short and then taken for an empty one. The test's stand-in could not cut an answer short; it can now, and the change fails.

`npm run verify --prefix server` passed on the final code, all 11 checks in 140 s: the server tests 221 of 221 on Node.js 24.18.0 and on the pinned 26.13.1, the network modules 71 of 71, the web client and the panel's page 105 of 105 (94 before), the packaged build, and its smoke tests 26 of 26 (25 before). The records were written during and after that run; `git diff --check` is clean with them.

The page was opened in the application's browser pane from a scratch copy of the built bundle (Step 5). In that copy the emulator, the room's browser, the tunnel program and the folder dialog were the stand-ins of the tests, so that every part of the page could be seen without a real tunnel, a real emulator or a dialog on the screen. The page, the listener and the web client were the bundle's. This is not the hand check of the slice. What was seen:

- A new installation: `Needs setup` with the server's sentence, no folder, neither policy chosen, "Start server" disabled, the switch on.
- "Choose game folder" with the stand-in held open: `The folder dialog is open. Look for it among the windows.`, every control disabled, and one request and one stand-in for two presses. A cancel changed nothing. An empty folder gave `Expected exactly one CUE file in the game folder.` The folder with a synthetic disc was shown with its path, and the server's sentence went (D50).
- The second policy was saved, and a start with it gave the server's sentence about it. The first policy took that sentence back. "Start server" then led to `Online`, with the disc's line, the players' counts, the guests' link in its field and "Open game" to the same room on this computer, with `target="_blank"` and `rel="noopener noreferrer"`. The link opened the game page of the scratch server, which offered to join the room.
- "Copy invite link" said `The link is copied.` and the link was on the clipboard. The switch was saved, and the server that was launched next did not start its room. The details listed the version and the three states.
- "Stop room" led to `Stopped`: the room's part went, the field was empty and the link had no address. "Quit server" led to `The server has quit. Open Sled Storm Server to start it again.` with no control left, and no process of the copy was left running. A server that was killed while its page was open was shown as `The server is not running. Open Sled Storm Server to start it.` within three seconds.
- The token left the address. The tab kept its session in its own storage and set no cookie. The page's script wrote nothing into the console, and the policy stopped nothing: all six files loaded, and no report of the policy was logged.

Seen there and left as it is:

- The browser writes a line into its console for every request that is refused or not answered: the 400 of the empty folder, a 409 for an invitation that was asked for while the room was closing, and one line a second while the server is gone. None is from the page's script.
- In the pane a link with `target="_blank"` opens in the same tab. The game page replaced the panel's page, which was then opened again and still had its session. A browser opens a new tab; Task 6 sees that.
- The look put the synthetic link on the owner's clipboard.

What Task 5 settled beyond its text:

- `admin/page.test.mjs` also runs the page's script, which the plan left to the browser. It loads `panel.js` into a stand-in for a tab: a `window`, a `document` that is read from `index.html`, and a `fetch` that answers from a table. An element there takes only the properties that the page may write, each with the type that a browser keeps, so `href = null`, a text that is written over other elements and any `innerHTML` fail. A test presses only what is shown and enabled. Each page is loaded as `panel.js?page=N`, a module of its own. The three tests of the plan read source files and pass on a page that does nothing with the two modules, so they could not fail first.
- The elements that the script writes into, by id: `application`, `headline`, `sentence`; `setup`, `no-folder`, `folder`, `game`, `choose-folder`, `policy-shared-allowed`, `policy-local-only`, `setup-unfinished`; `hosting`, `start`, `stop`; `room`, `players-line`, `players`, `invite-note`, `invite`, `invite-url`, `copy-invite`, `open-game`; `options`, `auto-start`; `details`, `details-list`; `closing`, `quit`. The script asks for an element only as `element('…')` with the id written out, and a test reads the ids from its source: each is in the document once, and the document has no id that nothing uses.
- A reading gives up after 5 s, by `AbortSignal.timeout` on every `GET`, and the page then shows no server until a reading is answered. No other request has an end of its own: a button's request is sent once, and the folder's lasts as long as its dialog. This settles what phase 2 left open (D56).
- A tab without a session sends nothing: its `ask` answers 401 itself, and the controller then shows `This page is not connected…` and stops reading. Such a tab never says that the server is not running.
- An answer whose body is cut short was not given: it rejects, like a server that cannot be reached. A body that is no JSON is null, which the controller shows as an answer that the page cannot read.
- A property is written only when it differs from what the element has, and the lines of the details only when their pairs changed. A reading that found nothing new leaves the document alone: a selection stays, and the sentence, which is a `role="status"`, is not announced again. The radio buttons and the switch are compared at every reading, so a press that the server refused goes back by itself.
- A link that the view no longer gives is taken out of the page, not only hidden: the field is emptied and the `href` is removed (Review Focus 3).
- Beyond `textContent`, `hidden`, `disabled`, `checked` and `href`, the script writes the `value` of the read-only field of the guests' link, and makes the lines of the details as `dt` and `dd` elements, the only elements that it makes.
- The policies: first `shared-allowed`, "Players may download the game files from this server", then `local-only`, "Players use only their own game files", with the note "This version cannot host a room with the second choice yet." Neither is chosen in advance.
- Three texts are the document's own and are switched by `hidden`: "No game folder is chosen.", "The server can be started once the game folder and the disc policy are chosen." while setup is unfinished, and "Players:" before the counts. The script holds no sentence at all. The version is shown in the details only.
- The smoke test of the first run loads `session.js` and `controller.js` out of the staged bundle and lets them ask the packaged server, with the stand-ins for the browser's opener, the dialog, the room's browser and the tunnel. It asks what the page asks, in the page's order, and so also pins that the packaged server answers what the modules read. The document is not part of it.
- The listener's test asks for the test files that lie in the page's folder, `/view.test.mjs`, `/controller.test.mjs` and `/page.test.mjs`, and gets `404`.

What phase 4 takes over:

- Task 6 is the first time anyone sees the system's dialog, and the first time the page runs in the default browser, with the real emulator. It needs a server that was started without `SLED_SERVER_NO_BROWSER=1` (D49) and the owner's eyes or the Chrome extension: ask for them first.
- Not seen in a browser yet, only in the tests: a stop and a quit that ask about players, a clipboard that refuses, and the page in a browser other than the pane's.
- The scratch copy of the look was made by a script in the session's scratch folder, which is gone. It did what `stage('application', { emulator: true, tunnel: 'fake' })` does in `server/smoke/sea.test.mjs`, with a dialog stand-in that stays open while a file exists and then answers with the content of a second file, or as a cancel without one. It was started from the shell with `SLED_SERVER_HOME`, `SLED_SERVER_NO_BROWSER=1`, `SLED_SERVER_OPENER`, `SLED_SERVER_FOLDER_DIALOG`, `SLED_SERVER_TUNNEL_PROBE=off` and ports of its own, 18000 and 18006. Task 6 uses the built bundle without `Contents/Resources/bin` instead, as its text says.
- For the review of Task 7, beside the Review Focus: the server's sentence for a start with `local-only` ends "Choose shared-allowed to host.", a word that the page does not show. On a new installation the document's note about the setup repeats the server's sentence above it until the folder is chosen. A button's request that the server never answers keeps the buttons waiting until the page is loaded again. The lines that a browser writes into its console, above. The one change that no test catches, above.
- The item "`admin/panel.js` has no automated test" under "Open after slice 1" in `docs/sea-server-plan.md` is closed by this phase. Task 8 takes it out when it writes the slice's records.

**Phase 4 is done (2026-11-21), and with it the slice.** Tasks 6 to 8 are complete. What was checked by hand, what the review found and what was fixed, what was not verified and what stays open are under "P3 Browser admin and macOS launch" in `docs/sea-server-plan.md`, with D58 and D59 and the verification log; the ledger has every step and ruling.

- Task 6 ran on a scratch copy of the built bundle without the tunnel program, opened with `open`. The owner watched the screen for APP-01 and the folder dialog, and the Claude extension read the page in Chrome; the rest ran in the application's browser pane, whose profile holds the library of wrapper 1.1.0. APP-01, the dialog (in front of the browser, one at a time, a cancel, the owner's disc under `Documents` with no privacy prompt), a start, "Open game", SAVE-03, a stop and a quit with a player seated, a quit with the dialog open, the switch both ways, and the invitation through a real tunnel in front of a synthetic disc were seen. A folder without a disc in the real dialog, a privacy prompt and a click in Finder were not.
- The hand check found that a double click on "Stop room" or "Quit server" with players in the room answered its own question; fixed test first (D58).
- Task 7: the reviewer on Fable 5.2 was stopped by the model's usage limit before it wrote anything; one reviewer on Opus 5.5 ran in its place. Nothing critical; its important finding was the double click, to which it added a held key; its seven minor findings are all fixed test first (D48, D53, D58, D59 and four sentences of the page and the server).
- Task 8: the records above, `CHANGELOG.md`, "Build and run the current result" for the panel, the snapshot `.superpowers/sdd/p3-slice-2-tree.tar` as the review base of slice 3, and a new "Where to continue".

**Next: slice 3** of P3, which gets a task plan of its own.

## Review Focus

1. The dialog is behind another window and the button is pressed again; the page is reloaded or closed while the dialog is open; the server is told to quit with the dialog open: one dialog at most, a sentence that says where to look, no request that hangs for ever, and no dialog left on the screen by a server that is gone.
2. A folder whose name has spaces, quotes, an apostrophe, non-ASCII letters, a leading dash or a line break: it comes out of the dialog as it is, is never part of a script or a shell line, and is saved or refused in a sentence.
3. The public address changes or goes away while the page is open: the link that the page offers is the current one or none, never the old one.
4. The server quits, is killed or is started anew while the page is open, or the computer sleeps: the page says so in a sentence and offers nothing that cannot work; it does not show "Online" for ever.
5. A folder path or a sentence from the server that contains markup: shown as text. A button pressed twice, or two buttons at once: one request, and the answer of the server decides.

---

### Task 1: The system's folder dialog

**Files:**
- Create: `server/src/platform/folder-dialog.ts`, `server/test/folder-dialog.test.ts`
- Modify: `server/src/host-control.ts`, `server/src/host-server.ts`, `server/src/serve.ts`, `server/src/self-test.ts`
- Modify: `server/test/host-server.test.ts`, `server/test/public-boundary.test.ts`, `server/test/fixtures.ts`, `server/smoke/sea.test.mjs`

**Interfaces:**
- Produces: `type ChooseFolder = (signal: AbortSignal) => Promise<string | null>`: the chosen folder's path, or null after a cancel; it rejects when the dialog could not be shown or was ended by the signal.
- Produces: `systemFolderDialog(program = '/usr/bin/osascript'): ChooseFolder`. It runs `program` with `-e 'tell me to activate' -e 'POSIX path of (choose folder with prompt "Choose the folder that holds your Sled Storm disc")'`. Exit 0 gives the standard output without its one final line break. Exit 1 with `(-128)` in the standard error is a cancel. Anything else rejects with `FolderDialogError`, whose message names no path.
- Produces: `createHostControl({ paths, service, chooseFolder? })`; `HostControl` gains `pickFolder(): Promise<{ picked: boolean; config: SavedConfig } | Refusal>` and `close(): void`, which ends an open dialog. `Refusal['status']` gains 503.
- Produces: `POST /api/game-folder/pick`, control credential or panel session, no body read: 200 `{ picked: false, config }` after a cancel; 200 `{ picked: true, config }` with the saved configuration; 400 `{ error }` with the sentence of `PUT /api/config` for a folder that is refused; 409 `{ error: 'Stop the room before changing the game folder or the disc policy.' }` before any dialog while hosting is up or a start is under way; 409 `{ error: 'The folder dialog is already open. Look for it among the windows.' }`; 409 `{ error: 'The server is quitting.' }`; 503 `{ error: 'The folder dialog is not available.' }` without a dialog; 503 `{ error: 'The folder dialog could not be opened.' }` when it failed.
- Produces: `serve` gives the system's dialog on macOS, the stand-in that `SLED_SERVER_FOLDER_DIALOG` names by its full path, or none with `SLED_SERVER_NO_BROWSER=1`; it calls `control.close()` first when it stops.

- [x] **Step 1: Write the failing tests.**
  - `folder-dialog.test.ts`, each with a stand-in program written into a scratch folder: `the dialog's answer is the folder, whatever its name` (the stand-in prints, by `printf '%s\n'`, a path with spaces, a quote, an apostrophe, `雪`, a leading dash in the last part and one with a line break inside; each comes back unchanged but for the final line break; the stand-in's recorded arguments are exactly the four fixed ones); `a cancel is no folder and no error` (exit 1 with `execution error: User canceled. (-128)` on standard error gives null); `a dialog that cannot be shown is an error that names no path` (exit 1 with another message; a program that does not exist; an empty answer with exit 0); `a dialog is ended by its signal` (the stand-in sleeps; after `abort()` the promise rejects and the stand-in's process is gone).
  - `host-server.test.ts`: `the game folder is chosen in a dialog on the server's computer` (401 without a credential; 404 for `GET`; with a session and a `chooseFolder` that gives a folder with a disc: 200 `picked: true`, and `GET /api/config` and the file name its real path; one that gives null: 200 `picked: false`, the file unchanged; one that gives a folder without a disc: 400 with `Expected exactly one CUE file in the game folder.`, the file unchanged; one that rejects: 503 with the sentence; a body with `{"gameFolder":"/elsewhere"}` in the request changes nothing about what is chosen); `one folder dialog at a time, and none while hosting is up` (a `chooseFolder` that waits: a second request is 409 with the sentence while the first is open and the stand-in was called once; with the host `online` or a start under way: 409 before any call; `control.close()` aborts the signal of the open one, whose request is then answered 503); `a server without a dialog says so` (no `chooseFolder`: 503 `The folder dialog is not available.`).
  - `public-boundary.test.ts`: the stand-in control writes down `pick`; nothing reaches it.
  - Smoke: `the game folder is chosen through the dialog's stand-in, and a cancel changes nothing` (a packaged server with `SLED_SERVER_FOLDER_DIALOG`; a session through the stand-in opener; pick gives `picked: true` and the folder; `status` and the log name no folder; then the stand-in cancels: `picked: false`, the same configuration); `a server that may show nothing has no folder dialog` (only `SLED_SERVER_NO_BROWSER=1`: 503).
- [x] **Step 2:** Run `npm test --prefix server`. Expected: the new tests fail, the older ones pass.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `npm run typecheck --prefix server && npm test --prefix server`. Expected: pass.

### Task 2: A change of the configuration and what the status said before it

**Files:**
- Modify: `server/src/host-service.ts`, `server/src/host-control.ts`
- Modify: `server/test/host-service.test.ts`, `server/test/host-server.test.ts`, `server/test/fixtures.ts` or wherever a stand-in `HostService` is written

**Interfaces:**
- Produces: `HostService.configured(): void`. On a host whose state is `needs_setup` or `failed` with a problem of component `config` or `game-data`, and with no start under way, the status becomes `idle` without a problem. In every other state it changes nothing.
- Produces: `HostControl.configure` and `pickFolder` call it after a change of `gameFolder` or `discPolicy` was saved; a change of `autoStart` alone does not.

- [x] **Step 1: Write the failing tests.** `host-service.test.ts`: `a saved change of the configuration takes back what the status said about the one before` (a start without a configuration is `needs_setup` with its sentence; `configured()` makes it `idle` with `problem: null`; a start with a folder whose track is missing is `failed` with component `game-data`, and `configured()` makes it `idle`; a build without its browser is `failed` with component `emulator` and stays so; an `online` host stays `online`). `host-server.test.ts`: in `the configuration is read and changed through the listener`, the stand-in service counts `configured`: once for a saved folder, once for a saved policy, not for `autoStart` alone, not for a refused change; and after a pick that saved a folder.
- [x] **Step 2:** Run `npm test --prefix server`. Expected: fail.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `npm run verify --prefix server`. Expected: pass.

### Task 3: What the page shows

**Files:**
- Create: `admin/view.js`, `admin/view.test.mjs`

**Interfaces:**
- Consumes: the bodies of `GET /api/status`, `GET /api/config` and `GET /api/invitation` as slice 1 made them.
- Produces: `panelView({ report, config, invitation, busy, confirming, notice })`, a pure function. `report` is the status body, `config` the configuration body, `invitation` is `{ url, localUrl }` or null, `busy` is the name of the request that is under way or null (`'folder' | 'policy' | 'start' | 'stop' | 'quit' | 'autoStart'`), `confirming` is `'stop' | 'quit' | null`, `notice` a sentence of the page's own or null. It returns:
  - `application`, `version`: text.
  - `headline`: the host state in words. `needs_setup` reads `Needs setup`; `idle` reads `Stopped`, or `Needs setup` while setup is unfinished; `preparing` `Preparing the game files`; `starting` `Starting`; `online` `Online`; `degraded` `Running, with a problem`; `failed` `Failed`; `stopping` `Stopping`; any other value is shown as it is.
  - `sentence`: `notice`, else the status problem's message, else the configuration's `problem`, else null.
  - `setup`: `{ unfinished, folder, policy, locked }`; `folder` is the path or null, `policy` one of the two names or null, `locked` is true unless the state is `needs_setup`, `idle` or `failed`, and true while any request is under way.
  - `game`: null without `report.host.game`, else `Sled Storm (PAL), 2 tracks, 613 MB` or `Unrecognized disc, 2 tracks, 613 MB`, megabytes as `Math.round(bytes / 1048576)`.
  - `start`: `{ shown, enabled }`. Shown in `needs_setup`, `idle`, `failed` and `degraded`; enabled when setup is finished and nothing is under way.
  - `stop`: `{ shown, enabled, label }`. Shown in `preparing`, `starting`, `online`, `degraded` and `stopping`; disabled in `stopping` and while a request is under way; the label is `Stop room`, or `Stop anyway` while `confirming` is `'stop'`.
  - `quit`: `{ enabled, label }`: `Quit server`, or `Quit anyway` while `confirming` is `'quit'`.
  - `players`: null when the status has none, else `1 connected, 0 away with a controller kept`.
  - `invite`: `{ url, note }`. `url` is the guests' link or null; `note` is null with a link, `The public address is not available yet.` with a room and no link, null without a room.
  - `openGame`: `localUrl` or null.
  - `autoStart`: `{ checked, enabled }`.
  - `details`: pairs of a name and a value: `Version`, `Room`, `Public address`, `Second address`, with the states as the status names them.
- Produces: `disconnected(sentence)`: the view of a page without a server: only `application`, `headline: 'Not connected'` and `sentence`, with every control absent.

- [x] **Step 1: Write the failing tests**, one fixture per state, in `admin/view.test.mjs`: `a new installation is asked for its folder and its policy, and cannot be started` ; `with both chosen the server can be started, and the folder can still be changed`; `while the server prepares and starts, it can be stopped and the setup is locked`; `an online room shows its invitation, its players and the way into the game`; `a room without a public address says so and can still be played on this computer`; `a failed start shows its sentence and can be tried again`; `a stop that the server refused for players becomes a question`; `a request under way disables every button`; `a state or a value that the page does not know is shown as it is` (a state `resting`, a `players` with text in place of numbers, an invitation that is no object, a `config` of null: no throw, and nothing but strings, booleans and null in the view); `markup in a sentence or a path stays text` (the view carries it unchanged; putting it into the page as text is Task 5's).
- [x] **Step 2:** Run `node --test "admin/*.test.mjs"`. Expected: fail on the missing module.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run the tests. Expected: pass.

### Task 4: What the buttons do

**Files:**
- Create: `admin/controller.js`, `admin/controller.test.mjs`

**Interfaces:**
- Consumes: `panelView` and `disconnected` of Task 3; `api(session, path, init)` of `admin/session.js` through `ask`.
- Produces: `createPanel({ ask, render, wait, clipboard, lost })`. `ask(path, init)` resolves to `{ status, body }` with the JSON body or null, and rejects when the server cannot be reached. `render(view)` is called after every reading and every change. `wait(ms)` resolves when the next reading is due. `clipboard(text)` resolves when the text was copied. `lost()` is called when the server answers 401, so that the tab lets go of its session.
- Produces: the panel object: `run(): Promise<void>` reads once a second until the page is disconnected; `chooseFolder()`, `setPolicy(name)`, `setAutoStart(value)`, `start()`, `stop()`, `quit()`, `copyInvite(): Promise<boolean>`. Each sends one request, renders with `busy` set while it is under way, and reads the server anew when it is answered.
- The requests: `POST /api/game-folder/pick`; `PUT /api/config` with `{ discPolicy }` or `{ autoStart }`; `POST /api/host/start`; `POST /api/room/stop`, and with `{ "force": true }` when it is asked a second time after a 409 with `players`; `POST /api/host/quit`.
- The sentences of the page's own: `This page is not connected to the server. Open Sled Storm Server again.` after a 401; `The server is not running. Open Sled Storm Server to start it.` when it cannot be reached; `The server has quit. Open Sled Storm Server to start it again.` after a quit was accepted; `Players are in the room: 1 connected, 0 away with a controller kept. Stop it anyway?` and the same for quit; `The link is copied.`; `Select the link and copy it.` when the clipboard refused; `No folder was chosen.` is not said: a cancel says nothing. An `error` of the server is shown as the notice until the next action.

- [x] **Step 1: Write the failing tests** with a stand-in server that answers from a table and keeps what it was asked: `the page reads the status, the configuration and the invitation, and reads again a second later` (no invitation is asked for while the room is `off`); `a folder is chosen through the server's dialog, and a cancel changes nothing and says nothing`; `a second press while a request is under way sends nothing`; `the policy and the switch are saved by one request each`; `start and stop send one request, and what the server refuses is shown in its sentence`; `a stop with players asks first and then stops with force` (Review Focus 5); `a quit with players asks first; an accepted quit ends the reading and says that the server has quit`; `a server that forgets the session disconnects the page and lets go of the session`; `a server that cannot be reached is said to be not running, and the page finds it again when it answers` (Review Focus 4); `the invitation that is shown is the one of the latest reading` (the address changes between two readings, then goes away: the view has the new link, then none; Review Focus 3); `the link is copied, or the page says how to copy it`; `an answer that is not what the page expects does not stop the reading` (a status of 500, a body of null).
- [x] **Step 2:** Run `node --test "admin/*.test.mjs"`. Expected: fail on the missing module.
- [x] **Step 3:** Implement.
- [x] **Step 4:** Run `npm run verify --prefix server`. Expected: pass.

### Task 5: The page

**Files:**
- Modify: `admin/index.html`, `admin/panel.css`, `admin/panel.js`
- Modify: `server/src/host-server.ts` (`PANEL_FILES`), `server/scripts/stage-resources.mjs` (`PANEL_FILES`), `server/src/self-test.ts`
- Modify: `server/test/host-server.test.ts`, `server/smoke/sea.test.mjs`
- Create: `admin/page.test.mjs`

**Interfaces:**
- Consumes: Tasks 3 and 4.
- Produces: `admin/panel.js` connects as before, then builds `createPanel` with `ask` over `api`, and a `render` that writes each part of the view into its element by `textContent`, `hidden`, `disabled`, `checked` and `href` only. It has no rule of its own about the server.
- Produces: the listener serves `/view.js` and `/controller.js` beside the four files of slice 1, and the bundle carries them.

- [x] **Step 1: Write the failing tests.** `admin/page.test.mjs`: `every file that the page loads is served by the listener and staged into the bundle` (the `src` and `href` of `index.html` and the imports of each module, followed from `panel.js`, against both lists, read from their source files); `the page writes text and sets no markup` (no `innerHTML`, `outerHTML`, `insertAdjacentHTML`, `document.write` or inline event handler in any file of the page, and no `style` attribute, which the policy would refuse); `every element that the page writes into exists in the document` (each id that `panel.js` names is in `index.html`, once). `host-server.test.ts`: the tests of the page's files ask for six addresses. Smoke: `the first run, as the page asks for it: a folder from the dialog, a policy, a start, the invitation, a stop and a quit` (packaged server with the synthetic emulator, the stand-in browser, tunnel and dialog; the requests of Task 4 in the page's order, each with a session; the invitation has both links; after the stop the state is `idle`; after the quit nothing runs); `the bundle carries the panel and no test files` with six names.
- [x] **Step 2:** Run the tests. Expected: fail.
- [x] **Step 3:** Implement the page. Its parts, top to bottom: the name and the headline with the sentence; the game folder with "Choose game folder" and the facts of the disc; the two policies as radio buttons, the second with its note (decision 10); "Start server" and "Stop room"; the players; the invitation in a read-only field with "Copy invite link", and "Open game" as a link with `target="_blank"` and `rel="noopener noreferrer"`; the switch "Start the room when Sled Storm Server opens"; the details, folded; "Quit server".
- [x] **Step 4:** Run `npm run verify --prefix server`. Expected: pass.
- [x] **Step 5:** Open the page in the application's browser pane from a scratch copy of the built bundle, with the stand-in dialog: every part shows, the console is empty, the policy stops nothing that the page needs, and the buttons do what the status then says. This is not the hand check of the slice.

### Task 6: The real thing, by hand

A copy of the built bundle without the tunnel program, `SLED_SERVER_HOME` in a scratch folder. The owner's eyes or the Chrome extension are needed for what the default browser and the system's dialogs show; ask for them first.

- [x] **Step 1 (APP-01):** Open the bundle by a double click in Finder, with no configuration: the default browser shows the panel, asking for setup; nothing sits in the Dock. Open it again: the same server, a second tab.
- [x] **Step 2:** "Choose game folder": the system's dialog comes to the front. Cancel: nothing changes. Press the button twice: one dialog. Choose a folder without a disc: the sentence. Choose the owner's disc under `Documents`: saved; note every privacy prompt that macOS raises, for which program, and what the server then can read.
- [x] **Step 3:** Choose the policy, "Start server": the page goes through preparing and starting to a room; without the tunnel program it says that no public address is available. "Open game" opens the game in a new tab of the same browser, in the server's room.
- [x] **Step 4 (SAVE-03):** In that tab the library of saves that wrapper 1.1.0 left on `http://127.0.0.1:8000` is listed, and a save from it loads.
- [x] **Step 5:** "Stop room" with the game tab seated asks first; "Stop anyway" stops. The switch for starting at launch, then quit and a double click: the room is, or is not, started as the switch says. "Quit server": the page says so, nothing is left running, and a dialog that was open is gone.
- [x] **Step 6:** With the tunnel program in place and a synthetic disc, not the owner's: a start gives an invitation, "Copy invite link" puts it on the clipboard, and the link opens the room. If no tunnel may be opened in this session, this step is recorded as not verified.

### Task 7: Review

- [x] **Step 1:** One independent reviewer on the most capable model, from a diff against the review base, with this plan's Review Focus.
- [x] **Step 2:** Fix critical and important findings test first, and the minor ones that are cheap and clearly right.

### Task 8: Records

- [x] **Step 1:** `docs/sea-server-plan.md`: slice 2 results under P3, what was not verified, the verification log, the decisions, a new "Where to continue". `CHANGELOG.md`. "Build and run the current result" for the panel. A new snapshot of the tree as the review base of slice 3.
- [x] **Step 2:** Run every check on the final tree.
