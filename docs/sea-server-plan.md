# Sled Storm Server: Node SEA implementation plan

Working plan for shipping the existing dedicated stack as one macOS application
built on a Node.js single executable application (SEA). This file records what
was actually done and verified. Anything not run stays listed as open.

- Input: the project owner's brief of 2026-11-14, amended 2026-11-15. The brief
  is not part of the repository.
- Baseline revision: `acc8e35` (wrapper 1.1.0).
- Fixed product decisions, not reopened here: Node SEA from the first stage; no
  Electron, Go or Tauri; a browser admin panel; four equal browser players; the
  existing headless-Chromium dedicated runtime; the existing Cloudflare Quick
  Tunnel and gateway; macOS on Apple Silicon first.

## Status

| Stage | State |
|---|---|
| P0 Audit and SEA proof | Done 2026-11-15. Open items are listed under the P0 results. |
| P1 Node host runtime | Done 2026-11-20 in three slices. Open items are listed under P1. |
| P2 Server-owned rooms | Done 2026-11-21 in two slices. Open items are listed under P2. |
| P3 Browser admin and macOS launch | Done 2026-11-21 in three slices. Open items are listed under P3. |
| P4 Independent data sources | Done 2026-11-22 in three slices, each in three phases. Open items are listed under P4. |
| P5 Resumable delivery | In progress: three slices; slices 1 and 2 done 2026-11-22, each in three phases; slice 3 in three phases, phase 1 done 2026-11-22, phase 2 half done (Task 4). Open items are listed under P5. |
| P6 Qualification and release package | Not started |

## Where to continue

The work goes one slice per working session, and a slice that has several
phases goes one phase per session. A session that is asked to continue starts
here: this section says where the work stands, what comes next and how it is
done. Every session ends by rewriting it, so that the record follows the work
and the next session needs nothing but this file.

**Position, 2026-11-22, 11:55.** P0 to P4 are done and P5 is under way. On
the owner's word at 11:50 the whole working tree (P3, P4 and P5 so far) was
committed on branch `claude/sea-server` and pushed to `origin`; check
`git status` and `git log` first. Each P3 slice's
results, hand checks, what was not verified and what stays open are under
"P3 Browser admin and macOS launch"; its decisions are D38 to D46 (slice 1), D47 to D59 (slice 2) and
D60 to D71 (slice 3); its task plans are in
`docs/superpowers/plans/2026-11-21-p3-*.md`.

P4, Independent data sources, is done in three slices (D72 to D91): hosting
under `local-only` (slice 1), a player's own ZIP and one disc identity for
the server and the page (slice 2), and the player's choice of source with
one room from mixed sources (slice 3). Its exit checks and each slice's
results, hand checks, what was not verified, the review and what stays open
are under "P4"; its task plans are
`docs/superpowers/plans/2026-11-21-p4-local-only.md`,
`2026-11-21-p4-own-zip.md` and `2026-11-22-p4-mixed-sources.md`.

P5, Resumable delivery, is cut into three slices (the table under "P5"):
the server's chunk routes and the host's delivery limit; the page's
resumable download; fallbacks, the portable ZIP and the end of P5. Slice 1
is done in three phases (D92 to D95, task plan
`docs/superpowers/plans/2026-11-22-p5-chunk-routes.md`, ledger
`.superpowers/sdd/2026-11-22-p5-chunk-routes/progress.md`, the review's
report `review.md` beside it): the loopback listener serves
`/game-data/manifest` and `/game-data/<sha256>/chunks/<index>`
(`server/src/runtime-http.ts`), each chunk a range of the streamed archive
(`openChunk` in `server/src/game-data.ts`), every disc delivery that the
gateway forwards and marks runs under one limit
(`server/src/delivery-limit.ts`) while the room's emulator and the owner's
page are never queued, and the gateway passes the two shapes in its shared
mode only (`research/network/public-server.mjs`). Its
results, hand checks, what was not verified, the review and what stays open
are under "P5".

P5 slice 2, the page's resumable download, is done in three phases (D96 to
D99, task plan `docs/superpowers/plans/2026-11-22-p5-resumable-download.md`,
ledger `.superpowers/sdd/2026-11-22-p5-resumable-download/progress.md`, the
review's report `review.md` beside it): "Download from server" fetches the
room's archive as the server's chunks, two at a time, each checked for its
manifest length and SHA-256 before it counts (`web/disc-download.js`), keeps
the checked parts in the origin private file system with the progress in
IndexedDB, one page of the origin at a time (`web/disc-parts.js`), uses
them again after a reload or a cut on the same origin (DATA-05), fetches a
corrupt one again (DATA-06), checks the whole archive before it hands it
over, removes the parts once the game has started (`web/app.js`), and takes
the whole `/disc.zip` where the manifest answers 404 (the Python launcher).
Its results, hand checks, what was not verified, the review and what stays
open are under "P5".

P5 slice 3, Fallbacks, the portable ZIP and the end of P5, is under way
in three phases (task plan
`docs/superpowers/plans/2026-11-22-p5-fallbacks-portable-zip.md`, ledger
`.superpowers/sdd/2026-11-22-p5-fallbacks-portable-zip/progress.md`); its
decisions D100 to D105 stay in the task plan until the slice closes. Phase 1
is done (2026-11-22): the part store asks for the quota before it keeps
parts, only for what is missing, and every store says why it keeps parts in
memory (`reason`: no private file system, storage refused, another tab, the
quota, or a full disk after a refused write; D100, `web/disc-parts.js`);
the progress lines carry that reason as a note, and a stop says "Reload the
invitation to continue" only where the parts are saved, "to try again"
otherwise (D101, `web/disc-download.js`); the listener marks its
changed-files 503 with `X-Sled-Game-Files: changed`, the gateway passes it,
and the page stops on that mark alone, a bare 503 being a failure asked
again (D102, `server/src/runtime-http.ts`). `web/app.js` is not changed
yet. `npm run verify --prefix server`: all 11 checks passed in 157 s (web
and panel 235 of 235, server 267 of 267 on both Node.js versions, network
74, smoke 30; `verify-phase-1.log` in the ledger folder). An orphaned
`node --test … test/delivery-limit.test.ts` from an earlier chat (started
08:13, parent launchd) was still running at 11:30; this chat left it.

Phase 2, Task 4 is done (2026-11-22, 11:41 to 11:50): `askToKeepStorage`
in `web/game-data-folder.js` asks for persistent storage before the
download where game data is kept on a stable address, never on a Quick
Tunnel (D103), and a browser copy or a Quick Tunnel ZIP that could not be
kept is told through the action notice once the room is LIVE
(`unsavedGameDataNotice`, D104, `web/app.js`). Tests and 9 mutants;
`npm run verify --prefix server` passed all 11 checks in 156 s
(`verify-phase-2.log` in the ledger folder). The owner then stopped the
chat at 11:50, before Task 5, to commit and push.

**Next: P5 slice 3, phase 2, Task 5**: the checks by hand of DATA-05 to
DATA-08 on the owner's disc through a copy of the bundle, as Task 5 lists
them (a small quota with the DevTools protocol's
`Storage.overrideQuotaForOrigin`, no private file system, a second tab, a
cancelled picker, a new gateway port as a new host name with the saved ZIP,
a disc changed during a download), and the two notices of Task 4. The
extended `player.mjs` (visible windows, quota, no private file system, a
mapped `*.trycloudflare.com` name for the Quick Tunnel path, pickers that
cancel, a save picker, a second tab) and `drive.mjs` are in the ledger
folder, not yet run; host an APFS clone of `game/` so that the changed-disc
step touches no file of the owner's (the task plan's Status says how). Ask
the owner first, in one question, whether they will watch (in this chat
they chose to). Phase 3 is the review, the records and P5's exit. The
review base of slice 3 stays `.superpowers/sdd/p5-slice-2-tree.tar`, since
the commit holds slice 3's first changes; P6's first review starts from
the commit that closes P5.

**The unattended chain of 2026-11-22 has ended.** It ran until 10:00; P5
slice 2, phase 2 began at 09:58 and ended after 10:00, so it reported and
proposed no next chat. The next chat starts when the owner writes
"продолжить". What the chain learned stays below for another such night.
At 05:12 local time (+04) the owner
wrote that each chat, once it has finished its phase and recorded its state,
should be followed by the next chat, and so on until 10:00. The application
starts a chat only on the owner's own words in the chat that starts it: it
refused at 06:22 both in the chat of P4 slice 3, phase 3 (a turn begun by an
automated event) and in the chat that had started it (a turn begun by the
first one's report). So a chat in the chain that ends before 10:00 records
its state and proposes the next chat as a card (`start_session`,
`own_initiative`, a fresh context, no worktree, the brief "продолжить" and
this paragraph), which the owner starts with a click; it proposes one card,
not two. While this holds, nobody
may be at the screen: do not wait on a question to the owner. A hand check
then runs alone and headless in the pinned Chromium, as in P4 slices 2 and
3; temporary ZIPs of the disc in the session's scratch folder, deleted
after, were allowed by the owner for slice 2 and used the same way in slice
3; what needs eyes is recorded as not verified. A chat that ends at or after
10:00 reports, and no chat follows.

What P3 leaves open is listed under P3, "Open after slice 1", "Open after
slice 2" and "Open after slice 3"; what P4 leaves open, under P4. Before
anything is published: what macOS asks for a folder on another Mac, and the
Documents folder requests of 2026-11-21 that the TCC log holds (open after
P4 slice 2); P3's records say no privacy prompt came on this Mac.

For hand checks, what P3 learned:

- Ask the owner first, in one question, for anything that only eyes or the
  Claude in Chrome extension can see. On 2026-11-21 the owner let the
  checks run alone, but somebody at the screen still answered a system
  dialog; say beforehand which dialogs to leave alone.
- A copy that a hand check opens: copy the built bundle without
  `Contents/Resources/bin` into a scratch folder and run its executable with
  `SLED_SERVER_HOME`, `SLED_SERVER_NO_BROWSER=1` and `SLED_SERVER_OPENER`
  naming a script that appends its argument to a file; read the panel's
  address (its token is good for 60 s) from the file. Configure it with
  `configure --game-folder … --disc-policy shared-allowed` or, since P4
  slice 1, `local-only`. `SLED_SERVER_NO_BROWSER=1` also refuses the folder dialog
  (D49): for the dialog, open the copy with
  `open --env SLED_SERVER_HOME=… --env SLED_SERVER_OPENER=… <copy>`.
- The server reads the page's files when it starts (D69): a changed file of
  `admin/` is seen after a restart of the copy, not on a reload.
- The application's browser pane holds the library of saves on
  `http://127.0.0.1:8000`; keep the pane shown (`mcp__ccd_view__show_pane`).
  `navigate` to an address that differs only after `#` does not reload: call
  `location.reload()`. The pane saves no download: a file that the page
  offers was saved by the pinned Chromium driven over a pipe
  (`Browser.setDownloadBehavior`), as `server/scripts/room-player.mjs` drives
  it.
- An older build for a replacement: unpack a tree snapshot into a scratch
  folder, link `.cache`, `vendor` and `server/node_modules` into it, and run
  `node scripts/package-macos.mjs` in its `server/` (7 s).
- A quarantined copy: re-sign it ad hoc after removing `bin`
  (`codesign --force --sign -`), set `com.apple.quarantine` on its files and
  open it; the owner approves it in System Settings, and macOS then opens it
  by itself without the variables of `open --env`, so that server uses the
  real data folder: quit it with `quit` and open the copy again.
- Whether macOS raised a privacy prompt can be read afterwards from the
  system log: `/usr/bin/log show --start <time> --predicate 'subsystem ==
  "com.apple.TCC"'`, looking for the server's bundle identifier.
- The independent review: Fable 5.2 hit its usage limit in P3 slices 2 and
  3 and in P4 slice 1 before it wrote anything; Opus 5.5 did the review each
  time. A subagent may not write a report file: its final message is the
  report.
- The owner may open `dist/` by Spotlight during a check, which starts a
  server with the real data folder; check `pgrep -fl SledStormServer` and
  quit any server that is not the copy's.

What P4 slice 1 added for hand checks:

- A hand check with the real emulator keeps the default ports (8000 and
  8006): from another game port the page cannot reach the room's relay.
- A guest through the gateway without a public address: replace the copy's
  `Contents/Resources/bin/cloudflared` by a script that runs
  `server/test/fake-cloudflared.mjs` (as `stage(…, { tunnel: 'fake' })` in
  `server/smoke/sea.test.mjs` does) and set `SLED_SERVER_TUNNEL_PROBE=off`.
  `invitation` then prints a link with the access path, which the gateway
  takes on its own loopback port (`gatewayPort` in `status`); nothing is
  opened in front of the disc.
- `.superpowers/sdd/2026-11-21-p4-local-only/guest-player.mjs` is a copy of
  `room-player.mjs` that chooses a folder's CUE and BIN files through
  `DOM.setFileInputFiles`, presses keys written to `guest-keys.txt` beside it
  (`s KeyS 83 6000` holds X for 6 s) and writes its frame count to
  `guest-frame.txt`; `local` in place of the gateway's port joins with the
  local link in a fresh profile. Slice 3 may make this part of
  `room-player.mjs`.
- The pane's profile keeps a copy of the disc for `127.0.0.1:8000`, so a
  page there does not show a download; a fresh profile of the pinned
  Chromium does.
- To a race of several players from the owner's page in the pane: click
  the game for real, then keys with a 180 ms hold dispatched by a page
  script: Enter leaves the demo, `s` (X) on `start`, two times ArrowDown to
  `multi-player quick race`, `s`; each player's `s` puts their rider in;
  Enter, Enter starts the race. Separate cameras show each player's own
  sled.

What P4 slice 2 added for hand checks:

- The time and memory of reading a disc in the page:
  `.superpowers/sdd/2026-11-21-p4-own-zip/zip-bench.mjs <source>...` (a
  source is one ZIP or a folder of CUE and BIN files) serves `web/` on a
  loopback port, runs `chosenDisc` and `identifyDisc` in the pinned
  Chromium, one browser per source, and samples the memory of the browser,
  the renderer and the rest; it prints no file name and no identity, only
  whether it equals the first source's. `BENCH_WEB=<folder>` serves another
  copy of `web/`, for a change measured before it is made.
- `guest-player.mjs` beside it also takes one ZIP in place of the game
  folder.
- The server's archive is streamed, not kept as a file: a byte copy of it is
  `curl http://127.0.0.1:8000/disc.zip` from the copy's loopback listener.
- `log show --start` reads its time as local time: give it the server's
  start from `ps -o lstart=`, not a UTC stamp.

What P4 slice 3 added for hand checks:

- `.superpowers/sdd/2026-11-22-p4-mixed-sources/player.mjs <control folder>
  <label> <url>` runs one player in its own pinned Chromium and takes
  commands appended to `<control folder>/<label>.cmd`: a source's radio, a
  file input, copying files into the origin's private file system, the
  picker (a page script over that folder, whose access is always granted),
  one byte changed in a remembered copy, Join, keys, back to the lobby, the
  image filter, reload, a screenshot. Several players share one room; the
  race's keys are those of slice 1, with a 500 ms hold for Enter at the
  character select. It replaces the guest scripts of slices 1 and 2.
- A screenshot is read after `sips -s format jpeg -s formatOptions 60 -Z 640`:
  the Read tool's hook refuses a full-size PNG.
- `npm run verify` builds the bundle from the tree as it is while it runs:
  compare `web/` and `admin/` with `dist/macos/…/Contents/Resources`
  (`diff -rq`) before a hand check, and never run a check that puts back an
  old file while a full verify runs.
- The gateway's port, and so a guest's origin with its stored choices,
  changes with every start of hosting.
- `review-fixes.mjs` beside `player.mjs` drives the page's own paths on
  `web/` with a stand-in session info, the picker over the private file
  system and a slowed `crypto.subtle.digest` that holds a check open.

What P5 slice 1 added for hand checks:

- `.superpowers/sdd/2026-11-22-p5-chunk-routes/chunk-check.mjs` checks the
  chunk routes of a running copy (`whole`, `limit` with the server's PID,
  `idle`, `gateway` with the gateway's port, the access token and the
  policy) and prints only booleans, counts and timings. Since the review of
  slice 1 the limit holds only requests that the gateway marks
  (`x-sled-gateway`): its `limit` and `idle` checks over loopback, which ran
  before that fix, must now send the mark or go through the gateway's port;
  `stall-probe.mjs` beside it follows one stalled client's socket queues
  with `netstat`. The copy is made as in P4, with the tests' tunnel
  stand-in in `bin`; `invitation` gives the access path.
- Node lets a socket's timeout pass once when its write queue moved since
  the write was dispatched: a check of an idle cut waits twice its time.
- The TCC log names the bundle's path in the lines of the room's headless
  Chromium (preflight camera queries, attributed to the process that
  started the copy); look for a service and a prompt, not only for the
  bundle's name.

What P5 slice 2 added for hand checks:

- `.superpowers/sdd/2026-11-22-p5-resumable-download/copy.sh` (with `HC`
  naming a folder in the session's scratch folder) stages the copy as in P4
  and P5 slice 1 (`setup`, `serve`, `start`, `link`, `status`, `quit`) and
  writes the guest's address on the gateway's loopback port to a file,
  printing no path, link or token. Delete `HC` after the check: its
  profiles hold copies of the disc.
- `player.mjs` beside it is P4 slice 3's player with `THROTTLE=<bytes per
  second>` (`Network.emulateNetworkConditions`), `parts` (the archive
  directories and progress records of the resumable download, as counts)
  and `corrupt <index>` (one byte of a part changed, its length kept); it
  prints every 64-character hex string as `<sha>`. `drive.mjs` runs one
  scenario of it in one call: `wait:<regex>[:<seconds>]`, `cmd:<command>`,
  `kill` (SIGKILL to every process of the profile, a crash) and `quit`.
- Killing only the player closes its browser's debugging pipe and the
  browser quits by itself: that is not a crash. macOS `pkill -f` reads a
  pattern that starts with `-` as an option; give `user-data-dir=<profile>`.
- Over loopback the whole archive (86 chunks) arrives in about 3 s: hold the
  downloads to 16 MiB/s to stop a guest halfway. Hosting must keep running
  between the cut and the new start, since the gateway's port, and so the
  guest's origin with its parts, changes with every start of hosting.
- `python3 server.py --browser-hosted` lets the page itself download the
  disc without starting the installed Google Chrome; its manifest answers
  404.
- `browser-check.mjs` beside `player.mjs` (`node browser-check.mjs
  <scratch folder>`, about 5 s) serves `web/disc-download.js` and
  `web/disc-parts.js` with a random archive's manifest and chunks on a
  loopback port and drives the page's own modules in the pinned Chromium,
  headless, with the browser's private file system, IndexedDB, Web Locks and
  `fetch`: a download with 524 answers and an answer past the answer
  deadline, the parts and the record, the lock against a second store and
  another page, `discard`, a part kept over a reload. No disc and no copy of
  the bundle are needed; its profile is deleted afterwards.

What P5 slice 3, phase 1 added:

- `.superpowers/sdd/2026-11-22-p5-fallbacks-portable-zip/mutate.py
  <spec.json>` applies each mutant of a spec (`file`, `cwd`, `command`,
  `timeout`, `mutants` as name, old text, new text), runs the command in its
  own process group, counts a run past the timeout as killed (hung), and
  restores the file; `m-*.json` beside it are phase 1's specs.
- The downloader's tests sleep at once: a test where a pause never ends
  loops forever instead of failing. Let the stand-in server answer
  differently after its first answer, so a regression completes and fails.

**How the work is done.**

- The owner's brief fixes the product decisions. An unclear technical detail
  is settled minimally and recorded here as a decision, with what it costs if
  wrong. The slice plan is not held for approval.
- Nothing is pushed, released or published. A commit is made only when the
  owner asks for one.
- Code, comments and documents in the repository are in English. The owner is
  answered in Russian.
- `game/` holds the owner's private disc. It is not copied, and its hashes and
  paths stay out of Git, logs and the status. So do private links, room names
  and tokens.
- No automated test starts the real Chromium, a tunnel, the network, the
  user's browser or a system dialog: a launch in a test keeps
  `SLED_SERVER_NO_BROWSER=1` and names a stand-in with `SLED_SERVER_OPENER`
  or `SLED_SERVER_FOLDER_DIALOG` when it must see what is opened (D44, D49).
  No tunnel is opened in front of the owner's disc: hand checks run a copy of
  the built bundle without `Contents/Resources/bin`, with `SLED_SERVER_HOME`
  in a scratch folder.
- A failing test comes before the code. Each slice has a task plan in
  `docs/superpowers/plans/` and a ledger of decisions in the ignored
  `.superpowers/sdd/`.
- The first session of a slice writes its task plan. A slice too large for one
  session is cut into phases there, each one a group of tasks that ends with
  every check passing. A session does one phase and stops.
- A session that ends a phase in the middle of a slice records, in the task
  plan and in this section: which tasks are done, what was run and with what
  result, the decisions taken, what is left, and the phase that comes next.
  The working tree is left with `npm run verify --prefix server` passing.
- A slice ends with an independent review on the most capable model that
  takes requests, in its last phase, from a diff against the snapshot named
  below. Critical and important findings are fixed test first, and so are
  the minor ones that are cheap and clearly right. The rest is listed under
  the slice as open. Ask the reviewer to save its findings as it goes: a
  reviewer may be stopped by a usage limit, and a subagent may not be allowed
  to write a report file, in which case its final message is the report.
- Then this file gets the slice's results, what was not verified, the
  verification log and a new version of this section, and `CHANGELOG.md` gets
  its entry. Nothing unverified is recorded as verified.

**Tools.** `npm run verify --prefix server` runs every automated check, in
about 145 s, and keeps the output of a check that fails in `dist/verify/`; `server/scripts/room-player.mjs` plays a room by hand. Both are
described under "Checking a change". The emulator is built on the owner's
machine (`.cache/`, `vendor/`), and the pinned Chromium and `cloudflared` are
in `.cache/toolchain`. The page's tests run alone with
`node --test "admin/*.test.mjs"` from the repository's root.
`python3 server/scripts/disc-fixtures.py` rewrites the disc fixtures that the
page's and the server's tests share (D78, D84); a change of a fixture goes
through it, not by hand. It runs on macOS, because it calls `zip` and
`ditto`; a run rewrites ditto's archive (its folder times) and nothing else.

**Review base.** P3 slice 1 was reviewed against `54a64b3`, slice 2 against
the ignored file `.superpowers/sdd/p3-slice-1-tree.tar`, and slice 3 against
`.superpowers/sdd/p3-slice-2-tree.tar`. The state that P3 leaves is the
ignored file `.superpowers/sdd/p3-slice-3-tree.tar`: every file that Git does
not ignore, as it was when slice 3 closed, with the logout's records; on
2026-11-21, before P4's first change, all 210 such files were equal to it. It
was the base of P4 slice 1's review. The state that P4 slice 1 leaves, with
its records, is the ignored file `.superpowers/sdd/p4-slice-1-tree.tar`, made
the same way when the slice closed (212 files); it is the base of slice 2's
review. The state that slice 2 leaves, with its records, is the ignored
file `.superpowers/sdd/p4-slice-2-tree.tar` (220 files); it was the base of
slice 3's review. The state that P4 leaves, with its records, is the ignored
file `.superpowers/sdd/p4-slice-3-tree.tar`, made the same way when slice 3
closed (224 files); it was the base of P5's first review, that of slice 1.
The state that P5 slice 1 leaves, with its records, is the ignored file
`.superpowers/sdd/p5-slice-1-tree.tar`, made the same way when the slice
closed (227 files); it was the base of slice 2's review. The state that
slice 2 leaves, with its records, is the ignored file
`.superpowers/sdd/p5-slice-2-tree.tar`, made the same way when the slice
closed (232 files); it is the base of slice 3's review.
A commit of P3, P4 and P5 so far, if the owner asks for one, replaces it;
otherwise unpack the archive into a scratch folder and compare with
`git diff --no-index`.

## Current launch path at `acc8e35`

`python3 tools/play-online.py` is the supervisor. It needs Node.js 22+,
`cloudflared`, the bootstrapped `vendor/emulatorjs`, the native build stamp in
`.cache/` and `research/network/node_modules/ws`. It refuses to start when port
8000, 8004, 8005 or 8006 is taken, then starts four children in their own
process groups:

| Child | Command | Listens on | Role |
|---|---|---|---|
| runtime | `server.py --disc-mode … --dedicated` | `127.0.0.1:8000` | Finds Chrome, builds `disc.zip` and the identity, prepares the core, serves `web/`, `/emulator/*`, `/disc.zip`, `/session-info`. |
| relay (child of runtime) | `node research/network/emulator-relay.mjs` | 8004, 8006 | Room relay and RetroArch Netplay relay. The Netplay relay starts headless Chrome through `dedicated-runtime.mjs` for `role: "create"`. |
| gateway | `node research/network/emulator-gateway.mjs` | 8005 and a random mirror port | Allowlisted public gateway with the private access path. |
| tunnel, mirror-tunnel | `cloudflared tunnel --url …` | n/a | Primary Quick Tunnel to 8005 and, for dedicated rooms, an HTTP/2 mirror tunnel with 2 s to 30 s retry backoff. |

Readiness is a port probe per child and, for the tunnel, a hostname in the
`cloudflared` log with a later `Registered tunnel connection` line. Shutdown
sends SIGTERM to each process group in reverse order, waits five seconds and
then sends SIGKILL.

The processes exchange state through files that a single Node process no longer
needs: `.cache/emulator-access.txt`, `.cache/online/public-launcher.json`
(with the runtime PID), `.cache/online/mirror-origin.txt`, and the mirror port
and tunnel hostnames scraped from logs.

Hard-coded addresses to parameterize in P1:

- `server.py`: Host and Origin allowlists for port 8000.
- `research/network/emulator-relay.mjs`: ports 8004 and 8006, origin list.
- `research/network/retroarch-relay.mjs`: `verifyClient` origin list.
- `research/network/emulator-gateway.mjs`: ports 8005, 8000, 8004, 8006.
- `research/network/dedicated-runtime.mjs`: `Page.navigate` URL.
- `web/retroarch-netplay.js`: the port 8000 to 8006 mapping.
- `web/app.js`: the dedicated worker is recognized by origin
  `http://127.0.0.1:8000`.

## Findings that shape the plan

1. Saving is gated by `canSaveSolo = !invitation && …` in `web/app.js`, not
   only by `role === 'create'`. In a server-owned room every player joins with
   an invitation, so the gate must become a room capability.
2. The 1.1.0 save library and settings live in the storage of origin
   `http://127.0.0.1:8000`. The local game origin therefore keeps a fixed
   loopback port, and the host plays through loopback by default.
3. Room identity is a SHA-256 over the whole `/session-info` object, including
   `discMode`, the archive chunk hashes and Python's key order. Moving
   `/session-info` to TypeScript changes it, so P2 defines a canonical field
   list and raises the invitation version.
4. A server-owned room can restart its runtime in place, so loading a save no
   longer needs a new room or a new invitation.
5. SEA support in Node 26.13.1 is tested upstream on macOS arm64 only; macOS
   x64 is listed as unsupported.
6. The developer environment is on Node 24 (`.nvmrc`). `--build-sea` needs
   25.5.0 or later, so the build fetches a pinned 26.13.1 binary.

## Decisions

| # | Decision | Reason |
|---|---|---|
| D1 | The server lives in `server/` with its own `package.json` and lockfile. Build scripts live in `server/scripts/`. Build output goes to the ignored `dist/`. | Mirrors `research/network`, keeps build tools next to their dependencies, moves no existing file. |
| D2 | The SEA runtime is Node.js 26.13.1 (LTS). Version, archive name and SHA-256 are pinned in `server/toolchain.lock.json`. The binary is fetched into `.cache/toolchain/`. | The brief's proposed pin; no floating `latest`. |
| D3 | Developer checks keep running on the `.nvmrc` Node. Only `--build-sea` and the produced executable use 26.13.1. | Updating `.nvmrc` is a separate, verified migration. |
| D4 | esbuild produces one CommonJS bundle. TypeScript is used for type checking only; sources use erasable syntax so `node --test` runs them directly. | One build step, no second emit pipeline. |
| D5 | `ws` stays at the repository pin and is bundled exactly once. The optional native add-ons are compiled out, and the build fails on any external import that is not a Node.js built-in. | A SEA cannot `require()` files; a hidden native path must fail at build time. |
| D6 | Read-only resources are found from the executable's location only: `Contents/Resources` inside an application bundle, otherwise `resources/` next to the executable. | The resource root must not depend on the repository or the working directory. |
| D7 | Writable data goes to `~/Library/Application Support`, `~/Library/Logs` and `~/Library/Caches` under `Sled Storm Server`. `SLED_SERVER_HOME` relocates all three for tests. | Brief section 9; one module owns the paths. |
| D8 | One running server per user is enforced by a kernel advisory lock that the server holds while it runs (`O_EXLOCK` on macOS), plus a private instance record and a token-authenticated loopback probe. | The kernel drops the lock when the process dies, so there is no stale-lock takeover race and a PID is never trusted. |
| D9 | The executable's default command is a short-lived launcher: it starts a detached server when none is running, opens the server page and exits. `serve`, `status`, `quit` and `self-test` are explicit commands. Helper roles are `internal` subcommands of the same executable. | A process without an AppKit event loop never receives the macOS reopen event. A launcher that exits lets LaunchServices run it again on the next double-click, so no native shim is needed. |
| D10 | The application bundle is an agent (`LSUIElement`), without a Dock icon. Quitting is a server action: the `quit` command now, the panel button in P3. | Nothing sits unresponsive in the Dock. The brief does not ask for a Dock or menu-bar presence. |
| D11 | Provisional bundle identifier: `io.github.watscho.sledstorm-server`. | Signing needs one. The owner can change it before the first distributed build. |
| D12 | Control routes match the raw request path, after Host and Origin checks and a bearer credential. | An encoded or dotted spelling of a route is not a route. |
| D13 | `allowScripts` in `server/package.json` approves the install script of the pinned esbuild only. | npm reports unreviewed install scripts; the approval is explicit and tied to one version. |
| D14 | The disc archive is virtual. The server streams ZIP headers around the user's own files and keeps only a small stamp with the checksums in the cache. The format, `stored-v2`, has fixed dates and attributes, so its bytes depend only on names, contents and order. | No second copy of a 700 MB disc, and the archive hash survives restarts, file times and time zones. Its bytes differ from an archive made by `server.py`, so a ZIP that a guest saved from a Python host is downloaded once more. |
| D15 | The packaged server listens on the fixed ports 8000 (game origin) and 8006 (Netplay relay). The gateway, its mirror and the control listener take free ports. A fixed port that is busy is an error with an action, never a silent move. | The web client derives both addresses from port 8000, and the saved games belong to that origin. Giving the relay an explicit address needs client changes and moves to P2. |
| D16 | The disc policy is an explicit choice in the configuration; nothing is shared by default. Until P4 only `shared-allowed` can host, because a dedicated room still needs the host disc. `local-only` is stored and reported as waiting for a later stage. | The brief forbids switching sharing on without a choice. |
| D17 | The packaged server does not carry the developer routes of `server.py` (`/diagnostic-state`, `/lab-state`, the RetroArch lab) or the legacy relay on port 8004 behind `?transport=legacy`. | They are diagnostics of the developer launcher, which keeps them. |
| D18 | The emulator runtime is a prebuilt resource: `build-sea.mjs` stages `web/` always and the emulator files when the checkout has them. A build without them reports a failed emulator component instead of hosting. | The packaged server never patches or builds the core on the user's machine. |
| D19 | The status and the log carry no credential, no folder path and no disc hash. Unexpected errors are logged by code or class name only. | File system messages contain the user's paths. |
| D20 | `config.json` in the data root holds `version`, `gameFolder` and `discPolicy`. It is validated on every read and replaced atomically; a file this version cannot use is kept as `config.json.bad`. | Brief section 9. |
| D21 | Detailed task plans for a slice live in `docs/superpowers/plans/`. This file stays the summary and the record. | The slice plans carry test lists and interfaces that would bury the overview. |
| D22 | `cloudflared` 2026.10.7 ships unmodified as the resource `bin/cloudflared`. `server/toolchain.lock.json` pins the SHA-256 of the archive (the release asset digest) and of the binary (stated in the release notes). | No install on the user's machine and no floating version. The release was three weeks old when pinned; the newest was three days old. |
| D23 | A tunnel is ready when its own metrics listener reports a registered connection and a hostname, and a probe has then passed through the public address: the access link, the session info and a Netplay check that takes no seat. The probe asks public DNS (`1.1.1.1`, `1.0.0.1`) and connects to the address it gets. | A URL in a log proves nothing. A new hostname takes about five seconds to exist and its zone has a negative TTL of 60 s, so asking the system resolver early stops the host's own computer from opening the link for a minute. |
| D24 | The primary tunnel restarts after 2, 4, 8, 16 and 30 s and then fails until the next start request; 60 s online earn the pauses back. The mirror keeps trying every 30 s. The host is `online` only with the primary online, `degraded` with a `tunnel` problem otherwise, and the mirror never changes the host state. A start request on a host degraded only by its tunnel retries the address and leaves the local game running. | Bounded recovery for the address that matters, the launcher's behavior for the mirror, and "the internet is down" is not "the game is down". |
| D25 | The private link leaves the server through the authorized `GET /api/invitation` (the `invitation` command) and through the `X-Invite-*` headers of `/session-info` on the loopback game origin, as with `server.py`. It never reaches the log or the status. | The host page builds invitations from those headers. Any local process of the same user can read them there; a web page cannot. |
| D26 | A child that must not outlive the server gets a guard: the same executable run as `internal guard <pid>`, holding a pipe from the server. When the pipe closes without a release byte, the guard ends the child. | A killed server cannot clean up, and a tunnel program left behind keeps a public address open. |
| D27 | `SLED_SERVER_TUNNEL_PROBE=off` skips the public probe. It exists for smoke tests that put a stand-in program in place of `cloudflared`; every staged smoke copy has the real program removed. | No automated test may open a real tunnel. |
| D28 | The emulator's browser is Chromium's own continuous build 1727462 for macOS arm64, version 158.0.8127.0, taken unmodified from the project's `chromium-browser-snapshots` store and shipped whole as the resource `chromium/Chromium.app`. The store publishes no SHA-256, so `server/toolchain.lock.json` holds the ones computed when the build was chosen, for the archive, the launcher and the framework; the MD5 of the archive matched the store's record. The verified archive is kept in `.cache/toolchain`. | Chrome for Testing is Google-branded, carries proprietary codecs and has no stated terms for shipping inside another product. `chrome-headless-shell` is the old headless mode, which the runtime never ran on. The chosen build is ten commits before the branch point of milestone 158, so it has none of the fixes made later on that branch, and it has no AAC decoder. |
| D29 | `dedicated-runtime.mjs` stays the one place that drives the browser. It takes the page address, further switches, the place for the profile, extra environment variables and a grace period, with the launcher's behavior as the default of each. A browser that ignores its stop is killed after the grace, and both `exited` and a failed start are reported only once the browser process is gone and its profile removed. | The Python launcher keeps working unchanged, and "stopped" means that nothing is left. |
| D30 | The server adds `--use-mock-keychain`, `--disable-background-networking`, `--disable-component-update` and `--host-resolver-rules=MAP * ~NOTFOUND , EXCLUDE 127.0.0.1` to the worker, and sets `BREAKPAD_DUMP_LOCATION` to a folder inside its own profile root. | Measured on the shipped build: with the launcher's switches alone it talked to `www.google.com`, a Google time service and Google's update servers by itself, and the first three switches did not stop all of that. With the resolver rule its sockets were loopback only. No switch moved its crash reports out of the user's `~/Library/Application Support/Chromium`; the variable does. |
| D31 | Browser profiles live in `<cache>/browser-profiles`, a path of its own in `Paths`. The host empties that folder at every start. No guard process watches the browser. | A killed server cannot remove a profile, and one server runs per data location. Measured: when the server is killed, the browser and all helpers are gone within one to three seconds, because their pipes close. |
| D33 | The room identity is the SHA-256 of a fixed, versioned list: disc identity, core, adapter, native build files sorted by name, BIOS, progression, separate cameras, native camera, and the protocol name. One module, `web/room-identity.js`, computes it for the players' pages and for the server, with shared fixtures. Nothing about delivery is in it. The invitation version of a Netplay room rises from 7 to 8; a version 7 link is refused in its own words. The legacy transport keeps version 6 and its old identity. | Brief section 7. The old identity hashed the whole `/session-info` reply, so its key order and the archive checksum were part of it. |
| D34 | The relay can open a dedicated room without a player (`createRoom`): nobody is seated, four controllers are free, there is no idle timeout, and no player's message starts or stops an emulator on a relay that owns its rooms. A guest who arrives before the emulator listens waits; between two sessions the answer is "try again". The developer launcher's relay is not told to own its rooms and behaves as before. | Brief section 7, invariants 1 to 7. |
| D35 | The host keeps one room. Its name and token are made at each start of hosting, and its identity comes from the real disc and this build, with the built-in BIOS. When its emulator is lost, a new session opens in the same room after 2, 4 and 8 s, so a room gets one session and up to three more; a room that stayed open for 60 s earns the pauses back; after the last pause the room has failed, is no longer handed out, and its status says why the last session ended. The host is `online` only with the room open and the address online, and `degraded` with component `room` while the room restarts or has failed. An empty room keeps the controllers of players who left a race for 60 s. | The invitation stays good while the server runs. A new runtime is a new game, as the brief says. |
| D36 | `invitation` prints `{ url, localUrl }`: the link for guests, null without a public address, and the same room on `http://127.0.0.1:8000/`. Both are built by the web client's own `invitationUrl`. | The owner plays through loopback, and a server without internet access can still be played on its own computer. |
| D37 | The room's options are not a setting yet: the verified PAL disc gives all content unlocked with separate native cameras, any other disc the original progression without them. | These are the web client's defaults. The panel of P3 is where an owner will choose; D62 makes them a setting. |
| D38 | A browser gets into the panel with a one-time token that the launcher asks the running server for, with the control credential, and puts into the fragment of the address it opens. The page trades it for a session, removes it from the address, keeps the session in its `sessionStorage` and sends it as a bearer header. No cookie is used. | Brief section 12. A cookie for `127.0.0.1` is sent to every port of that address, so the game page's origin and any other local web server would receive it, and a page of another origin could ride on it. An address from the history or a bookmark has no session; opening the application again gives one. |
| D39 | A one-time token is good once and for 60 s, and the eight newest are kept. A session lasts until the server quits; of more than sixteen, the one that was not used for longest ends. Only the control credential makes a one-time token. | The token passes through the command line of `/usr/bin/open` and may stay in the browser's history, so it must be worthless a moment later. |
| D40 | The panel's files are the resource directory `admin/`, served by the control listener from a fixed list of names. | Brief section 13. The page stays readable source, as the web client is. |
| D41 | A start request retries what failed inside a running stack: the public address (D24) and a failed room, in the same room with the same links. It builds the stack anew only when none is up or the game files changed. While the room restarts by itself it changes nothing. | P2 left this open: a rebuilt stack is a new room and a new address for players who hold a good link. |
| D42 | "Stop room" stops hosting: the room, the relay, the gateway, the tunnels and the local game page. The control listener stays. With a player connected or a controller kept, the request must say `force`. | The brief's states go from `online` through `stopping` to `idle`; a public address without a room is of no use. |
| D43 | `config.json` gains `autoStart`, true when absent, and stays at version 1. The game folder and the disc policy cannot be changed while hosting is up or a start is under way. Changes are carried out one at a time. | Brief sections 4 and 12. An older build ignores the field, and drops it when it rewrites the file. |
| D44 | For tests, `SLED_SERVER_OPENER` names a program, by its full path, that the launcher runs with the panel's address in place of `/usr/bin/open`. The packaged executable honors it, and it wins over `SLED_SERVER_NO_BROWSER`, so a test that sets both can never open a real browser. The launcher hands any opener one of two addresses only: the panel's, plain or with a one-time token. | The smoke test of HOST-01 must see what a launch opens, and no automated test may open the user's browser. Whoever sets the launcher's environment already runs as the user and can read the control credential from the instance record, so the variable gives nothing new away. |
| D45 | A start that builds the stack anew needs `force` while a player is connected or a controller is kept, as a stop does (D42). That is the start after the game files changed (D41); a start that tries again what has failed leaves the room and needs none. | Found by the review of P3 slice 1. The players of the old room hold their copy of the disc and could play on, and the brief asks for a confirmation when participants are present. The owner who follows the status's advice reads a refusal first. |
| D46 | A quit is the last word. Hosting is stopped for good: a start that is asked for while the server quits is answered 409 and changes nothing, and so does the start at launch when the quit came first. Between other requests the later one still wins. | Found by the review of P3 slice 1: the control listener answers until hosting has stopped, and a start in that time built a new stack that the exit then cut off. A stop, a change of the configuration and a new one-time token are still answered while the server quits. |
| D47 | The game folder is chosen in the system's dialog, which the server shows with `/usr/bin/osascript` and a fixed script, run by `execFile`, behind `POST /api/game-folder/pick`. The route reads no body, so nothing of a request reaches the script, and the path comes out of the dialog only. | Brief section 12. P0 decided against a native shim, so there is no `NSOpenPanel` of our own. The dialog belongs to `osascript`; what macOS then lets the server read under `Documents`, `Desktop` or `Downloads` is known only after the hand check of P3 slice 2. |
| D48 | The request for the dialog stays open until the dialog is answered, and one dialog is open at a time: a second request meanwhile is answered 409. A cancel changes nothing. A chosen folder is checked and saved as one that `PUT /api/config` names, so it is refused while hosting is up, and no dialog is shown then. A quit ends an open dialog. | The simplest contract that a page can follow, and every process that the server starts has an owner and a stop. A page that is closed leaves its dialog on the screen, and the folder chosen there is still saved. A server that is killed leaves its dialog too: `osascript` then answers into a pipe that nobody reads, and nothing is saved. A dialog that fails is logged with its exit code and the number of AppleScript's error, never its words. |
| D49 | `SLED_SERVER_FOLDER_DIALOG` names a program, by its full path, that stands in for `osascript` in tests. A server that was started with `SLED_SERVER_NO_BROWSER=1` and no stand-in has no dialog and answers 503: the switch now means that the server shows nothing on the user's screen. In the code, the host's operations have no dialog unless they are given one, and only `serve` gives the system's. | No automated test may open a system dialog, and a test that forgets the stand-in must get a refusal, not a window on the owner's screen. A hand check of the dialog starts the server by a double click or `open`, without that switch. |
| D50 | A saved change of the game folder or the disc policy returns a host that is at rest with a problem of its configuration or its game files to `idle`, without a problem. A host that runs or starts, and a problem of the build, stay as they are. | The sentence was about the configuration before the change: without this the panel shows `Choose the game folder and the disc policy to start hosting.` right after both were chosen. The status of a host at rest no longer says what the last start found about what the owner has since changed; the next start says it anew. |
| D51 | The panel follows the server by asking: the status, the configuration and, while a room exists, the invitation, once a second. Setup is what the configuration says, not the host state. | The control listener is no WebSocket endpoint, which a test pins, and a loopback listener is cheap to ask. The page is up to a second behind, more in a hidden tab. |
| D52 | "Open game" is a link to the room's address on this computer, opened in a new tab without an opener or a referrer; no route is added. "Copy invite link" writes the guests' link to the clipboard. A stop with players is confirmed in the page, from the server's refusal with its counts; a quit asks the same way from the status that the page last read, and the quit route stays unconditional. | The panel is opened in the default browser, and a link opens in the same browser, where the saves of `http://127.0.0.1:8000` are (SAVE-03). A player who joins between the page's last reading and a click on Quit is not asked about; whether the server refuses a quit is P3 slice 3. |
| D53 | A sentence of the page's own, which is a refusal of the server, a question about the players or `The link is copied.`, is shown until the next press, and gives way before that once the server says something new: another state, another problem, or another saved folder or policy. A question about the players is also taken back when a reading counts nobody in the room. | A sentence that stayed would hide what the status says next, such as a public address that failed after a link was copied, and the page has no button for "no". A refusal may go before the owner has read it, when the status changes right after it. |
| D54 | While the request of a button is under way, every button of the page waits, Quit included. The folder's request lasts as long as its dialog, and the page then says `The folder dialog is open. Look for it among the windows.` | One request at a time, and the server's answer decides. A second press in the same tab is not sent, so the server's sentence for a second dialog would never be seen there. With the dialog open the page cannot quit the server; the `quit` command can, and a page that is loaded again has its buttons back. |
| D55 | The page offers a link only when it is an address of the web, `http://` or `https://`, and shows whatever else the server sent as text. A status that is not what the page expects shows no server, with a sentence, and the page reads on. A start that the server refuses for players in the room shows the server's sentence; the page has no "Start anyway". | The links become an `href` and the clipboard's text, the one place where the server's text is more than text. The room can be stopped first, which asks; the owner needs two presses there. |
| D56 | A reading of the page, each `GET`, gives up after 5 s, and the page then shows no server until a reading is answered. No other request has an end of its own. A tab without a session sends nothing. An answer that is cut short counts as none. | A reading is asked again a second later; a button's request is sent once, and the folder's lasts as long as its dialog. A button's request that the server never answers keeps the buttons waiting until the page is loaded again, while the readings go on. |
| D57 | The page's script is tested in Node.js against a stand-in for the browser's document. The document is read from `index.html`, and an element there takes only the properties that the page may write, each with the type that a browser keeps. The same test file compares the files that the page loads with the listener's list and the bundle's. | The page has no build step, and no automated test may start a browser. A stand-in is no browser: what a browser does differently shows only by hand. |
| D58 | A press of a button is one click: a click that the browser counts as the second or a later one of a series (`detail` above 1) is no press. A key presses with a count of 0, and once however long it is held: its repeats are cancelled. | Found by the hand check of P3 slice 2. "Stop room" and "Quit server" with players in the room turn into "Stop anyway" and "Quit anyway" under the cursor, so the second click of a double click answered the question that the first one asked. An owner who means to confirm clicks again after the system's double-click interval. The review proposed a pause before the question's button is armed; the browser's own count follows the system's setting, which a constant in the page would guess. |
| D59 | A start that is accepted while the host is at rest with no stack makes the status `preparing`, without a problem, at once; the attempt then says what it finds. | Found by the review of P3 slice 2: the status moved only once the attempt had read the configuration and the build, and the page's reading right after its start could show `Stopped` with "Start server" enabled again. It reverses what slice 1 pinned ("before the status has moved"); `starting()` stays for the control's own check. A start that is refused for its configuration shows `preparing` for a moment. |
| D60 | A quit with a player connected or a controller kept needs `force` at the server, as a stop does (D42): `POST /api/host/quit` answers 409 with the counts, and the command is `quit [--force]`. A signal from the system (`SIGTERM` at logout, `SIGINT`, `SIGHUP`) quits without asking. | The brief asks for a confirmation when participants are present, and D52 asked only from the page's last reading, so a player who joined after it was not asked about. A script that quit with players connected now needs `--force`; a server of an earlier build ignores the body and quits. |
| D61 | A new game ends the room's session and opens the next one at once, under the same name and token, so both links stay good: `POST /api/room/new-game` and the command `new-game [--force]`, with `force` while somebody is in the room. The players are told `The host started a new game. Open the invitation again to join.` The count of failed sessions starts again (D35). A pause between two sessions ends at once; a room that has failed is started again; a room whose session is starting is left as it is; without a room the answer is `No room is open.` | P2 left "a new game for the room" to P3, and the brief says that a new runtime is a new game, not a reconnection. A save that was loaded into the room is gone with its session. Everyone in the room is disconnected and comes back through the same link, and for a few seconds two emulators exist, as during a load. |
| D62 | The room's options are a saved preference: `config.json` gains `roomOptions: { progress, camera }`, `{ "progress": "all", "camera": true }` when absent, and stays at version 1. They are changed only while nothing is hosted, like the folder and the policy, and a start applies them. On the verified PAL disc separate cameras are its native camera; any other disc plays the original progression with a shared camera, whatever is saved (D37). The status names the options of the room that runs. | The options are part of the room's identity and of every link, so a change under a running room would break the links that players hold. To change them the room is stopped, and the players get new links. A build before this one drops the key when it rewrites the file, as with `autoStart` (D43). |
| D63 | The diagnostic report is made by the server and saved by the page: `POST /api/diagnostics/export`, with the control credential or a panel session and no body read, and the command `diagnostics`, which makes the report itself from the same log and configuration when no server runs (`host` and `startedAt` null). It holds the application and version, the time and the uptime, the system and the architecture, the runtime manifest as the build wrote it, which parts the build has (web client, emulator, its browser, tunnel program, panel), the host's status, the configuration with `gameFolder` as `true` or `false` in place of the path, and the last 200 lines of `server.log` within its last 64 KB, leaving out the line that the bound cut. Each of those lines, and the sentence of the status's problem, goes through a filter that replaces the saved folder (as written, in either Unicode normal form and as an address spells it) with `<game folder>`, the home folder with `~`, every run of 16 or more hexadecimal digits with `<hex>`, every host name under `trycloudflare.com` with `<public host>`, and the fragment of an address (after a scheme or a slash) with `<fragment>`. | The brief asks for a diagnostic report without secrets, and so far the log could be read only in a terminal. The log already carries none of that (D19), so the filter is the second line of defense: it may hide a number of 16 or more digits that would have helped, and a folder other than the saved one is hidden only as part of the home folder. A server of an earlier build has no report, and the command says so. |
| D64 | A launch that finds a live server of another build replaces it when nobody is in its room. The instance record gains `build`, the `server.sha256` of the runtime manifest that the packaged server read at its start, null for a run from source; a record without the key reads as null. Two builds differ when these differ, null counting as a value of its own; two runs from source differ by their version. The launcher reads the room from the server's status first, because a server of an earlier build quits without asking about players. With somebody in the room, or a status that does not count the players, it keeps that server, opens its page, says why on standard error and prints `otherBuild: true`. Otherwise it asks the server to quit without `force`, waits at most `QUIT_WAIT_MS` for it to be gone, starts its own and prints `{ event: 'replaced' }`; a quit that is refused or not done in time keeps the server, as with players. | Slice 1 left an older server running after the application was replaced, answering the new routes with `Not found`. Plan decision 5 compared versions when either side has no build; that would have kept a packaged server of an earlier build with the same version, which is the case to settle, so a missing build is another build. The plan's `older: true` became `otherBuild: true`, because the running server may be the newer one. Cost: opening a copy of another build stops the hosting of the running one while its room is empty, and an invitation that was handed out for it stops working; a player who joins a server of an earlier build between the reading and the quit is put out. |
| D65 | The page asks about the players from the server's refusal: a stop, a new game and a quit each send their request, a 409 with the counts becomes the question ("Stop anyway", "New game anyway", "Quit anyway"), and the second press of the same button says `force`. Quit is the one request that is sent while the folder's request is under way; the server ends that dialog as it quits (D54 otherwise stands). | Replaces what remained of D52, the question from the page's last reading, which missed a player who joined after it. A quit costs one request more before the question; a quit refused during the dialog leaves the dialog's request under way. |
| D66 | The room's options on the page are two choices of progress and a switch for separate cameras, locked as the setup is. Each change sends both options in one `PUT /api/config`, the other one as it is saved (the web client's default when the page cannot read it). The note under them says that unlocked content and separate cameras need the verified PAL disc, or, while a room runs with another disc (the status names the room's options and the disc is not the verified one), that it plays with the original progression and a shared camera. | The server takes both options or neither (D62). A change made in another tab between two readings is overwritten by the other option's saved value of this tab's last reading. |
| D67 | The page saves the diagnostic report through its own hidden link with `download`, from a `Blob` of the report's JSON, named `sled-storm-server-diagnostics-<YYYY-MM-DD>.json` by the day of the report's `generatedAt` (UTC), or without a date when that is unreadable. Only the last file's address is held; the next save lets it go. | No element is made and nothing is written as markup, so the page's content security policy stays. Two reports of one day get the same name, and the browser numbers the second. That the browser saves the file under that policy is shown only by hand. |
| D68 | A press of a button ends once the page shows what the server said after it: when the page's own reading began after the press's reading and overtook it, the press waits for that newer reading too. A new game that is accepted says `A new game is starting in the same room. The links stay the same.` | Found in phase 3 of P3 slice 3: the press's reading was dropped as the older one, and the press ended while the page still showed the view from before its answer. In the browser nothing waits on a press, so only tests see the difference. It is one of two races found while looking for why the smoke test `the first run, as the page asks for it` failed once in phase 1 and once at the start of phase 3, each time on a comparison of views whose text was not kept. The other is in the test: a reading before the server's start at launch finds the host at rest, and the page rightly shows "Needs setup" without the server's sentence; the test now waits for that sentence. Which of the two failed, if either, is not known. |
| D69 | The control listener reads the six files of the page once, when it starts, and serves them from memory; a file that could not be read answers 500 as before. | A server that keeps running after the application was replaced in place (D64 keeps it while somebody is in its room) serves the page of its own build, which knows its routes. A changed file of the page is seen only after the server starts again. A server of the slice 2 build still reads the files from the disc. |
| D70 | Before its other filters, the diagnostic report replaces every run of more than 512 characters without a space, a quote or an angle bracket with `<long text>`. | Each of the other filters looks from every start of a line to the end of a run, which on a run of 64 KB took up to 16 s; with the cut, the worst line of the bound takes about 160 ms. A run that long is lost from the report; no line that the server writes holds one, and an invitation is about 300 characters. |
| D71 | A server of another build that accepted the launcher's quit (202) but is still there after `QUIT_WAIT_MS` is reported as still quitting, `A server of another build is still quitting. Open Sled Storm Server again in a moment.`, and its page opens as for a server that is kept. `launch` takes the wait as an option for tests. | A refusal and a slow quit no longer read alike. The owner opens the application again, as before. |
| D72 | The packaged server's room is always dedicated, and the disc policy decides only how the public gateway runs: `shared-allowed` in its `shared` mode with `/disc.zip` on its list, `local-only` in its `local` mode without it. The loopback listener serves `/disc.zip` under both policies, to the room's emulator and to a page on `127.0.0.1`. The session info keeps `discMode: 'shared'` ("this origin serves the archive", as since 1.1.0) and gains no policy field. | Brief §11.1: `local-only` forbids delivery to remote clients, not the worker's load, and a loopback client may get the disc. Under `local-only` a program on this computer that sends the listener's Host header can read the disc, as the brief allows; public delivery is closed by the gateway's list alone. |
| D73 | A gateway in its `local` mode adds `X-Sled-Disc: local` to each answer for `/session-info` that it passes, and the page then plays the session as `local`, with the player's own CUE and BIN files, whatever the body says. | The part that refuses the disc is the one that says so; the page needs no rule about addresses, and a page through the gateway on a loopback port is told the same as one through the tunnel. The Python launcher's local mode gets the header too; its body already says `local`. |
| D74 | Under `local-only` the session info that reaches an invited player still holds `archive`: the size, the chunk size and the SHA-256 of the archive and of each chunk. | They are checksums, not a way to the bytes, and P4 slice 3 checks a player's saved ZIP against them as the fast path of the brief's §11.3. A player can tell whether a ZIP of theirs is a byte copy of the host's archive; the disc identity already tells whether their files are the host's disc. |
| D75 | The game's page takes any disc the packaged server takes from a folder: one CUE whose `FILE "…" BINARY` lines name from 1 to 99 distinct tracks beside it. The rule that a player's own CUE lists eleven tracks is gone. Both sides apply one module, `web/disc-sheet.js`, which the server reaches through `server/src/network.ts`. | Whether a disc fits a room is the disc identity's question (ROOM-05), and the PAL disc's features stay behind `pal`. Settles the first item of "Open after slice 1" under P4. In the Python launcher's local-file mode players can now load a disc other than the Europe one, as its shared mode already allows; none is tested. |
| D76 | Bounds of a disc, shared by the server and the page and checked before a file is read: a CUE of at most 1 MiB, at most 99 `FILE` lines, the CUE and its tracks together at most 1 GiB. | A CD holds at most 99 tracks, and a 99-minute CD read raw is 1,047,816,000 bytes. A folder larger than any CD, which is no PlayStation disc, is refused by the server where it was taken before. The archive format's own guard (4 GiB) stays in `prepareGameData`. |
| D77 | A track is found by its name in NFC and lower case; two tracks of one such name are a track listed twice, and two chosen files that match one name are refused. The identity counts each track under the CUE's spelling and the CUE under its file's name, as before. | The server already finds such a track on a macOS volume; the page now does too. On a case-sensitive volume the server would not find it while the page would; the host is macOS, whose volumes match names this way unless chosen otherwise. |
| D78 | `web/disc-identity.fixtures.json` holds discs of synthetic bytes with their identities, and discs that the shared rules refuse with the message; the page's tests and the server's tests read it. `server/scripts/disc-fixtures.py` writes it, computing each identity with the Python launcher's serialization from tracks it declares, not with the code under test. | An oracle independent of the server's TypeScript and the page's JavaScript. No fixture has the PAL flag, which needs the real first data track. The bundle leaves the file out, as every `*.fixtures.json`. |
| D79 | The page's ZIP reader (`web/disc-zip.js`) reads only an archive whose end record is the last thing in the file (its comment may follow), whose central directory ends where the end record begins and is as large as it says, and whose counts agree; data before the archive that its offsets do not count makes it damaged. ZIP64, several parts, encryption and methods other than stored and deflated are refused as unsupported; encryption and the method are checked on the entries the disc uses. | DATA-04: no guessing at a damaged layout. An extra file of another method does not refuse a ZIP. A self-extracting archive whose offsets do not count its stub is refused; the player chooses the files. |
| D80 | A name in a player's ZIP is UTF-8, flagged or not, decoded strictly; any other name is refused. A name with a control character, a backslash, a drive letter, or an empty, `.` or `..` segment (a leading `/` makes an empty one) is refused anywhere in the archive, ignored entries included. | Finder and Info-ZIP's `zip` write UTF-8 names without the flag. A ZIP from an old Windows tool whose names are not ASCII (CP437, CP866) is refused rather than guessed; the player chooses the files. |
| D81 | In a player's ZIP, `__MACOSX/` entries, AppleDouble `._` entries and folders are ignored; two other entries whose names match by `nameKey` are refused; the archive holds exactly one CUE, and its tracks are found beside it by `nameKey`; other files are ignored. The CUE counts in the identity under its entry's last segment as the archive stores it, not normalized. | A folder's CUE counts under the name its volume holds, and Finder's Compress keeps that form (checked: NFC stays NFC, NFD stays NFD). A tool that changed a non-ASCII CUE name's form would give another identity, and the room would refuse the disc. |
| D82 | Before any data of a player's ZIP is read: at most 1,000 entries and a central directory of at most 1 MiB, the CUE's declared size (D76) before the CUE, and the disc's declared sizes once the CUE names its tracks. Each entry used must have a local record that names it byte for byte with its method, encryption flags and (without a data descriptor) its CRC-32 and sizes; its data ends before the directory, and the entries used do not overlap. | DATA-04. Overlapping entries are the known way to make a small archive inflate to a large one. |
| D83 | Each entry used is read once: a stored one stays a slice of the archive, a deflated one is inflated by `DecompressionStream('deflate-raw')`; the bytes are counted and the read stops as soon as they pass the declared size, and fewer bytes or another CRC-32 refuse the ZIP. The disc is handed over as the player's own files are, as `File` objects; the exact copy of the server's archive (D74's manifest) is passed as it is. | Nothing is written and the emulator's own extractor never sees a player's archive. A deflated ZIP of the owner's disc holds about its size in the browser's blob memory while the game runs; phase 3 measures it. |
| D84 | The fixture file also lists ZIPs of its discs: made by `zip`, `ditto` and Python's `zipfile` on this Mac, the server's canonical archive rebuilt by the generator, and damaged or hostile archives built byte by byte, each with its disc's identity or the reader's refusal code. The server's test pins its streamed archive equal to the rebuilt one. | Real tools' layouts (data descriptors, names without the flag, `__MACOSX`) are tested as they come. The generator needs macOS; ditto's archive changes in its folder times on every run, and carries the provenance attribute that macOS sets on files (a machine-local number). |
| D85 | A CUE sheet with a control character other than a tab, a line feed, a carriage return or U+001A (the DOS end-of-file mark) is not a text file, and the shared rule refuses it on the server and the page: `The CUE file is not a text file.` A track's name holds no control character at all, the CUE never lists itself as a track, and any number of leading byte order marks is taken. | The emulator unpacks the file it is given as `EJS_gameUrl` itself when its first bytes are a ZIP, 7z or RAR signature, and each signature has another control character in its first six bytes, so no CUE that the page hands over is unpacked by it; the tracks, given as `EJS_externalFiles`, are written as they are. Found by reading the emulator before the ZIP field was wired; the last three rules came from the review, so that the server and the page agree on contrived discs. A CUE with a stray control character, which no ripping tool writes, is refused by both. |
| D86 | A deflated entry of a player's ZIP goes to the browser's blob store 16 MiB at a time (`HELD_LIMIT`): the page holds at most that much inflated data before it makes a `Blob` of it, and the `Blob` already made carries the earlier parts without a copy. | Measured by hand first on a disc of 687 MiB: the renderer kept +0.82 GiB after the disc was released when each entry was held whole, +0.26 GiB with the parts; the read is a little faster. A deflated ZIP still keeps the disc's size in the blob store while the game runs, which the player's own files and a stored ZIP do not. |
| D87 | The page offers the three choices of the brief's §11.2 as one group in its Game files tab, in the brief's order and words: "Use my game files", "Use saved ZIP", "Download from server", the last only when the session offers the disc (`discMode` is `shared` after the gateway's header, D73). Every page whose disc is not fixed shows it, the host's own page included. The choice made last on the address is preselected while it is offered, else the kind of a copy remembered there (D88), else the download where it is offered, else the player's files; the launch summary names the choice and whether it is ready. | The brief asks for a clear choice in the guest's flow, and one room for every allowed source. Under `shared-allowed` a guest may now play from their own files or ZIP, which the page did not offer before; a `local-only` session never offers the download, whatever was chosen last. |
| D88 | Where the browser has `showOpenFilePicker`, a player's files and ZIP are chosen through it, and once the page has checked the copy (when it is chosen, or at Join for a copy restored from an earlier visit) while it is still the chosen one, its handles and the disc identity they gave are kept for the address in IndexedDB (`sledstorm-game-data`, key `source`). A later visit uses the copy without a picker while read access holds, asks again with Join's click when the browser wants to ask (`prompt`), and restores nothing when access was refused, a file is gone or the record is of another disc; a file found gone after access is asked again refuses that copy at Join (`Your game files were moved, renamed or deleted since you chose them. Choose them again.`). Elsewhere the file inputs are used and a choice lasts as long as the page. Wrapper 1.0's record of a Quick Tunnel's saved ZIP is read as a saved ZIP when its checksum is the room's archive's. | The brief asks not to open the picker again without need, and no disc bytes go into the browser's storage for it (brief §11.5). What Chrome asks when access is renewed, once per address or once per file, is Chrome's and is checked by hand. |
| D89 | When the session info names the room's disc identity (the packaged server always, D74; the Python launcher in shared mode), the page compares a chosen copy's identity with it before it connects and refuses another disc: `These game files are not the disc this room plays. Use the host's CUE and BIN files under the same names, or a ZIP of them.` Where it names none (the Python launcher's local mode), the room compares, as before. | A clear message before the room's refusal (ROOM-05), which stays. |
| D90 | Each disc item that the page's ZIP reader gives carries `held`, the bytes its data keeps in the browser's blob store (the entry's size when deflated, 0 when stored); the page tells a player who chose a compressed ZIP how much the browser keeps while the game runs, and that the CUE and BIN files or an uncompressed ZIP avoid it. | D86 leaves a deflated ZIP's size in the blob store; the open item of slice 2 asked to say so. |
| D91 | "Download from server" stays as 1.1.0 does it: the whole `/disc.zip`, kept in Cache Storage on a stable address with "Keep game data", and on a Quick Tunnel saved as a ZIP the player chooses, which then becomes the remembered saved ZIP and the last choice; the Quick Tunnel dialog's "Use existing ZIP" chooses the saved ZIP source, which takes any compatible ZIP (D89), not only the exact copy. | Resumable delivery, chunk routes and OPFS are P5. |
| D92 | The loopback listener serves `GET` and `HEAD` of `/game-data/manifest`, `{"version":1,"disc","pal","archive"}` as JSON (the session info's `disc`, `pal` and `archive`, D74), and of `/game-data/<sha256>/chunks/<index>`, the chunk as `application/octet-stream` with its exact length; both `Cache-Control: no-store`. The ID must be the current archive's and the index a decimal integer without a sign or leading zero below the number of chunks, matched on the path as written (before percent-decoding); anything else under `/game-data/` is 404 before a file is opened. A private disc answers 404 on both; changed game files 503, as `/disc.zip`. | The brief's §11.4 protocol, with its checks before any read. A page that asks for a chunk of an archive the server has replaced gets 404 and reads the manifest again (P5 slice 2). |
| D93 | A chunk is the range `[index × chunkSize, min(size, (index + 1) × chunkSize))` of the archive that the server streams; the whole archive is the same code over `[0, size)`. Each file is read through one handle and compared with its prepared state before and after, and the last piece read from a file waits for the second comparison, so a chunk of two versions never arrives whole. | No archive is written to disk (as since P1). The page's hash check (slice 2) catches a change that keeps a file's size and time. |
| D94 | One limit runs every `GET` of `/disc.zip` and of a chunk that a guest asks for through the gateway, which marks every request it forwards (`x-sled-gateway`; it forwards no header of the guest's, so a guest cannot take the mark off): 4 at once, 16 more waiting in order, any further one 503 `The server is busy. Try again shortly.` with `Retry-After: 2`. A waiting request whose client goes leaves the queue; an active one frees its place when it ends or its client goes, and its file reads stop; one whose client stopped reading is cut 30 to 60 s later (a socket timeout of 30 s, which Node lets pass once when the socket's write queue moved since the write was dispatched; that also keeps a slow but reading client). The room's emulator, the owner's page and any page on this computer come over loopback without the mark: they are never queued or refused, and keep the idle cut. A `HEAD` reads nothing and stays outside the limit; so do the manifest and the session info. | The brief's limit on the host's active delivery with backpressure, and its §11.1: the server's worker always gets the locally chosen disc. The room's emulator loads `/disc.zip` at every session start (a fresh profile each time) under the relay's 75 s deadline, so it must never wait behind guests (the review of slice 1). With reads of 1 MiB the four active deliveries hold a few MiB. If wrong: on a slow tunnel four guests with two requests each take turns, and four stalled clients hold every guest's place for up to about a minute; deliveries on this computer are unbounded, as every `/disc.zip` was before P5. Constants of `server/src/runtime-http.ts` (`DELIVERY`); P6 measures them. The 30 to 60 s were measured in phase 2's hand check. |
| D95 | In its shared mode the gateway passes `GET` and `HEAD` of `/game-data/manifest` and of paths matching `^/game-data/[a-f0-9]{64}/chunks/(?:0\|[1-9][0-9]{0,6})$`, compared on the path `new URL` gives (percent-encoding kept), which must also be the path as sent (before `?`), since `new URL` settles dot segments, and forwarded without the query, with the gateway's mark (D94); the listener checks the ID and the bounds. A chunk's `GET` of 200 streams without its `Content-Length`, as `/disc.zip` does; its length is in the manifest. Its local mode refuses them with the 403 of `/disc.zip`. | The gateway stays a list of shapes, not a proxy (brief §11.4); DATA-01 for the new routes. Settled with P5 slice 1's plan; implemented in its phase 2. |
| D96 | "Download from server" reads `GET /game-data/manifest` (`no-store`). A 404 means the server has no chunk routes (the Python launcher): the page downloads the whole `/disc.zip`. Any other status, a network error or no answer within the answer deadline stops with `Could not download the game disc. Reload the invitation to try again.` A manifest counts only with `version: 1`, the session info's `disc` and `pal`, an archive whose `sha256` and chunk hashes are 64 lowercase hex characters, whose `size` and `chunkSize` are positive safe integers, `chunkSize` at most 64 MiB, and whose chunk count is `ceil(size / chunkSize)`; otherwise `The server's game data changed. Reload the invitation to try again.` Two workers fetch the missing chunks in index order, each read into one buffer of its manifest length; a longer or shorter answer is a failure. Before an answer begins (the host's queue, D94) only an answer deadline of 5 minutes applies; once it has begun, 45 s without a byte is a stall. A 503 with `Retry-After` is a pause of 1 to 30 s; a 503 without it stops with `The host's game files changed. Ask the host to start hosting again, then reload the invitation.` A cut by the answer deadline before the answer began, or a proxy's 504 or 524, is a wait: asked again after 1 s, until the chunk has waited 30 minutes in all. A chunk's 404 reads the manifest again, once for both workers and aborted by a stop: the same archive is a failure of that chunk; another archive of the same disc starts over on it, at most twice, the old archive's parts removed; anything else stops as a changed manifest does. A network error, a stall, a wrong length or hash, or another status is a failure of that chunk, asked again after 1, 2 and 4 s; the fourth in a row stops with `Game data stopped downloading. Reload the invitation to continue.`, keeping every checked part. Pauses and waits neither count as failures nor end a run of them; any other error reaches the player as the last sentence. The whole `/disc.zip` has the same deadlines. | The brief's §11.4 client steps 1 to 3, with the host's queue (D94) in mind. The waits, their budget, the 64 MiB bound and the sentence for storage errors came from the review of slice 2: four waits past Cloudflare's 100 s would have stopped a guest behind a slow tunnel. If wrong: over a Quick Tunnel a waiting request is asked again after about 100 s at the back of the host's queue, and a dead host behind an edge that answers 524 keeps a guest waiting up to 30 minutes per chunk (a host that is gone answers 502 at once, a failure). Constants exported from `web/disc-download.js`; P6 measures them. |
| D97 | The checked chunks are files `<index>` in `sledstorm-parts/<archiveSha256>` of the origin private file system, each written with `createWritable()` and committed by `close()` before its index is added to the archive's record in IndexedDB (`sledstorm-disc-parts`, store `progress`, key the archive's SHA-256, `{ size, chunkSize, chunks, done }`), written one after another from one in-memory copy. A part on disk that the record does not list does not count; a listed part whose file is missing or of another length is dropped when the store opens; a part of another length than the manifest's is never kept. Opening the store for one archive removes every other archive's parts and record. One page of the origin holds the stored parts at a time (a Web Lock, `sledstorm-disc-parts`, asked with `ifAvailable`, released when the parts are removed or the page unloads); a page without it, or without the private file system or IndexedDB, keeps its parts in memory (`persistent: false`). A part that the private file system refuses to keep (its quota, a full disk) stays in memory for that page, never listed. | The brief's §11.4 step 4 (a part saved and the progress updated atomically) and §11.5. The lock and the parts in memory after a refused write came from the review: two tabs of one invitation removed each other's parts, and a quota smaller than the archive (a private window, a full disk) stopped every download at the same place. If wrong: a second tab of the same invitation downloads into memory and does not survive its own reload; parts in memory cost the browser's memory, as 1.1.0's whole download did. Slice 3 checks the quota before saving and tells the player. |
| D98 | When every part is counted, the page builds one `File` from the parts in order, refuses it with `Game data stopped downloading. …` unless its size is the archive's, and checks every chunk's SHA-256 over it, one chunk in memory at a time; parts that fail are dropped and fetched again, and a second failed check stops with `The server's game data changed. …`. | The brief's §11.4 step 5. A part changed on disk after it was counted is caught (DATA-06 in the page). Each fetched chunk is hashed twice and each reused chunk once: one more pass over the archive, a few seconds, at the end of each download. |
| D99 | The parts are a staging area: `sharedDiscFile` in `web/app.js` saves the downloaded `File` where it saved the whole download (the Quick Tunnel's chosen ZIP, D91; the fixed address's Cache Storage copy with "Keep game data") and removes the archive's parts and record once the game has started (`discardGameData`). EmulatorJS reads a `File` whole before it starts and then replaces its game URL by the file's name. | A finished download leaves no second copy in the origin; a Quick Tunnel host name that never comes back leaves at most one unfinished archive in that origin's storage. If wrong: a player who reloads after the start, where no copy was kept, downloads again, and a room that fails just after it starts is when a reload is most likely (the review's note); slice 3 decides whether the parts replace the Cache Storage copy. |
| D32 | The packaged server runs the shipped browser only. `SLED_SERVER_CHROME` names another browser for a server run from source, and is ignored by the packaged executable. A build without an executable browser fails to start hosting, with the emulator named. | RUNTIME-01. The product has dedicated rooms only; without the browser the relay would accept the old browser-hosted role. |

## Stage plan

Each stage is a small reviewable change set. A stage is done only when its exit
checks have been run and logged below.

### P0 Audit and SEA proof

Scope: baseline checks, this plan, pinned Node and bundler, a minimal
TypeScript server built as a real SEA, the packaged smoke, and a draft
application bundle to answer the launch, reopen and quit question.

Files:

- `server/package.json`, `server/package-lock.json`, `server/tsconfig.json`,
  `server/toolchain.lock.json`
- `server/src/entry.ts` and `main.ts`: entry point and command dispatch;
  importing `main.ts` starts nothing.
- `server/src/paths.ts`: resource, data, cache, log and temporary roots.
- `server/src/owned-process.ts`: child ownership, startup deadline, bounded stop.
- `server/src/instance.ts`, `server/src/platform/instance-lock.ts`: single
  instance.
- `server/src/host-server.ts`: loopback control listener with status and quit.
- `server/src/serve.ts`, `control.ts`: the server, and the launch, status and
  quit commands.
- `server/src/network.ts`: typed entry to the existing gateway and relay.
- `server/src/self-test.ts`, `internal.ts`: the in-executable smoke and its
  child roles.
- `server/scripts/`: `fetch-node.mjs`, `build.mjs`, `build-sea.mjs`,
  `package-macos.mjs`
- `server/test/`: unit tests. `server/smoke/`: tests that run the built SEA.
- `packaging/macos/Info.plist`

No existing file under `web/`, `research/` or `tools/` was changed.

Results:

- SEA-01 passed: the packaged executable runs with a search path that points
  nowhere. No Node.js, npm, Python, Git or `node_modules` is involved.
- SEA-02 passed: it runs from another working directory, from a path with
  spaces and non-ASCII characters, with a read-only bundle, in both the bare
  and the application layout. It wrote only under the user data roots.
- SEA-03 passed: a real HTTP exchange, and a Netplay round trip through the
  existing gateway and relay modules, bundled unchanged, with the guest
  running as a second process of the same executable and a binary packet in
  each direction.
- Child ownership passed: a child that stops when asked, and a child that
  ignores SIGTERM and is killed after the grace period.
- Single instance passed: six concurrent launches end with one server; a
  killed server's record is not trusted; SIGTERM and `quit` both leave no
  record and no process.

Observed SEA behavior, Node.js 26.13.1 on macOS 27.0.1 arm64:

- `--build-sea` resolves relative paths in its configuration against the
  working directory, so the build writes absolute paths.
- The produced Mach-O is unsigned and macOS kills it on start (exit by
  SIGKILL). An ad-hoc signature makes it runnable on the build machine.
- User arguments start at `process.argv[2]`. Node.js options passed as
  arguments reach the application, and a `NODE_OPTIONS` that preloads a missing
  file had no effect with `execArgvExtension: "none"`.
- `require()` of anything that is not built in fails with
  `ERR_UNKNOWN_BUILTIN_MODULE`. The bundle check in `build.mjs` therefore fails
  the build on any such import, and the `ws` native add-on paths are compiled
  out.
- Starting `process.execPath` again with a subcommand works for helper
  children, including a detached server.
- The executable is 146 MB, almost all of it the Node.js runtime. Its load
  commands declare macOS 13.5 as the minimum system.

Draft application bundle, launched through LaunchServices with `open`:

| Scenario | Observed |
|---|---|
| The server runs as the bundle's own long-lived process, then the bundle is opened again. | LaunchServices reports the application as already running and starts nothing. The Node.js process receives no event, so it cannot bring its page back. |
| Default command, first open. | The launcher starts a detached server, reports `started` and exits. The server keeps running. |
| Default command, opened again while the server runs. | LaunchServices runs the launcher again. It finds the server, reports `reused` with the same PID and address, and exits. No second server appears. |
| Three opens in quick succession. | The first runs the launcher. The other two arrive while it is still alive and are absorbed by LaunchServices. One server, one page. |
| Opened again with the browser enabled. | The launcher opened the page with `/usr/bin/open` and exited without an error. |
| `quit`. | The server stops, removes its record and leaves no process. |

Shim decision: no native shim. Launch, reopen and quit work with the single
executable alone, because of D9 and D10. A shim would be needed only for a Dock
or menu-bar presence, which is not required.

Not verified in P0:

- A double-click in Finder itself. `open` uses the same LaunchServices path.
- What the Dock shows. None is expected for an agent bundle; nobody looked.
- That the browser window really showed the page. The launcher's call to open
  it succeeded; the page itself was checked only over HTTP.
- A quarantined download, Gatekeeper and App Translocation. The signature is
  ad-hoc; nothing here is a distributable build.
- Logout, shutdown, sleep and network changes with a running server.
- The SHA-256 pin for Node.js was taken from `SHASUMS256.txt` over HTTPS; its
  PGP signature was not checked.
- Nothing game related: no emulator, no room, no tunnel, no Chromium.

### P1 Node host runtime

Scope: port what the packaged runtime needs from `server.py` and
`tools/play-online.py` into the SEA: runtime HTTP with the existing headers and
Host checks, disc preparation and identity with streaming hashes, the
supervisor for Chromium and `cloudflared`, parameterized ports and origins,
transactional start and idempotent stop. Choose the redistributable Chromium
build and run the worker on it.

Depends on: P0. The end-to-end check needs a bootstrapped and built emulator,
a game disc, Chrome or the chosen Chromium, and `cloudflared`. The emulator was
not bootstrapped on the machine used for P0.

Slices:

1. Local host stack: done 2026-11-20. Task plan:
   `docs/superpowers/plans/2026-11-20-p1-local-host-stack.md`.
2. Tunnels: done 2026-11-20. Task plan:
   `docs/superpowers/plans/2026-11-20-p1-tunnels.md`.
3. Dedicated emulator: done 2026-11-20. Task plan:
   `docs/superpowers/plans/2026-11-20-p1-dedicated-emulator.md`.

Slice 1 results:

- `configure` validates a game folder and stores it with the disc policy.
- `serve` prepares the disc and then runs the game origin, the Netplay relay
  and the gateway in its own process. Start is a transaction. Start and stop
  requests may interleave: the latest wins, a stop interrupts a start that is
  under way, and stop ends open connections.
- A disc that changes under a running server is never sent: a download in
  progress is cut short, later ones get 503, and the host state becomes
  `degraded` with a `game-data` problem until the next start.
- The disc identity is unchanged: it equals the browser's `identifyDisc` and
  `shared_identity()` of `server.py`, in tests on synthetic data and by hand
  on a real disc.
- The runtime HTTP routes pass the four cases of
  `tools/test-emulator-server.py`, ported, and new cases for path escapes,
  conditional requests, dropped downloads and a changed disc.
- `createRetroArchRelay` takes an `origins` option. Its default is unchanged,
  and it is the only edit to an existing module.
- HOST-05 holds for both fixed ports: a busy port fails that component with
  an action, the other program is untouched and nothing else stays listening.
  The server asks the port before binding, because on macOS a loopback bind
  succeeds while another program listens on all interfaces.

Measured on a real 11-track disc (archive of 720,729,166 bytes), Apple
Silicon, internal disk: first preparation 1.2 s, later starts reuse a 10 kB
stamp without reading the disc, the full archive streams in 0.5 s in process
and downloads in 0.2 s over loopback HTTP. `server.py` needed 2.8 s to prepare
the same disc and writes a second copy of it.

Not verified in slice 1:

- The emulator itself. This machine has no built emulator, so the packaged
  server was run with stub emulator files: the lobby page loads, the game
  cannot start. `RUNTIME-01` and every gameplay check stay open.
- Whether EmulatorJS reads the `stored-v2` archive. `unzip` and Python's
  `zipfile` verify it; the emulator's own extractor has not seen it.
- A dedicated room. Without a worker the relay offers browser-hosted rooms
  only, and no room was created.
- Anything public: no tunnel runs yet, and the gateway was only shown to
  listen and to ask for its access link.
- Browsers other than the Chromium-based pane used for the page check.
- Game files on a slow, removable or permission-protected volume.

Review of slice 1: one independent reviewer read the whole change and probed
it. No critical finding; six important ones, all fixed with a test that failed
first: a fixed port held on all interfaces, a disc changed during a download,
a start that could not be interrupted, interleaved start and stop, a changed
disc that the host could not see, and missing tests for the real archive
stream and the authorized gateway path. Left open as minor:

- An unreadable CUE gives only the generic "could not be read", and a CUE of
  any size is read into memory.
- An unwritable cache folder gives the same generic message and leaves a
  temporary stamp file.
- Messages say "start the server again", but only quitting and opening the
  application retries a failed start. The control API gets a start action in
  P3.
- If stopping the rooms throws, the relay listener stays open.

Exit checks: the SEA starts the prepared emulator and the current tunnels
without Python; the worker reaches readiness on the shipped Chromium; HOST-02,
HOST-03, HOST-04, HOST-05, TUN-01, TUN-02 and RUNTIME-01 from the brief.

Slice 2 results:

- The built server starts the primary tunnel to its gateway and the mirror
  tunnel to the gateway's mirror listener, with the launcher's own commands.
- TUN-01 held on a real tunnel: with the primary program killed, the host was
  `degraded` at once and refused to hand out a link; 20 s later it was `online`
  with a new link. Bounded restarts and the failed state are covered by tests
  with a stand-in program.
- TUN-02 holds in tests: a mirror that cannot start leaves the host `online`,
  and the gateway advertises a mirror address only while the mirror is online.
- Through a real public address: the access link answered 302, `/session-info`
  answered 200 over HTTP/2 with the mirror and invitation headers, the archive
  matched its manifest, a path outside the allowlist got 403 and a request
  without the cookie got 401.
- Time from launch to `online`, with the DNS wait and the probe: 26 s and 54 s
  in two runs.
- `quit` during a start that was still probing took 1 s. After `quit`, and
  after killing the server, no tunnel program and no guard was left.
- The log and the status held no hostname and no token, in tests and in the
  real runs.

Not verified in slice 2:

- Anything from another device or network. Every request through the public
  address came from the hosting computer itself.
- The game through the tunnel: only stub emulator files and a synthetic disc
  were ever exposed.
- Hours of uptime, sleep and network changes; the 20 s loss window against
  `cloudflared`'s own reconnects.
- A network that blocks public DNS: the fallback to the system resolver is
  covered by a unit test only.
- A client that actually uses the mirror: only the advertised address was
  checked.
- A host page that is already open when the address changes.

Review of slice 2: one independent reviewer confirmed all five focus points
with its own probes and found no critical issue. Fixed with a test that failed
first: a probe that could not be interrupted, a mirror that never came back, a
cleanup failure that could crash the server, and a guard that could signal a
reused PID. Left open as minor:

- Once the primary's restarts are spent, only quitting and opening the
  application recovers; the start action comes with the panel in P3.
- A failed launch logs no reason.
- One failed answer from public DNS switches that launch to the system
  resolver.
- No automated test runs the real probe and the guard together; that was
  checked by hand on a real tunnel.

Slice 3 results:

- The emulator was built on this machine as `docs/setup.md` says, with the
  Homebrew Python 3.15.2, in eight minutes. The package now carries the real
  emulator, the pinned Chromium and `cloudflared`.
- RUNTIME-01 held by hand. The built server, on the owner's disc and with the
  tunnel program removed, started a room's worker from
  `Contents/Resources/chromium` inside its own bundle. The packaged server
  has no code path to another browser.
- A second copy of the pinned Chromium, driven as a player, pressed the start
  button on `http://127.0.0.1:8000/`. The page downloaded the archive, the
  room started, and the page reported `LIVE` 12 to 15 s after the button, in
  five runs. Frames then advanced at 50 per second with the player zero frames
  behind, for 100 s in the longest run, with no page error. So EmulatorJS
  reads the `stored-v2` archive, in the player and in the worker.
- The worker's sockets, sampled every second for 40 s of a live room, were on
  loopback only: the game origin and the relay.
- A worker was 11 to 14 processes with 1.5 to 2.5 GB resident in total, and
  about half a core. macOS listed it as a background-only application, with
  no Dock icon. The server itself stayed at 35 MB.
- `quit` during a live room took 0.3 s. The player's page said "Dedicated
  server stopped", the profile was removed, and no process was left after
  two crash-handler helpers ended within half a second.
- Killing the server during a live room: 14 worker processes were gone within
  one second. The profile stayed, and the next start removed it.
- After the player left, the room expired and its worker ended a minute
  later, as the relay's rules say.
- Size of `Sled Storm Server.app`: 556 MB unpacked and 224 MB as a zip
  archive. Chromium is 373 MB of it, the executable 140 MB, `cloudflared`
  38 MB, the emulator 4 MB and the web client 3 MB.

Not verified in slice 3:

- More than one player, a race, input, audio, or a save. One player sat in
  the lobby of a live room.
- The game through the public address. No tunnel ran while the owner's disc
  was configured.
- A room on a machine without Google Chrome installed. This machine has it;
  the evidence is the worker's executable path and the code.
- The optional WebGL 2 renderer for dedicated races
  (`tools/prepare-hardware-preview.py` was not run).
- Long sessions, sleep, and a worker under memory pressure.
- The shipped browser beside a Chromium that the user installed. Running the
  bundle sets `LastRunAppBundlePath` in the macOS defaults of
  `org.chromium.Chromium` and creates an empty system download folder for
  that identifier. A user's own Chromium shares both.
- Signing: the nested browser is sealed as plain resources by an ad-hoc
  signature. A notarized build needs it signed as code.
- The license texts. The Chromium bundle carries no license file, and the
  package does not ship one yet.
- A real browser whose main process hangs. Killed outright in a live room, it
  left nothing after 0.7 s; a hung one was not produced.
- The resolver rule against an address written as numbers: reasoned about,
  not measured.

Review of slice 3: one independent reviewer confirmed four of the five focus
points with its own probes and found no critical issue. Fixed with a test that
failed first: a browser that is present but cannot run left the host `online`
with every room failing and nothing in the log (the host is now `degraded` with
the emulator named, until a worker starts again); an old profile that could
not be removed failed every start; a cleared cache folder broke rooms until a
restart; and an unreadable message on the browser's pipe could crash the
server. The smoke test no longer runs the staged browser for its version.

The seven minor items of that review were closed the same day, at the owner's
request:

- A player now hears "Dedicated emulator disconnected" whichever of a dying
  worker's two connections the relay sees end first. In a dedicated room the
  relay waits 100 ms after a player's stream ended before it lets that player
  go. Checked by hand: the real browser was killed in a live room.
- The runtime ends its wait when the browser process exits and then closes its
  ends of the pipes, so a wrapper that keeps them open cannot hold a stop.
- Stale profiles are removed at the beginning of every start attempt, also one
  that ends in `needs_setup` or on a busy port.
- `quit` waits 15 s: the grace periods of a tunnel and of a worker, and 5 s.
- A smoke test covers a build with the emulator and without the browser.
- The lock pins the SHA-256 of the browser's launcher and of its framework,
  the fetch script checks both on every build, and the manifest repeats them.
- The verified Chromium archive is kept in `.cache/toolchain` and the browser
  is unpacked from it. A copy outside the build machine is not made; that
  needs a place the owner chooses.

### P2 Server-owned rooms

Scope: internal `createRoom()` without a browser peer and without a seat, four
free controllers, a room that survives zero players, the canonical room
identity with a new invitation version, save and restore as a room capability,
restore inside the same room.

Depends on: P1.

Exit checks: ROOM-01 to ROOM-07 and SAVE-01 to SAVE-04 from the brief; the
existing dedicated-room tests keep passing for the developer path.

Slices:

1. Room identity, invitation version 8 and the server's own room: done
   2026-11-20. Task plan:
   `docs/superpowers/plans/2026-11-20-p2-server-owned-room.md`.
2. Saving as a capability of the room, and restoring inside the same room:
   SAVE-01 to SAVE-04 and the restore chain below. Done 2026-11-21 in four
   phases. Task plan: `docs/superpowers/plans/2026-11-21-p2-room-saves.md`.

Slice 1 results:

- ROOM-01: the packaged server opens its room at the start of hosting. By
  hand on the owner's disc it was open, with no player, 7 s after the start.
  The first player to join got controller 1; the worker holds no seat.
- ROOM-02, in relay tests: four players get the four controllers and a fifth
  is refused. By hand two players joined with one link and played on
  controllers 1 and 2, each seeing two players on one frame count.
- ROOM-03: by hand the first player left and the second played on. The
  reserved seat and its return are covered by a relay test.
- ROOM-04: by hand the room was still open after 75 s without players, and a
  new player joined the game that had kept running. A relay test shows that
  a server's room has no expiry where a browser-made one has.
- ROOM-05: a player whose identity differs is refused before taking a seat,
  in relay, host and packaged tests.
- ROOM-06: a version 7 link gets the sentence "This invitation was made for
  an earlier version of the game. Ask the host for a new link." and a
  disabled start button. Checked by hand as well.
- ROOM-07: the browser and the server compute the recorded identities from
  one fixture file, whose values were computed outside the module. Key order
  and fields outside the list do not count; each listed field does.
- A player's page cannot make the server start or stop an emulator: `create`,
  `host` and `release-for-load` are refused and the room is untouched.
- With the room's browser killed by hand, the player was told "Dedicated
  emulator disconnected", the host was `degraded` with the room named, and a
  new session was open 8 s later under the same invitation.
- The log and the status hold neither the room's name nor its token.

Not verified in slice 1:

- Three and four real players, a race, and a seat returned during a race:
  two real players sat in the lobby.
- The room through the public address: no tunnel ran with the owner's disc.
- A room for hours, and a lost emulator during a race.
- The developer launcher with the changed web client. Its tests pass; it was
  not started by hand.

Review of slice 1: one independent reviewer found one critical defect and
reproduced it. A room has one name for all its sessions, and the emulator of
an old session that ended late removed the next session from the relay: the
room could not be joined while the status said `online`, and stopping hung.
Fixed with a relay test and a host test that failed first. Also fixed with
tests: controllers kept for players who left a race were never freed in an
empty room; a failed room still told guests to try again and was still handed
out; a guest who waited for a session that failed heard that the emulator had
failed. The page no longer offers "Saved games" in a room that is the
server's. The status of a failed room now says why its last session ended.
Left open:

- A start request while the room is restarting or has failed rebuilds the
  whole stack, with a new room and a new address. Nothing sends one before
  the panel of P3, which has to decide what "start" means then.
- With a browser that hangs, giving up on a room can take about five minutes:
  four sessions with the 75 s startup deadline each.

Seen during the hand checks, and not changed: the emulator's own page code
(`EmulatorJS.checkForUpdates`) asks a server on the internet whether a newer
EmulatorJS exists, from every player's page. In the room's worker the
resolver rule of D30 stops that request, which the page reports as a failed
fetch and ignores. Whether players' pages should make it is a question for
the web client, outside this plan.

Open in slice 1, by decision:

- Nobody can save or load in a room of the packaged server until slice 2.
- A page opened on the server's computer without a link is told that the
  server has one room. The owner gets the local link from the `invitation`
  command until the panel of P3 has its "Open game" button.
- The room's options cannot be chosen (D37).

Slice 2 results, by hand on the owner's disc with a copy of the built bundle
without the tunnel program, unless a test is named:

- SAVE-01: the player alone in the server's room saved to a slot, played on
  and loaded the slot. The saved screen came back and the player was on
  controller 1 again. Seven loads in all, the last two on the final build.
  Each time the log showed the second worker starting and the first ending.
  The two emulators ran together for 6 to 9 s, the player was back 10 to 18 s
  after asking, and the room was closed to others for 3 to 9 s of that.
- SAVE-02: with a second player the Save button is hidden, Load is disabled
  and the list says "Saving and loading are paused while another player is
  connected or reserved." A `restore` request made by hand with the player's
  own key, with a wrong key and with a wrong token was refused in words, and
  the game ran on. A `.sledsave` cut in half, with one byte changed, of
  random bytes and empty was refused at import, each with its reason; a good
  one was accepted. After the second player left a multiplayer race, the
  kept controller blocked the load in the page and in the relay, and both
  opened again about 35 s after the race was ended.
- SAVE-03: two saves made by wrapper 1.1.0 (`acc8e35`, run as
  `python3 server.py`) on `http://127.0.0.1:8000` in the same browser profile
  were listed in the lobby of the server's room and loaded in the room. One
  of them was made under original progression with a shared camera: it
  loaded, and the room kept its own options.
- SAVE-04: `invitation` printed the same links before and after three loads,
  and a second player then joined with that link on controller 2.
- The restore chain below has a relay test for each row, for cancellation and
  for a start that fails, and a smoke test of a load into the room of the
  packaged server with stand-ins. A load asked through the gateway has a
  relay test with the save marked and live input beside it.
- The open point is answered for this machine, a 16 GB Apple M1 Pro with the
  player's browser on it: the summed resident memory of the server's
  emulators peaked at 3.2, 3.5 and 3.9 GB while two ran, against 1.3 GB for
  one at rest, and no load failed. The fallback is not planned.
- The page that came back by itself had a running audio context, with no
  click since the reload. Nobody listened.
- A room made by the developer's local launcher (`python3 server.py` of the
  tree) still loads a save by starting a new room, with the changed client.

Found by the hand check and fixed with tests that failed first: the game
origin confirmed a browser's kept copy by its date. The Python launcher and
every build serve `127.0.0.1:8000`, so a browser that had just run wrapper
1.1.0 there was told 304 and ran the 1.1.0 client against the packaged
server: "Invalid or outdated invitation", with the start button disabled.
Each file now has an `ETag` of its length and time, only a matching
`If-None-Match` gives 304, and the emulator's files are asked about each time
too.

Review of slice 2: one independent reviewer read the whole diff, ran the
tests and reproduced its findings outside the repository. No critical
finding, and the five points of the plan's Review Focus hold. Fixed with
tests that failed first:

- One player could make the server start emulators without bound by asking
  for a load and calling it off: 63 starts in 2 s. A room now takes no new
  load while more than its own emulator exists, and none for 5 s after a load
  that started an emulator and did not complete. The player reads "The room
  is still finishing the last load. Try again in a moment."
- A save had 10 s to arrive, which a player on a slow uplink cannot meet. It
  has 60 s.
- A load went on for a player whom the relay had already let go, when that
  player's connection was slow to close. Letting a player go now ends the
  load.
- The player of a load who asked about the room before coming back was told
  to try again for up to a minute. The room now answers that player, known
  by the controller key, and the page's question carries the key.
- The page waited without end for a load on a connection that died without a
  word. It gives up after 150 s and reports the lost connection.
- Three tests depended on tight timing; their margins are wider.

Not verified in slice 2:

- A load asked through the public address: no tunnel ran with the owner's
  disc. The gateway part has a test; a 4.4 MB message through Cloudflare on
  a real uplink has none.
- `tools/play-online.py` with the changed client. It opens a public address
  in front of the disc, so `python3 server.py` was run instead.
- A machine with 8 GB. If a load fails there for memory, the room is
  unchanged, and the fallback of the open point is the remedy.
- Sound by ear, Safari and Firefox, three or four players, and anything for
  hours.
- A second emulator that cannot start on the real Chromium. Tests cover it
  with stand-ins.

Open after slice 2:

- A save says which game it fits only through the key its player declares. A
  state of another game declared as fitting stays in the server's room for
  everyone who joins later, until the next load or a restart. P3 gives the
  owner a new game for the room.
- `web/app.js` has no automated test. The return after the reload, the
  skipped question to the room and the settings written into the request
  were run by hand.
- A page in the background refused to load a save: "The room changed. Wait
  until you are playing alone to load a save." Seen once, with the browser
  pane hidden and four animation frames a second; the same build loaded from
  a page in front. The check is wrapper 1.1.0's own, after its backup
  autosave. The cause was not traced further.

Seen during the hand checks of slice 2, and not changed:

- The game's language screen moves on by itself after about half a minute. A
  save made there shows the next screen soon after a load.
- A player alone hears from the autosave every 15 s: the page catches up
  after it, with the sound at zero meanwhile, and shows "Catching up to the
  live race…" for a quarter to half a second. Autosave and catch-up are
  unchanged from wrapper 1.1.0; the slice brings them to the server's room.
  Whether the gap is heard is for the owner to judge.
- A controller kept for a player who left a multiplayer race stays kept
  until the race ends, as long as somebody is in the room.
- Wrapper 1.1.0 did not start its room with the pinned Chromium as
  `SLED_CHROME_BIN`; with the installed Chrome it did. The cause was not
  looked for.

Restore chain, as implemented and tested, including cancellation and start
failure:

| Step | What happens | On failure |
|---|---|---|
| save | The owner's browser stores a snapshot in its library, format unchanged. | n/a |
| request restore | The owner asks on a connection of its own, with the room token and its seat key. The server checks the capability: owner, connected, the only peer, no reserved seats, not racing. It takes no request while an emulator of the last load still exists, nor for 5 s after a load that did not complete. | Refused; the room is untouched. |
| validate | The server receives the bounded binary snapshot and checks format and compatibility. The live runtime keeps running. | Refused, or a 60 s transfer timeout; the room is untouched. |
| restart runtime in the same room | The room goes to `restoring` and answers new joins with a retryable reply. A new worker starts with the snapshot under the same room id, token and identity. The old worker stops only after the new one reports `listening`. | The new worker is stopped; the old one keeps the room. The owner sees the reason. |
| rejoin | The owner's client reconnects with its seat key, which stayed reserved. | The seat is released after the normal reservation rules. |
| regain owner | The owner is the first peer again; the room returns to `open`. The invitation is unchanged. | n/a |

Changed in slice 2: the request does not travel over the owner's room socket.
That socket carries the live Netplay input in binary, and behind the public
address the gateway numbers and reorders those packets, so a 4.4 MB save
cannot be sent in it. The transfer timeout was 10 s in the first draft of this
table. The other decisions of the slice are in its task plan.

Open point for P2: starting the new worker before stopping the old one needs
two emulators for a few seconds. If that cost is not acceptable on the target
hardware, the fallback is validate, explicit confirmation, stop, start, and a
fresh worker when the restored one fails. Measured in slice 2 on a 16 GB
machine and accepted there; the fallback stays unplanned until a smaller
machine says otherwise.

### P3 Browser admin and macOS launch

Scope: the local admin panel and its API, the system folder picker, the
bootstrap token exchange, the early application bundle, and the local game
client on the fixed origin.

Depends on: P1 for start and stop, P2 for the room.

Exit checks: HOST-01, APP-01, AUTH-01 and SAVE-03 from the brief; double-click
to a ready invitation without a terminal.

Slices, cut on 2026-11-21:

1. Access to the panel, and the operations behind its buttons: the one-time
   token and the session of a browser, start, stop and the configuration
   through the control listener, and proof that nothing public reaches it.
   HOST-01 and AUTH-01. In four phases. Task plan:
   `docs/superpowers/plans/2026-11-21-p3-panel-access.md`.
2. The panel and the first run: the page with its setup, the system folder
   dialog, the choice of the disc policy, start, stop, the invitation to
   copy, "Open game", quit, and the switch for starting at launch. A double
   click leads to a ready invitation without a terminal. APP-01, and SAVE-03
   with the bundle opened by a double click. The privacy prompts for a
   folder chosen in the dialog are checked here. In four phases. Task plan:
   `docs/superpowers/plans/2026-11-21-p3-panel-first-run.md`.
3. The room from the panel, and diagnostics: a new game for the room, the
   room's options (D37), stopping with players in the room, the diagnostic
   export without secrets, the checks at logout and under App Translocation,
   and the instructions for the packaged path. In four phases. Task plan:
   `docs/superpowers/plans/2026-11-21-p3-room-and-diagnostics.md`.

Each slice gets its task plan in its first session. What P2 left for P3 is
placed as follows: the meaning of a start request and the missing start
action are slice 1 (D41); "Open game" and SAVE-03 are slice 2; a new game
for the room and its options are slice 3.

Slice 1 results, 2026-11-21:

- The control listener knows two callers: a command that holds the control
  credential of the instance record, and a browser tab that holds a session.
  The launcher asks the running server for a one-time token and opens
  `http://127.0.0.1:<port>/#bootstrap=<token>`. The page trades the token for
  a session, takes it out of the address, keeps the session for its tab and
  sends it as a bearer header. No cookie exists (D38, D39).
- Hosting is started and stopped, and the configuration read and changed,
  through the listener, by either caller: `POST /api/host/start`,
  `POST /api/room/stop`, `GET` and `PUT /api/config`. The executable has the
  commands `start` and `stop`, both with `--force`, for the same routes (D41,
  D42, D43, D45).
- The status counts the room's players: connected, and away with a controller
  kept.
- `config.json` has `autoStart`. The server hosts at launch only when it says
  so.
- The panel's page is the resource directory `admin/`, staged into the bundle
  by name and served from a fixed list of four addresses, with a content
  security policy (D40). It shows that it is connected, the version and the
  state of the host. Its controls are slice 2.
- Nothing public reaches the control listener. `server/test/public-boundary.test.ts`
  asks the real gateway, its mirror listener and the game origin for every
  control route, in nine spellings, with three methods and with every
  credential a caller could bring; the control listener marks its own answers
  with a header, and no answer on the public side carries it (AUTH-01).
- A quit is final (D46), and changes of the configuration are carried out one
  at a time.

Hand checks of slice 1, on a scratch copy of the built bundle without the
tunnel program and with `SLED_SERVER_HOME` in a scratch folder:

| Check | Result |
|---|---|
| HOST-01: the bundle opened with `open`, then again, then three times at once. | One server throughout, with the same PID. Each launch that ran handed the default browser, Chrome, the panel's address with a token of its own; a few seconds later each token was used, so a trade of it answered 401 with the sentence. Of three opens at once LaunchServices ran one launcher, as in P0. |
| The page, read in the application's browser pane from a fresh address. | Connected, with the version, the state and its sentence. The address had no fragment, the tab kept a session, and no cookie and nothing in `localStorage` existed. A reload kept the session, and the pane had no earlier address to go back to. |
| The address that Chrome had used, opened in another tab. | `This page is not connected to the server. Open Sled Storm Server again.`, no session in that tab, and the first tab still answered. |
| Every tab of the pane closed. | The server ran on. |
| `stop` with one player in the room, the pinned Chromium on the owner's disc. | Refused with exit code 1: `Players are in the room: 1 connected, 0 away with a controller kept. Add --force to stop it anyway.` The room stayed open. |
| `stop --force`, `start`, `stop` on an empty room, `stop` while idle, two `start` at once. | `idle` with the game port closed, and the player read `Dedicated server stopped`. `start` opened a new room. An idle host took a stop. Two starts made one stack. |
| AUTH-01: the game page on port 8000, and a one-page stand-in on another local port, asking the control port for the status, the configuration, a session, a stop with force and a quit. | No answer could be read, no WebSocket opened, and the panel could not be framed. The server ran on with its room and nobody in it. Sent directly, the same requests were answered 403 with the Origin or the Host of another site, to a preflight too and with no access-control header, and 401 without Origin and credential. |
| `quit`. | No process of the copy and no listener left. The log held no token and no folder. |

The review of slice 1 found nothing critical. Three important defects are
fixed, each with a test that failed first:

- A start request that came after a quit request built a new stack while the
  server was quitting, and the exit then cut that stack off. A quit is now
  final (D46).
- Changes of the configuration that overlapped lost one another, reset the
  connection, and in some runs left a damaged `config.json`. They are carried
  out one at a time, and every write has a temporary file of its own.
- A start after the game files changed built the stack anew and ended the
  room with players in it, though a stop asks for `force` there. Such a start
  asks for it too (D45).

Six of the ten minor findings are fixed the same way: a folder change that
was taken under a start accepted a moment before; a second start during a
start that tried the failure once more; a configuration that could not be
written, answered by a closed connection; sessions that ended by age instead
of by use; staging that copied every file of `admin/` but the tests; and
answers that another origin could load as a resource.

Not verified in slice 1:

- The page as Chrome shows it. The Chrome extension was not connected, so the
  page that the launcher opened there was not read; that it got its session
  is known from its token, which was used. The page was read in the
  application's browser pane.
- A page of a public site asking the control port, in any real browser. The
  pane stops such a request itself, and the stand-in was a page on another
  local port. The server's answer does not depend on the browser: it was
  asked directly with that Origin.
- The launcher's own call of `/usr/bin/open`. In the hand check a script noted
  the address and ran `/usr/bin/open` with it.
- A server started by `open` that reads a game folder: the runs with a game
  were started from a shell, so that no privacy prompt was raised. The
  prompts are slice 2.
- The public address. No tunnel ran in front of the owner's disc; the
  boundary behind the gateway is tested with a stand-in tunnel program.
- `start --force`, and a start that is refused for players, on the owner's
  disc. Both have tests with the real relay and a seated player.

Open after slice 1:

- The one-time token is in the command line of `/usr/bin/open`, where another
  account of the same computer can read it with `ps` and trade it first. That
  account then has a session until the server quits, and nothing lists or
  ends sessions. The brief's threat is the public side and other sites; a
  hostile second account on the owner's computer is outside it. No fix
  without another way to hand the token to the browser.
- An older server that still runs after the application was replaced answers
  `start` and `stop` with `Not found`, and the launcher opens its page
  without a session. Nothing replaces an older server. For slice 3, before
  anything is published; the new commands and the folder route of slice 2
  get the same answer from such a server.
- A start request tries a failed room and a failed address again, and leaves
  a mirror that has given up alone. With TUN-02.
- A launch during a quit still opens a page on a server that is going away,
  as since P1. A stop, a change of the configuration and a new one-time token
  are answered while the server quits.
- `localhost:<port>` is taken as the listener's own name, as since P1. The
  panel is opened on `127.0.0.1` only.
- The message for a disc that changed, `Start the server again.`, also
  reaches guests on `/disc.zip`, as before the slice.
- `local-only` can be saved, though hosting refuses it, as before the slice.
- What a browser keeps: the address with its used token may stay in the
  history, and the tab's storage may be written to disk for a restored
  session. The token is worthless after its use; the session ends when the
  server quits.
- The minute of a one-time token is counted on a clock that may stand still
  while the computer sleeps.

Slice 2 results, 2026-11-21:

- The panel's page sets the server up and runs it: the game folder, chosen in
  the system's dialog, with the facts of its disc; the disc policy, chosen
  once, neither in advance (D16); "Start server" and "Stop room"; the
  players; the guests' link in a read-only field with "Copy invite link";
  "Open game", a link to the room on this computer (D52); the switch "Start
  the room when Sled Storm Server opens"; the details, folded; and "Quit
  server". A stop or a quit with players in the room asks first (D52), and a
  double click does not answer that question (D58).
- The server shows the system's folder dialog behind
  `POST /api/game-folder/pick`, one at a time, with a fixed script and no
  body read; a cancel changes nothing, and a quit ends an open dialog (D47 to
  D49). A dialog that fails is logged by its exit code and the number of
  AppleScript's error. A saved change of the folder or the policy returns a
  host at rest to `idle` (D50), and a start that is accepted at rest makes the
  status `preparing` at once (D59).
- The page follows the server by asking once a second (D51). What it shows is
  made as data by `admin/view.js`, and `admin/controller.js` carries out the
  buttons, one request at a time (D53 to D56). `admin/panel.js` only writes
  the view into the document, as text. The listener serves the six files of
  the page, and the bundle carries them.
- Tests: `server/test/folder-dialog.test.ts`; the route, the stand-in dialog
  and `configured()` in the listener's and the host's tests; `admin/view.test.mjs`,
  `admin/controller.test.mjs` and `admin/page.test.mjs`, which runs the page's
  script against a stand-in for the browser's document (D57); smoke tests of
  the dialog's stand-in, of a server without a dialog and of the first run as
  the page asks for it.

Hand checks of slice 2, on a scratch copy of the built bundle without the
tunnel program and with `SLED_SERVER_HOME` in a scratch folder, opened with
`open`. The default browser is Chrome; the owner watched the screen for the
first part, and the Claude extension read the page in Chrome until it went
away with the working session. The rest ran in the application's browser
pane, whose profile holds the library of saves that wrapper 1.1.0 left on
`http://127.0.0.1:8000`.

| Check | Result |
|---|---|
| APP-01: the copy opened twice. | One server with the same PID. The owner saw two new tabs with the panel and nothing in the Dock; the launcher is a `UIElement`. The page, read in Chrome: `Needs setup` with the server's sentence, no fragment left in the address, "Start server" disabled, neither policy chosen, the switch on. |
| "Choose game folder", pressed in Chrome by the owner. | The system's dialog came in front of Chrome at once. One `osascript`, a child of the server. |
| The same press made through the extension while the Claude window was in front. | The owner saw the dialog in front of that window. |
| A press in a second tab while the dialog was open. | `The folder dialog is already open. Look for it among the windows.` and no second dialog. The first tab said `The folder dialog is open…` with every control disabled. |
| Cancel. | The dialog went and `config.json` was not written. |
| The owner's disc, in a folder under `Documents`. | Saved, and the page showed its path; once the server ran, `Sled Storm (PAL), 11 tracks, 687 MB`. No privacy prompt: the owner saw none, and the log of `tccd` for the whole check holds no request for the Documents folder and no prompt for the server or `osascript`, only checks without a prompt of other services, with the server's bundle as the responsible process of `osascript`. |
| The first policy, then "Start server". | `Preparing the game files`, `Starting`, then `Running, with a problem` with `This build has no tunnel program.`, the players `0 connected, 0 away with a controller kept`, `The public address is not available yet.`, no field for a link and no copy button. |
| "Open game", in Chrome. | The game page of the room in a new tab of Chrome, without an opener or a referrer, offering to join; the panel's tab stayed. |
| SAVE-03, in the pane. | "Open game", "Join game", "Saved games": the library of wrapper 1.1.0 was listed, with the slots "made by 1.1.0" and "1.1.0 original shared-camera". "made by 1.1.0" loaded into the room after the page's own question, and the screen went to the setup of a one-player quick race, as its picture shows. |
| "Stop room" with the pane seated. | `Players are in the room: 1 connected, 0 away with a controller kept. Stop it anyway?` and "Stop anyway", which stopped the room: the room's part and the link's `href` went, and the player read `Dedicated server stopped`. |
| A double click on "Stop room", and on "Quit server", with the pane seated. | Neither answered its question, but only because the question takes two lines and pushed the button below the second click; on a button that stays in place the second click answered it. Fixed (D58), with a test that failed first. |
| The switch turned off in the page, then a quit and `open`. | `autoStart: false` in the file; the new server was `idle` with no room and nothing on port 8000. Turned on again, a quit with nobody in the room was immediate (`The server has quit. Open Sled Storm Server to start it again.`, no control left), and `open` started the room by itself. |
| "Quit server" with the pane seated. | The same question; "Quit anyway" quit. No process of the copy, no Chromium of the copy and no listener were left. The log names no folder and holds no token. |
| The `quit` command with the dialog open. | The dialog's process ended with the server; nothing of the copy was left. The page said `The server is not running. Open Sled Storm Server to start it.` |
| The invitation, on a second copy: the build's `cloudflared`, the smoke tests' synthetic emulator and stand-in room browser, a synthetic disc, ports of its own. | `Online` with the guests' link 11 s after "Start server". "Copy invite link" said `The link is copied.`, and the clipboard held exactly the `url` of `invitation`, without the control credential, a session or a folder. The link opened the game page through the public address, offering to join the room. `quit` ended the server and both tunnel programs; the page emptied the field and removed the link. |

Not verified in slice 2:

- A double click in Finder. The copies were opened with `open`, which goes
  through LaunchServices as a click does; the owner also opened the build in
  `dist/` from Spotlight once, which started a server of its own with the
  real data folder (it was quit; it had no configuration).
- A privacy prompt. None came on this Mac, which is enrolled in device
  management; why none came is not known, and the privacy database could not
  be read. On another Mac the server, or `osascript` on its behalf, may be
  asked about the Documents folder, and what a refusal then does is not seen.
- A folder without a disc chosen in the real dialog. The refusal and its
  sentence were seen with the dialog's stand-in in phase 3, and are tested.
- The page in Chrome after the folder was chosen, and SAVE-03 in Chrome:
  Chrome's profile holds no library on port 8000. The rest was seen in the
  application's browser pane. The page in a browser other than these two.
- A clipboard that refuses, a computer that sleeps with the page open, and a
  server that is killed with the dialog open.
- The fixes of the review, and that of the double click, by hand: the hand
  check ran the build from before them; each is covered by a test that failed
  first.
- A held key on a button in a real browser: the page cancels its repeats
  (D58), which is tested against the stand-in only.
- The game through the public address with a real emulator: the invitation
  was checked in front of the synthetic emulator, as in P1 and P2.
- A folder with letters beyond ASCII chosen in the real dialog. `osascript`
  run with an empty environment, as a server opened by LaunchServices has
  one, printed such a folder byte for byte.

The review of slice 2, on Opus 5.5 from a diff against the snapshot of slice
1, found nothing critical. A first reviewer on Fable 5.2 was stopped by the
model's usage limit before it wrote anything, and one new reviewer ran in its
place. Its one important finding is the double click on "Stop room" and
"Quit server" that the hand check had found, to which it added a held Enter
key; both are fixed (D58). Of its seven minor findings all are fixed, each
with a test that failed first:

- The reading right after an accepted start could still show `Stopped` with
  "Start server" enabled (D59).
- A sentence about the folder dialog outlived the dialog, after a folder was
  saved through a dialog that another tab had opened (D53).
- A quit with the dialog open answered the waiting request with
  `The folder dialog could not be opened.`; it now gets
  `The server is quitting.`
- The page said `The public address is not available yet.` after the address
  had failed or without a tunnel program; "yet" is said only while the
  tunnel starts or tries again.
- The server's sentence for `local-only` named `shared-allowed`, a word that
  the page does not show; it now names the page's first choice as well.
- A tab whose server was started anew on another port said for ever that the
  server is not running; it now says that it cannot reach the server.
- A dialog that failed left no trace in the log (D48).

Not taken from the review: a pause before the question's button is armed
(D58 says why); letting Quit be pressed while the folder's request is under
way (D54 stands); fewer readings from a tab whose server is gone; a bound on
the requests of the other buttons.

Open after slice 2:

- No privacy prompt came on this Mac, and why is not known. What macOS asks
  on another Mac, for which program, and what a refusal does to a pick or a
  start, is to be seen before anything is published.
- A server that is killed leaves an open folder dialog on the screen; its
  answer is ignored (D48). No guard process is spent on it.
- With the folder dialog open, the page cannot quit the server; the `quit`
  command or a reload of the page can (D54).
- A button's request that the server never answers keeps the buttons
  waiting until the page is loaded again (D56). The only route that may hold
  is a change of the configuration on a folder that does not answer, as since
  slice 1.
- A tab whose server is gone asks once a second for as long as it is open,
  and the browser writes a line into its console each time.
- The quit route is unconditional, and the page asks about players from the
  status that it last read (D52). Slice 3.
- A disc is checked for being the supported one at the first start, not when
  the folder is chosen; the page shows what it is once the server ran.

Slice 3 results, 2026-11-21:

- A quit with a player connected or a controller kept needs `force` at the
  server, as a stop does: `POST /api/host/quit` answers 409 with the counts,
  and the command is `quit [--force]`; a signal from the system still quits
  (D60).
- `New game` on the page, `POST /api/room/new-game` and the command
  `new-game [--force]` end the room's session and open the next one at once
  under the same links; the players read `The host started a new game. Open
  the invitation again to join.` (D61).
- The room's options (progress, separate cameras) are saved in `config.json`,
  changed only at rest, applied at a start and named by the status; any disc
  but the verified PAL one plays with the original progression and a shared
  camera (D62, D66).
- `Save diagnostics` on the page, `POST /api/diagnostics/export` and the
  command `diagnostics` give a report without folders or secrets; the command
  makes one when no server runs (D63, D67, D70).
- A launch that finds a server of another build replaces it when its status
  says that nobody is in its room, and keeps it otherwise (D64, D71).
- A stop, a new game and a quit ask from the server's 409; Quit can be sent
  while the folder dialog is open; a press ends once the page shows what the
  server said after it (D65, D68). A server serves the page of its own build
  for as long as it runs (D69).
- `docs/sled-storm-server.md` is the owner's guide to the packaged path.
- Tests: `server/test/diagnostics.test.ts`; the keeper's, the host's, the
  listener's, the configuration's and the launcher's tests of the above; the
  page's view, controller and page tests; smoke tests of a quit with a seated
  player, a new game that keeps the links, the report, a launch of another
  build, and the first run as the page asks for it with the new controls.

Hand checks of slice 3, on scratch copies of the built bundle without the
tunnel program, with `SLED_SERVER_HOME` in a scratch folder and the owner's
disc, in the application's browser pane. The owner allowed the checks to run
alone; the Claude in Chrome extension was not connected, so nothing was read
in Chrome.

| Check | Result |
|---|---|
| The room's options while a room runs, and at rest. | Disabled while the room ran, enabled once it was stopped. |
| `Original progression` without separate cameras, then "Start server". | The room's status and its local link said `progress: original`, `camera: false`. |
| `All content unlocked` with separate cameras, on the verified PAL disc. | The local link carried `nativeCamera: true`. A Start pressed while the options' request was under way did nothing, as the buttons wait for a request (D56); pressed again, it started. |
| "New game" with the pane seated. | `Players are in the room: 1 connected, 0 away with a controller kept. A new game disconnects them. Start one anyway?`; "New game anyway" said `A new game is starting in the same room. The links stay the same.` The player read `The host started a new game. Open the invitation again to join.` The local link was byte for byte the same, and the same link joined again and played. |
| "Quit server" with the pane seated. | `POST /api/host/quit` answered 409, then `Players are in the room: 1 connected, 0 away with a controller kept. Quit anyway?`; "Quit anyway" quit. No process of the copy and nothing on port 8000 were left; the player read `Dedicated server stopped`. |
| "Save diagnostics". | In the pane the page said `The browser saves the diagnostic report as sled-storm-server-diagnostics-2026-11-21.json.` with no console error, but the pane saved no file. In the pinned Chromium, driven by a scratch script, the same press saved the file (5148 bytes) with no violation of the content security policy. It holds no folder, home folder, user name, room name or token, instance token, fragment, `bootstrap` or `trycloudflare`; its 13 hexadecimal runs are all checksums of the runtime manifest. |
| Quit with the folder dialog open, on a copy opened with `open`. | The page said `The folder dialog is open. Look for it among the windows.` with every control disabled but Quit; Quit ended the server and its `osascript`, and nothing of the copy was left. A first dialog was answered by somebody at the screen before Quit could be pressed; it saved a folder into the scratch home only. The log of `tccd` holds no request for Documents, only checks without a prompt. |
| A replaced application, the old server of the slice 2 build (rebuilt from the snapshot), the pane seated. | The bundle was replaced in place by the current build and opened: the old server kept running and its page opened; from the shell the launcher said `A server of another build is running and somebody may be in its room, so it keeps running.` |
| The same, after the player left. | Opened again: the old server logged `Stopped.` and the new one `Ready` a tenth of a second later on a new port, with the new build in its record; one server, nothing of the old stack left, and the new page with its new controls. |
| The page that the kept slice 2 server serves. | The new build's page, read from the replaced bundle: "New game" said `Not found`, and "Quit server" quit at once with a player seated, because the slice 2 quit does not ask. This led to D69. |
| App Translocation: a copy re-signed ad hoc, every file quarantined. | `spctl` rejected it; `open` left a launcher waiting under `AppTranslocation`; the owner chose "Open Anyway" in System Settings. macOS then opened the copy by itself, without the variables of `open --env`, so that server used the real data folder (no configuration) and was quit; its page files were served from the translocated bundle after its launcher had ended. |
| The approved copy opened again with the scratch home. | No dialog. The server ran from the translocated bundle with no launcher left, opened the room (its Chromium from the same place), took `new-game`, `stop` and `start`, and the pane joined and played. `quit` without force refused with the sentence; `quit --force` quit. |
| A real logout, with a copy of the final build serving a room and the pane seated. | The owner logged out and back in. The server logged `Stopping: SIGTERM.` 0.17 s after loginwindow's point of no return and `Stopped.` 76 ms later; no process of the copy and no instance record were left. loginwindow listed the copy's Chromium among the processes to quit, failed to terminate it, and went on; it ended with the server. macOS did not wait: the applications quit in 3.6 s after the confirmation, and the logout was complete 3.2 s after the server had stopped. The owner saw nothing but the usual question. |

Not verified in slice 3:

- Chrome, and anything on the screen: the extension was not connected, so the
  Gatekeeper dialogs, the page that macOS opened after "Open Anyway" and the
  Dock were not seen. The file of "Save diagnostics" was saved by the pinned
  Chromium; the application's browser pane saves no download.
- A double click in Finder: the copies were opened with `open`.
- The review's fixes by hand: the hand checks ran the build before them; each
  is covered by a test that failed first.
- A replaced application whose old server is of this build or later, with a
  player seated: that it keeps its own page (D69) is shown by a unit test.
- A new game during a save's load, and the options with a disc other than the
  verified PAL one, by hand: both are tested, the second end to end with a
  synthetic disc.
- A privacy prompt on another Mac, as after slice 2.
- A logout with a server opened by a double click: the server of the logout
  check was started from a shell of the desktop application, so macOS counted
  its Chromium among that application's processes. A server that
  LaunchServices started may be ended in another order; the signal and the
  quit it causes are the same code.

The review of slice 3, on Opus 5.5 from a diff against the snapshot of slice
2, found nothing critical. A first reviewer on Fable 5.2 was stopped by the
model's usage limit before it wrote anything. Its important finding is the
page that a kept old server serves from a replaced bundle, which the hand
check had found the same day; it is fixed (D69). Of its five minor findings,
three are fixed, each with a test that failed first or, for the guide,
checked against the code: the quadratic filter of the report (D70), an
accepted but slow quit reported as refused (D71), and two sentences of the
guide. The stale stage row is closed by these records. Its two missing tests
of the keeper are one new test, which passed at once and failed when the
guard it pins was removed. Not taken: three emulators for up to 5 s when a
new game is asked during a load (below). On the smoke test that failed twice
it found no race beyond the two that phase 3 closed.

Open after slice 3:

- A new game asked during a save's load can run three Chromium processes for
  up to 5 s: the room's stop returns before its browsers have left. Fixing it
  needs the relay in `research/network` or a count of workers in the keeper.
- A server of the slice 2 preview build that keeps running after the
  application was replaced serves the new page: its "New game" says `Not
  found`, and its "Quit server" does not ask about players. Only that
  unpublished build does so; from this build on, a server keeps its own page
  (D69).
- A server that keeps running after the application was replaced serves the
  game page (`web/`) from the replaced bundle; a player who opens its link
  again gets the new client. The guide says to replace the application when
  nobody plays.
- macOS opens an approved quarantined copy by itself, and the translocation's
  mount stays after the server quits, until macOS removes it.
- The smoke test `the first run, as the page asks for it` did not fail again
  in this phase; `verify` keeps the output of the next failure.
- What slices 1 and 2 left open stands, but for the quit that did not ask the
  server (D60, D65).

### P4 Independent data sources

Scope: split room mode from client disc policy, own CUE/BIN or ZIP in dedicated
rooms, loopback delivery under `local-only`, shared identity fixtures, safe
archive checks. Exit checks: DATA-01 to DATA-04 and DATA-09.

Depends on: P2 for the room and its identity, P3 for the policy in the
configuration and the panel. The chunk routes, resumable delivery and a
limit on the host's active delivery are P5.

Exit checks, as the brief's stage table puts them: one room accepts players
from mixed sources, and `local-only` gives no disc away and does not stop
the room's emulator from loading it.

Slices, cut on 2026-11-21:

1. Hosting under `local-only`: the policy no longer blocks a start and
   decides only how the public gateway runs; the room's emulator and the
   owner's page on `127.0.0.1` load the disc over loopback; the gateway
   refuses every way to the disc and says so in the session info, and an
   invited player's page then asks for its own CUE and BIN files (D72 to
   D74). DATA-01 and DATA-09, and two of the three sources of DATA-02 in one
   room. In three phases. Task plan:
   `docs/superpowers/plans/2026-11-21-p4-local-only.md`.
2. A player's own ZIP, read safely, and one disc identity for the server and
   the page: a reader in the page for a ZIP of the player's (stored and
   deflated entries, a CUE in a folder of the archive), bounded sizes, the
   checks of DATA-04 (a name that leaves the archive's folder, an entry
   larger than its bound or than it declares, two entries of one name, no or
   two CUE sheets), each entry's checksum, the exact copy of the server's
   archive kept as the fast path, and fixtures that the server's tests and
   the page's tests both read (ASCII and Unicode names, the order of the
   tracks, damaged data). DATA-03 and DATA-04, and DATA-02 for the modules.
   In three phases. Task plan:
   `docs/superpowers/plans/2026-11-21-p4-own-zip.md`.
3. The player's screen and one room from mixed sources: the three choices of
   the brief's §11.2 (my game files, a saved ZIP, the server's download only
   where it is allowed), a chosen copy used again without a new picker or a
   new download, and one room with players from all three, by hand with the
   owner's disc. DATA-02 end to end and the stage's exit checks. In three
   phases (D87 to D91). Task plan:
   `docs/superpowers/plans/2026-11-22-p4-mixed-sources.md`.

Each slice gets its task plan in its first session.

Slice 1 results, 2026-11-21:

- DATA-09: the server hosts under `local-only`. The disc policy no longer
  blocks a start and decides only how the public gateway runs (D72); the
  room's emulator and the owner's page on `127.0.0.1` load the disc from the
  loopback listener under both policies.
- DATA-01: through the gateway under `local-only` every way to the disc is
  refused: `/disc.zip` by GET and HEAD, with a query, a trailing slash, dot
  segments, percent-encoding and capitals, and the routes P5 will add, with
  the access cookie 403 and without it 401. `//disc.zip` is read by the
  gateway as another host's address with the path `/` and answers the game
  page, never the disc. Shown in the host test, the gateway test and the
  packaged smoke test, and by hand.
- A gateway in its `local` mode marks `/session-info` with
  `X-Sled-Disc: local` (D73), and the page then plays the session as `local`
  (`sessionDiscMode` in `web/local-disc.js`), asking for the player's own CUE
  and BIN files. The session info keeps `discMode: 'shared'` and the
  archive's checksums (D74).
- Two of the three sources of DATA-02 in one room: the loopback download and
  a guest's own files, by hand with the owner's disc.
- Nothing of the room depends on the policy: the host test shows the same
  loopback session info and the same local link, but for the room's own
  name and token, under both.
- The panel's note and the guide describe the second policy: a guest's
  files must be the host's files under the same names, and the guest's page
  takes only a CUE of eleven tracks, as on the Europe disc.
- Tests: the gateway's header in `research/network/gateway.test.mjs`;
  `local-only hosts: …` in `server/test/host-service.test.ts`; the gateway's
  list per mode in `server/test/emulator-assets.test.ts`;
  `web/local-disc.test.mjs`, the first tests of `selectedDisc`; the panel's
  note; and the smoke test `the packaged server hosts under local-only, and
  its gateway gives no disc away`.

Hand checks of slice 1, on a scratch copy of the built bundle whose tunnel
program was the tests' stand-in (it opens nothing and names a host that does
not exist; the public probe was off), so that `invitation` printed the
guests' link and its access path could be taken on the gateway's own
loopback port; `SLED_SERVER_HOME` in a scratch folder, the owner's disc,
`local-only`. The owner watched the owner's page in the application's
browser pane; the other players ran in the pinned Chromium, driven by
scratch copies of `server/scripts/room-player.mjs`.

| Check | Result |
|---|---|
| A start on the game port 8100 and the relay's port 8104. | The room's real emulator did not start in 75 s, and the room restarted. The page reaches the room's relay on port 8006 only from port 8000, and from another port at `/netplay` on its own origin, which only the gateway serves. Not a matter of the policy; open below. |
| A start on the default ports. | `online`, the room open 4 s after the start, its emulator in the bundle's Chromium on the loopback origin. |
| The owner's page in the pane, on the local link. | No file choice; joined as controller 1 and played. Its disc came from a copy that the pane's profile already kept for `127.0.0.1:8000`. |
| The same link in a fresh profile of the pinned Chromium. | No file choice; `Downloading game data`, a request for `/disc.zip` on loopback, then controller 2, two players. |
| A guest through `http://127.0.0.1:<gatewayPort>/access/<token>`. | The page showed the file choice and hid the game data choice; the owner's CUE and eleven BIN files, given through `DOM.setFileInputFiles`, were verified, and the guest joined the same room as controller 2. It asked for no `/disc.zip`. |
| A race. | From the owner's page `multi-player quick race`; the guest's X, sent through the protocol, put its rider in the second slot; the race on Pine Valley started and both throttles were held for 6 s. The owner's page showed 47 km/h; the two pages' frame counts were 20762 and 20731, read 0.67 s apart. The guest stayed 420 s, LIVE to the end. |
| `/disc.zip`, `/disc.zip?x=1` and `/%64isc.zip`, asked from the guest's page. | 403 each time, in three runs. |
| The copy's log, and `tccd`. | No access token, room name, room token or host name in the log; nothing about the bundle in the log of `tccd`. |

Not verified in slice 1:

- A real tunnel: the gateway was reached on its loopback port, with the
  tests' stand-in for `cloudflared`. A guest through Cloudflare goes through
  the same gateway and the same list.
- The guest's own screen during the race: its Chromium had no window. Its
  input reached the game (its rider joined), and both pages counted the same
  frames.
- A full race to its end, a save and a load, a stop, a start and a new game
  under `local-only` by hand; the policy is read in one place, and the
  room's code is the same under both (review, focus 2).
- A guest with the same disc under other file names, by hand: the disc's
  identity counts the names, so the room refuses it (ROOM-05).

The review of slice 1, on Opus 5.5 from a diff against
`.superpowers/sdd/p3-slice-3-tree.tar`, found nothing critical or important
and no target form that reaches the disc. A first reviewer on Fable 5.2 was
stopped by its usage limit before it wrote anything. Of its five minor
findings, four are fixed: the note and the guide say what a guest's files
must be (a page test failed first), a panel test no longer shows the old
refusal, the host test compares the two policies (it passed at once and
failed when the session info or the link was made to depend on the policy),
and decision 5 of the task plan says what happens to `//disc.zip`. The
fifth, a gateway that answers 400 to a target that does not start with a
single `/`, is not taken: the gateway is shared with the Python launcher,
and `//disc.zip` reaches only the page.

Open after slice 1:

- Settled in slice 2, phase 1 (D75): a host whose disc's CUE does not list
  eleven tracks could host under `local-only`, but no guest could join it,
  because the guest's page took only such a CUE. The page now takes any disc
  the server takes.
- `SLED_SERVER_GAME_PORT` other than 8000 leaves the room's real emulator
  without its relay (see the hand checks). Only tests and hand checks set it,
  with the stand-in worker, which does not use the page's relay address.
  Hand checks with the real emulator keep the default ports.
- An automated test that the page behind `X-Sled-Disc: local` never asks for
  `/disc.zip` needs a real browser; the smoke test checks the page's code as
  text, and the hand check shows the behavior.
- The gateway reads `//disc.zip` as another host's address and answers the
  page; harmless, and recorded in decision 5 of the task plan.

Slice 2 results, 2026-11-22 (its hand checks on 2026-11-21):

- DATA-02 for the modules: the server and the page take a disc by one
  module, `web/disc-sheet.js` (D75 to D77): one CUE whose `BINARY` lines
  name 1 to 99 tracks beside it, at most 1 MiB of CUE and 1 GiB in all, a
  track found by its name in NFC and lower case. The rule that a player's
  CUE lists eleven tracks is gone, which settles the first item of "Open
  after slice 1". `web/disc-identity.fixtures.json`, written by
  `server/scripts/disc-fixtures.py` with the Python launcher's serialization
  as an independent oracle (D78), pins the identity for the server's folder,
  the page's own files and the page's ZIP reader alike.
- DATA-03: a player's own ZIP is read in the page by `web/disc-zip.js`
  (D79 to D83): stored and deflated entries, the CUE in a folder of the
  archive, names in UTF-8 with or without the flag, Finder's `__MACOSX` and
  AppleDouble entries ignored, each entry read once and checked against its
  declared size and CRC-32, and the disc handed to the emulator as the
  player's own files are, as separate `File` objects. The game files field
  takes one ZIP (`chosenDisc` in `web/local-disc.js`; `accept` is
  `.cue,.bin,.zip`), and the reader's refusal is the status the player sees.
- DATA-04: a damaged layout, ZIP64, several parts, encryption, a method
  other than stored and deflated, a name that leaves the archive's folder,
  two entries of one name, no CUE or two, a missing track, sizes over the
  bounds, a wrong CRC-32, an entry that inflates past its declared size and
  entries that overlap are refused with a message that says what to do; 57
  archives in the fixture file, five from real tools on this Mac. A browser
  that cannot inflate refuses a deflated ZIP with a message of its own.
- The exact copy of the server's archive keeps its fast path: `discFromZip`
  compares it with the manifest that the session info announces (D74) and
  hands it to the emulator as `/disc.zip` is; the session info identifies
  it. Any other ZIP takes the general path, and its refusal is final.
- D85: a CUE that is not text (a control character other than tab, the line
  ends and the DOS end-of-file mark) is refused by the server and the page,
  because the emulator unpacks its game file itself when it starts as a ZIP,
  7z or RAR archive. Found while checking how the emulator takes the files,
  before the field was wired.
- D86: a deflated entry goes to the browser's blob store 16 MiB at a time,
  measured by hand first.
- The game files field: "or one ZIP that holds them" in its help, the
  lobby's description, the panel's note under `local-only` and the guide;
  "1 file selected" for one file.
- Tests: `web/disc-sheet.test.mjs`, `web/disc-zip.test.mjs`,
  `web/local-disc.test.mjs` (`chosenDisc`), `web/disc-identity.test.mjs` and
  `server/test/disc-identity.test.ts` on the shared fixtures; the server's
  streamed archive pinned equal to the generator's; the gateway's list and
  the smoke test serve `/disc-sheet.js` and `/disc-zip.js` to a guest, with
  the field's `accept`.

Hand checks of slice 2, alone, with the owner's consent to temporary ZIPs of
the disc in the session's scratch folder, deleted after the check. Time and
memory in the pinned Chromium, headless, one browser per source
(`.superpowers/sdd/2026-11-21-p4-own-zip/zip-bench.mjs`); the guest on a
scratch copy of the bundle rebuilt after D86, with the tests' tunnel
stand-in and the probe off, the real emulator, the default ports, the
owner's disc and `local-only`, through the gateway's loopback port
(`guest-player.mjs` beside it).

| Check | Result |
|---|---|
| A synthetic disc of 687 MiB in 11 tracks (a 283 MiB data track half random and half a pattern, ten random tracks): own files, a stored ZIP (687 MiB), a deflated ZIP (547 MiB). | One identity for the three. Own files: identity 1.0 s, nothing kept. Stored: read 0.62 s, identity 1.0 s, +24 MiB kept. Deflated, as phase 2 wrote it: read 0.93 s, +1.5 GiB kept, of which the renderer's +818 MiB stayed after the disc was released. |
| The same with the reader of D86. | Deflated: read 0.84 s, identity 0.73 s, +0.94 GiB kept (the browser's blob store +690 MiB, the disc's size, freed on release; the renderer +255 to +273 MiB), read peak +0.93 GiB, identity peak +1.5 GiB. |
| The owner's disc: its own files, the byte copy of the server's archive (stored), and a ZIP made by Finder's Compress (`ditto -c -k --sequesterRsrc --keepParent`, deflated, 612 MiB). | One identity for the three. Own files: identity 1.07 s. The server's copy: read 0.63 s, identity 1.13 s, +38 MiB kept. Finder's ZIP: read 2.94 s, identity 0.76 s, +0.94 GiB kept. |
| A guest with the copy of the server's archive. | The fast path: `Comparing the ZIP with the room's archive...` for about 1 s, controller 1, LIVE 6 s after the start button, frames counted for 64 s. |
| A guest with Finder's ZIP. | The general path: the tracks checked in about 2.2 s and identified in 1.3 s, the room took the identity, controller 1, LIVE 5.7 s after the button, 67 s of frames with one catch-up of 1 s. |
| A guest with the server's copy, one byte flipped in its middle. | Refused at once: `A file in the ZIP is damaged: <track 3>. Copy or download the ZIP again, or choose your CUE and BIN files instead.` (the script cut it at 100 characters; the rest is the code's); no join. |
| `/disc.zip`, `/disc.zip?x=1`, `/%64isc.zip`, asked from each guest's page, and the page's own requests. | 403 each time; no page asked for the disc before the probe. |
| The copy's data folder, and the TCC log since the copy's server started. | No access token, room name, room token or host name in its 194 files; no line about the bundle in the TCC log. |

Not verified in slice 2:

- What a person sees on the guest's screen: its Chromium had no window; the
  page's status and frame counts were read through the protocol.
- The review's fixes by hand: they came after the hand check and change the
  refusals of contrived archives and three messages, not the paths that the
  guests took; the automated checks cover them.
- A real tunnel, a race with a second player, and a full session's memory:
  the emulator keeps its own copy of the disc in its file system on top of
  every source.
- A ZIP whose CUE sits deeper than one folder, or made on Windows or Linux by
  hand: the fixture file holds folders from `zip` and Python's `zipfile`, and
  names in a legacy code page are refused by design (D80).

The review of slice 2, on Opus 5.5 from a diff against
`.superpowers/sdd/p4-slice-1-tree.tar`, found nothing critical or important:
the four focus items hold, and each hostile fixture is refused at the check
its name describes. A first reviewer on Fable 5.2 stopped at once on its
usage limit and wrote nothing. Its four minor groups are all fixed, test
first: three edge cases of the shared rule that the server and the page
decided apart (a CUE that lists itself, two byte order marks, a track name
with a tab; now in `cueTrackNames`, D85); five checks of the reader that no
fixture reached (eight new hostile archives, one per condition, each shown
by a mutant that only it kills); two messages (a name refused for a control
character, a name that is not UTF-8); and a raw error in a browser without
`DecompressionStream('deflate-raw')`. Set aside by the reviewer: the size of
Chrome's inflated chunks before the bound is checked (bounded, needs a
browser), `#` and `?` in a CUE's name (the emulator's, before the slice),
the recorded costs of D80 and D86, case folding beyond `toLowerCase` (D77),
the host's own manifest, and no unit test of `web/app.js` (the hand check
shows its paths).

Open after slice 2:

- A deflated ZIP keeps the disc's size in the browser's blob store while the
  game runs (D86), which the player's own files and a stored ZIP do not.
  Settled in slice 3 (D90): the reader says what each item keeps, and the
  page tells the player.
- The TCC log of 2026-11-21 holds five requests for the Documents folder by
  the bundle's identifier, between 21:16 and 21:25 local, each prompted and
  allowed (`authValue=2`), from copies of earlier hand checks (two scratch
  folders of another chat and one under `/var/folders`, where macOS
  translocates a quarantined copy). P3's records say that no privacy prompt
  came on this Mac; which check raised them, and whether a person saw a
  dialog, is not known. Read before anything is published, with "what macOS
  asks for a folder on another Mac".

Slice 3 results, 2026-11-22:

- DATA-02 end to end: one dedicated room took four players whose disc came
  three ways (the owner's page and one guest by the server's download, one
  guest's own CUE and BIN files, one guest's ZIP made by Finder) and raced
  them; the room compares the disc's identity, not the way it came (by hand,
  below). In the page, `web/disc-source.test.mjs` gives the room's identity
  for the files, a deflated ZIP and the exact copy of the server's archive.
- The player's screen (D87): the Game files tab holds "Use my game files",
  "Use saved ZIP" and "Download from server", the last only where the
  session offers the disc; the choice made last on the address is
  preselected while it is offered, else a copy remembered there, else the
  download where it is, else the player's files. The launch summary's "Game data" row names the choice and
  whether it is ready; Join with nothing chosen opens the tab and says what
  to choose. Under `shared-allowed` a guest may now play from their own
  files or ZIP.
- A chosen copy is remembered by its handles (D88): where the browser has
  `showOpenFilePicker`, a copy that the page has checked is kept for the
  address in IndexedDB as its handles and the identity they gave, never as
  bytes; a later visit uses it without a picker while access holds and asks
  again with Join's click when it must. Wrapper 1.0's saved ZIP record is
  read as a saved ZIP.
- A chosen copy is compared with the room's disc before joining (D89): as
  soon as it is chosen, and at Join for a copy from an earlier visit; another
  disc, or a remembered copy changed since, is refused with a message that
  says what to use, and nothing else is tried in its place.
- A compressed ZIP says what it costs (D90): the reader's items carry
  `held`, and a deflated ZIP's notice says how much the browser keeps while
  the game runs and what avoids it. This settles the first item of "Open
  after slice 2".
- The download stays as 1.1.0 does it (D91); the Quick Tunnel dialog's "Use
  existing ZIP" chooses the saved ZIP source, and a ZIP saved after a
  download becomes the remembered saved ZIP.
- The panel's note under `local-only` and the guide ("What your guests
  choose") describe the guest's choices.
- Tests: `web/disc-source.test.mjs` (the sources offered and preselected,
  DATA-02 in the page, D89's refusal, a copy remembered, restored, asked
  again, refused, missing or foreign, wrapper 1.0's record, a store that
  refuses); `held` in `web/disc-zip.test.mjs`; the panel's note; the
  gateway's list and the smoke test serve `/disc-source.js`, the group and
  both inputs to a guest under `local-only`.

Hand checks of slice 3, alone and headless (the owner was away until 10:00
and asked that nobody be waited on), on a scratch copy of the built bundle
with the tests' tunnel stand-in and the probe off, the real emulator, the
default ports, the owner's disc and `SLED_SERVER_HOME` in a scratch folder.
Every player ran in its own pinned Chromium, driven from a command file by
`.superpowers/sdd/2026-11-22-p4-mixed-sources/player.mjs`; the guests came
through the gateway's loopback port. The picker was a page script that
answers handles of the origin's private file system, into which the driver
had copied the disc, as the task plan foresaw; their access is always
granted. A temporary ZIP of the disc was made in the chat's scratch folder,
as the owner allowed in slice 2, and deleted after with the browsers'
profiles.

| Check | Result |
|---|---|
| The first try. | The bundle that phase 2's last full check built held the old guard of `selectDiscSource`: the page's file had been put back for the scripted load's check of the old code while that run built the bundle. A copy chosen from inside the closed Game files tab left the download's radio checked. Rebuilt; the page's and the panel's files then equal to the tree; everything below ran on the rebuilt bundle with fresh profiles. |
| Each page under `shared-allowed`. | Three choices, the download preselected. |
| The owner's page on the local link. | One request for `/disc.zip` on loopback, then LIVE as controller 1. |
| A guest with a copy of another disc (synthetic, through the file input). | Refused at once with `These game files are not the disc this room plays. Use the host's CUE and BIN files under the same names, or a ZIP of them.`; "Use my game files" chosen, its summary `choose files`. |
| A guest with its own CUE and BIN files (the picker). | Checked in about 2 s, `12 files · checked.`, controller 2; no request for `/disc.zip`. |
| A guest with Finder's ZIP (`ditto -c -k --sequesterRsrc --keepParent`, 612 MiB, deflated, the picker). | Checked in about 4 s, with D90's notice (`about 721 MB`), controller 3; no request for `/disc.zip`. |
| A guest with the download through the gateway. | One request for `/disc.zip`, controller 4. |
| A race. | Four players; from the owner's page `multi-player quick race`, each player's X put a rider in its slot, the race on Pine Valley started, and every throttle was held for 6 s. The four pages' frame counts were 12346 to 12441, read within 2 s; the owner's and the ZIP guest's screens each showed their own sled. |
| Reuse. | Each guest returned to the lobby (the page reloads), set the image filter to CRT and joined the running race again: the files and the ZIP came back as `from your last game` with no new picker, the download from the browser's kept copy with no new request; controllers 2, 3 and 4 again. |
| A remembered copy changed since: one byte in the middle of its largest file. | Join refused it: D89's message for the files, `A file in the ZIP is damaged: …` for the ZIP; nothing played, no request for the disc; a second Join refused again. |
| `local-only` (hosting restarted, so a new gateway port). | A fresh guest: two choices, its files preselected, `This session does not offer the disc…`; picked its files and joined as controller 1 with no request for `/disc.zip`; after a reload, its copy without a picker, LIVE again. `/disc.zip`, `/disc.zip?x=1` and `/%64isc.zip` from its page: 403 each. |
| The copy's data folder and logs, and `tccd`. | None of the two invitations' host names, access paths, room names or tokens in the copy's 194 data files, its log or the players' logs; no line about the bundle in the TCC log since the first copy started. |

Not verified in slice 3:

- The real picker, Chrome's prompt to renew access after the browser is
  restarted, and whether it asks once for an address's files or once per
  file: the stand-in's handles are always granted, and nobody was at the
  screen.
- The Quick Tunnel dialog's "Use existing ZIP" and "Save a ZIP and join":
  the page shows them only on a `trycloudflare.com` address, so a real
  tunnel; the code path is the saved ZIP source's.
- Review Focus 3 on the bundle: a guest's address changes with each start of
  hosting (the gateway's port here, the Quick Tunnel's name there), so a
  remembered "download" was not met under `local-only` on one address by
  hand; the scripted load of phase 2 showed it on one stand-in address, and
  `initialSource`'s test pins it.
- A browser without `showOpenFilePicker` (Firefox, Safari): its file inputs
  and the help `The choice lasts until this page is reloaded.` are not run
  in a browser; the pinned Chromium has the picker.
- What a person sees on the guests' screens beyond four screenshots.

The review of slice 3, on Opus 5.5 from a diff against
`.superpowers/sdd/p4-slice-2-tree.tar`, found nothing critical; a first
reviewer on Fable 5.2 stopped at once on its usage limit and wrote nothing.
Its two important findings are fixed, test first. A remembered copy found
moved or deleted once access was asked again gave the browser's own error at
every Join; it is now refused with `Your game files were moved, renamed or
deleted since you chose them. Choose them again.` and the player chooses
again. A copy remembered once was preselected on later visits even after the
player chose the download, against D87, because the task plan's Task 5 put
the remembered copy first; the last choice now comes first, a ZIP saved by
"Save a ZIP and join" becomes the last choice, and a slow check of a copy
the player left no longer replaces the copy chosen after it. Of the six
minor groups, fixed: a check of a copy no longer chosen wrote the status
line, even over a running game's; messages said "join" and "Join game" on
the host's own page; the game data dialog's joins could start from another
source, and a refused "Use existing ZIP" was told only in a closed tab; Join
with a copy already refused first asked the room; each source's help was
read twice by a screen reader and the memory notice was not announced; and
three tests that were missing or claimed more than they checked. The fixes
were shown failing first by `web/disc-source.test.mjs`,
`web/lobby-markup.test.mjs` and a scripted check in the pinned Chromium
(`review-fixes.mjs` in the slice's ledger folder), and once more on the
rebuilt bundle with the real emulator: the download chosen last was
preselected after a remembered copy, and a changed copy was refused at
Join, the second Join opening the Game files tab. Not taken: an automated
test of phase 2's `selectDiscSource` bug, which needs a DOM that the page's
Node tests do not have (the scripted load shows it), and a stalled IndexedDB
keeping Join disabled at load (not seen; the database's version does not
change, so no upgrade can block it).

Open after slice 3:

- The real picker and Chrome's prompt to renew access after a restart of
  the browser, once per address or once per file, with the owner at the
  screen; whether `requestPermission` for one handle after another keeps the
  click's activation is not known.
- The Quick Tunnel dialog by hand: it needs a page on a `trycloudflare.com`
  address, so a real tunnel, which is not opened in front of the owner's
  disc; a synthetic disc can stand in.
- A browser without `showOpenFilePicker` by hand.
- An automated regression test of `lobby.selectDiscSource` (a DOM in the
  page's tests).
- From slice 2, before anything is published: the Documents folder requests
  of 2026-11-21 in the TCC log.

P4's exit checks, 2026-11-22:

- One room accepts players from mixed sources: four players whose disc came
  three ways raced in one room (slice 3, by hand); the room compares the
  disc's identity (ROOM-05), which the host's folder, a player's own files
  and any ZIP of them share (the fixtures of slice 2, DATA-02).
- `local-only` gives no disc away and does not stop the room's emulator from
  loading it: the gateway refuses every way to the disc (DATA-01, slice 1's
  tests and hand check, slice 3's probe), and the room's emulator and the
  owner's page load it over loopback (DATA-09, slice 1; slice 3's room under
  `local-only` played).
- DATA-01 and DATA-09 in slice 1; DATA-03 and DATA-04 in slice 2; DATA-02
  for the modules in slice 2 and end to end in slice 3.

### P5 Resumable delivery

Scope: chunk endpoints, bounded downloader, persistent parts, portable ZIP.
Exit checks: DATA-05 to DATA-08.

P5 goes in three slices, cut on 2026-11-22 from the brief's §11.4, §11.5
and §15.2:

| Slice | Scope | Checks | Task plan |
|---|---|---|---|
| 1 The server's chunk routes and the host's delivery limit | `GET /game-data/manifest` and `GET /game-data/<archiveSha256>/chunks/<index>` on the loopback listener, each chunk a range of the streamed archive; one limit with a bounded queue on the host's disc deliveries, which stop reading when their client goes; the gateway passes the routes' shapes in its shared mode only. | DATA-06 on the server (another archive ID, a bad index), DATA-01 for the new routes. | `docs/superpowers/plans/2026-11-22-p5-chunk-routes.md` |
| 2 The page's resumable download | A downloader with two requests at a time that checks each chunk's length and SHA-256 before it counts it, keeps the parts in the origin private file system and the progress in IndexedDB, uses the checked parts again after a reload or a cut on the same origin and fetches a corrupt one again; "Download from server" uses it where the manifest answers, and the whole `/disc.zip` where it does not (the Python launcher). | DATA-05, DATA-06 in the page. | `docs/superpowers/plans/2026-11-22-p5-resumable-download.md` |
| 3 Fallbacks, the portable ZIP and the end of P5 | The quota estimated before saving and its exhaustion, refused persistence, no private file system, a cancelled picker; the portable ZIP saved from the parts once complete; a new Quick Tunnel host name promises nothing of the old origin's parts and the saved ZIP is chosen again; what becomes of 1.1.0's Cache Storage copy; DATA-05 to DATA-08 by hand, the review and the records. | DATA-07, DATA-08, P5's exit. | `docs/superpowers/plans/2026-11-22-p5-fallbacks-portable-zip.md` |

Slice 1 results, 2026-11-22:

- The manifest and the chunks on the loopback listener (D92): `GET` and
  `HEAD` of `/game-data/manifest` answer the session info's `disc`, `pal`
  and `archive` with `version: 1`, and of
  `/game-data/<sha256>/chunks/<index>` the chunk with its exact length, both
  `no-store`. Another archive ID, an index out of bounds and every other
  spelling under `/game-data/` (capitals, a leading zero, a sign, a
  fraction, an exponent, percent-encoding, a trailing slash, an empty index)
  answer 404 before a file is opened; a private disc answers 404; game files
  changed since they were prepared answer 503 and the host is told, as for
  `/disc.zip`. DATA-06 on the server.
- A chunk is a range of the archive that the server streams (D93):
  `GameData.openChunk` reads `[index × chunkSize, min(size, (index + 1) ×
  chunkSize))` through the code that makes the whole archive and its
  hashes, so the archive's bytes, its SHA-256, its chunk hashes, the stamp
  `stored-v2` and the disc and room identities did not change. A file is
  compared with its prepared state before and after it is read, and the
  last piece read from it waits for the second comparison, so a chunk of two
  versions never arrives whole.
- One limit on the guests' disc deliveries (D94): every `GET` of
  `/disc.zip` and of a chunk that comes through the gateway, which marks
  what it forwards, runs under `createDeliveryLimit`
  (`server/src/delivery-limit.ts`): 4 at once, 16 waiting in order, any
  further one 503 with `Retry-After: 2`; a client that goes leaves the queue
  or frees its place and its reads stop; one that stops reading is cut 30 to
  60 s later. The room's emulator, the owner's page and any page on this
  computer are never queued or refused (the review's fix); a `HEAD`, the
  manifest and the session info stay outside the limit.
- The gateway (D95): in its shared mode it passes `GET` and `HEAD` of the
  two shapes, only when the path as sent is the parsed path, forwards them
  without the query and with its mark, and streams a chunk without its
  length; in its local mode it refuses them with 403. DATA-01 for the new
  routes.
- Tests: `server/test/game-data.test.ts` (every chunk its slice of the
  archive, bounds, a changed or rewritten track, an abandoned chunk),
  `server/test/delivery-limit.test.ts`, `server/test/runtime-http.test.ts`
  (the manifest, a chunk's bytes, 19 other spellings reading nothing, a
  changed disc, the limit's wait and refusal, a waiter that goes, a client
  that stops reading, a delivery on this computer and a `HEAD` outside the
  limit), `server/test/host-service.test.ts` (the hosted archive in two
  chunks of 8 MiB, a changed disc found by a chunk, `local-only`),
  `research/network/gateway.test.mjs` (4 shapes passed, 16 spellings and
  methods refused without reaching the upstream, the mark on what it
  forwards) and the smoke test through the bundle's gateway under both
  policies.

Hand checks of slice 1, phase 2 (2026-11-22, 08:35 to 08:45, alone and
headless: a scratch copy of the bundle that the phase's full verify had
built, with the tests' tunnel stand-in in `Contents/Resources/bin`, the
probe off, `SLED_SERVER_HOME` in the scratch folder, the real emulator, ports
8000 and 8006 and the owner's disc; `chunk-check.mjs` in the ledger folder
prints no hash, name, path, link or token). They ran before the review's
fix, when requests on loopback were still under the limit; since the fix
only what the gateway marks is:

| Check | Seen |
|---|---|
| The routes over loopback, `shared-allowed` | The manifest equals the session info's `disc`, `pal` and `archive`; 86 chunks of 8 MiB, each with its exact length and the manifest's SHA-256; together the archive's SHA-256 and the bytes of `/disc.zip`. |
| Eight chunk requests at once | Four answered within 4 ms, four waited and were answered as places freed; every chunk whole and matching; the server's resident memory 206 MiB idle and at its peak. |
| A client that goes in the middle of a chunk | A waiting request was answered 21 ms later. |
| Four clients that stop reading, a fifth behind them | The fifth was answered 60 s later, its chunk whole. Node lets a socket's timeout pass once when its write queue moved since the write was dispatched, so the cut comes 30 to 60 s after a client stops reading (D94's wording, changed). |
| The gateway's loopback port with the access cookie | `shared-allowed`: the manifest and a chunk (no `Content-Length`, matching); `local-only`: 403 for both; both policies: 403 for capitals, a leading zero, `%30`, `%67`, a dot segment and a trailing slash, 401 without the cookie; the loopback listener 200 throughout. |
| Secrets and privacy prompts | The copy's logs, data files and status hold none of 11 private strings (archive and chunk hashes, the disc identity, the stand-in host, the access path, the room and its token). The TCC log: no folder request and no prompt; the lines that carry the bundle's path are the room's headless Chromium's preflight camera queries and system checks of that helper, attributed to the process that started the copy. |

Not verified in slice 1:

- A real Quick Tunnel in front of the routes: none is opened in front of
  the owner's disc; the gateway's framing of a chunk rests on the
  measurements of `docs/verification.md`.
- A page that uses the routes: that is slice 2.
- A chunk of a disc changed during the hand check: the unit tests change a
  track before and during a chunk, the host-service test before one.
- The review's fix on the bundle: the room's emulator served while four
  guests hold every place was not run by hand (the hand check came before
  the review); the listener's and the gateway's tests and the smoke test
  through the bundle's gateway cover it.

The review of slice 1, on Opus 5.5 from a diff against
`.superpowers/sdd/p4-slice-3-tree.tar`, found nothing critical; a first
reviewer on Fable 5.2 stopped at once on its usage limit and wrote nothing.
Its probes held Review Focus 1 to 4: no other spelling of a chunk path
opened a file or passed the gateway, a client that went or stalled freed
its place, no chunk of two versions arrived whole, and nothing of the disc
passed a local gateway. Focus 5 did not hold: every `GET /disc.zip` shared
the four places with guests, and the room's emulator loads the disc at every
session start, with a fresh profile, under the relay's 75 s deadline, and
the owner's page counts time in the queue against its 45 s deadline, so four
guests downloading the whole disc over a tunnel (about 6 minutes each) could
make a new game or a restarted emulator fail the room. D94's cost line had
said they load it once at the start. Fixed test first: the gateway marks
every request it forwards (`x-sled-gateway`; it forwards no header of the
guest's), and the listener limits only marked deliveries, so the room's
emulator, the owner's page and any page on this computer are never queued
or refused (D94 as it now reads). The three minor findings are fixed: a
`HEAD` outside the limit that reads nothing is now tested, the bounds test
removes a track first so that it tells the order of the checks, and the
phase 1 verification row no longer says that every new test failed first.
Each new test failed before the code or was proved by a mutant; five
mutants were killed. Declined by the reviewer and left as they are: a slow
but steady guest keeps its place (P6 measures the constants); a rewrite that
keeps a file's size and time is left to slice 2's hash check; settled
spellings of `/disc.zip` pass the shared gateway, as before P5, and the
local one refuses them.

Open after slice 1:

- For slice 2: the downloader waits in the guests' queue, so its stall
  deadline must not count the time before an answer, and a 503 with
  `Retry-After` is a pause, not a failure. Today's page fits: a room has four
  players, so at most four guests download the whole `/disc.zip` at once.
  Settled in slice 2 (D96).
- The limit's numbers (4 at once, 16 waiting, 30 s idle) under real guests
  on a slow tunnel: P6 measures them.
- A real Quick Tunnel in front of the chunk routes, with a synthetic disc.
- From P4, before anything is published: the Documents folder requests of
  2026-11-21 in the TCC log, and what macOS asks for a folder on another
  Mac.

Slice 2 results, 2026-11-22:

- The downloader (D96, `web/disc-download.js`): "Download from server"
  reads `/game-data/manifest` and checks it against the session info
  (version 1, the room's `disc` and `pal`, an archive whose hashes are 64
  lowercase hex characters, whose chunk size is at most 64 MiB and whose
  chunk count fits its size) before any chunk is asked. The missing chunks
  are fetched two at a time, each read into one buffer of its manifest
  length and checked for its SHA-256 before it counts. Before an answer
  begins, the time in the host's queue has a cap of 5 minutes and no stall
  deadline; once it has begun, 45 s without a byte is a stall. A 503 with
  `Retry-After` is a pause of 1 to 30 s; a cut by the answer deadline or a
  proxy's 504 or 524 is a wait, asked again within 30 minutes per chunk;
  neither counts as a failure. A 503 without `Retry-After` stops the
  download with the host's changed-files message. A chunk's 404 reads the
  manifest again, once for both workers: the same archive is a failure of
  that chunk, another archive of the same disc starts the download over on
  it (at most twice, the old archive's parts removed), anything else stops
  it. A chunk that fails four times in a row stops the download and keeps
  every checked part. Where the manifest answers 404 (the Python launcher),
  the whole `/disc.zip` is downloaded as before, with the same deadlines.
- The parts (D97, `web/disc-parts.js`): files
  `sledstorm-parts/<archiveSha256>/<index>` of the origin private file
  system, each committed before the archive's progress record in IndexedDB
  lists it; a listed part whose file is missing or of another length is
  dropped when the store opens; an origin keeps the parts of one archive,
  held by one page at a time. A page without the private file system or
  IndexedDB, or without the lock (a second tab), keeps its parts in memory,
  and so does any page for a part that the private file system refuses to
  keep.
- The whole archive is checked chunk by chunk, and its size, before it is
  handed over (D98): a part changed on disk after it was counted is fetched
  again, and a second failed check stops the download.
- The parts are a staging area (D99): `sharedDiscFile` in `web/app.js`
  saves the returned `File` where it saved the whole download (the Quick
  Tunnel's chosen ZIP, the fixed address's Cache Storage copy) and removes
  the parts once the game has started.
- The gateway's list of page files (`research/network/emulator-assets.mjs`)
  serves `/disc-download.js` and `/disc-parts.js` to guests in both disc
  modes, since `app.js` imports them.
- Tests: `web/disc-parts.test.mjs` (19: listing only after the commit, the
  open-time checks, two parts at once, record writes in order, another
  archive, the file, drop, remove, memory, a refused write kept in memory, a
  part of another length, a second page without the lock) and
  `web/disc-download.test.mjs` (38: the fallback, two at a time, reuse
  (DATA-05), corrupt and wrong-length chunks (DATA-06), pauses, waits and
  their budget, stalls before and after the first byte, a 503 without
  `Retry-After`, another archive and a third, the manifest's checks, four
  failures across a pause, the final check and the size, storage errors, a
  stop that asks for nothing more and waits for the other worker, the whole
  download's deadlines), over stand-ins for the server, the private file
  system, the record store and the Web Locks; `research/network/gateway.test.mjs`
  (the page's imports served to guests).

Hand checks of slice 2 (2026-11-22). Phase 2, 10:04 to 10:09, alone and
headless in the pinned Chromium, on a scratch copy of the bundle that the
phase's full verify had built, with the tests' tunnel stand-in in
`Contents/Resources/bin`, the probe off, `SLED_SERVER_HOME` in the scratch
folder, the owner's disc under `shared-allowed` (86 chunks) and ports 8000
and 8006; the guest came through the gateway's loopback port. They ran
before the review's fixes. Phase 3, after the fixes: the page's own modules
in the pinned Chromium on synthetic bytes. Logs `hand-check-step*.log` and
`browser-check.log` in `.superpowers/sdd/2026-11-22-p5-resumable-download/`.

| Check | Seen |
|---|---|
| A fresh guest | The manifest 200; 86 chunk requests for 86 chunks, every answer 200; "Checking game data…" at 5.4 s; the room LIVE at 12.4 s; afterwards no archive directory and no record (D99). |
| DATA-05: the guest's browser killed with SIGKILL at 40% (downloads held to 16 MiB/s) | 34 checked parts kept (272 MiB) and a record listing 34 of 86; the same profile on the same origin asked only for chunks 34 to 85; the room LIVE; no parts afterwards. |
| DATA-06 in the page: one byte of part 0 changed on disk, its length kept, before the new start | It counted when the store opened and was not asked in the first pass; the whole-archive check found it, chunk 0 was asked once more, the second check passed and the game started (53 chunk requests: 52 + 1). |
| `python3 server.py --browser-hosted` | The manifest 404, `/disc.zip` 200 once, the room LIVE; no parts directory. |
| The review's fixes, real browser, synthetic archive of 2.5 MiB in chunks of 1 MiB | Two 524 answers and one answer slower than the answer deadline were asked again and the download completed, equal to the archive; its 3 parts were files of the private file system, listed in the record; a second store in that page and a store in another page of the origin kept their parts in memory; `discard` removed the parts and the record, after which the other page held the stored parts; a stored part counted after that page's reload. 8 of 8. |
| Secrets | The logs hold no 32-or-more-character hex string of the disc, no access path, no token, no disc file name and no tunnel host; the scratch copy, its data and the profiles (3.5 GB, with copies of the disc) were deleted; no ZIP of the disc was made. |

Not verified in slice 2:

- Anything that needs eyes: the status lines were read from the page, not
  seen.
- A Quick Tunnel origin itself, and Cloudflare's 524 after about 100 s
  without an answer: no tunnel is opened in front of the disc; the waits
  were driven with a stand-in server's 524.
- A crash of the machine or a power cut: the browser was killed, the
  system kept its writes; whether `createWritable` is atomic then is
  Chromium's.
- A private window, its quota, and a full disk: the refused write is
  tested with a stand-in that refuses `close()`; no real quota was
  exhausted.
- The review's fixes on the owner's disc through a copy of the bundle: the
  hand checks of phase 2 came before them; the unit tests, the mutants and
  the browser check on synthetic bytes cover them.
- Safari and Firefox.

The review of slice 2, on Opus 5.5 from a diff against
`.superpowers/sdd/p5-slice-1-tree.tar`, found nothing critical; a first
reviewer on Fable 5.2 stopped at once on its usage limit and wrote nothing.
Focus 1, 2, 4 and 5 held under its probes, with two exceptions. First, a
write that the private file system refused at its quota or on a full disk
failed the chunk four times, and the download stopped at the same place on
every reload, where 1.1.0's whole download into memory had worked (I1).
Second, two tabs of one invitation removed each other's parts (m1). Focus 3
did not hold for time in the queue: a request cut by the answer deadline
before its answer began, or answered 524 by a proxy, counted as a failure,
so four waits stopped the download (I2). Five mutants survived the slice's
tests (I3). Fixed: a refused part stays in memory for that page, unlisted
(D97); waits are asked again within a budget of 30 minutes per chunk, and
neither they nor pauses count as or end a run of failures (D96); one page
of the origin holds the stored parts, with a Web Lock (D97). Also fixed:
storage errors reach the player as the stopped message; both stores refuse
a part of another length, and the final check the archive's size (D98); the
abort and timer cleanups (the sleep's listener, a request after a stop, the
manifest read after a 404 aborted by a stop); a chunk size of at most 64
MiB. Ten new tests failed before the code; the others pin the review's
surviving mutants (M1 to M6, M11, M18, M29, M30) and the two cleanups; 26
mutants of the fixes and of those survivors are all killed.

Open after slice 2:

- For slice 3: the quota estimated before the download, and what the
  player is told when parts stay in memory (no private file system, a
  second tab, a refused write, refused persistence); the portable ZIP from
  the parts; whether the parts replace 1.1.0's Cache Storage copy and when
  they go (D99: removed once the game starts, when a reload is most likely,
  the review's note); a new Quick Tunnel host name promises nothing of the
  old origin's parts.
- A 503 without `Retry-After` is read as the host's changed game files
  (D92, D96), a signal that any proxy could send; a dedicated header from
  the server would be more robust (the review's note). It needs a server
  change.
- The waits' constants (5 minutes before an answer, 30 minutes per chunk, a
  retry after 1 s), Cloudflare's 524 after about 100 s, and a request asked
  again at the back of the host's queue: P6 measures them with real guests
  on a slow tunnel.
- Chrome's private-window quota, a crash of the machine during a write,
  Safari and Firefox.
- From slice 1 and P4: a real Quick Tunnel in front of the chunk routes,
  the limit's numbers, and before anything is published the Documents
  folder requests of 2026-11-21 in the TCC log and what macOS asks for a
  folder on another Mac.

### P6 Qualification and release package

Scope: clean macOS, signing and notarization when certificates exist, real
races on separate devices and networks, licenses and documentation.
Exit checks: RELEASE-01 and the manual matrix in the brief.

## Risks and open questions

| Risk | Plan |
|---|---|
| The shipped Chromium (D28): it must be signed as nested code for a notarized build, its license and credits must ship with it, it is 373 MB, and it shares the bundle identifier `org.chromium.Chromium` with a browser the user may have installed. | P6. Giving the embedded copy its own identifier when it is re-signed is the candidate fix. `chrome-headless-shell` has no application bundle and would avoid the shared identifier and most of the size, but the game must be checked on it first. |
| The end-to-end game check needs a bootstrapped emulator and a disc. | Done by hand in P1 slice 3 with one player. Races with several players are P2 and P6. |
| A detached server outlives the launcher. Its behavior at logout and under App Translocation is unverified. | Check both with the real bundle in P3 and P6. |
| The package is 556 MB unpacked and 224 MB compressed. | Recorded in P1 slice 3. Reducing it is a P6 question. |
| macOS privacy prompts when the server reads a folder chosen through a system dialog. | Test in P3 with the real bundle, signed the same way as the release. |
| SEA is in active development upstream. | Pin the exact Node.js version; rerun the SEA smoke on every pin change. |
| Intel Macs: SEA is unsupported upstream on macOS x64. | Out of scope until upstream changes; do not promise it. |

## Verification log

### Baseline, 2026-11-15, revision `acc8e35`, macOS 27.0.1 arm64

Developer tools: Node.js 24.18.0, npm 11.16.0, Python 3.9.6.

| Command | Result |
|---|---|
| `npm ci --prefix research/network` | Passed. |
| `node --test web/*.test.mjs` | 48 passed, 0 failed. |
| `npm test --prefix research/network` | 19 passed, 0 failed. |
| `python3 tools/test-emulator-server.py` | 4 passed. |
| `python3 -m py_compile server.py tools/build-emulator.py tools/play-online.py` | Passed. |
| `python3 tools/test-emulator-view.py` | Not run: needs the built native emulator sources in `.cache/pcsx-sources`. |
| Save library checks in a browser (`tools/serve-save-checks.mjs`) | Not run in P0. |
| Gameplay checks | Not run: the emulator is not bootstrapped or built on this machine. |

Note: `docs/setup.md` asks for Python 3.10+, and this machine has 3.9.6. The
Python checks above passed on it, but that does not qualify 3.9 for hosting.

### P0, 2026-11-15, working tree on top of `acc8e35`

| Command | Result |
|---|---|
| `npm ci --prefix server` | Passed from the committed lockfile. |
| `npm run typecheck --prefix server` | Passed. |
| `npm test --prefix server` | 22 passed, 0 failed on Node.js 24.18.0. The same files pass on the pinned 26.13.1. |
| `npm run build:sea --prefix server` | Built `dist/sea/SledStormServer` on Node.js 26.13.1 for darwin-arm64. The bundle has 34 modules and only built-in imports. |
| `npm run smoke --prefix server` | 5 passed, 0 failed. These run the built executable. |
| `npm run package:macos --prefix server` | Assembled the draft bundle; `codesign --verify --deep --strict` passed with an ad-hoc signature. |
| LaunchServices scenarios in the table above | Run by hand with `open` against a copy of the draft bundle and a scratch `SLED_SERVER_HOME`. |
| Baseline commands, repeated after the change | Same results as the baseline. |

### P1 slice 1, 2026-11-20, working tree on top of `3e037ab`

| Command | Result |
|---|---|
| `npm run typecheck --prefix server` | Passed. |
| `npm test --prefix server` | 89 passed, 0 failed, 0 skipped on Node.js 24.18.0, and the same on the pinned 26.13.1, after the review fixes (77 before them). The Python parity test ran against Python 3.9.6. |
| `npm test --prefix research/network` | 20 passed, 0 failed (one new test for the `origins` option). |
| `npm run package:macos --prefix server` | Built the bundle (42 modules, built-in imports only), the executable and the draft application bundle. The manifest records `emulator: null`. |
| `npm run smoke --prefix server` | 9 passed, 0 failed, rerun after the review fixes. These run the built executable, including a configured server that serves the game origin from a folder with spaces and non-ASCII characters. |
| Real disc, by hand, repeated after the review fixes | A development run of the new modules prepared the disc in `game/`: identity and PAL flag equal `shared_identity()` of `server.py`, the stream's SHA-256 equals the manifest, and Python's `zipfile` verifies every entry. The built executable then came online with the same disc (11 tracks, PAL, the same archive size) and served the whole archive over loopback HTTP. |
| Browser, by hand | The built executable served the real `web/` on port 8000 with stub emulator files. In a Chromium-based browser pane the lobby rendered, `crossOriginIsolated` was true, 31 static requests loaded and none failed, and the console showed no error. |
| Baseline commands, repeated | Same results as the baseline: 48 web tests, 4 Python tests, `py_compile`. |

### P1 slice 2, 2026-11-20, working tree on top of `4a2f21a`

| Command | Result |
|---|---|
| `npm run typecheck --prefix server` | Passed. |
| `npm test --prefix server` | 129 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1, after the review fixes (123 before them). No test opens a tunnel or uses the network. |
| `npm test --prefix research/network` | 20 passed, 0 failed. |
| `npm run package:macos --prefix server` | Built; the bundle now carries `bin/cloudflared`, and the manifest records its version and both hashes. |
| `npm run smoke --prefix server` | 12 passed, 0 failed, with a stand-in tunnel program: the tunnel comes online, `invitation` prints the link, `quit` and SIGKILL leave no tunnel program. |
| Real Quick Tunnel, by hand, before and after the review fixes | The built executable in front of stub emulator files and a synthetic disc; results under "Slice 2 results". Two temporary public addresses per run were created and closed. |
| Baseline commands, repeated | Same results as the baseline. |

### P1 slice 3, 2026-11-20, working tree on top of `4a2f21a`

| Command | Result |
|---|---|
| `python3 tools/bootstrap-emulator.py`, `tools/build-emulator.py`, `tools/prepare-emulator.py --native` (Homebrew Python 3.15.2) | Finished in eight minutes; the prepared core is in `.cache/`. |
| `npm run typecheck --prefix server` | Passed. |
| `npm test --prefix server` | 150 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1, after the review fixes and the seven minor items (143 before them). No test starts a real browser. |
| `npm test --prefix research/network` | 36 passed, 0 failed; thirteen new tests of the dedicated runtime against a stand-in browser and three of the relay. |
| `npm run package:macos --prefix server` | Built with the emulator and Chromium; `codesign --verify --deep --strict` passed with the ad-hoc signature. |
| `npm run smoke --prefix server` | 16 passed, 0 failed. Staged copies carry stand-ins for the emulator, the tunnel program and the browser. |
| Real room, by hand, seven runs, the last two on the final build | Results under "Slice 3 results". |
| Baseline commands, repeated | Same results as the baseline. |

### P2 slice 1, 2026-11-20, working tree on top of `4a2f21a`

| Command | Result |
|---|---|
| `npm run typecheck --prefix server` | Passed. |
| `node --test web/*.test.mjs` | 56 passed, 0 failed (48 before the slice). |
| `npm test --prefix research/network` | 49 passed, 0 failed after the review fixes (36 before the slice). |
| `npm run verify --prefix server` | New in this slice: every check below in one command. All 11 checks passed in 102 s on the final tree. |
| `npm test --prefix server` | 167 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1 after the review fixes (150 before the slice). |
| `npm run package:macos --prefix server`, `npm run smoke --prefix server` | Built; 17 passed, 0 failed. |
| Real room, by hand, once more on the final build | Results under "Slice 1 results" of P2. |

### P2 slice 2, 2026-11-21, working tree on top of `4a2f21a`

| Command | Result |
|---|---|
| `npm run verify --prefix server` | All 11 checks passed on the final tree, after the review fixes. |
| `npm test --prefix server` | 176 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1 (167 before the slice). |
| `npm test --prefix research/network` | 71 passed, 0 failed (49 before the slice). |
| `node --test web/*.test.mjs` | 66 passed, 0 failed (56 before the slice). |
| `npm run package:macos --prefix server`, `npm run smoke --prefix server` | Built; 18 passed, 0 failed. |
| Real room, by hand, on the owner's disc | SAVE-01 to SAVE-04 and the other checks under "Slice 2 results" of P2. Two loads once more on the final build, with the pinned Chromium as the player. |
| Wrapper 1.1.0 from `git archive acc8e35` in a scratch folder, `python3 server.py` | Two saves made for SAVE-03, in the browser profile that then opened the server's room. |
| `python3 server.py` of the tree | A save loaded in a room that the page made. |

### P3 slice 1, 2026-11-21, working tree on top of `54a64b3`

| Command | Result |
|---|---|
| `npm run verify --prefix server` | All 11 checks passed in 132 s on the code after the review fixes. The records were written during and after that run; `git diff --check` is clean with them. |
| `npm test --prefix server` | 213 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1 (176 before the slice, 200 before the review). |
| `npm test --prefix research/network` | 71 passed, 0 failed, unchanged. |
| `node --test web/*.test.mjs admin/*.test.mjs` | 70 passed, 0 failed (66 before the slice, as the web client alone). |
| `npm run package:macos --prefix server`, `npm run smoke --prefix server` | Built; 23 passed, 0 failed (18 before the slice). |
| A scratch copy of the built bundle without the tunnel program, by hand | HOST-01, AUTH-01 and the other checks in the table under "Hand checks of slice 1". Run on the build before the review fixes; the fixes are covered by tests, not by a second hand check. |
| Independent review, from a diff against `54a64b3` | No critical finding, three important and ten minor. The three and six of the minor ones fixed, each with a test that failed first; the rest listed under "Open after slice 1". |

### P3 slice 2, 2026-11-21, working tree on top of `54a64b3`

| Command | Result |
|---|---|
| `npm run verify --prefix server` | All 11 checks passed in 141 s on the code after the review fixes; the six files of the page in the built bundle are byte-equal to `admin/`. The records were written during and after that run; `git diff --check` is clean with them. |
| `npm test --prefix server` | 222 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1 (213 before the slice). |
| `npm test --prefix research/network` | 71 passed, 0 failed, unchanged. |
| `node --test web/*.test.mjs admin/*.test.mjs` | 107 passed, 0 failed (70 before the slice). |
| `npm run package:macos --prefix server`, `npm run smoke --prefix server` | Built; 26 passed, 0 failed (23 before the slice). |
| A scratch copy of the built bundle without the tunnel program, by hand, with the owner at the screen for the first part | APP-01, the folder dialog, SAVE-03 and the other checks in the table under "Hand checks of slice 2". Run on the build before the fixes of the double click and of the review; the fixes are covered by tests, not by a second hand check. |
| A second scratch copy with the build's `cloudflared`, a synthetic emulator and a synthetic disc, by hand | The invitation through a real Quick Tunnel; two temporary public addresses existed for about a minute. |
| `env -i /usr/bin/osascript -e 'POSIX path of (POSIX file "…" as alias)'` on a scratch folder named with Cyrillic, CJK, an accent, an apostrophe and a quote | The folder came back byte for byte, with one trailing slash and line break. No window was shown. |
| Independent review on Opus 5.5, from a diff against `.superpowers/sdd/p3-slice-1-tree.tar` | No critical finding, one important and seven minor, all fixed, each with a test that failed first. A first reviewer on Fable 5.2 was stopped by a usage limit and wrote nothing. |

### P3 slice 3, 2026-11-21, working tree on top of `54a64b3`

| Command | Result |
|---|---|
| `npm run verify --prefix server` | All 11 checks passed in 150 s on the final tree, after the review's fixes and with these records; 151 s on the code alone before the records. |
| `npm test --prefix server` | 243 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1 (222 before the slice, 240 before the review). |
| `npm test --prefix research/network` | 71 passed, 0 failed, unchanged. |
| `node --test web/*.test.mjs admin/*.test.mjs` | 116 passed, 0 failed (107 before the slice). |
| `npm run package:macos --prefix server`, `npm run smoke --prefix server` | Built; 29 passed, 0 failed (26 before the slice). |
| Scratch copies of the built bundle without the tunnel program, by hand, alone | The room's options, a new game, a quit with a seated player, the report, the folder dialog, a replaced application (the old server rebuilt from the snapshot of slice 2) and App Translocation, in the table under "Hand checks of slice 3". Run on the build before the review's fixes; the fixes are covered by tests. |
| The report saved by the pinned Chromium from the page, by a scratch script | Saved under the page's content security policy, 5148 bytes, with no folder and no secret. |
| Independent review on Opus 5.5, from a diff against `.superpowers/sdd/p3-slice-2-tree.tar` | No critical finding, one important and five minor; the important one and three minor fixed, one minor closed by the records, one left open. A first reviewer on Fable 5.2 was stopped by a usage limit and wrote nothing. |
| A real logout, by hand | The server ended on `SIGTERM` within 76 ms, nothing was left, and macOS did not wait for it; the owner saw only the usual question. |

### P4 slice 1, phase 1, 2026-11-21, working tree on top of `54a64b3`

`npm run verify --prefix server`: all 11 checks passed in 156 s. Server tests
243 of 243 on Node.js 24.18.0 and on the pinned 26.13.1 (one test replaced:
`local-only waits for a later stage` became `local-only hosts: …`), network
modules 71 of 71, web client and panel page 116 of 116, the packaged build,
and its smoke tests 29 of 29. Nothing was checked by hand. The slice's
verification is completed in its phase 3.

### P4 slice 1, phase 2, 2026-11-21, working tree on top of `54a64b3`

`npm run verify --prefix server`: all 11 checks passed in 153 s. Server tests
243 of 243 on Node.js 24.18.0 and on the pinned 26.13.1, network modules 71 of
71, web client and panel page 123 of 123 (seven new: `web/local-disc.test.mjs`
and the panel's note), the packaged build, and its smoke tests 30 of 30 (one
new: the packaged server under `local-only`). The new smoke test was run
first on the build of phase 1, where it failed only on the page's change.
Nothing was checked by hand.

### P4 slice 1, phase 3, 2026-11-21, working tree on top of `54a64b3`

| Command | Result |
|---|---|
| `npm run verify --prefix server` | All 11 checks passed in 155 s after the review's fixes, before the records; again on the final tree with these records (`verify-phase-3.log` in the slice's ledger folder). |
| `npm test --prefix server` | 243 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1, unchanged in number (the `local-only` host test extended). |
| `npm test --prefix research/network` | 71 passed, 0 failed. |
| `node --test web/*.test.mjs admin/*.test.mjs` | 123 passed, 0 failed (the panel's note test extended, a panel view test reworded). |
| `npm run package:macos --prefix server`, `npm run smoke --prefix server` | Built; 30 passed, 0 failed. |
| A scratch copy of the built bundle with the tests' tunnel stand-in, by hand with the owner's disc, the owner watching | The room under `local-only`, a loopback download, a guest on its own files through the gateway's loopback port, a race of two, and 403 for the guest's `/disc.zip`, in the table under "Hand checks of slice 1" in P4. |
| Independent review on Opus 5.5, from a diff against `.superpowers/sdd/p3-slice-3-tree.tar` | No critical or important finding, five minor; four fixed, one not taken. A first reviewer on Fable 5.2 was stopped by a usage limit and wrote nothing. |

### P4 slice 2, phase 1, 2026-11-21, working tree on top of `54a64b3`

| Command | Result |
|---|---|
| `npm run verify --prefix server` | All 11 checks passed in 156 s before the records (`verify-phase-1.log` in the slice's ledger folder), and in 155 s on the final tree with them (`verify-phase-1-final.log`). |
| `npm test --prefix server` | 246 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1 (three new: the shared fixtures' identities and refusals, the bounds of `findDisc`; three tests moved under the 1 GiB bound). |
| `npm test --prefix research/network` | 71 passed, 0 failed (`/disc-sheet.js` on the gateway's list). |
| `node --test web/*.test.mjs admin/*.test.mjs` | 133 passed, 0 failed (`disc-sheet.test.mjs`, the shared fixtures, the new rules of `selectedDisc`, the panel's note). |
| `npm run package:macos --prefix server`, `npm run smoke --prefix server` | Built; 30 passed, 0 failed (the gateway serves `/disc-sheet.js` to a guest). |
| `python3 server/scripts/disc-fixtures.py` | Wrote `web/disc-identity.fixtures.json`: 4 discs, 6 refused. |

### P4 slice 2, phase 2, 2026-11-21, working tree on top of `54a64b3`

| Command | Result |
|---|---|
| `npm run verify --prefix server` | All 11 checks passed in 156 s before the records (`verify-phase-2.log` in the slice's ledger folder); `-- --quick` on the final tree with them (`verify-phase-2-final.log`). |
| `npm test --prefix server` | 247 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1 (one new: the server's streamed archive equals the rebuilt canonical archive, and the page's reader reads the server's identity from it). |
| `npm test --prefix research/network` | 71 passed, 0 failed. |
| `node --test web/*.test.mjs admin/*.test.mjs` | 142 passed, 0 failed (`disc-zip.test.mjs`: 9 tests, the reader on 46 archives, CRC-32, the bounds, a bomb stopped at once, the fast path). |
| `python3 server/scripts/disc-fixtures.py` | Wrote `web/disc-identity.fixtures.json`: 4 discs, 6 refused, 46 archives; a second run changed only ditto's archive. |
| Mutants of `web/disc-zip.js`, in place and restored | 20 in three rounds; the five survivors led to four fixtures and one check removed; none survived in the end. |

### P4 slice 2, phase 3, 2026-11-22, working tree on top of `54a64b3`

| Command | Result |
|---|---|
| `npm run verify --prefix server` | All 11 checks passed in 155 s after Task 7 (`verify-phase-3-task-7.log` in the slice's ledger folder), and in 154 s after the review's fixes, before the records (`verify-phase-3.log`); `-- --quick` on the final tree with the records (`verify-phase-3-final.log`). |
| `npm test --prefix server` | 247 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1, unchanged in number (the shared fixtures' new refusals, two byte order marks in `disc-folder.test.ts`). |
| `npm test --prefix research/network` | 71 passed, 0 failed (`/disc-zip.js` on the gateway's list). |
| `node --test web/*.test.mjs admin/*.test.mjs` | 152 passed, 0 failed (`chosenDisc`, the CUE rules of D85, the parts of D86, a browser that cannot inflate, the reader's messages, the panel's note). |
| `npm run package:macos --prefix server`, `npm run smoke --prefix server` | Built; 30 passed, 0 failed (the gateway serves `/disc-zip.js` and the field's `accept` to a guest). |
| `python3 server/scripts/disc-fixtures.py` | Wrote `web/disc-identity.fixtures.json`: 4 discs, 9 refused, 57 archives. |
| Mutants of `web/disc-zip.js`, in scratch copies | Eight, one per condition of the five checks that the review found unreached; seven killed by the new fixtures at once, the eighth after one more fixture. |
| By hand, alone, with the owner's consent | The time and memory of own files, a stored and a deflated ZIP (`zip-bench.mjs`); a guest under `local-only` with the server's archive, with Finder's ZIP and with a damaged copy, on a scratch copy of the bundle with the tests' tunnel stand-in; in the table under "Hand checks of slice 2" in P4. |
| Independent review on Opus 5.5, from a diff against `.superpowers/sdd/p4-slice-1-tree.tar` | No critical or important finding; four minor groups, all fixed. A first reviewer on Fable 5.2 stopped at once on its usage limit. |

### P4 slice 3, phase 1, 2026-11-22, working tree on top of `54a64b3`

| Command | Result |
|---|---|
| `npm run verify --prefix server` | All 11 checks passed in 154 s before the records (`verify-phase-1.log` in the slice's ledger folder); `-- --quick` on the final tree with them (`verify-phase-1-final.log`). |
| `npm test --prefix server` | 247 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1, unchanged. |
| `npm test --prefix research/network` | 71 passed, 0 failed, unchanged. |
| `node --test web/*.test.mjs admin/*.test.mjs` | 163 passed, 0 failed (`held` of the ZIP reader's items; `disc-source.test.mjs`: 10 tests, the offered and preselected sources, DATA-02 in the page, D89's refusal, a remembered copy restored, asked again, refused or foreign, wrapper 1.0's record). |
| `npm run package:macos --prefix server`, `npm run smoke --prefix server` | Built; 30 passed, 0 failed. |
| Mutants of `web/disc-source.js`, in place and restored | Eight; all killed. |

### P4 slice 3, phase 2, 2026-11-22, working tree on top of `54a64b3`

| Command | Result |
|---|---|
| `npm run verify --prefix server` | All 11 checks passed in 156 s (`verify-phase-2.log` in the slice's ledger folder); `-- --quick` on the final tree with the records (`verify-phase-2-final.log`). |
| `npm test --prefix server` | 247 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1, unchanged. |
| `npm test --prefix research/network` | 71 passed, 0 failed (`/disc-source.js` on the gateway's list; failed first with 403). |
| `node --test web/*.test.mjs admin/*.test.mjs` | 159 passed, 0 failed (the panel's note names the guest's two choices, failed first; four tests of 1.0's dialog functions removed with them, a checksum test added). |
| `npm run package:macos --prefix server`, `npm run smoke --prefix server` | Built; 30 passed, 0 failed (the guest's page through the gateway under local-only serves the group, both inputs and `/disc-source.js`). |
| `node .superpowers/sdd/2026-11-22-p4-mixed-sources/page-load.mjs` | `web/` with a stand-in session info in the pinned Chromium, headless: every expectation held, no request for `/disc.zip`, no console error (the stand-in has no favicon). Run once against the old guard of `selectDiscSource`: failed at the ZIP chosen with the Game tab open. |

### P4 slice 3, phase 3, 2026-11-22, working tree on top of `54a64b3`

| Command | Result |
|---|---|
| `npm run verify --prefix server` | All 11 checks passed in 154 s after the hand check (`verify-phase-3-task-7.log` in the slice's ledger folder), and in 154 s after the review's fixes, before the records (`verify-phase-3.log`); `-- --quick` on the final tree with the records (`verify-phase-3-final.log`). |
| `npm test --prefix server` | 247 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1, unchanged. |
| `npm test --prefix research/network` | 71 passed, 0 failed, unchanged. |
| `node --test web/*.test.mjs admin/*.test.mjs` | 163 passed, 0 failed (the last choice before a remembered copy, the button's word, a copy gone or changed since; `lobby-markup.test.mjs`: each source read once, the memory notice announced). |
| `npm run package:macos --prefix server`, `npm run smoke --prefix server` | Built; 30 passed, 0 failed. Before the hand check the bundle of phase 2 was found stale (one file of `web/`) and rebuilt with `node scripts/package-macos.mjs`. |
| `node .superpowers/sdd/2026-11-22-p4-mixed-sources/review-fixes.mjs` | `web/` with a stand-in session info in the pinned Chromium: failed on the page before the fixes for I2, a remembered file gone, M1 and M4 (`review-fixes-red.log`); every expectation held after them (`review-fixes.log`). `page-load.mjs` held again. |
| Mutants of `web/disc-source.js`, in place and restored | One: the room check removed; killed by the changed-copy test, which had passed at once. |
| By hand, alone, headless | One room from three sources with the real emulator and the owner's disc, reuse, a changed copy refused, `local-only`, and the review's fixes on the rebuilt bundle; in the table under "Hand checks of slice 3" in P4 (`player.mjs`, `hand-check.log`, `hand-check-fixes.log` in the ledger folder). |
| Independent review on Opus 5.5, from a diff against `.superpowers/sdd/p4-slice-2-tree.tar` | No critical finding; two important and six minor groups, all fixed but two items left open. A first reviewer on Fable 5.2 stopped at once on its usage limit. |

### P5 slice 1, phase 1, 2026-11-22, working tree on top of `54a64b3`

| Command | Result |
|---|---|
| `npm run verify --prefix server` | All 11 checks passed in 156 s before the records (`verify-phase-1.log` in the slice's ledger folder, `.superpowers/sdd/2026-11-22-p5-chunk-routes/`); `-- --quick` on the final tree with them, 9 checks in 82 s (`verify-phase-1-final.log`). |
| `npm test --prefix server` | 264 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1 (17 new: a chunk of the archive by range, its bounds, a changed or rewritten track, an abandoned chunk; the delivery limit; the manifest, a chunk's bytes, another archive or a bad index reading nothing, a changed disc, the limit's wait, refusal, a waiter that goes and a client that stops reading). Each failed first but the bad-index test, which passed before the code as a guard (the static files already answered 404). |
| `npm test --prefix research/network` | 71 passed, 0 failed, unchanged. |
| `node --test web/*.test.mjs admin/*.test.mjs` | 163 passed, 0 failed, unchanged. |
| `npm run package:macos --prefix server`, `npm run smoke --prefix server` | Built; 30 passed, 0 failed. |
| Mutants of `server/src/game-data.ts`, `runtime-http.ts` and `delivery-limit.ts`, in place and restored | Eight (no hold-back of a file's last piece, no upper bound on the index, no archive ID check, no idle cut, no abort on close, a waiter left queued, a release counted twice, an unbounded queue); all killed. |

### P5 slice 1, phase 2, 2026-11-22, working tree on top of `54a64b3`

| Command | Result |
|---|---|
| `npm run verify --prefix server` | All 11 checks passed in 154 s (`verify-phase-2.log` in the slice's ledger folder). |
| `npm test --prefix server` | 266 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1 (2 new: the hosted archive in two chunks of 8 MiB that match the manifest and make `/disc.zip`; a chunk of a changed disc refused, the host told once, a new start serving the new archive and 404 for the old one; and the loopback listener's routes under `local-only`). They passed at once, phase 1 having written their code; three mutants of `host-service.ts` were killed. |
| `npm test --prefix research/network` | 72 passed, 0 failed (1 new: the gateway's chunk shapes in shared mode, 16 other spellings and methods refused without reaching the upstream, all refused in local mode, a chunk streamed without its length). It failed first; five mutants of `public-server.mjs` were killed. |
| `node --test web/*.test.mjs admin/*.test.mjs` | 163 passed, 0 failed, unchanged. |
| `npm run package:macos --prefix server`, `npm run smoke --prefix server` | Built; 30 passed, 0 failed (the manifest and a chunk through the gateway under `shared-allowed`, a chunk refused under `local-only`). The changed smoke test failed first against the bundle built before the gateway's change. |
| Hand check, alone and headless, a scratch copy of the bundle with the owner's disc | See "P5 slice 1" under P5: every chunk matched, the limit held four and queued four, a client that went freed its place, a stalled one was cut after 60 s, the gateway passed a chunk under `shared-allowed` only. |

### P5 slice 1, phase 3, 2026-11-22, working tree on top of `54a64b3`

| Command | Result |
|---|---|
| Independent review on Opus 5.5, from a diff against `.superpowers/sdd/p4-slice-3-tree.tar` | No critical finding; one important (the room's emulator and the owner's page queued behind guests) and three minor, all fixed. A first reviewer on Fable 5.2 stopped at once on its usage limit. |
| `npm run verify --prefix server` | All 11 checks passed in 155 s after the review's fixes (`verify-phase-3.log` in the slice's ledger folder); `-- --quick` on the final tree with the records (`verify-phase-3-final.log`). |
| `npm test --prefix server` | 267 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1 (1 new: a delivery on this computer and a `HEAD` outside the guests' limit; the limit's tests now ask as the gateway does; the bounds test removes a track first). The new test failed first (`503` for `/disc.zip` on loopback); the bounds test passed before and after, as a guard, and was proved by a mutant. |
| `npm test --prefix research/network` | 73 passed, 0 failed (1 new: the gateway marks what it forwards, also when a guest sends the header itself). It failed first. |
| `node --test web/*.test.mjs admin/*.test.mjs` | 163 passed, 0 failed, unchanged. |
| `npm run package:macos --prefix server`, `npm run smoke --prefix server` | Built; 30 passed, 0 failed. |
| Mutants of `server/src/runtime-http.ts`, `game-data.ts` and `research/network/public-server.mjs`, in place and restored | Five (a `HEAD` under the limit; every delivery limited; none limited; the files checked before the index; no mark from the gateway); all killed (`review-fixes-mutants.log`). |

### P5 slice 2, phase 1, 2026-11-22, working tree on top of `54a64b3`

| Command | Result |
|---|---|
| `npm run verify --prefix server` | All 11 checks passed in 156 s before the records (`verify-phase-1.log` in the slice's ledger folder, `.superpowers/sdd/2026-11-22-p5-resumable-download/`); `-- --quick` on the final tree with them (`verify-phase-1-final.log`). |
| `npm test --prefix server` | 267 passed, 0 failed on Node.js 24.18.0 and on the pinned 26.13.1, unchanged. |
| `npm test --prefix research/network` | 73 passed, 0 failed, unchanged. |
| `node --test web/*.test.mjs admin/*.test.mjs` | 202 passed, 0 failed (39 new: the part store, 16, over stand-ins for the private file system and the record store; the downloader, 23, over a stand-in server). Both new test files failed first (no module). |
| Mutants of `web/disc-download.js` and `web/disc-parts.js`, in place and restored | Eighteen (unbounded workers, a stall deadline before the answer, a pause counted as a failure, no hash check, no final check, the old archive's parts kept, PAL unchecked, the whole download's stall deadline before its answer, a longer chunk accepted, Retry-After unclamped, the same archive's 404 fatal; no length check at open, other archives' directories or records kept, the record's shape unchecked, unserialized record writes, `drop` keeping the index, `file` without its completeness check); all killed, two after a test was added or sharpened. |

### P5 slice 2, phase 2, 2026-11-22, working tree on top of `54a64b3`

| Command | Result |
|---|---|
| `npm run verify --prefix server` | All 11 checks passed in 154 s before the records (`verify-phase-2.log` in the slice's ledger folder); `-- --quick` on the final tree with them (`verify-phase-2-final.log`). |
| `node --test research/network/gateway.test.mjs` | Failed first once `app.js` imported the downloader (`/disc-download.js` and `/disc-parts.js` not served to guests), then 7 of 7; the network suite 73 of 73 in the full verify. |
| `node --test web/*.test.mjs admin/*.test.mjs` | 202 passed, 0 failed, unchanged in number (the page's wiring is checked by hand). |
| By hand, pinned Chromium, headless, a scratch copy of the bundle with the owner's disc (`hand-check-step*.log` in the ledger folder) | A fresh guest through the gateway's loopback port: 86 chunk requests for 86 chunks, the game started, no parts left. SIGKILL at 40%: 34 parts kept; the same profile again asked for chunks 34 to 85 only, plus chunk 0 once after the whole-archive check caught one changed byte in it; the game started, no parts left. `python3 server.py --browser-hosted`: manifest 404, `/disc.zip` once, the game started. |

### P5 slice 2, phase 3, 2026-11-22, working tree on top of `54a64b3`

| Command | Result |
|---|---|
| Independent review on Opus 5.5, from a diff against `.superpowers/sdd/p5-slice-1-tree.tar` | No critical finding; three important (a write refused at the quota stopped every download at the same place; four waits in the host's queue stopped the download; five surviving mutants) and seven minor; all fixed but m7 (two decision notes, open). A first reviewer on Fable 5.2 stopped at once on its usage limit. |
| `npm run verify --prefix server` | All 11 checks passed in 156 s after the review's fixes (`verify-phase-3.log` in the slice's ledger folder); `-- --quick` on the final tree with the records (`verify-phase-3-final.log`). |
| `node --test web/*.test.mjs admin/*.test.mjs` | 220 passed, 0 failed (18 new: the part store 3, the downloader 15). Ten failed before the code (a refused write, a part of another length, a second page without the lock; a wait past the answer deadline, a proxy's 504 and 524, the wait budget, a storage error, a file of another size, a manifest read in flight at a stop, a chunk size over 64 MiB); the others pin mutants that the review found surviving, or that survived the fixes' first round. |
| `npm test --prefix server`, `npm test --prefix research/network` | 267 passed on Node.js 24.18.0 and on the pinned 26.13.1, and 73 passed, unchanged. |
| Mutants of `web/disc-download.js` and `web/disc-parts.js`, applied to copies | 26 (ten of the review's survivors on the fixed code, sixteen of the fixes); 24 killed in the first round, the two cleanups of m4 after their pins; 26 of 26 at the end (`review-fixes-mutants.log`). |
| The page's modules in the pinned Chromium, headless, synthetic bytes (`browser-check.mjs`, `browser-check.log`) | 8 of 8: waits on 524 and on the answer deadline asked again, the parts in the private file system and the record, the lock against a second store and another page, `discard`, a part kept over a reload. |

## Checking a change

`npm run verify --prefix server` runs every automated check and prints one
line for each: types, the server tests on the developer's Node.js and on the
pinned one, the network modules, the web client with the panel's page, the
launcher's Python checks, the packaged build with its smoke tests, and that no
process is left running. `-- --quick` leaves out the build and the smoke tests.
A check that fails prints the names of its failed tests and keeps its whole
output in `dist/verify/`.

A room is checked by hand with `server/scripts/room-player.mjs`, which drives
the pinned Chromium as a player. The hand checks of this plan ran a copy of
the built bundle with `Contents/Resources/bin` removed, so that no public
address was opened in front of the owner's disc, and with `SLED_SERVER_HOME`
pointing at a scratch folder.

## Build and run the current result

```sh
npm ci --prefix server
npm run package:macos --prefix server
```

This fetches and verifies the pinned Node.js, `cloudflared` and Chromium on
first use (about 360 MB of downloads), bundles the server, builds the single
executable and assembles
`dist/macos/Sled Storm Server.app`. With a built emulator in the checkout at
build time, the bundle carries it; without one, a start fails with the
emulator component named.

Opening that bundle starts the server and shows its page in the default
browser, connected through a one-time token. On the first run the page asks
for two things: "Choose game folder" opens the system's dialog, in which the
folder that holds the disc is chosen, and the disc policy is chosen once.
"Start server" then prepares the game files, starts the room, with its
emulator in the Chromium inside the bundle, and opens the public address in
front of it. The page shows the state, the disc, the players and, once the
public address works, the guests' link with "Copy invite link". "Open game"
opens the room in a new tab, for a player on this computer, with the saves
that the browser keeps for `http://127.0.0.1:8000`. "Stop room" closes the
room, the public address and the local game page, and leaves the server and
its page; "Start server" hosts again, in a new room with a new address. "New
game" ends the room's game and opens a new one in the same room, under the
same links. The room's options ("All content unlocked" or "Original
progression", and "Separate cameras") are chosen while the room is stopped.
A stop, a new game or a quit with players in the room is refused by the
server, and the page asks from that refusal. The switch "Start the room when
Sled Storm Server opens" decides whether the next launch hosts by itself.
"Save diagnostics" has the browser save the diagnostic report as a file.
"Quit server" ends the server, also while the folder dialog is open. Opening
the bundle again opens the page again, with a session of its own, on the same
server; closing the page stops nothing. The owner's guide to all of this is
`docs/sled-storm-server.md`.

The same can be done from a terminal:

```sh
"dist/macos/Sled Storm Server.app/Contents/MacOS/SledStormServer" status
"dist/macos/Sled Storm Server.app/Contents/MacOS/SledStormServer" configure --game-folder <folder> --disc-policy shared-allowed
"dist/macos/Sled Storm Server.app/Contents/MacOS/SledStormServer" start
"dist/macos/Sled Storm Server.app/Contents/MacOS/SledStormServer" invitation
"dist/macos/Sled Storm Server.app/Contents/MacOS/SledStormServer" new-game
"dist/macos/Sled Storm Server.app/Contents/MacOS/SledStormServer" stop
"dist/macos/Sled Storm Server.app/Contents/MacOS/SledStormServer" quit
"dist/macos/Sled Storm Server.app/Contents/MacOS/SledStormServer" diagnostics
"dist/macos/Sled Storm Server.app/Contents/MacOS/SledStormServer" self-test
```

`invitation` prints two links to the room: `url` for guests, and `localUrl`
for a browser on the server's own computer. `new-game` ends the room's game
and opens a new one in the same room, so both links stay good. `stop` with a
player in the room, or a controller kept for one, stops nothing, says how
many are there and names `--force`; so do `new-game` and `quit`, and a
`start` that closes such a room because the game files changed. `start` and `stop` print the status of the moment they were
asked, so `status` tells how it went. The server keeps its record,
`config.json` and log under `~/Library/Application Support` and
`~/Library/Logs` in `Sled Storm Server`.

Opening the bundle on a real disc also opens a public address in front of it.
The hand checks ran a copy of the bundle with `Contents/Resources/bin`
removed, which leaves the host `degraded` with the local game working.

The Python launchers remain the supported way to play: the packaged server
was checked with two players only, in the lobby and at the start of one race.
A player alone in its room can save and load.
