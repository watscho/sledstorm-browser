# Verification and known limits

## Unreleased dedicated draw-distance checks

- Two Chrome contexts on one Apple M1 Mac played the opening section of
  Pine Valley through Cloudflare with **16:9**, **+100%** draw distance, and
  **Enhanced 2×**. The sampled race state agreed across all 900 Netplay steps.
  The two clients had zero catch-up episodes or room stalls. Their longest
  compositor-confirmed presentation intervals were 83 ms and 67 ms.
- With a controlled 240 ms pause on controller 2, the earlier build entered
  catch-up and had a later presentation gap of 167 ms. The updated build
  stayed out of full catch-up and had no presentation gap above 67 ms after
  the first fresh frame. Both clients agreed on sampled race state.
- Four Chrome contexts on the same Mac used the same graphics settings and
  tunnel path. In the first run, all four entered catch-up, with maximum
  presentation gaps of 483, 450, 467, and 417 ms by controller. The
  longest waits were already present when the clients finished preparing
  their frames.
- A second four-player run omitted the compositor trace and covered the same
  3.38–21.36-second race window as the two-player run. Controllers 1 and 2
  entered catch-up once each. Maximum intervals between prepared frames were
  283, 250, 92, and 101 ms by controller. All four clients agreed on sampled
  race state for 900 steps in each run, with no room stalls or disconnects.
  These checks used one Mac for the dedicated runtime and all player windows.

## Unreleased WebGL2 preview checks

- A longer Pine Valley replay compared Sharp Bilinear WebGL2 with software
  Enhanced 2× at 16:9 and **+100%** draw distance. The local diagnostic
  launcher used RetroArch RWebAudio in both paths. Chrome 156 on an Apple M1
  ran the same 480-step solo input sequence four times in WebGL2, software,
  software, WebGL2 order. All four runs ended with the same console-state
  digest.
- After trimming the replay boundaries, each run matched 227 generated
  frames to renderer compositor submissions and Chromium display feedback.
  The median interval between presentations was 33.3 ms, the p99 was
  50.0 ms and none of the 904 measured intervals exceeded 60 ms. This is
  consistent with presenting approximately 25 new game frames per second
  on a 60 Hz cadence. Chrome presentation feedback measures compositor
  timing. The test did not measure physical screen or speaker output.
- Neither WebGL2 repeat had a gap over 5 ms between scheduled audio buffers.
  The two software repeats had five and six gaps, with a maximum of 16 ms.
  These measurements cover the local diagnostic launcher.
- A Chrome trace on the same solo Pine Valley section identified OpenAL queue
  waits of up to 33 ms inside emulation steps. The tested browser garbage
  collection events did not overlap the longest steps. With RetroArch's
  browser-native WebAudio driver, the 95th-percentile interval between WebGL2
  frames fell from about 63 ms to 46 ms in the driver comparison. Two repeats
  on the rebuilt local launcher measured 48–49 ms at about 50 PAL steps/s.
  Console-state digests matched, and neither final WebGL2 repeat had a gap
  over 5 ms between scheduled audio buffers. A second Pine Valley camera,
  PNG capture and the software pause screen also passed on that launcher.
- Local Chrome replayed 320 PAL steps each from the same solo and two-player
  Pine Valley states at 16:9 and **+100%** draw distance. Each run produced
  160 hardware frames at 2736×1024 with the stock HUD. Final console-state
  digests matched the software replays for both camera views.
- The preview exported a PNG. Selecting CRT restored the software view;
  selecting Clean resumed the preview. The Enter key opened the stock solo
  pause screen.
- On the test Mac, the 95th-percentile interval between new frames was about
  57 ms in the solo preview and 45 ms for the second camera. The separate
  Enhanced 2× runs measured about 46 ms and 51 ms respectively. These are
  local presentation timings. Live rooms and other GPUs remain unqualified.
- The same 320-step solo and two-player fixtures ran with nearest-neighbor
  and Sharp Bilinear texture sampling. Each produced 160 wide frames with
  matching console-state digests. The nearest-neighbor screenshots matched
  the previous preview pixel for pixel. The filtered runs kept PNG capture
  and software fallback in CRT and pause. The solo emulator-step p95 was
  about 41 ms with the filter and 33 ms without it in this comparison.
- A GPU-only world and HUD experiment reduced the median full step for the
  second camera from about 28 to 24 ms, but increased the p95 interval
  between new frames from about 46–48 ms to 62 ms. Grouping disjoint HUD
  quads reduced the draw count without restoring frame pacing, so the
  preview retains the software HUD and the previous world path.

## Unreleased frame recovery checks

- A follow-up Chromium trace reproduced the second controller's 117 ms
  presentation gap on the opening section of the same two-player Pine
  Valley race through Cloudflare. Both clients had an unusual four-step
  interval between generated frames at that point. Controller 2 had a new
  image ready after 88 ms, but it did not get a separate presentation. The
  following frame was ready after 116 ms and reached the compositor in
  under 1 ms. No catch-up or room stall occurred in that window.
- The dedicated WebGL2 client now yields one loop callback after a new
  frame ends a gap of at least 65 ms, when visible and below the catch-up
  threshold. The yield is limited to once per 250 ms. A probe in the same
  room and with the same rider assignments presented all 449 prepared
  frames on controller 2 and peaked at 100 ms. After loading the patched
  app in a new tunnel room, both clients presented all 450 prepared frames
  over the same 900-step opening section. The longest intervals were 83 ms
  and 100 ms, with zero catch-up or stalls. The final run used the same
  settings and reversed rider assignments. The four-step gap in frame
  generation still occurred.
- Two separate Chrome contexts on one Apple M1 joined the same dedicated
  room through a private Cloudflare Quick Tunnel. Both selected 16:9,
  **+100%**, Enhanced 2× and **Clean**. In the opening section of a native
  two-player Pine Valley race, both used WebGL2 at 1368×512, advanced their
  own sled and stayed connected throughout the same 900 Netplay frames.
  Neither entered catch-up or reported a room stall. Peak backlog was ten
  frames for controller 1 and nine for controller 2. Chromium confirmed
  449 and 448 presentations respectively. The p95 interval was 50 ms for
  both, and the longest intervals were 83 and 117 ms. Controller 2 had one
  interval above 100 ms. Both tabs remained visible. This was a same-machine
  test through the tunnel using the opening track section, with separate
  multiplayer starting positions.
- A dedicated Chrome replay used the same Pine Valley checkpoint and held
  accelerate for Netplay steps 160–1059 at 16:9, **+100%** and Enhanced 2×.
  The two software runs entered catch-up three and four times. Two runs in
  the standard lobby using WebGL2 at 1368×512 and **Clean** completed the
  window without entering catch-up. Median private render time on presented
  steps fell from 16.4–16.9 ms to 12.7–13.8 ms. The 99th-percentile canvas
  interval fell from 114–116 ms to 53–60 ms. An isolated gap still reached
  111 ms. The test also exercised PNG capture,
  Crisp pixels, CRT fallback and WebGL context-loss fallback. This was a
  local one-controller room on an Apple M1.
- A 900-step Pine Valley replay at 16:9, **+100%** and Enhanced 2× measured
  about 50 authoritative steps per second while the client sometimes ran
  only 40–46 steps per second before catch-up. The longest canvas upload gap
  in that run was 682 ms. Earlier task scheduling and software 1× still
  reproduced long gaps in follow-up runs.
- During visible wide-view recovery, the local renderer can now show another
  preview after gaining two frames on the room, with at least 80 ms between
  previews. The previous ten-frame progress requirement could keep the
  canvas frozen for much of recovery. One controlled 480 ms client pause
  produced preview intervals of about 110–145 ms after the first fresh
  frame. A repeat using the archive served by the launcher measured about
  110–113 ms during catch-up. One replay without an injected pause peaked at 75 ms
  between uploads. These are local canvas timings, and no result here
  establishes steady 50-step pacing under sustained load.
- A separate localhost run used the normal dedicated lobby, one controller,
  16:9, **+100%** draw distance and Enhanced 2×. Chromium confirmed all 225
  wide frames in the measured window. The p99 presentation interval was
  50 ms. One interval reached 83 ms, with about 75 ms already elapsed between
  the preceding and following canvas uploads. The room reported no stall or
  catch-up during this sample. A completed repeat with the same settings did
  enter catch-up and reached a 500 ms presentation interval, of which
  490 ms elapsed between canvas uploads. A separate repeat timed out before
  collecting the replay. The confirmed pauses were already present before
  Chrome composition. The trace did not identify what started the backlog.
- With RWebAudio selected only in the test client, both 480-step dedicated
  replays entered catch-up. The longest presentation intervals reached
  483 ms and 250 ms. Both were preceded by comparably long gaps between
  canvas uploads. The stalls reproduced with both drivers. These runs do
  not establish a benefit from changing the dedicated audio driver.
- In a local Chrome test of a dedicated room with one controller, a 480 ms
  browser pause during a solo PAL race recovered to six frames behind without
  covering the game. A 1.3-second pause recovered in about two seconds after
  catch-up started.
- With two Chrome contexts connected to a dedicated race on the same Mac, a
  1.3-second pause on controller 2 recovered to five frames behind. Controller
  1 advanced 251 frames during the check. Both controllers kept their slots.
- All 22 browser-module tests and 17 network tests passed. These recovery
  timings reflect local tests with injected browser pauses.

## Unreleased personal camera checks

- In Chrome, an isolated PAL race fixture drew the original **1st** and **3rd**
  banners in the center of the corresponding personal view. The private
  rendering pass preserved the console-state digest.
- A forced respawn fade darkened controller 1's view while controller 2
  retained its normal view. Skipping controller 2's personal render kept
  pixel-identical output in both 16:9 and 4:3.

## Unreleased draw distance checks

- Chrome restored the same PAL race frames with **Original**, **+50%** and
  **+100%**. At the maximum, the solo terrain span reached 20 grid cells
  from a stock 10, and the two-player personal view reached 18 from nine.
  The sampled four-player
  scene reached the geometry limit and used its original eight-cell span.
  Console-state digests matched across all settings for each fixture.
- With draw distance at **+100%**, skipping 24 emulated frames during a
  simulated catch-up switched the previous solo build to 4:3. Chrome showed
  pixel-identical 16:9 frames before and after the same gap with the fix,
  both in solo and in a four-player personal view with Enhanced 2×. The
  dense four-player fixture kept 16:9 at the original terrain span.
  The pause screen and the explicit **4:3 · Original** setting still use 4:3.
- A local Chrome comparison replayed the same 140 emulated frames in a dense
  four-player PAL race at **+100%**. The 99th percentile of the private
  render pass time dropped from about 59 ms to 42 ms. The renderer still
  needed a second pass on 15 of 70 drawn frames, compared with 16 before.
  In the solo and two-player samples the terrain span climbed back to the
  selected maximum. The aspect ratios and console-state digests matched.
- A second local Chrome comparison replayed the dense fixture with both 1×
  and Enhanced 2×. The median full emulator step among fallback frames fell
  from about 54 to 51 ms at 1× and from 71 to 66 ms at 2×. The 15 geometry
  rebuilds still occurred; the first pass no longer rasterizes the center
  that the second pass replaces. Two sampled output frames matched pixel
  for pixel at each resolution, and the console-state digests matched.
- The original single-player menu with its first selections opened Pine
  Valley. In a 23-second Chrome diagnostic run at 16:9, **+100%** and 1×,
  only two steps rebuilt the geometry more than once. Removing unnecessary
  work from the solo path kept the sampled 16:9 and 4:3 images and the final
  console-state digests identical in fixed-state replays. In a second live
  diagnostic run, the 95th-percentile gap between displayed frames was
  about 55 ms, versus 62 ms before, but a single gap still exceeded
  100 ms without a geometry rebuild. These local runs did not use the
  dedicated runtime.

## v0.8.2 checks — 2026-11-08

- 22 browser-module tests, 17 network tests and three HTTP handler tests passed.
- The default local launcher started a dedicated room in Chrome. A solo
  quick race loaded from the original game menu, and the sled responded
  to keyboard input.
- The online launcher created a Cloudflare Quick Tunnel. A second Chrome
  context opened the link from **Copy invite link**, downloaded the full shared
  disc without saving it, and synchronized as controller 2. Both players
  started Pine Valley, received personal camera views and moved their own sled
  using the default keyboard controls. Both contexts ran on one Mac.

## v0.8.1 release checks — 2026-11-08

- 22 browser-module tests, 19 network tests, three HTTP handler tests and
  Python syntax checks passed.
- Local startup checks verified the default dedicated shared-disc mode,
  explicit `--dedicated`, `--browser-hosted` and browser-hosted local-disc mode.
  The launcher rejected incompatible flag combinations.
- The native core was rebuilt and its presentation isolation checks passed.
  Chrome compared the same solo PAL race fixture with the stock respawn fade
  forced active. The bright side margins disappeared in both 1× and Enhanced
  2× at 16:9, while the HUD stayed visible.

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

## Current limits

- The Cloudflare gameplay runs used Chrome contexts on one Mac. Separate
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
