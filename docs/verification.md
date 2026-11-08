# Verification and known limits

## v0.8.0 release checks — 2026-11-08

- 22 browser-module tests, 19 network tests, three HTTP handler tests, Python
  syntax checks and the native presentation tests passed. The native tests
  check four PAL viewports, state isolation and menu bypass.
- The pinned WebAssembly core was rebuilt with the current native adapters.
- Chrome on macOS launched a solo PAL race through the normal launcher.
  Enhanced 2× reproduced duplicate digits and seams before the fix. A saved
  race state with a test 6,000-point award allowed direct frame comparisons.
  After the fix, 4:3 and 16:9 both showed a clean minimap and one award popup.
  The original timer ran down and the award disappeared.
- In the browser-hosted local launcher, the selected tab, aspect ratio, CRT
  filter and Enhanced 2× persisted after reload. **Save game** and **Load last
  save** restored the solo race in a new room. **F8** downloaded a PNG and
  **Alt+Enter** entered and exited fullscreen. The dedicated relay tests
  also checked that loading is allowed for a sole owner and refused while a
  second controller is present.

## v0.7.0 release checks — 2026-11-07

- 21 browser-module tests, 19 network tests, three HTTP handler tests and
  the native presentation checks passed. The relay checks cover controller
  indicators after synchronization, saved controller replacement and
  out-of-order recovery of three reserved controllers.
- The native build record matched the current adapter sources and the cached
  JavaScript and WebAssembly binaries.
- Chrome on macOS opened a test ZIP through the system file picker and launched
  without downloading it again. The system Save As flow wrote a byte-for-byte
  copy of the test ZIP. Joining without saving also launched successfully.
  These checks used a local fixture and a test archive.

## v0.6.0 dedicated rooms — 2026-11-07

- 20 browser-module tests, 19 network tests, three HTTP handler tests and the
  native presentation checks passed. A fresh localhost launch confirmed that
  a dedicated room selects the native camera without URL parameters.

- Two isolated Chrome contexts ran Pine Valley against a local dedicated
  room with the full-size native camera. Both accelerated their own
  sled with a full camera and original HUD. The shared pause menu suspended
  personal rendering. Controller 2 rejoined the running race on its original
  slot and resumed its native view. The presentation counters reported no
  native camera or HUD errors in these samples.
- A local suspension check stopped input from controller 1 while the
  dedicated runtime advanced 204 console steps over 4.1 seconds. The
  controller disconnected and later recovered its original slot.
- Four Chrome contexts on one Mac ran Hard Pack through a private Cloudflare
  tunnel. All four produced the same serialized state digest and rider
  positions at the same synchronized frame. The four personal views and HUDs
  were inspected individually. The clients used matching local CUE/BIN files
  through a test-only launcher override, so this run tested the internet
  gameplay path independently of disc transfer.
- On Kodiak Canyon with the updated build, an intentional 1.15-second
  client stall through the tunnel caused a 61-step backlog. The catch-up
  screen appeared, personal rendering paused, and the backlog fell to three
  steps in about 2.4 seconds after its peak without reconnecting.
- The final Hard Pack run verified the four named, ready players, movement on
  each controller, and the shared 4:3 pause menu. After the creator closed
  their tab, controllers 2–4 kept driving and controller 2 became room owner.
  The creator recovered controller 1 and their player name from a private
  link in a fresh Chrome context. Controller 2 then continued alone. The
  other players returned in the order 4, 1, 3 and all reclaimed their
  original controllers and personal views.
- The gamepad tester was exercised with simulated browser input. Physical
  USB and Bluetooth devices still need hands-on verification.

## v0.5.0 RetroArch Netplay — 2026-11-07

- Rebuilt the pinned WebAssembly emulator and prepared the runtime archive.
  All 18 browser-module tests, 17 network tests, three HTTP handler tests and
  the native presentation checks passed.

- Four isolated Chrome contexts on one Mac used the ordinary lobby and a
  live Cloudflare Quick Tunnel in local-disc mode. The host ran on loopback,
  and all three guests opened the generated HTTPS invitation.
- Four racers started Pine Valley. Each screen showed its own camera and
  the original HUD, including position, timer, points, lap counter, map and
  speedometer.
- Players 2–4 each rejoined the running race from a fresh browser context,
  using the original invitation and the same local disc. From **Join game**
  to the live view took **6.1–6.7 seconds**, including disc loading. Holding
  **S** accelerated the returning sled. Host and guest frames kept advancing.
- The same race continued after the fourth and third players disconnected.
  All remaining screens advanced and continued rendering the HUD. A separate
  transport probe checked binary forwarding, full-room rejection, slot reuse
  and the blocked archive route in local-disc mode.
- This run exercised the public tunnel from one Mac. Gameplay between
  separate physical computers and networks remains unverified.

## v0.4.0 release checks — 2026-11-07

- 18 browser-module tests, 16 networking tests and three synthetic HTTP-handler
  tests passed. Coverage includes keyboard presets and conflict swapping,
  controller device selection and private-gateway access to the controller SVG.
- Native presentation assertions passed against the pinned source checkout,
  covering four PAL viewports, state isolation and native-menu bypass.
- The local launcher served v0.4.0 and the controller illustration with the
  expected SVG content type.
- An isolated Chrome preview rendered Controls at wide and narrow panel widths.
  A browser check changed a binding, verified the conflicting key swapped, and
  switched to WASD. This check used the launcher panel without a running game.

## v0.3.0 gameplay evidence — 2026-11-07

These runs used PAL SLES-02194 and the pinned PCSX-ReARMed / RetroArch runtime
in the Codex in-app browser on one Mac with HLE BIOS, single-threaded WebAssembly
and a 512 MiB heap per instance.

- Four browsers joined one Pine Valley race, each confirmed its own rider and
  independently accelerated a different sled.
- Each player had a separate full camera and original single-player HUD.
- All four agreed at **19,500 completed core steps**. Final short samples were
  **50.3, 49.0, 48.5 and 49.8 steps/s**, against a PAL target of 50.
- The host passed **30 full serialized-state comparisons** before and after
  private camera/HUD rendering.
- Controller 4 opened the shared pause menu with original **4:3** proportions.
- Two-player control and cameras were exercised separately, with state agreement
  past 8,500 steps. A third late arrival caught up and agreed at 34,000 steps.

Local evidence is ignored under `.cache/emulator-four-browser-*`.

## v0.3.0 disc loading and internet access

- Two actual browsers loaded the host disc through private Cloudflare HTTPS,
  joined one room, completed catch-up and agreed at 9,000 core steps. Short live
  samples were around 48 steps/s. This transport check preceded the final
  four-player camera/HUD changes.
- The final localhost host launcher generated a private HTTPS invitation. That
  invitation authenticated and opened the guest launcher with inherited settings,
  while the host continued reading its disc locally.
- Local-file mode booted from a complete PAL CUE and eleven BIN tracks selected
  in the browser; the server refused host archive downloads in that mode.

The internet-path checks used browsers on **one Mac**. A race between separate
physical computers on remote networks remains unqualified.

## Automated checks

```sh
node --test web/*.test.mjs
npm test --prefix research/network
python3 tools/test-emulator-view.py
python3 tools/test-emulator-server.py
```

Coverage includes invitation validation, public URL construction, frame gating,
state canonicalization, real loopback WebSocket exchange, compact history,
asset-route restrictions and disc policies. Native checks cover viewport bounds,
canonical GPU/VRAM preservation, interpreter RAM/register/instruction-cache
restoration, interrupted HUD execution and native menu bypass. The native test
requires a C compiler and the pinned source checkout from the build.

## Current limits for v0.8.0

- The v0.6.0 Cloudflare gameplay run used four Chrome contexts on one Mac. Separate
  computers and networks, sustained sessions and remote latency remain open.
- The native camera was checked on Pine Valley, Hard Pack and Kodiak Canyon.
  Full race completion, other courses and weather combinations remain open.
- The new solo Enhanced 2× HUD fix was verified in Chrome on one Mac. Mixed
  4:3/16:9 and mixed 1×/2× clients in a sustained four-player internet race
  still need dedicated release coverage.
- Dedicated rooms preserve controller slots across browser reconnects while
  the server is running. A server restart requires a new room and invitation.
  In browser-hosted mode the room lasts as long as the host stays connected.
- The dedicated Cloudflare tests used local CUE/BIN files in the clients.
  Shared-disc delivery through Cloudflare was exercised in earlier builds. The
  v0.7.0 ZIP picker checks used a local fixture.
- Physical gamepads, sustained background-tab play, soundtrack quality,
  mobile gameplay and Linux/Windows still need hands-on verification.
- This setup targets PAL SLES-02194 with CUE/BIN tracks.

Core-step measurements count emulator steps. Display pacing and audio need
separate measurements on the intended devices.
