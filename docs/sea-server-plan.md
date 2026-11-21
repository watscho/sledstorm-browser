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
| P3 Browser admin and macOS launch | Not started |
| P4 Independent data sources | Not started |
| P5 Resumable delivery | Not started |
| P6 Qualification and release package | Not started |

## Where to continue

The work goes one slice per working session, and a slice that has several
phases goes one phase per session. A session that is asked to continue starts
here: this section says where the work stands, what comes next and how it is
done. Every session ends by rewriting it, so that the record follows the work
and the next session needs nothing but this file.

**Position, 2026-11-21.** P0, P1 and P2 are done. P2 slice 2, saving and
loading in the server's room, closed on 2026-11-21 with a hand check on the
owner's disc, an independent review and its fixes. Its results, what was not
verified and what stays open are under "P2 Server-owned rooms"; its task plan
is `docs/superpowers/plans/2026-11-21-p2-room-saves.md`. Check `git status`
first: P1 slices 2 and 3 and both slices of P2 were committed together on
2026-11-21 on branch `claude/sea-server`, on top of `4a2f21a`, in the commit
that holds this sentence. Nothing is pushed.

**Next: P3, the browser admin panel and the macOS launch.** It has no task
plan yet. The first session of P3 reads the brief's part on P3 with HOST-01,
APP-01, AUTH-01 and SAVE-03, and "P3 Browser admin and macOS launch" below;
cuts the stage into slices and records them there; writes the task plan of
the first slice in `docs/superpowers/plans/`, cut into phases if it is large;
then does the first phase and stops.

What P2 leaves for P3 to decide or to do:

- What a start request means while the room is restarting or has failed.
  Today it rebuilds the whole stack with a new room and a new address.
- A new game for the room. Today the game in the room is replaced only by
  loading a save or by stopping and starting the server, so a state that
  should not be there stays for everyone who joins.
- The "Open game" button. Today the owner gets the local link from the
  `invitation` command.
- The room's options cannot be chosen (D37).
- SAVE-03 is an exit check of P3 too. In P2 it passed by hand with wrapper
  1.1.0 run as `python3 server.py`; P3 repeats it with the bundle opened by a
  double click.

For hand checks: a page in a browser pane that is hidden runs in the
background, and such a page refused to load a save on 2026-11-21. Keep the
pane shown, or drive the pinned Chromium as `server/scripts/room-player.mjs`
does.

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
- No automated test starts the real Chromium, a tunnel or the network. No
  tunnel is opened in front of the owner's disc: hand checks run a copy of the
  built bundle without `Contents/Resources/bin`, with `SLED_SERVER_HOME` in a
  scratch folder.
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
- A slice ends with an independent review on the most capable model, in its
  last phase, from a diff against the snapshot named below. Critical and important findings are
  fixed test first, and so are the minor ones that are cheap and clearly
  right. The rest is listed under the slice as open.
- Then this file gets the slice's results, what was not verified, the
  verification log and a new version of this section, and `CHANGELOG.md` gets
  its entry. Nothing unverified is recorded as verified.

**Tools.** `npm run verify --prefix server` runs every automated check;
`server/scripts/room-player.mjs` plays a room by hand. Both are described
under "Checking a change". The emulator is built on the owner's machine
(`.cache/`, `vendor/`), and the pinned Chromium and `cloudflared` are in
`.cache/toolchain`.

**Review base.** The commit that closes P2, which holds this paragraph: the
latest commit on `claude/sea-server` when P3 starts. Before it was made, the
states after P2 slice 1 and after P2 slice 2 were kept as the snapshots
`5b2973043340526c98194cadb862f7934d9d55e7` and
`e5b897b57d1a1b24f7d2102c211d83e4ca1f2fa2`, commit objects on no branch.

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
| D37 | The room's options are not a setting yet: the verified PAL disc gives all content unlocked with separate native cameras, any other disc the original progression without them. | These are the web client's defaults. The panel of P3 is where an owner will choose. |
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

## Checking a change

`npm run verify --prefix server` runs every automated check and prints one
line for each: types, the server tests on the developer's Node.js and on the
pinned one, the network modules, the web client, the launcher's Python
checks, the packaged build with its smoke tests, and that no process is left
running. `-- --quick` leaves out the build and the smoke tests.

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
build time, the game page is on `http://127.0.0.1:8000/`, the server opens its
tunnels, and `invitation` prints the private link once the public address
works. The server opens one room by itself, with its emulator in the Chromium
inside the bundle. `invitation` prints two links to that room: `url` for
guests, and `localUrl` for a browser on the server's own computer. Without a
built emulator the state is `failed` with the emulator component named.

Opening the bundle on a real disc also opens a public address in front of it.
The hand checks of slice 3 ran a copy of the bundle with `Contents/Resources/bin`
removed, which leaves the host `degraded` with the local game working.

The Python launchers remain the supported way to play: the packaged server
has no panel yet, and it was checked with two players only, in the lobby and
at the start of one race. A player alone in its room can save and load.
