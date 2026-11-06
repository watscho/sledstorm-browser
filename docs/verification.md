# Verification and known limits

This is a development experiment, not a completed compatibility or internet
release. Evidence below is local to macOS and the PAL SLES-02194 configuration.

## Gameplay evidence recorded on 2026-11-06

- The recompiled WebAssembly target reached the original frontend, multiplayer
  selection, Pine Valley load, countdown and controllable racing.
- Two browser clients ran matching core state through frame 18,625 after the
  two-player HUD/resource and pause-presentation changes. Each had its own
  expanded WebGL2 view with the single-player HUD; the guest accelerated.
- Pause/options opened by either player used the original 4:3 menu and resumed
  the personal view correctly.
- Earlier four-client checks reached frame 9,500 in software and 8,425 in WebGL2
  with original quad presentation. The final two-player-only pause/HUD edits
  were not followed by a new full four-client race qualification.
- Original disc files and memory cards were not edited by the wrapper.

These browser clients ran on one Mac. This is evidence of local room/controller
synchronization, not of cross-device internet latency, NAT/proxy compatibility,
or long-running reliability.

## Automated coverage

`tools/check-port.sh` exercises actual Wasm fibers, local disc extents, pixel
conversion, HUD mapping, real SIO/Multitap polling, progression, preferences,
GPU IRQ parsing and the JavaScript settings/relay/gateway/client tests.
The repository preparation run on 2026-11-06 passed:

- All 14 JavaScript tests (3 settings and 11 relay/gateway/client cases), plus
  the Wasm/adapter checks in `sh tools/check-port.sh`.
- Fresh fetch of the pinned port and framework into a temporary directory;
  supplied framework patch application and an idempotent second run.
- A full browser build from those newly fetched sources, with no native-build
  libwebp override. This reused the installed Emscripten SDK and tooling; a
  completely fresh SDK download/installation was not repeated.
- Separate installation of the pinned CMake/Ninja/Capstone wheels into a
  temporary directory and executable version checks for CMake and Ninja.
- English launcher inspection at the default desktop viewport and 390 × 844;
  translated labels fit and the decorative vector loads.
- Repository content checks: no disc/save/build/dependency artifacts, Cyrillic
  text or machine-specific home paths among tracked files; authored Markdown
  links resolve; missing-disc errors explain setup.

Tests use loopback servers. Temporary launcher/relay processes were stopped
and ports 8000–8003 were clear after verification. No internet endpoint was
started. The clean-source build was compiled, not independently race-qualified.

## Still unverified or unsupported

- Separate devices over the internet, high latency, browser suspension and
  long-running/reconnection behavior under real networks.
- Physical gamepads, audible audio quality, mobile gameplay, Linux/Windows
  qualification and track-wide compatibility beyond the local race evidence.
- Four independent full-screen cameras. Three/four players and software retain
  the original split-screen presentation.
- Rollback, persistent rooms/saves, host migration and automatic racer insertion
  into an already-running native race.
- Other regions/disc revisions, standalone ISO/CHD and PS2 Sled Storm.

A local file check or a passing compiler build does not remove these limits.

## Cloudflare endpoint verification — 2026-11-06

The one-command online helper was used to start a real Quick Tunnel to the
private gateway. HTTPS checks through the public hostname verified:

- Unauthorized requests return 401; the private access route grants an HttpOnly,
  Secure cookie and redirects to the launcher.
- COOP/COEP isolation headers survive the proxy; the gateway requires local disc
  selection, and the manifest describes all 12 local disc files.
- Compiled JS/Wasm and OpenBIOS are reachable after authorization; `/disc/*`,
  `.git` and `.cache` paths remain blocked.
- Two synthetic WSS clients created/joined a room and received identical rows
  through ten controller-input frames; that test room was then closed.
- One actual browser host selected its local CUE/BIN files, loaded the runtime
  through the public origin and reached the original main menu with controller 1.

The host session and tunnel were left running for participant testing. No live
hostname, token or session invitation is recorded in this repository. This is
public transport and single-host boot evidence; a two-device internet race,
latency, reconnect behavior and gameplay reliability remain unverified.

## Host-disc mode — 0.2.0 (2026-11-06)

- All 12 Node relay/gateway/client tests, 3 settings tests and 3 real Python
  HTTP-handler tests passed. HTTP-handler fixtures contain synthetic tracks.
- The existing Wasm disc adapter passed remote extent and local Blob checks,
  including reporting remote transfer bytes without counting local Blob reads.
- Through a live Cloudflare endpoint, an authenticated 4 KiB disc extent matched
  the host's bytes exactly. Unauthorized, unbounded, oversized, out-of-file and
  private-path requests were refused. A local-files gateway against the same
  runtime still blocked host disc reads and advertised local selection.
- Two actual Chrome tabs created/joined a shared-mode room without selecting any
  CUE/BIN files. Both booted the native frontend and reported matching core state
  through verified frame 2,550 and reached the original language-selection screen.
- The native startup scans the approximately 283 MiB data track; shared-mode
  startup took several minutes through the test tunnel. A transfer counter and
  loading overlay were added for that phase. It is not video streaming or a
  guarantee of low startup bandwidth.

Both browser clients ran on the same Mac through the public HTTPS origin.
This verifies the no-file-selection path and controller synchronization, not a
race on two separate computers. Direct offline LAN access is not part of this
helper. Both modes retain the previous native game build; no C/C++ changed.
