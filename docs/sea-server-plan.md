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
| P1 Node host runtime | In progress. Slice 1 of 3 (local host stack) done 2026-11-20. |
| P2 Server-owned rooms | Not started |
| P3 Browser admin and macOS launch | Not started |
| P4 Independent data sources | Not started |
| P5 Resumable delivery | Not started |
| P6 Qualification and release package | Not started |

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
2. Tunnels: supervise `cloudflared` with `owned-process.ts`, parse and then
   really probe readiness, restart with bounded retries, keep the mirror, and
   feed the invitation address into `/session-info` from memory.
3. Dedicated emulator: choose and pin the Chromium build, start the worker
   through the existing `dedicated-runtime.mjs`, stage a really built emulator
   and run the game end to end.

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

### P2 Server-owned rooms

Scope: internal `createRoom()` without a browser peer and without a seat, four
free controllers, a room that survives zero players, the canonical room
identity with a new invitation version, save and restore as a room capability,
restore inside the same room.

Depends on: P1.

Exit checks: ROOM-01 to ROOM-07 and SAVE-01 to SAVE-04 from the brief; the
existing dedicated-room tests keep passing for the developer path.

Restore chain to implement and test, including cancellation and start failure:

| Step | What happens | On failure |
|---|---|---|
| save | The owner's browser stores a snapshot in its library, format unchanged. | n/a |
| request restore | The owner asks over its room socket. The server checks the capability: owner, connected, the only peer, no reserved seats, not racing. | Refused; the room is untouched. |
| validate | The server receives the bounded binary snapshot and checks format and compatibility. The live runtime keeps running. | Refused, or a 10 s transfer timeout; the room is untouched. |
| restart runtime in the same room | The room goes to `restoring` and answers new joins with a retryable reply. A new worker starts with the snapshot under the same room id, token and identity. The old worker stops only after the new one reports `listening`. | The new worker is stopped; the old one keeps the room. The owner sees the reason. |
| rejoin | The owner's client reconnects with its seat key, which stayed reserved. | The seat is released after the normal reservation rules. |
| regain owner | The owner is the first peer again; the room returns to `open`. The invitation is unchanged. | n/a |

Open point for P2: starting the new worker before stopping the old one needs
two emulators for a few seconds. If that cost is not acceptable on the target
hardware, the fallback is validate, explicit confirmation, stop, start, and a
fresh worker when the restored one fails.

### P3 Browser admin and macOS launch

Scope: the local admin panel and its API, the system folder picker, the
bootstrap token exchange, the early application bundle, and the local game
client on the fixed origin.

Depends on: P1 for start and stop, P2 for the room.

Exit checks: HOST-01, APP-01, AUTH-01 and SAVE-03 from the brief; double-click
to a ready invitation without a terminal.

### P4 Independent data sources

Scope: split room mode from client disc policy, own CUE/BIN or ZIP in dedicated
rooms, loopback delivery under `local-only`, shared identity fixtures, safe
archive checks. Exit checks: DATA-01 to DATA-04 and DATA-09.

### P5 Resumable delivery

Scope: chunk endpoints, bounded downloader, persistent parts, portable ZIP.
Exit checks: DATA-05 to DATA-08.

### P6 Qualification and release package

Scope: clean macOS, signing and notarization when certificates exist, real
races on separate devices and networks, licenses and documentation.
Exit checks: RELEASE-01 and the manual matrix in the brief.

## Risks and open questions

| Risk | Plan |
|---|---|
| Redistributable Chromium for macOS arm64: origin, license, size, nested signing, parity with installed Chrome. | Decide in P1 and run the worker on it before building on top. |
| The end-to-end game check needs a bootstrapped emulator and a disc. | P0 uses synthetic checks only and says so. P1 cannot be closed without them. |
| A detached server outlives the launcher. Its behavior at logout and under App Translocation is unverified. | Check both with the real bundle in P3 and P6. |
| The executable is 146 MB before Chromium and `cloudflared`. | Record the real package size in P1 when Chromium is chosen. |
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

## Build and run the current result

```sh
npm ci --prefix server
npm run package:macos --prefix server
```

This fetches and verifies the pinned Node.js on first use, bundles the server,
builds the single executable and assembles
`dist/macos/Sled Storm Server.app`. Opening that bundle starts the server and
shows a placeholder page; opening it again shows the same page. To inspect or
stop it from a terminal:

```sh
"dist/macos/Sled Storm Server.app/Contents/MacOS/SledStormServer" status
"dist/macos/Sled Storm Server.app/Contents/MacOS/SledStormServer" quit
"dist/macos/Sled Storm Server.app/Contents/MacOS/SledStormServer" self-test
```

The server keeps its record and log under `~/Library/Application Support` and
`~/Library/Logs` in `Sled Storm Server`.

To host the game origin, save a game folder and start the server again:

```sh
"dist/macos/Sled Storm Server.app/Contents/MacOS/SledStormServer" configure --game-folder <folder> --disc-policy shared-allowed
"dist/macos/Sled Storm Server.app/Contents/MacOS/SledStormServer" quit
open "dist/macos/Sled Storm Server.app"
"dist/macos/Sled Storm Server.app/Contents/MacOS/SledStormServer" status
```

`status` then reports the host state. With a built emulator in the checkout at
build time, the game page is on `http://127.0.0.1:8000/`. Without one, the
state is `failed` with the emulator component named. No tunnel and no
dedicated emulator start yet, so the Python launchers remain the way to play.

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
