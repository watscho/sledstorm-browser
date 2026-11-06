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
