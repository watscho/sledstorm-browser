# Verification and known limits

## 0.9.1 verification summary

Release verification used Chrome on one Mac with the PAL SLES-02194 disc.

| Check | Result |
| --- | --- |
| Pine Valley impacts | Sign and ice fragments appeared in the striking guest's camera in both room types. The confirmed awards were 50 and 500 points. Both impact replays passed for each of the four controllers. |
| Personal camera and HUD | Checked 4:3 and 16:9 at 1×, software Enhanced 2× and the supported WebGL2 path. The checks covered snowfall, the finish banner, respawn fade, widescreen edges and isolation of the console state. |
| Rejoining | Guests recovered their controller assignments. In the dedicated loopback comparison, the remaining clients' scheduled audio gaps during a rejoin fell from 271–278 ms to 26–34 ms. |
| Full races | Races with two, three and four clients reached matching standings. The four-client loopback TLS race matched all 1,241 common confirmed gameplay samples. |
| Release build | Rebuilt the pinned core and verified the launcher in fresh Chrome profiles. Controller 2 stayed connected after the room creator left. All 26 browser tests, 19 network tests, four HTTP tests and the native presentation checks passed. |

The [Pine Valley checks](#development-checks--pine-valley-impact-effects)
record the test conditions and the remaining limits. The
[multi-device checklist](#follow-up-multi-device-verification) extends
coverage to separate computers and networks.

## 0.9.0 verification summary

The build that became 0.9.0 was checked on 2026-11-10 with the PAL SLES-02194
disc, Chrome and an AC-powered M5 Pro. All final Cloudflare clients ran on the
same Mac. The [current limits](#current-limits) describe the scope of these checks.

| Check | Result |
| --- | --- |
| Solo Pine Valley render matrix | The same 900-step fixture matched at Original and +100% across 4:3 and 16:9, with 1×, software 2× and the supported WebGL2 2× path. The extended solo samples reached a 20-cell terrain span from a stock 10. |
| Four-player start grid | All four sleds appeared in the captured pre-GO views. The wide backdrop filled the black edge bands in the reproduced countdown frame. |
| Dedicated Quick Tunnel rooms | The 2-, 3- and 4-player rooms matched all 900 sampled steps per client. The 4-player room matched a second 900-step window after rejoining. These runs recorded zero catch-up episodes, room stalls or scheduled audio gaps over 5 ms. |
| Focus and reconnect | While the creator's tab was hidden for 12 seconds, the other clients advanced about 600 steps. Controller 2 took ownership after the creator closed their tab, and controllers 4, 1 and 3 returned to their original seats. |
| Display pacing | The longest displayed intervals were 100 ms with two and three players and 117 ms with four. The latter followed a 97 ms pause in ordered delivery. Chrome submitted the prepared frame in under 0.5 ms. |
| Automated checks | 44 browser and network tests, four HTTP handler tests and the native presentation isolation checks passed. |

See [render settings in isolation](#pine-valley-render-settings-in-isolation),
[input timing](#pine-valley-input-timing-on-one-tunnel) and
[room stability](#pine-valley-room-stability) for the measurement details.

## Development checks — Pine Valley impact effects

Local Chrome replays on PAL SLES-02194 started from checkpoints prepared just
before contact with the yellow direction sign and the shortcut's ice wall.
The original game handled the collision and scoring in each replay.

- The stock solo camera displayed both impact effects. The four-player and
  two-player personal views restored the sign and the ice shatter for
  controllers 1 and 2 respectively. The ice wall retained the 500-point
  award. The tested 4:3 and 16:9 software paths, software Enhanced 2× and
  WebGL2 through SwiftShader matched the race state at seven sampled steps
  per replay.
- For the four-player ice wall, the WebGL2 command stream changed from zero
  matching fragment commands to 50 on the first sampled frame after contact.
  The canonical state digests matched across both builds. The captured
  private passes preserved the serialized console state.
- Two dedicated loopback rooms on one Mac loaded intact Pine Valley targets
  through the normal save-resume flow. The test held each checkpoint until
  the 4:3 host and 16:9 WebGL2 guest had synchronized. With the guest holding
  accelerate, the test resumed both clients at the same Netplay step. Both
  clients recorded the target breaking at the same confirmed step. All 78
  sampled steps around the sign hit and all 77 around the ice hit matched.
  The guest received one 50-point award for the sign and one 500-point award
  for the ice. The guest's Metal WebGL2 view submitted matching fragment
  commands in five sign frames and 38 ice frames. Its composed captures show
  both effects with the personal HUD. The sign capture shows the same
  floating 49 as the solo control while the HUD total is 50.
- The same checkpoints ran in two browser-hosted rooms on one Mac. Each
  client selected its own PAL CUE and BIN files, and the launcher returned
  404 for the disc archive. Only the host loaded the test checkpoint. The
  guest received it through Netplay. With the same scheduled start, the host
  and guest matched all 77 confirmed steps for each hit, including the
  50-point sign award and 500-point ice award. Two native screenshots per
  event at 1368×512 show the fragments moving in the guest's 16:9 software
  Enhanced 2× view. The sign popup advanced from 49 to 50 while the HUD
  total stayed at 50. Both clients reported zero camera and HUD errors.
- The native regression check now exercises the full-size layout with each
  controller, verifies that particle preparation receives its existing lists
  and checks that the private draw exits at the first viewport branch. The
  stock branch still runs with its original result outside presentation.
- A dense four-player widescreen checkpoint still needed two geometry builds
  on each of ten new frames at Original draw distance. A diagnostic trace
  reached the viewport exit once per build.
- One loopback dedicated room advanced through Pine Valley with four, three,
  then two connected controllers. Controller 4 rejoined in the original slot.
  Scene and racer fields agreed at nine common steps in each of the four
  sampled windows. Full serialized states differed across browsers in both
  the patched and baseline four-client runs. These were short tests on one
  computer using a prepared course-selection checkpoint.
- Dedicated rooms on one Mac completed full Pine Valley races from the
  original menus with two, three and four Chrome clients. A test driver
  sent ordinary accelerator and steering inputs. The two-, three- and
  four-client races ran three, two and three laps and matched at 118, 81 and
  128 common sampled steps respectively. Every client in each room showed
  the same order, finish times and points. The rooms mixed 4:3 and 16:9.
  The three- and four-client rooms also mixed 1× and software Enhanced 2×.
  PAL filled unoccupied racer slots with CPU opponents and used four
  viewports with three connected controllers.
- A repeat on the clean rebuild joined four fresh headless Chrome profiles
  to a loopback dedicated room with 4:3, 16:9 and WebGL2 Enhanced 2× through
  SwiftShader.
  The other clients advanced 70–94 race steps between closing controller 4's
  tab and reopening it. About 7.7 seconds after reopening, controller 4 was
  back in its own slot with its camera, HUD and non-silent stereo
  buffers. No client reported a camera or HUD error at that point.
  Three racers finished both laps. The scripted driver for controller 3
  completed one lap before the test deadline, leaving the settled standings
  and full-race audio comparison unmeasured in this repeat.
- A second four-client repeat forced Chrome to run WebGL2 through SwiftShader
  on the CPU. All four clients matched the sampled racer positions, scores
  and finish timers at 1,029 common confirmed steps. Controller 3 trailed the
  others by up to 36 sampled steps and its scripted driver timed out before
  finishing. Its browser scheduled 516 gaps over 5 ms between stereo buffers,
  with a maximum of 501 ms. The other three scheduled 4–22 gaps apiece,
  with a maximum of 395 ms. This was a single-Mac load test with the browser
  output muted. Chrome with its normal settings selected Apple Metal on
  the same Mac.
- With Chrome's normal graphics settings, all four clients completed both
  laps from the PAL menus in a dedicated room on the same Mac. Controller 3
  used WebGL2 Enhanced 2× through Apple Metal. The other views used 4:3 and
  16:9 at 1×. Controller 4 returned to its assigned slot in about 5.8 seconds,
  with its camera, HUD and audio buffers. Each of the other clients advanced
  70 race steps before controller 4 reopened the tab. The clients' core
  counters stayed within two steps at the sampled in-race checkpoints. All
  1,270 common confirmed samples matched, and the settled screens showed the
  same places, times and points on all four clients.
  The probe read the correct local rank and 91 HUD packets on each client at
  finish tick 23. The three software captures showed the placement banners.
  The WebGL2 capture read the underlying canvas, which showed the loading screen.
  The controlled WebGL2 replay below captures the composed finish animation.
  The audio probe counted 7, 2, 9 and 3 gaps over 5 ms by seat, with the
  longest gap measuring 293 ms. The fourth client's count covers the window
  after its return. Chrome's physical audio output was muted for the test.
- A timed comparison in four-client loopback rooms on the same Mac isolated
  the large scheduling gaps to controller 4's rejoin. With the previous
  dedicated host compression, the three remaining clients went 306–307 ms
  between core steps at the same race clock and recorded 271–278 ms audio
  scheduling gaps. The dedicated host now uses lossless zlib level 3 for its
  outgoing Netplay snapshots. Offline compression of two local checkpoints
  took 39–42 ms at level 3 and 204–217 ms at level 9 in native zlib, with
  level 3 increasing the compressed sizes by about 4.4%.
  In the repeat the corresponding core gaps were 75–77 ms and the audio
  scheduling gaps were 26–34 ms. No client recorded an audio gap over 5 ms
  in the 27 seconds after return. Controller 4 recovered the same slot,
  camera and HUD 5.3 seconds after reopening. The 132 common confirmed
  samples matched after rejoin. Audio was measured from the browser's buffer
  schedule.
- The same build completed two laps with four clients on one Mac through a
  loopback TLS gateway. The creator used the local launcher. Three guests
  opened matching PAL ZIP files from disk. The primary WebSocket used TLS
  with the fallback route enabled. The test selected the online branch on
  localhost. The gateway required a private access cookie and refused disc
  and diagnostic data requests. During controller 4's rejoin, a probe held a
  1,579,199-byte synchronization block for 184 ms before releasing it and the
  queued primary messages in order. Controller 4 recovered the same seat
  6.1 seconds after reopening. The other clients advanced 68 steps while the
  tab was closed.
  All 1,241 common confirmed gameplay samples matched. F8 captures showed
  matching places, best laps and points. The stored total times matched too.
  The local client scheduled six audio gaps over 5 ms, with a 38 ms maximum.
  The three guests scheduled none over 5 ms in the sampled race windows.
  The offline startup probe reproduced a vendor version-check TypeError
  when the test blocked that request. A locally supplied 503 response
  removed the exception. The game advanced in both cases.
- A separate two-client loopback run paused the guest's emulator for 1.3
  seconds. The guest reached a backlog of 62 steps and recovered to five
  steps behind with the same controller slot. The other player advanced
  130 steps over the interruption and recovery. The sampled race fields
  agreed at nine common steps both before and after the interruption.
- Local RWebAudio replays of the sign and ice wall scheduled 159–160
  non-silent buffers per 80-step replay, with no gap over 5 ms in either
  build. The console state matched at the end of each paired replay.
  Physical output remains part of the listening test.
- A diagnostic build checked stereo PCM from PCSX-ReARMed before browser
  resampling. All 100 batch checksums matched across the stock and enhanced
  cameras for the multiplayer sign, multiplayer ice and solo ice replays.
  Each replay collected 88,200 stereo frames at 44.1 kHz. A run without the
  sign hit changed the PCM at contact. Moving the ice collider away on the
  impact step preserved the active object and changed the PCM at that step
  in both modes.
- Bootstrap installed the pinned EmulatorJS assets into an empty destination
  from the cached official archive. The installed assets passed the pinned
  checksum check. A separate PCSX-ReARMed and RetroArch build from clean
  object directories loaded in Chrome and reproduced the ice impact in all
  four tested render configurations. Download and setup on a separate
  computer remain open.
- A clean source copy downloaded and verified the official EmulatorJS
  archive, checked out the pinned sources and installed the pinned SDK.
  The native build completed with Python 3.14 selected explicitly while
  the terminal still resolved `python3` to macOS Python 3.9. The build now
  checks the Python version up front and builds the Emscripten zlib port
  before compiling PCSX-ReARMed. The clean build generated the WebGL2
  module and passed both impact replays on all four controller slots.
- The clean build hosted a two-lap Pine Valley race in browser-hosted
  local-file mode. The creator used loopback and the guest joined through a
  temporary HTTPS tunnel. The game and diagnostic data routes refused
  requests through that tunnel. Both clients ran on one Mac and displayed
  the same standings. The live sampler matched 73 of 78 common steps and
  skipped rollback replays, so it did not establish agreement after
  reconciliation at the five differing steps.
- A separate short run through the same online path captured each sampled
  step on its first execution and again on rollback replays. It compared
  the latest samples for steps with confirmed inputs. The first executions
  differed at 23 of 159 common steps. All 159 matched after reconciliation.
- A three-client browser-hosted room reproduced a controller change through
  the HTTPS tunnel. When both guests closed their tabs, controller 3 returned
  first and received controller 2 on the earlier build. With the preference
  saved after synchronization, guests reopened the same invitation in fresh
  tabs and recovered controllers 3 and 2 in that order. The two remaining
  clients advanced 90 race steps while controller 3 was away. The host
  advanced another 424 steps while both guests returned. The returning
  clients resumed their native camera and HUD with no reported render errors.
  All three clients ran on one Mac and completed the two-lap race with
  matching standings. After both guests returned, the first executions
  differed at 274 of 737 common sampled steps. All 737 matched after
  reconciliation.
- Two four-client browser-hosted runs used the HTTPS tunnel and local disc
  files on one Mac. A probe buffered only controller 4's incoming messages
  for 150–167 ms and 1,305–1,307 ms, then delivered each batch in order.
  During the longer holds, controller 4 trailed the host by up to 18 and 24
  sampled steps. Its longest intervals between live core steps were 359
  and 436 ms. The sampled clients stayed connected and the step gap returned
  to within nine steps within about 1.7 seconds of release. One client
  reported a stall during the repeat. These intervals measure emulator
  processing during the hold, separate from display and audio output.
  Both rooms completed two laps. The sampled race fields matched after
  reconciliation at all 752 and 798 common steps respectively. The first
  run's early standings captures showed different times during the screen
  transition. In the repeat, two captures taken 1.2 seconds apart from
  300 steps after the standings appeared showed the same places, times
  and points on all four clients. The displayed times matched the stored
  race clocks.
- A four-controller Pine Valley checkpoint exercised the finish banner in
  4:3 at 1×, 16:9 at 1×, software Enhanced 2× and WebGL2. The check set
  the finish fields for one racer at a time. The earlier personal-camera
  build kept the finish timer at zero. The corrected build matched the
  original's 28 ticks after 56 core steps and drew the growing banner in
  the center. The captures showed **1st**, **2nd**, **3rd** and the original
  **last!** for fourth place. When a different racer finished, the local
  HUD stayed at its baseline packet count. The WebGL2 HUD layer had no
  banner pixels in the center.
- The launcher’s **F8** shortcut downloaded the composed finish frame on the
  clean build with WebGL2 through Apple Metal. The 910×512 PNG matched all
  23,196 sampled opaque banner pixels from the local HUD. The baseline and
  the capture after a different racer finished had no center banner. The
  same shortcut downloaded the local banner at 512×256 in 4:3, 684×256 in
  widescreen 1× and 1368×512 in software Enhanced 2×. All six captures
  preserved the canonical console-state digest. These were controlled
  checkpoints, with the game's own racer ranking and a scripted finish flag.
- The same checkpoint exercised the stock respawn fade one camera at a
  time. The selected camera darkened at the center and at both side margins
  in each wide render mode. At 4:3, fading a different camera left the local
  frame pixel-identical. In the wide modes, average brightness changed by
  at most 0.2 on a 0–255 scale in the sampled bands of the unaffected view.
  All 96 private passes sampled across the fade and finish replays preserved
  the canonical console-state digest. These are controlled local replays.
- A solo Pine Valley checkpoint on the same build confirmed the fade and
  finish animation with the stock 4:3 view, 16:9 at 1×, software Enhanced
  2× and WebGL2. The stock finish timer and all three wide paths reached
  28 ticks at the same step. Both side margins darkened in the wide views.
  The 12 sampled solo private passes preserved the console-state digest.
- Four browser-hosted Chrome clients on one Mac completed two laps from the
  original menus after the finish fix. Controller 4 saw **1st**, controller
  1 saw **2nd**, controller 3 saw **3rd** and controller 2 saw **last!** in
  their own cameras as they crossed the finish. The room mixed 4:3 and
  16:9 with 1× and software Enhanced 2×. The settled places, times and points
  matched on all four displays. The sampled gameplay fields, including
  finish timers, initially differed at 321 of 781 common steps. All 781
  matched after reconciliation. The eight sign and ice impact replays also
  passed on this build.
- Recorded controller inputs reproduced one natural landing per controller
  on Pine Valley and one in solo. The five jumps lasted 36–66 core steps.
  The personal views covered 4:3 and 16:9 at 1× and software Enhanced 2×,
  plus the 16:9 WebGL2 path. Racer positions, velocities, airtime and scores
  matched the reference at 1,692 replayed steps. The 169 sampled private
  passes preserved the console-state digest. The controller 3 captures
  showed snow spray behind the sled as it settled. The separate tread marks
  on the surface are drawn by PAL's solo-only trail routine.
- The same replays exposed missing snowfall in the personal view. PAL
  rejected lines whose previous endpoint still used split-screen coordinates.
  The private draw now selects the original racer's snow range and moves
  those endpoints to its full-size projection origin. Four sampled WebGL2
  frames per four-player seat contained 35–46 shaded snow lines after the
  fix, compared with 0–3 before. The sampled solo line counts stayed the same.
  In a separate two-player replay, the counts ranged from 93 to 98 across
  the two cameras with snow enabled and stayed at zero with the weather flag
  cleared. Before the fix, the counts were 0–2 for controller 1 and 13–27 for
  controller 2. Both builds ended each paired replay with the same
  console-state digest.
- Four alternating runs of the same dense four-controller checkpoint at
  16:9, software Enhanced 2× and Original draw distance measured 120 new
  frames and 231 geometry builds each. The 95th-percentile private render
  time was 26.9 ms before the snowfall fix and 27.8–29.0 ms after it. The
  95th-percentile interval between prepared frames was 50.8–51.3 ms before
  and 56.9–66.0 ms after. All four runs ended with the same state digest.
- Two Pine Valley landing frames exposed black corners beyond the 4:3
  viewport. The private ordering tables showed that PAL's fog gradient still
  covered only the original width. Extending that quad to the 684-pixel
  viewport removed all near-black pixels from the sampled corners of both
  frames in software 1×, software Enhanced 2× and WebGL2. Pixels inside
  the original projection matched in the compared areas. The state digests
  matched across the two builds.
- The software Enhanced 2× fallback now clips the first pass to the side
  margins when the next pass clears and redraws the center. All 176 compared
  software frames matched pixel for pixel, including 76 frames with two
  passes. The sample covered normal play and a forced respawn fade.
  Four alternating timing runs on the same dense Pine Valley checkpoint
  each prepared 120 frames with 231 geometry builds and the same final state
  digest. The 95th-percentile private render time went from 27.4–27.8 ms to
  25.4–26.1 ms. The 95th-percentile intervals between prepared frames were
  51.3–52.3 ms before and 51.1–51.3 ms after.
- The local browser-hosted GPU replay path displayed both impacts for
  controller 2. The original split-screen also displayed the ice shatter.
  The enlarged browser-hosted view showed missing terrain at the edges
  outside the original pane. This check used a local snapshot and covers the
  impact visuals. The snapshot contains the personal-camera HUD atlas.
- Browser-hosted RetroArch rooms now negotiate the full-size PAL renderer.
  A local Chrome room started Pine Valley from a course-selection checkpoint
  with four controllers and mixed 4:3 and 16:9 views. All four used the native
  pass and had no reported camera or HUD errors. The sampled race fields
  agreed in windows with four, three and two connected controllers and
  after controller 3 rejoined. These were short tests on one computer.
- The opt-in impact regression passed both events for each of the four
  controller slots on the clean build. On the earlier build, the ice replay
  for controller 1 and sign replay for controller 2 both failed because
  their personal camera received no matching fragment commands.
- Local diagnostic snapshots saved through the launcher in browser-hosted
  and dedicated RetroArch rooms passed the pinned state-format check.
  The dedicated room started from the original game menu.
- Four alternating headless Chrome runs replayed the same dense four-player
  checkpoint at 16:9, software Enhanced 2× and Original draw distance.
  Each measured 120 new frames, 231 geometry builds and the same end-state
  digest. The 95th-percentile private render time was 26.1–26.3 ms on the
  earlier build and 26.6–26.7 ms on the patched build. The 95th-percentile
  interval between prepared frames was 51.0–51.6 ms across all runs. One
  patched repeat reached a 99th-percentile interval of 63.1 ms. These are
  browser preparation timings from a local replay.

Repeat the effects check on Pine Valley with **Draw distance** set to
**Original**. Drive into a yellow direction sign and the ice wall at the
shortcut. Compare the moment of contact and the following frames in solo,
shared split-screen and dedicated personal cameras. Check the fragments and
sound alongside the object's removal and the single award. For a repeatable
renderer comparison, use the same local snapshot and inputs for each render
setting. Keep disc-derived snapshots and captures under ignored `.cache/`.

For an automated local comparison, run the launcher with the current native
build and install Playwright in your local Node environment. Generate the
WebGL2 renderer with `python3 tools/prepare-hardware-preview.py`. Save a
[local diagnostic snapshot](browser-emulator.md#local-diagnostics) in a
Pine Valley multiplayer race with personal cameras. Aim at the yellow
left-arrow sign on the approach to the start/finish banner or at the
shortcut's ice wall. Save while
the selected controller is close enough to hit the intact target by holding
accelerate for 31 core steps.

```sh
node tools/test-pal-impact.mjs sign .cache/sign-before.state 2
node tools/test-pal-impact.mjs ice .cache/ice-before.state 1
```

Use the controller number stored in the checkpoint. If Playwright is
installed outside the checkout, set `SLED_PLAYWRIGHT_MODULE` to the path of
its `index.mjs`. Set `SLED_TEST_CORE` to a local core archive to repeat the
test against another build. The test compares the impact step and console
state with and without local presentation, checks private-pass isolation
and verifies that WebGL2 receives matching fragment commands. It checks
the single 50-point or 500-point award and the presence of personal HUD
packets. Its fixtures stay local.

### Follow-up multi-device verification

1. On a separate computer, extract the current source archive or use a clean
   checkout containing these changes. From the source folder, begin setup with
   `python3 tools/bootstrap-emulator.py`.
   [Setup guide](setup.md)
2. On Pine Valley, compare solo, shared split-screen and personal cameras at
   Original draw distance. Check the yellow sign and ice wall on the striking
   racer's screen and any nearby camera with a clear view. Record the
   fragments, impact sound and one award to the racer who hit the object.
3. Start the online host with `python3 tools/play-online.py --disc-mode local`.
   This starts a browser-hosted room with a local PAL copy in each browser
   and the native build served by the host. Finish a full race with two,
   three and four players on separate computers across at least two networks.
   Include both 4:3 and 16:9, 1× and software Enhanced 2×.
   Check the start countdown, snowfall, snow spray, landings, respawn fade,
   lap counter and finish placement. Compare places, times and points once
   the results screen finishes updating.
4. Disconnect a controller during one race and return to its assigned racer.
   Confirm the race advances for the others and check HUD, audio and camera
   after rejoining. Note any visible or audible interruption and its duration.

Record the build, controller assignments, display settings and outcome for each
run. Identify each device and network by a short label and record whether its
VPN was on. Select **Time** in the settled standings and press **F8** to capture
the table without the browser address bar. Keep invitations, disc files and
diagnostic snapshots out of the shared results. Check the dedicated WebGL2
path separately on loopback using `python3 server.py --dedicated`, the
optional WebGL2 module, 16:9 Enhanced 2× and the Clean or Crisp pixels filter.

## Development checks — M5 Pro tunnel experiments

The following development notes describe intermediate builds and test controls.
They include regressions and experiments that were later replaced or removed.

- Four visible Chrome windows and the dedicated runtime ran on one M5 Pro
  through a Cloudflare Quick Tunnel. Pine Valley used **16:9**, **+100%** draw
  distance, and **Enhanced 2×**. The runtime held 50 PAL steps per second.
  In the ordinary run, all 900 sampled race steps agreed across the four
  clients. There were zero catch-up episodes and zero scheduled audio gaps
  above 5 ms. The longest interval between prepared frames for controller 1
  was 79 ms, compared with 116 ms in the earlier run on the same Mac.
- With a controlled 100 ms delay on controller 1's incoming stream, the
  longest prepared-frame interval around the delayed packet fell from
  165 ms to 75 ms. All 900 sampled steps still agreed. Later stress runs
  also recorded simultaneous CPU-side stalls across the four windows outside
  the injected delay. The Mac was on battery with substantial swap in use.
- Captures around the opening camera sweep reproduced a frame with four
  shadows and missing sled models on controller 2. At the same point after
  the change, all four sleds were visible. The opening sweep kept the original
  range across all four cameras in the follow-up captures.
- A later opening frame still exhausted the primitive pool even at the
  original draw distance. The stock split screen showed the sleds, while the
  private view showed only their shadows in hardware 16:9, software 16:9 and
  native 4:3. Reserving part of the stock pool for shadows and sleds restored
  all four models before GO in the private view. A repeat through Cloudflare
  captured 21 opening checkpoints per controller. At the same pre-GO step,
  all four cameras showed all four sleds. The 16:9 views still had missing
  scenery at the outer edges during part of the camera sweep.
- In a fresh four-player Pine Valley room after the render change, all four
  clients reached GO on the same step and matched the dedicated runtime on
  all 900 sampled race steps after reconciliation. Every controller moved and
  sent all six test steering inputs. There were no catch-up episodes or room
  stalls. The longest compositor-confirmed frame interval was 83.3 ms.
- The PAL Character Select screen retained the same green background in a
  local 4:3 run with the camera hooks and enhanced graphics disabled.

### M5 Pro on AC power

- The same build ran the opening Pine Valley section through Cloudflare in
  four visible Chrome windows while the M5 Pro was plugged in. The longest
  compositor-confirmed intervals were 83 ms with ordinary traffic, 117 ms
  with a 100 ms hold on controller 1's incoming stream, and 125 ms with a
  150 ms hold. Controller 1's longest displayed interval was 92 ms.
- A repeat of the 100 ms hold without compositor tracing peaked at 121 ms
  between prepared frames. All four runs agreed on 900 sampled steps each,
  with zero catch-up episodes or room stalls. Some shorter pauses in the
  stress runs coincided with RetroArch replaying steps after input changes.
- About 16 GB of swap stayed allocated, with zero swap writes and less than
  1 MB of swap reads across the measured windows. The earlier 630 ms
  multi-client pause did not reproduce under these conditions.

### Steering rollback follow-up

- The same AC-powered four-window test repeated the 100 and 150 ms holds
  after applying the full last confirmed controller state in rollback.
  The 100 ms run's longest displayed interval fell from 117 to 83 ms.
  In the 150 ms repeat, controller 3's longest displayed interval fell
  from 125 to 83 ms. Controllers 3 and 4 replayed 24 steps each, down from
  48 and 55. Controller 1 waited for input during a separate 108 ms gap
  around the injected hold.
- Each of the five runs matched all 900 sampled race steps, with zero
  catch-up episodes. The headless runtime maintained 50 PAL steps per
  second. The tested controller changes reached the outgoing WebSocket
  in 5–21 ms, within the frame sampling window measured before the change.
- An earlier 150 ms run also saw an unrelated 283 ms display gap on
  controller 2 before the injected hold. The gateway sent steps on time,
  and three clients received those packets together after the gap, with
  zero replay steps in the affected window.
  On the aligned clocks, controllers 1–3 received their first new step
  within 1.3 ms of one another. Controller 4 continued receiving steps
  throughout, with 37.6 ms as its largest gap in the same frame window.
  The macOS Wi-Fi log recorded a routine link-quality update and no link
  change in that window. The original capture had no TCP read timestamps.

### Quick Tunnel transport comparison

- During the earlier 283 ms presentation gap, controllers 1, 2 and 3 went
  262, 262 and 258 ms between consecutive step arrivals, respectively.
  Their next step callbacks occurred within 1.3 ms of each other on the
  same wall clock. Controller 4 continued receiving steps, and the relay
  and gateway continued forwarding steps to all four clients about every
  20 ms. The affected game loops still ran during the wait, with 32–51
  callbacks each over the same 250 ms window. These measurements place the
  wait after the gateway and before delivery to the WebSocket callbacks.
  All 109 input and step messages in the affected clients' recovery bursts
  matched individual gateway sends by command, size and step number.
  Step delivery remained ordered, and the oldest matched message spent
  425 ms between the gateway send and the browser callback.
  The connector used the Sofia edge in this trace, with median transit of
  42–44 ms. The trace could not identify the precise hop within the path.
- On the same AC-powered M5 Pro and Pine Valley settings, four QUIC runs
  and four forced HTTP/2 runs used the same Tbilisi connector edge address. They
  included ordinary traffic, 100 and 150 ms holds before the connector,
  and a 150 ms repeat without compositor tracing. Each run matched all
  900 sampled steps with zero catch-up episodes.
- The largest displayed gaps in the traced runs were 92 ms for QUIC and
  108 ms for HTTP/2. The repeats without tracing measured 106 ms and 92 ms
  between prepared frames, respectively. Gateway-to-browser transit medians
  were about 8–11 ms for both transports outside the injected holds.
  The 283 ms burst did not reproduce on either connection. A fresh default
  launcher invocation registered over QUIC and published the private invite.

### Batched input delivery

- A four-player QUIC test on the AC-powered M5 Pro held the downlink for
  controllers 2 and 3 at the gateway, then flushed the messages. Controller 1
  changed steering around the start of the hold to exercise rollback. Pine
  Valley used **16:9**, **+100%** draw distance, and **Enhanced 2×**.
- With a roughly 245 ms hold, the largest display gaps fell from 258 and
  242 ms to 150 ms on both affected clients. With a roughly 277 ms hold,
  the gaps fell from 258 and 275 ms to 175 ms on both clients. The largest
  scheduled audio gap in those traced runs fell from 79 to 27 ms. A 275 ms
  repeat without compositor tracing measured up to 167 ms between prepared
  frames and a 51 ms scheduled audio gap.
- The five runs with the updated build agreed on all 900 sampled race steps,
  with no catch-up or room stall. The ordinary and 100 ms runs had maximum
  display gaps of 83 and 92 ms and no scheduled audio gaps above 5 ms. Test
  pad changes reached the outgoing WebSocket in 0–20 ms, within the range
  measured with the previous prediction limit.
- The remaining display gaps coincided with replay after the burst. In
  the 245 ms run, a client spent about 129 ms in the netplay step before the
  next normal core run. This test reproduces the delayed delivery pattern
  and measures recovery on a real tunnel. The precise source of the
  historical delay inside the connection path remains unknown.
- A separate instrumented run matched WebSocket frame headers in Chrome's
  network log to game callbacks on all four clients. During the 277 ms hold,
  controllers 2 and 3 had 291–292 ms between TCP reads and 298–299 ms between
  WebSocket step headers. Without a hold, the longest step callback gap was
  45 ms. The imposed delay reached the browser's network process before
  affecting its game callbacks.
- In the instrumented 245 ms test, controller 3 replayed 16 steps in 121 ms.
  The core runs accounted for 118 ms, including about 12 ms in the GPU
  command renderer. Loading and saving state took about 3 ms in total.
  All three instrumented runs matched all 900 sampled steps, with no
  catch-up or room stall.

### Redundant WebSocket delivery

- The same four-player Pine Valley setup on AC power repeated the long
  downlink hold with two WebSockets per browser. A 276 ms hold on the primary
  connections of controllers 2 and 3 produced 300 and 282 ms gaps on those
  sockets. With the mirror delivering those steps, the largest display gap
  was 92 ms for both clients, with no scheduled audio gaps above 5 ms.
- Holding both connections for about 276 ms produced display gaps of 208
  and 175 ms. Holding only the mirror for about 277 ms produced gaps of 75
  and 83 ms for those same clients. The unmodified traffic run peaked at
  83 ms across all four displays.
- Repeating the primary-only hold at 247 ms produced a maximum 83 ms
  display gap on both affected clients. All five runs matched all 900 sampled
  race steps with no catch-up or room stall. Test pad changes reached the
  outgoing WebSocket in 0–22 ms, within the previous sampling range.
- Chrome's network log confirmed two distinct TCP connections for each
  browser. All eight connections still passed through the same Quick Tunnel.

### Separate connector experiment

- The four-player Pine Valley setup used a QUIC primary connector in
  Tbilisi and an HTTP/2 mirror connector in Sofia. The second tunnel exposed
  only the mirror WebSocket. Ordinary traffic peaked at 83 ms between
  displayed frames. A 276 ms hold on two primary downlinks produced
  75 and 92 ms display gaps for the affected clients.
- Suspending the entire primary connector for 277–278 ms twice produced
  up to 364 and 310 ms gaps on its streams. The separate mirror kept the
  race running, with maximum display gaps of 133 and 92 ms in the two
  runs. All four runs agreed on all 900 sampled steps with no catch-up
  or room stall.
- The mirror was downlink-only in those runs. A turn sent while the
  primary connector was suspended took 178 and 210 ms to reach the gateway
  from the outgoing WebSocket. The ordinary path took 6–8 ms. The browser
  issued both delayed commands within 8 ms of the test presses.
- A bidirectional test prototype used separate QUIC and HTTP/2 connectors
  that both registered in Sofia. During two 276–277 ms primary suspensions,
  the mirror delivered the turn in 39 ms from the outgoing WebSocket.
  The same commands arrived over the primary path after 150 and 152 ms.
  The gateway forwarded each command once, within 0.1 ms of the first copy.
  Both runs peaked at 92 ms between displayed frames, with no scheduled
  audio gaps above 5 ms. A run without a suspension also peaked at 92 ms
  and forwarded test turns 35–40 ms after the WebSocket sends. All three
  prototype runs matched all 900 sampled steps with zero catch-up or room
  stalls. This prototype ran outside the ordinary launcher.

### Separate connectors in the launcher

- The ordinary launcher started a primary QUIC connector in Sofia and a
  mirror HTTP/2 connector in Tbilisi for four visible Chrome clients. Two
  276 ms primary suspensions left 313 and 311 ms gaps on the primary
  streams. The mirror carried the test turns in 6–7 ms from the outgoing
  WebSocket. The same commands arrived on the primary after 186–191 ms.
  The gateway forwarded each turn once, within 0.3 ms of the first arrival.
- Maximum display gaps were 83 and 108 ms in the suspension runs, 117 ms
  with ordinary traffic, and 83 ms after the separate connector was
  terminated and the four clients fell back to the primary tunnel. All
  four runs agreed on all 900 sampled steps with no catch-up, room stalls
  or scheduled audio gaps above 5 ms.
- During the fallback run, one mirror socket naturally went 235 ms between
  TCP reads, 241 ms between WebSocket frame headers and 254 ms between
  game callbacks. The gateway sent the two steps 19.5 ms apart. The other
  socket delivered the same steps 18 ms apart, and controller 4's longest
  display gap was 75 ms. The trace localizes the delay between the gateway
  and Chrome's network process for that connection. The specific upstream
  hop and the exact trigger of the earlier 283 ms gap remain unknown.
- A launcher smoke test withdrew the mirror URL within a second of stopping
  the mirror connector. The primary launcher stayed available.

### TCP diagnosis with HTTP/2 connectors

- Temporary loopback probes timestamped traffic from the gateway to the
  connector and sampled macOS TCP counters on the external sockets. Chrome
  kept its end-to-end TLS connection to Cloudflare through the probe. Both
  connectors registered in Tbilisi. The four Chrome clients ran the same
  Pine Valley settings on AC power.
- A 275 ms hold at the gateway produced a gap of about 290 ms on the local
  connector stream and the external TCP socket. A separate 278 ms connector
  suspension left local reads at most 15 ms apart while external reads paused
  for 290–291 ms. The separate mirror delivered the test turn in 8 ms from
  the outgoing WebSocket, compared with 204 ms on the suspended path. The
  traced runs peaked at 83 and 92 ms between displayed frames.
- Three 90-second runs agreed on all 4,500 sampled race steps each. The two
  runs with separate connectors peaked at 76 ms between step callbacks and
  stayed out of catch-up. The last run used two sockets through one connector
  after stopping the separate mirror.
- In that last run, controller 2's mirror went 234 ms between external TCP
  reads while the gateway sent adjacent steps 20 ms apart. The receiver
  recorded 40 out-of-order bytes before delivery resumed in a burst, which
  shows TCP waiting for an earlier segment. The other socket delivered those
  steps 7 ms apart, and the largest interval between prepared frames around
  the event was 43 ms. The exact trigger of the historical 283 ms gap remains
  unknown.
- The same one-connector run also saw a separate two-second interruption
  across all eight external sockets. The gateway and local connector streams
  continued sending. Each external socket retransmitted 3.1–4.0 KiB of
  outbound data during the interruption. All four clients entered catch-up
  and recovered the same race state. The local Wi-Fi log and Chrome network
  log showed no recorded link or address change around the interruption.

### Separate connector recovery during a race

- The ordinary launcher ran four visible Chrome clients on the AC-powered
  M5 Pro with the same Pine Valley settings. After stopping the separate
  connector mid-race, all four clients opened their fallback WebSocket
  through the primary tunnel within 470 ms. The launcher obtained a new
  Quick Tunnel URL and all clients switched to it after 12.7 seconds, while
  keeping their existing Netplay connections and controller slots.
- The recovery run agreed on all 1,800 sampled race steps. The longest
  displayed interval was 83 ms, with zero catch-up episodes, room stalls,
  or scheduled audio gaps above 5 ms.
- The next run suspended the primary connector for 276 ms. A steering
  command sent during the suspension reached the gateway on the replacement
  route in 7 ms, compared with 194 ms on the primary. The gateway forwarded
  the first copy once. The primary streams went up to 305 ms between steps,
  while the combined streams peaked at 91 ms. The longest displayed interval
  was 92 ms in both the suspension and the subsequent ordinary run. Both
  runs matched all 900 sampled steps, with zero catch-up episodes, room
  stalls, or scheduled audio gaps above 5 ms.

### Three-client delivery burst in Sofia

- The same AC-powered M5 Pro and four-player Pine Valley settings used a
  QUIC primary and an HTTP/2 mirror, both registered in Sofia. Holding the
  primary downlinks for controllers 1–3 for about 246 ms produced step gaps
  of 265, 283, and 239 ms on those sockets. With the mirror, the largest
  gaps between delivered steps for those clients were 76, 55, and 88 ms.
  The largest displayed interval across the four clients was 100 ms.
- Holding both paths for those controllers for about 246 ms let the
  gaps reach the game callbacks, peaking at 268 ms. Local prediction still
  kept the longest displayed interval at 100 ms. A repeat with a 276 ms
  hold on both paths peaked at 296 ms between step callbacks and 108 ms
  between displayed frames. All three runs matched all 900 sampled steps
  each. None recorded catch-up, room stalls, or scheduled audio gaps above
  5 ms.
- Suspending the primary connector for 276 ms produced gaps of 277–292 ms
  on its four sockets. The mirror delivered the steering input
  in 40 ms from the outgoing WebSocket, compared with 175 ms on the
  suspended path and 39 ms over the mirror during ordinary traffic. The
  gateway forwarded the first copy in under 0.1 ms. The largest displayed
  interval was 92 ms, and all 900 steps matched.
- In an ordinary 90-second run, all 4,500 sampled steps matched. The
  longest delivered step interval was 84 ms, with zero catch-up episodes
  or room stalls. The QUIC connector reported no increase in lost or
  dropped packets. Its RTT samples had a median of 40 ms and a peak of
  47 ms. The longest prepared-frame interval was 121 ms, and controller 2
  had one 14 ms gap in scheduled audio. The compositor trace overflowed
  in this long run, so its displayed-frame intervals were unavailable.

### QUIC acknowledgements and browser socket reads

- A later four-client Sofia run on the same AC-powered M5 Pro recorded
  cloudflared's QUIC stream offsets and peer acknowledgements alongside
  Chrome's WebSocket headers and TCP read events. During a controlled
  277 ms connector suspension, new bytes on all four QUIC streams stopped
  for 290 ms. A test turn reached the gateway in 44 ms via the mirror and
  169 ms via the primary. All 900 sampled steps matched.
- Before that suspension, controller 3 naturally went 196 ms between
  delivered steps. The gateway-side connector still sent new data on all
  four QUIC streams at intervals of at most 21 ms, and the peer acknowledged
  the logged packets within 47 ms. Chrome's two sockets for controller 3
  went 177 and 173 ms between TCP reads, before the WebSocket frame parsing.
  Controller 4 continued receiving steps. The two WebSockets used
  different frontend IP addresses but the same Tbilisi POP in their
  upgrade responses. These measurements put the natural gap after the
  QUIC peer and before Chrome's socket read, while leaving the specific
  component within that path undetermined.
- Local prediction kept controller 3's longest displayed interval at
  83 ms. The short run had zero catch-up episodes, room stalls, or
  scheduled audio gaps above 5 ms.
- Two further 90-second runs used ordinary traffic and matched all
  4,500 sampled steps each. The longest delivered step intervals were
  78 and 45 ms. The longest prepared-frame intervals were 97 and 84 ms.
  Both runs had zero catch-up episodes, room stalls, or scheduled audio
  gaps above 5 ms. Compositor tracing was limited to the short run.
- A follow-up added transparent loopback probes for the browser-facing
  TCP connections and the local gateway-to-connector streams. Chrome kept
  end-to-end TLS to Cloudflare. The QUIC connector registered in Sofia and
  the HTTP/2 mirror in Tbilisi. A 276 ms primary suspension left the local
  streams receiving at intervals of at most 14 ms, stopped new QUIC stream
  bytes for 292 ms, and produced a 305 ms primary step gap. The mirror
  delivered the test turn in 8 ms, compared with 197 ms on the primary and
  6 ms over the mirror during ordinary traffic. All 900 steps matched, and
  the longest displayed interval was 100 ms.
- In an ordinary run, one controller 4 primary interval was 79 ms at the
  game callback but 19 ms at the WebSocket frame header and 11 ms at the
  external socket reads. Most of that gap occurred after Chrome's network
  process parsed the frame, distinct from the earlier long delivery gap.
- The two 90-second runs with both probes matched all 4,500 sampled steps
  each. The longest delivered step intervals were 72 and 53 ms, and the
  longest prepared-frame intervals were 88 and 87 ms. Across all eight
  browser-facing TCP connections, the counters recorded no out-of-order
  bytes or outbound retransmissions in either run. Both runs had zero
  catch-up episodes, room stalls, or scheduled audio gaps above 5 ms.

### Steering during a two-way interruption

- Four visible Chrome clients repeated Pine Valley at **16:9**, **+100%**
  and **Enhanced 2×** on the AC-powered M5 Pro through Cloudflare. The
  test submitted left, right, then neutral on controller 2, with four
  PAL steps between changes. A fourth client recorded the authoritative
  pad states sent by RetroArch.
- With ordinary traffic, the left and right changes reached the gateway
  in 39–40 ms. During a 277 ms two-way hold on the primary route of
  controllers 1–3, the mirror delivered the same changes in 40–41 ms.
  The primary copies arrived after 188 and 103 ms. RetroArch applied
  both directions in order, and controller 2's largest displayed
  interval was 75 ms in both runs.
- Holding both routes in both directions for about 277 ms raised
  controller 2's longest delivered step interval to 306 ms. The gateway
  forwarded both late steering changes in a batch under 0.2 ms. RetroArch
  folded them into the same server step and broadcast only the right
  turn. Controller 2's largest displayed interval was 92 ms, and
  controller 3 had a 25 ms gap in scheduled audio.
- A 426–428 ms two-way hold on both routes exceeded the prediction window.
  Controller 3 went up to 283 ms between displayed frames and 80 ms
  between scheduled audio buffers. RetroArch applied the final neutral
  pad state for controller 2. All four runs matched all 900 sampled steps
  each. Matching race state verifies synchronization, while a two-way
  outage on both routes can still affect short control inputs.

### Transport-only control

- The production gateway used its standard 8 MiB WebSocket limit. A
  283 ms pause at 50 steps per second represents roughly 1.5 KiB of
  ordinary framed race traffic per connection, far below that limit.
- A synthetic relay used the same gateway and two Quick Tunnel connectors
  in Sofia. It sent a 12-byte step and 80-byte pad update every 20 ms
  to four primary and four mirror WebSockets, without the emulator or
  browser. The local TCP probes kept the clients' TLS connections intact.
- Suspending the synthetic receiver for 279 ms produced a 285–291 ms
  callback gap on all eight WebSockets. The external TCP connections
  continued delivering bytes at intervals of at most 18 ms. That signature
  differs from the natural race gap where the external TCP reads paused.
- Over three minutes, the four logical clients shared 8,870 consecutive
  steps and all eight sockets stayed connected. Outside the controlled
  suspension the largest gap was 80 ms on an individual path and 54 ms
  on the ordered stream delivered from both paths.

### Controlled UDP loss on the connector-to-edge path

- The same four-player Pine Valley setup on the AC-powered M5 Pro used a
  temporary UDP proxy on the primary QUIC connector. Both connectors
  registered in Sofia. The ordinary run peaked at 63 ms between delivered
  steps and 83 ms between displayed frames.
- Dropping one outbound UDP datagram caused a QUIC loss declaration and
  retransmission of the same stream bytes after about 47 ms. The lost
  packet carried data for one stream. The longest delivered interval
  across the four clients was 88 ms.
- Dropping outbound UDP for 281 ms discarded 110 datagrams. The QUIC log
  recorded 88 loss declarations near the interruption. Primary step gaps
  reached 321–340 ms across all four clients. With the mirror, the largest
  delivered step interval was 101 ms and the largest displayed interval
  was 100 ms. The test turn sent during the drop reached the gateway over
  the still-available inbound direction in 40 ms, compared with 38 ms in
  the ordinary run.
- All three runs matched all 900 sampled steps each. None recorded
  catch-up, room stalls, or scheduled audio gaps above 5 ms. This controlled
  loss produced QUIC retransmissions. During the earlier natural 196 ms
  gap, the QUIC peer acknowledged ongoing writes promptly.

### Browser-facing interruption with and without the mirror

- Four Pine Valley runs on the AC-powered M5 Pro kept the same Cloudflare
  endpoints, **16:9**, **+100%** and **Enhanced 2×**. Test browsers used
  either the primary WebSocket alone or the production two-path transport.
  The loopback probe held downstream TLS bytes before Chrome for 276 ms
  on all four primary sockets in each stress run. It continued to read
  the external sockets and forward controller input during the hold.
- Without the mirror, the hold produced a 291 ms gap in delivered steps
  and a 117 ms gap between displayed frames near the interruption. With
  the mirror, the corresponding maxima were 88 and 100 ms. The four
  clients replayed 361 steps in total without the mirror and 223 with it.
- In the ordinary runs, median press-to-gateway time over 12 steering
  changes was 43 ms without the mirror and 38 ms with it. With the hold,
  the corresponding medians were 40 and 45 ms. The network portion of
  those medians was 36 and 34 ms. The two turns submitted during the hold
  reached the gateway in 36–37 ms from the WebSocket without the mirror
  and 33–35 ms with it.
- All four runs matched all 900 sampled steps each and recorded zero
  catch-up episodes or room stalls. Neither stress run recorded a
  scheduled audio gap above 5 ms. The ordinary runs recorded individual
  scheduled audio gaps up to 18 ms without the mirror and 23 ms with it.

### Longer single-route captures in Sofia

- Four visible Chrome clients on the AC-powered M5 Pro used one WebSocket
  each through the Sofia QUIC connector with the same Pine Valley settings.
  A limited compositor trace kept the displayed-frame timestamps available
  alongside QUIC acknowledgements and TCP counters over a 90-second run.
- Controller 1 had a natural 84 ms external TCP read gap. The gateway sent
  the adjacent steps 22 ms apart, Chrome parsed their WebSocket headers
  89 ms apart, and macOS recorded 208 out-of-order bytes. New QUIC writes
  continued on all four streams, and the peer acknowledged their packets
  within 78 ms in the measured window. Controller 4's 112 ms callback gap
  was separate. Its TCP reads and WebSocket headers were 16 and 20 ms apart.
- In the second run, all four clients ran the core at each step from
  19,110 through 19,116, with no replay in that window. The camera produced
  frames only at the endpoints, and the longest displayed interval was
  125 ms. External TCP read intervals remained at or below 35 ms during
  the run. The compositor received the next prepared frame in about 0.5 ms.
- The three 90-second captures preserved compositor timestamps and
  compared 13,500 race steps in total. One sampled step in the third run
  differed on one racer coordinate for controller 2. The preceding and
  following samples matched, and the probe recorded no replay at that
  step. No run entered catch-up or a room stall. The original 283 ms
  interruption did not recur in these captures.

### Dedicated server state comparison in Tbilisi

- Four visible Chrome clients on the AC-powered M5 Pro repeated Pine Valley
  at **16:9**, **+100%**, and **Enhanced 2×**. The primary connector used
  QUIC and the mirror used HTTP/2. A temporary probe sampled the dedicated
  emulator at the same netplay step as each client. The final sampled scene
  counter and 40 racer fields matched the server on all 900 steps in the
  ordinary run and all 4,500 steps in the stress run for every client.
  The probe recorded differences at 217 client steps across both runs.
  All preceded input confirmation and matched after replay.
- Holding the four primary TLS streams before Chrome for 275 ms produced
  primary callback gaps of 288–308 ms. The ordered stream from both routes
  stayed within 99 ms. Displayed frames stayed within 100 ms, with no
  catch-up, room stalls, or scheduled audio gaps in the measured window.
  Across 12 inputs per run, median WebSocket-send-to-gateway time was
  6.9 ms ordinarily and 6.6 ms with the hold. The corresponding medians
  from the test key press to the gateway were 10.2 and 14.5 ms.
- In the ordinary run, controller 3 had a 135 ms gap in JavaScript
  callbacks on both routes even though Chrome parsed the adjacent headers
  20–21 ms apart. The external TCP read gaps stayed within 14 ms, and the
  gateway sent the steps 20 ms apart. The delayed callbacks reached
  JavaScript about 116 ms after parsing, during a window with repeated
  rollback and a 133 ms displayed-frame gap. This isolates a browser-side
  delay for that event. The historical 283 ms event lacks equivalent
  capture data and its precise source remains unverified.

### Shorter prediction during steady delivery

- Four controlled 900-step Pine Valley runs on the AC-powered M5 Pro used
  **16:9**, **+100%**, and **Enhanced 2×**, with a Sofia QUIC primary and a
  Tbilisi HTTP/2 mirror. The test compared the existing six-step starting
  prediction limit with a two-step limit that grows faster when the
  confirmation frontier stops. Both policies retain the 18-step ceiling.
- The longest displayed interval fell from 125 to 83 ms in the ordinary
  runs and from 117 to 83 ms in the runs with a 275 ms downstream hold on all
  four primary sockets. In the ordinary runs, the longest browser task with
  replay fell from 80 to 43 ms. The largest task replayed eight steps with
  the previous policy and five with the two-step starting limit.
- All four clients matched the dedicated server at all 900 sampled steps in
  each run, with zero catch-up episodes or room stalls. With the shorter
  limit, the audio scheduling probe recorded no gaps in either run. Across
  12 inputs per run, median press-to-gateway time was 17.8 versus 16.9 ms
  ordinarily and 17.7 versus 8.8 ms with the hold. The median WebSocket
  transit time stayed within 7.1–8.0 ms across the four runs. These tests used
  a temporary browser override matching the policy now in the app.
- Two runs from the normal launcher verified the app policy without an
  override. Both connectors registered in Sofia. The longest displayed
  interval was 83 ms normally and 92 ms over the 90-second run with a
  276 ms primary hold. The effective step stream peaked at 73 ms in the
  hold run. All clients matched the server at each of the 5,400 sampled
  steps, with no catch-up, room stalls, or scheduled audio gaps. Median
  press-to-gateway time was 44.8 ms ordinarily and 43.0 ms with the hold.

### Both routes paused at the browser

- Four visible Chrome clients repeated Pine Valley at **16:9**, **+100%**,
  and **Enhanced 2×** on the AC-powered M5 Pro. A loopback probe held TLS
  bytes on all eight connections before Chrome. The primary and mirror
  connectors registered in Sofia using QUIC and HTTP/2 respectively.
- With a 284 ms downstream hold and no steering changes, the step stream
  paused up to 295 ms. The longest displayed interval stayed at 83 ms,
  and the probe recorded no replay during recovery. With steering changes
  during an equivalent hold, the longest step interval was 304 ms and
  the longest displayed interval was 108 ms. RetroArch replayed up to
  eight steps in one browser task. The two test presses reached the
  gateway in 45 and 60 ms and both appeared in the server's pad stream.
- A 285 ms two-way hold raised the longest delivered step interval to
  316 ms. Two test presses reached the gateway in 106 and 236 ms. The
  server missed the first short press and applied the second for three
  steps. The longest displayed interval was 83 ms, even though the
  interruption affected those controls.
- The ordinary run and all three hold runs matched the dedicated server
  on all 900 sampled steps for every controller. None entered catch-up or
  a room stall. The audio scheduling probe recorded no gaps in these runs.
- In a separate ordinary 90-second run, three connections stalled at the
  same race step. Browser-facing TCP reads paused for 120 ms on the mirrors
  for controllers 1 and 4 and 98 ms on controller 2's primary. Chrome's
  WebSocket header gaps were 128, 128, and 107 ms respectively. The gateway
  sent the adjacent steps 21 ms apart, and the local origin sockets continued
  receiving bytes at intervals within 15 ms. The alternate routes kept
  effective step intervals within 28 ms at that point. All 4,500 sampled
  steps matched the server, with no catch-up, room stalls, or scheduled
  audio gaps. The full run peaked at 72 ms between effective steps and
  92 ms between displayed frames. The earlier 283 ms event did not recur.

### Connector traces during a natural packet burst

- The same four-client Pine Valley setup logged QUIC stream writes and
  acknowledgements on the primary connector and HTTP/2 DATA writes on the
  mirror. Both connectors registered in Tbilisi. A 284 ms primary process
  suspension stopped new QUIC stream writes for 297 ms. The four primary
  browser step intervals reached 289–292 ms. The mirror kept the effective
  stream within 61 ms and the displayed intervals within 83.4 ms. The two
  test steering changes reached the gateway via the mirror in 14–16 ms
  and appeared in the committed pad stream.
- During an ordinary 90-second run, controller 1 had a natural 248 ms
  step gap on the HTTP/2 mirror. The gateway sent the adjacent steps 20 ms
  apart, and the local origin socket and all four HTTP/2 DATA streams kept
  processing writes at intervals within 16 ms. The external browser-facing
  socket received no bytes for 236 ms, then read 1,292 bytes at once.
  Chrome parsed the adjacent headers 248 ms apart and delivered each to
  JavaScript within about 1 ms. The primary kept the effective step interval
  at 33 ms at that point.
- The next 90-second run reproduced this pattern on controller 4's mirror.
  Chrome recorded a 239 ms step gap, and the browser-facing socket went
  236 ms without receiving bytes before reading a 1,314-byte burst. All
  four mirror streams continued writing DATA within 16 ms. The primary
  kept the effective interval at 13 ms for the affected step. The control
  run and both ordinary runs matched the dedicated server on all 9,900
  sampled steps for every client. No run entered catch-up or recorded a
  room stall or scheduled audio gap.
- The observed delay began after the mirror's local frame write and before
  the browser-facing TCP read. The HTTP/2 trace records writes rather than
  remote receipt. It cannot distinguish the connector's outbound TCP path
  from Cloudflare's forwarding or the client-facing path for this event.
- The affected browser-facing sockets each sent twelve 52-byte writes
  during their respective 236 ms receive gaps. Consecutive writes were at
  most 33 ms apart, and the kernel send queue repeatedly emptied during
  each gap. Established TCP data segments carry acknowledgements. This
  makes a receive gap caused solely by delayed local acknowledgements less
  likely, while leaving the remote sending and forwarding behaviour
  unobserved. [TCP specification](https://www.rfc-editor.org/rfc/rfc9293.html#section-3.1)

### TCP acknowledgements at the mirror's Cloudflare edge

- A temporary loopback TCP probe forwarded the mirror connector's encrypted
  HTTP/2 tunnel to its Cloudflare edge in Tbilisi. The probe sampled the
  external socket's send queue and acknowledged byte count. This adds one
  local hop while leaving TLS between cloudflared and Cloudflare intact.
- A controlled 284 ms hold before Chrome reproduced 289–315 ms gaps on the
  four mirror connections. The connector-to-edge socket continued making
  TCP acknowledgement progress at intervals within 15 ms, with no
  retransmitted bytes in the measured window. The effective step interval
  stayed within 65 ms, and the longest displayed interval was 83 ms.
- An ordinary run recorded a separate 187 ms step gap on controller 1's
  primary. The gateway sent the steps 20 ms apart. All four QUIC streams
  kept sending fresh bytes within 16 ms, and the peer acknowledged their
  packets within 9 ms. The browser-facing TCP read gap reached 120 ms and
  Chrome parsed the adjacent headers 178 ms apart. The mirror kept the
  effective step interval at 29 ms. Its own edge TCP acknowledgements
  continued at intervals within 15 ms during the event.
- Another ordinary run exposed one transient height difference during
  respawn at the same horizontal position as the earlier single-route
  mismatch. Controllers 1–3 recorded one value on the predicted step,
  while controller 4 matched the server. All four matched on the next step,
  without replay at that point. Neither step produced a new presented
  frame. The remaining 4,499 steps matched the server for all clients.
- Across three 90-second ordinary runs, the proxied mirror's longest
  browser step interval was 59 ms. The natural 239–248 ms mirror gaps from
  the direct-connector captures did not recur, so these runs cannot place
  those particular gaps relative to the edge's TCP acknowledgement.
  The longest displayed interval across the ordinary runs was 92 ms.
  Neither the control nor the ordinary runs recorded catch-up, room stalls,
  or scheduled audio gaps.

### Client-side delayed acknowledgement check

- Three 90-second runs used four visible Chrome windows on the AC-powered
  M5 Pro, Pine Valley at **16:9**, **+100%**, and **Enhanced 2×**, and the
  same Cloudflare room. The primary used QUIC in Sofia and the HTTP/2
  mirror used Tbilisi. The loopback proxy compared the default client-side
  TCP acknowledgement policy with `TCP_SENDMOREACKS` on the same external
  sockets, then returned them to the default. [macOS TCP socket options](https://github.com/apple-oss-distributions/xnu/blob/main/bsd/man/man4/tcp.4)
- The largest per-path browser step intervals were 125 ms in the first
  default run, 70 ms with more frequent acknowledgements, and 82 ms after
  restoring the default. The 125 ms event included a 119 ms browser-facing
  TCP read gap. The largest ordered step intervals were 58, 56, and 77 ms.
  None of the runs reproduced the 236 ms receive gaps from the earlier
  direct captures. These runs do not isolate an effect from changing the
  acknowledgement policy.
- The runs recorded no catch-up, room stalls, or scheduled audio gaps.
  Of 13,500 sampled steps, 13,499 matched the server across all four clients.
  One client differed in one rider's height on one unpresented step. The
  neighbouring steps matched the server.

### Mixed transport versus two QUIC connectors

- Four Chrome clients on the AC-powered M5 Pro repeated Pine Valley at
  **16:9**, **+100%**, and **Enhanced 2×** in the same room. Both connector
  destinations were in Tbilisi. After the mixed QUIC and HTTP/2 runs,
  only the test mirror was replaced with QUIC. All four clients retained
  their controller slots and recovered the mirror automatically.
- Ordinary traffic peaked at 83 ms between displayed frames in both
  configurations. Median press-to-gateway time across 12 test inputs was
  10.0 ms with mixed transport and 8.8 ms with two QUIC connectors.
- A temporary UDP proxy dropped outbound datagrams for 284 ms. With the
  HTTP/2 mirror, the primary gap reached 329 ms, while the effective
  step stream stayed within 60 ms and the displayed interval within 83.4 ms.
  With two QUIC connectors, the interruption affected both routes. The
  effective step interval reached 315 ms, the displayed interval reached
  142 ms, and controller 4 had a 13 ms gap in scheduled audio.
- The proxy left the inbound direction open. Both test presses during the
  outage reached the gateway in 9–12 ms with mixed transport and 7–20 ms
  with two QUIC connectors. All four clients matched the server on all
  3,600 sampled steps, with no catch-up episodes or room stalls. The
  protocol comparison isolates a shared UDP failure mode and supports
  keeping HTTP/2 as the backup. It does not identify the origin of the
  historical natural pause.

### Ordered fallback handover

- The browser regression test delays a packet on the temporary mirror
  and delivers a later packet over its replacement. It verifies that the
  temporary mirror stays open until the earlier packet arrives and the
  replacement packet reaches the ordered stream. Both mirrors carry input
  during the overlap, and the gateway accepts one ordered copy.
- Four visible Chrome clients on the AC-powered M5 Pro ran Pine Valley
  at **16:9**, **+100%**, and **Enhanced 2×** through Cloudflare. The
  ordinary 900-step run and two forced mirror replacement runs of 4,500
  and 1,800 steps matched the dedicated server on all sampled steps for
  every controller. None entered catch-up or recorded room stalls or
  scheduled audio gaps. The exact missing-packet order was verified by
  the browser regression test.
- A follow-up held a step from both the primary and the temporary mirror
  before opening the replacement. All four browsers received later packets
  on the new route and kept the temporary mirror open. The temporary copy
  restored ordered delivery 257–265 ms before the primary copy was
  released. Each temporary mirror closed after delivering its copy. Both
  test steering inputs submitted during the overlap reached the gateway
  in about 76 ms, including 33–34 ms before the browser sent them.
- All four clients matched the server on the 1,800 checked steps in the
  follow-up. The probe deliberately withheld both copies for more than half
  a second through the connection handshake. This produced up to 317 ms
  between displayed frames and up to 173 ms between scheduled audio buffers.
  The handover result concerns recovery of a packet already sent before the
  new mirror joined. The source of the earlier natural 283 ms pause remains
  unverified.

### Steering to the first confirmed displayed frame

- Four visible Chrome clients on the AC-powered M5 Pro repeated Pine Valley
  at **16:9**, **+100%**, and **Enhanced 2×** in the same Cloudflare room.
  The primary-only trial kept the mirror connected and suppressed its game
  data in the test browser. The two-path trial used ordinary ordered delivery.
- The probe timed synthetic steering presses to the first compositor-confirmed
  frame prepared after the server's pad transition reached the client and
  any replay of that step finished. Both timestamps used the same browser
  clock. It measures confirmed presentation and excludes physical controller
  latency.
- Two ordinary runs per mode tested 24 presses each. The median was 116.6 ms
  with one path and 119.6 ms with both. The pairwise medians moved in opposite
  directions across the two repetitions. The longest displayed interval was
  83.3 ms in both modes.
- During a 276 ms downstream hold on the primary, the two test presses
  reached confirmed presentation in 320.5 and 226.3 ms with one path and
  153.8 and 137.9 ms with both. The longest interval between displayed
  frames fell from 133.3 to 75 ms. All six runs matched the dedicated server
  on all 900 sampled steps for every client, with no catch-up or room stalls.

### Direct Chrome connections to Cloudflare

- Four visible Chrome clients on the AC-powered M5 Pro used the same Pine
  Valley settings through Cloudflare without the local measurement proxy.
  Chrome NetLog recorded eight distinct TLS sockets using HTTP/1.1 for
  WebSocket upgrades. Both browser endpoints were in the Tbilisi Cloudflare
  point of presence. The primary connector used QUIC to Tbilisi and the
  mirror used HTTP/2 to Sofia. macOS routed all four endpoints through `en0`.
- Stopping the primary connector for 285 ms produced 302–311 ms gaps on the
  primary in Chrome. With the HTTP/2 mirror, the effective Netplay step gap
  stayed within 55 ms and the longest displayed frame interval was 83.3 ms.
  Two steering presses during the hold reached the gateway once each through
  the mirror, about 42 ms after the browser sent them. Both appeared in the
  server's pad stream.
- In an ordinary run, four primary sockets stopped returning bytes to Chrome
  for 92–94 ms around the same step. Three mirror sockets also had gaps of
  92–93 ms. The gateway sent the affected steps 19–21 ms apart, both
  connectors kept writing, and QUIC acknowledgement times rose to 108 ms.
  Chrome dispatched the affected WebSocket frames within 8 ms of parsing
  their headers. Three controllers reached 108.3 ms between displayed frames.
  The exact source of the shared transport delay is unresolved. The original
  283 ms event did not have this socket trace.
- The second ordinary run peaked at 91.7 ms between displayed frames and
  53 ms between ordered steps. The two ordinary runs measured 4,500 steps
  each, and the hold run measured 900. All four clients matched the server
  on every sampled step after reconciliation. None recorded a catch-up
  episode, room stall or scheduled audio gap.

### Wi-Fi gateway controls

- A repeat recorded ICMP echo replies from the LAN gateway, both Cloudflare
  WebSocket addresses, Cloudflare DNS and a Google DNS address. macOS supplied
  kernel receive timestamps via `SO_TIMESTAMP`. All game clients and probes
  shared the Mac's Wi-Fi interface. The other network interfaces had no
  active Ethernet link.
- Before the measured race windows, replies from all five targets arrived
  in the same burst. The LAN gateway reached 343.5 ms RTT and the independent
  external target reached 348.7 ms. Kernel timestamps put the delayed replies
  within 7 ms of one another. Chrome read gaps reached 401–403 ms on three
  mirror sockets and ended within 4 ms of the LAN replies. The primary sockets
  kept reading within 29 ms, and the room sent steps within 22 ms.
  This episode involved the local network path and the mirror. The data
  does not distinguish the Mac, the wireless link and the router, or establish
  that the earlier 283 ms pause had the same cause.
- In the deliberate 283.5 ms primary connector hold, the LAN gateway RTT
  stayed within 7 ms around the hold and the independent external RTT stayed
  within 43 ms. The primary callback gap reached 310 ms, and the ordered step
  and display intervals stayed within 71 ms and 84 ms. Two test steering
  presses reached the gateway through the mirror 43–44 ms after being sent
  and both appeared in the server's pad stream.
- Both ordinary 4,500-step runs had a maximum displayed interval of 91.7 ms
  and a maximum LAN gateway RTT of 14.4 ms or less. Across those runs and the
  900-step control, no client entered catch-up or recorded a room stall or
  scheduled audio gap. The second ordinary run repeated the single-step
  respawn-height difference for controller 2's rider. Three clients sampled
  a height four units above the server on an unpresented predicted step, then
  all four matched on the next step without replay. All other sampled steps
  matched after reconciliation.

### Held controls during a shared delivery gap

- Four visible Chrome clients on the AC-powered M5 Pro repeated Pine Valley
  at **16:9**, **+100%**, and **Enhanced 2×** through Cloudflare. All four held
  accelerate throughout each test, and the probe captured the full pad word
  broadcast by the dedicated emulator.
- With the original 150 ms release rule, the ordinary run kept accelerate held
  and peaked at 83.3 ms between displayed frames. Two two-way holds of 285.0
  and 285.8 ms across the eight browser sockets made the server insert six or
  seven neutral steps per controller. The clients replayed after delivery
  resumed. The longest displayed intervals were 141.7 and 125 ms. All four
  clients matched the server on all 900 sampled steps in each run after replay.
- After the shared-gap grace change, the two equivalent holds lasted 284.8
  and 285.3 ms. The server kept accelerate held for every controller. The
  longest displayed interval was 83.3 ms in both runs, without rollback
  around the hold, catch-up, room stalls or gaps in scheduled audio. Each
  of the 900 sampled steps matched the server for every client in both runs.
- The ordinary updated run peaked at 83.3 ms between displayed frames.
  Twelve synthetic steering presses had a median press-to-gateway time of
  10.7 ms and a median WebSocket transit of 7.6 ms. The grace rule only
  applies when the server is missing input, and fresh input still reaches
  the next server step. These measurements exclude physical controller
  latency.
- A separate 284 ms two-way hold on just controller 1 still released that
  controller's pad while the other three kept accelerating. When all eight
  sockets were held for 461.8 ms, all four pads went neutral before packets
  resumed. That longer interruption produced a 208.3 ms display interval
  and a 64 ms scheduled audio gap. All 900 sampled steps matched the
  dedicated server after reconciliation in each control.
- A follow-up used direct Chrome connections and injected two-way holds
  at the gateway. Controller 1's two routes resumed after about 212 ms.
  Controller 2's two routes resumed after about 284 ms. Both pads kept
  accelerating through the entire gap, including the interval when only
  controller 2 was still affected. With steady input the longest display
  interval was 83.3 ms and no client needed rollback around the hold.
- In two repeats with steering changes, new input from unaffected
  controllers 3 and 4 reached the gateway in 7–11 ms during the shared gap
  and reached a confirmed displayed frame in 105–137 ms. The commands from
  affected controllers reached the gateway after 96–117 ms and appeared
  in a confirmed displayed frame after 243–310 ms. Controller 2's longest
  display intervals were 142 and 125 ms around the recovery, respectively.
  All four clients matched the server on all 900 sampled steps in each of
  the three injected runs after reconciliation. None recorded a catch-up
  episode, room stall or scheduled audio gap.
- In the initial unmodified race of this follow-up, controller 3 was already
  two PAL steps ahead of the server's game clock at the first measured step.
  At a two-step offset its first 101 sampled race states matched the server.
  Later inputs caused further divergence. The other three clients matched
  the server on the unshifted timeline. After restarting the race, all
  clients aligned with the server in the three injected runs. The cause of
  the first-race offset remains unverified.
- A separate probe recorded the console counters before the first race in
  two fresh rooms. All four clients entered the race and reached GO at the
  same step as the server in both rooms. The two first races and one restart
  matched all 900 sampled steps after reconciliation. In a local control,
  two ordinary restores from each of two snapshots reproduced all 390
  sampled gameplay steps. The exact-state restore matched the initial state
  digest but diverged in subsequent steps. The Netplay restore path was kept.
- The restart also caught a natural delivery interruption. Chrome's TCP
  reads for controller 3 paused for 1,640 ms on the primary and up to 900 ms
  on the mirror. The gateway sent the affected steps 19–21 ms apart. Chrome
  parsed the headers as the bytes arrived and the longest displayed interval
  for that controller was 633 ms. All four clients reconciled to the server.
  The socket trace places the interruption before browser emulation. The
  system Wi-Fi log did not identify the failing network hop.

### Direct Chrome and macOS TCP counters

- Two ordinary 4,500-step runs and one 900-step interruption control used
  four visible Chrome windows on the AC-powered M5 Pro, Pine Valley at
  **16:9**, **+100%**, and **Enhanced 2×**. Chrome connected directly to
  Cloudflare. macOS sampled each browser socket's TCP counters, and an
  independent probe timed ICMP replies from the LAN gateway and external
  addresses. The primary and mirror connectors used QUIC and HTTP/2 in
  Tbilisi, respectively.
- A natural burst on controller 3's primary put 255 ms between Chrome TCP
  reads and 259 ms between JavaScript step callbacks. The gateway sent the
  affected steps 20.1 ms apart. macOS counted 108 out-of-order bytes on
  that socket during the gap. The mirror's overlapping gap reached 118 ms
  and its socket counted 256 out-of-order bytes. The ordered stream stayed
  within 119 ms and controller 3's longest display interval was 91.7 ms.
  The LAN gateway RTT reached 72 ms nearby. The counters locate this event
  in browser-facing TCP delivery. The cause of the segment delay and its
  relation to the historical 283 ms event remain unverified.
- With both routes held for 212 ms on controller 1 and 285 ms on controller
  2, the longest ordered step gap was 312 ms and the longest displayed
  interval was 108.3 ms. Two brief steering changes from the affected
  controllers reached the gateway after 125 and 173 ms. The committed pad
  stream contained neither turn. The corresponding changes from
  controllers 3 and 4 reached the gateway in 8–9 ms and were applied.
- The ordinary runs peaked at 91.7 and 83.3 ms between displayed frames.
  Both runs had a 10.3 ms median from synthetic steering press to gateway.
  All four clients matched the server at all 9,900 sampled steps after
  reconciliation. None of the three runs recorded a catch-up episode,
  room stall or scheduled audio gap above 5 ms.

### HTTPS replay experiment

- Chrome reused an HTTP/2 connection for eight launcher requests. The test
  Quick Tunnel did not advertise HTTP/3 on those responses. The replay probe
  used a separate browser connection from the Netplay WebSockets. It asked
  for recent ordered packets after 90 ms without progress, keeping both
  WebSocket paths for normal traffic and input.
- The same four-player Pine Valley setup ran two ordinary 900-step trials
  and three controlled trials. Both WebSocket directions were held for about
  212 ms on controller 1 and 283 ms on controller 2. The longest displayed
  frame interval was 108.3 ms in the control, and 150 and 100 ms in the
  two HTTPS replay trials. One request recovered 12 packets 73 ms before
  their WebSocket copy. All other requests added zero packets. Chrome
  received the HTTP/2 response headers 115–399 ms after sending the requests.
- The ordinary runs had median press-to-gateway times of 9.7 ms with the
  probe off and 9.6 ms with it on. The probe made zero requests in its
  ordinary measured window. All 4,500 sampled steps matched the server
  across the four clients after reconciliation, with zero catch-up episodes,
  room stalls or scheduled audio gaps above 5 ms. The HTTPS probe stayed
  outside the runtime because it did not consistently improve presentation.

### Dedicated frame batching

- On the same Cloudflare connectors and AC-powered M5 Pro, the earlier
  core sent a 12-byte step marker and an 80-byte pad message about 7 ms
  apart in four-player Pine Valley. The updated dedicated host queues the
  marker and flushes it with the committed controller inputs before running
  the core. In a 350-step sample, at least 347 steps on each route fit in
  one 92-byte message. Control and synchronization messages still use the
  same ordered Netplay stream.
- In the ordinary matched runs, the median synthetic press-to-gateway
  time was 8.2 ms before and 8.5 ms after. The median time to the first
  confirmed displayed turn was 136.3 ms before and 96.6 ms after, and
  101.8 ms in a separate 4,500-step run of the updated core. The short
  ordinary runs both peaked at 83.3 ms between displayed frames.
- During the long run, controller 3's primary stopped returning new TCP
  bytes to Chrome for 275 ms. The gateway sent the two adjacent steps
  20.1 ms apart and macOS counted 240 out-of-order bytes. Delayed replies
  from the LAN router and several external addresses arrived
  within 5 ms of one another. The mirror delivered steps within 49 ms in
  the affected window, and the longest display interval there was 75 ms.
  The Wi-Fi log showed steady signal and no link change. The source of
  the shared local delay remains unverified.
- In the two steering trials with both routes held for about 283 ms on
  controller 2, the updated build peaked at 141.7 and 125 ms between
  displayed frames, versus 116.7 ms with the earlier build on the same
  tunnels. Controller 2 replayed 14 steps around the hold in both updated
  runs, versus 11 previously. Controller 1 had one 11 ms scheduled audio
  gap in the first updated run. Two short steering presses sent during
  each interruption were absent from the committed pad stream.
- With accelerate held steadily during the same interruption, the updated
  build peaked at 83.3 ms between displayed frames, with zero replay and
  zero scheduled audio gaps. Across all seven completed runs, the four
  clients matched the server at all 9,900 sampled steps after reconciliation
  and never entered catch-up or a room stall. One additional room startup
  timed out before joining. A fresh room started successfully on retry.

### Replay between browser tasks

- Six 900-step runs used the same four Chrome windows, AC-powered M5 Pro,
  Cloudflare tunnels and Pine Valley settings. A dedicated PAL client can
  now yield long replays between groups of complete console steps. The
  continuation enters through RetroArch's guarded post-frame handler and
  holds presentation until replay completes. The first prototype bypassed
  that guard and diverged. All six runs with the corrected continuation
  matched the server at all 5,400 sampled steps after reconciliation.
- With two-way holds of about 212 and 283 ms on controllers 1 and 2, the
  longest displayed frame interval was 125 ms with slicing disabled and
  116.7 ms in each of two enabled steering runs. Controller 2's longest
  measured browser task that included replay fell from 54.3 ms to 43.1
  and 44.5 ms. In all three holds, one short turn sent by controller 2
  during the interruption was absent from the committed pad stream.
- In ordinary traffic the median time from a synthetic press to the first
  confirmed displayed turn was 195.9 ms with either setting. Median
  press-to-gateway times were 42.7 and 42.4 ms. The frame interval peaked
  at 83.3 ms in both ordinary runs. With a steady held pad during the
  interruption, zero steps required replay and the longest displayed
  interval was 91.7 ms. All six runs had zero catch-up episodes, room
  stalls and scheduled audio gaps above 5 ms.

### Short steering inputs after a delivery gap

- A dedicated PAL race normally commits the latest pad word received for
  each controller. After a 130–400 ms delivery gap, the host can preserve a
  new steering tap that arrived with its release in the same update. It
  commits the most recent single direction for one PAL step, keeping the
  other buttons from the latest word. A direction already held before the
  gap, a currently held direction or a longer interruption uses the usual
  pad handling.
- In the four-client Pine Valley control, controller 2's short turn was
  absent from the committed stream after a two-way hold of about 285 ms.
  Two prototype repeats and the final build preserved exactly one turn
  step followed by neutral steering. The prototype's steering-hold trial
  applied a still-held turn for 12 steps. In a final-build single-controller
  hold, steering held before the interruption released without reappearing.
- During the final short-tap trial, the longest displayed interval was
  141.7 ms and the recovered turn reached a confirmed displayed frame
  304 ms after the synthetic press. There were zero scheduled audio gaps
  above 5 ms. During the 451 ms control, the short turn expired and the
  affected client recorded a 241.7 ms display interval and a 51 ms audio
  gap. The observed transport interruptions still delayed delivery.
- With recovery disabled and enabled in the final ordinary pair, the
  median synthetic press reached the gateway in 93.2 and 92.3 ms and the
  first confirmed displayed turn in 186.1 and 194.2 ms. The probe recorded
  24 presses per run. Both peaked at 83.3 ms between displayed frames. The
  recovery rule adds no wait to the live input path. All 4,500 sampled
  steps in the five final-build trials matched the server after
  reconciliation, with zero catch-up episodes or room stalls.

### Cloudflare frontend address comparison

- The same AC-powered M5 Pro used Wi-Fi and four visible Chrome windows
  for six Pine Valley runs at **16:9**, **+100%** and **Enhanced 2×**.
  Chrome's test resolver mapped both Quick Tunnel hostnames to the same
  advertised IPv4 address in one arm and to different advertised IPv4
  addresses in the other. The TCP log verified all eight WebSockets in
  each arm. Both frontend addresses responded from Cloudflare's Tbilisi
  location. The production launcher and system DNS were unchanged.
- Each arm covered 4,500 ordinary steps, 900 steps with holds of about
  212 and 283 ms on controllers 1 and 2's primary sockets, and 900 steps
  with the holds on both sockets for those controllers. The largest
  intervals between displayed frames were 116.7, 83.3 and 141.7 ms with
  the same address, and 91.7, 91.7 and 116.7 ms with different addresses.
  All four clients matched the server after reconciliation on all 12,600
  sampled steps. None entered catch-up, reported a room stall or scheduled
  an audio gap above 5 ms.
- In ordinary traffic, controller 1's primary TCP read paused for 250 ms
  with the same frontend address and 260 ms with different addresses.
  The gateway sent the affected steps about 20 ms apart. The mirror still
  delivered steps with maximum gaps of 95.6 and 75.3 ms, respectively.
  In the same-address arm, a separate event before the controlled hold
  paused all eight TCP streams for about 206 ms. During that event the
  local router's ICMP round trip reached 144 ms and the longest displayed
  frame interval was 75 ms. The source of the original 283 ms display gap
  remains unconfirmed.
- During the primary-only holds, controller 2's test press reached a
  confirmed displayed frame in 156 ms with the same address and 144 ms
  with different addresses. During the two-socket holds it took 358 and
  377 ms. Ordinary median press-to-gateway times were 8.9 and 10.3 ms.
  Both address layouts protected against a primary-only hold. The runs
  gave insufficient evidence to pin production sockets to specific IPs.

### Timing the replay after a shared pause

- A temporary timing build repeated Pine Valley on the AC-powered M5 Pro
  with four visible Chrome windows at **16:9**, **+100%** and **Enhanced 2×**.
  The QUIC and HTTP/2 Quick Tunnel connectors both registered in Sofia.
  The ordinary 4,500-step run peaked at 91.7 ms between displayed frames.
  Its 24 steering presses reached the gateway in a median of 41.2 ms and
  their first confirmed displayed turns in a median of 179.4 ms.
- Two further 900-step runs held both directions on both routes for
  about 211 ms on controller 1 and 283–286 ms on controller 2. The latter
  client's ordered delivery paused for 302–304 ms. The longest displayed
  interval was 83.3 ms with steady acceleration and zero replay, and
  116.7 ms with steering and replay. The two steering presses made during
  the hold reached confirmed displayed frames after 281 and 343 ms.
  All three runs matched the server after reconciliation on all 6,300
  sampled steps, with zero catch-up, room stalls or scheduled audio gaps
  above 5 ms.
- Around the steering hold, controllers 1 and 2 executed 14 and 11 replay
  steps. Executing those steps in the emulator took 98 and 77 ms in total.
  Clearing the buffer and saving the state together took 2.1 and 1.6 ms.
  The captures place the display interruption after the packets return,
  while the emulator is correcting the predicted steps. A faster state
  copy could remove only a small fraction of this interval.
- During room startup, router ICMP round trips reached 453 and 468 ms
  and external probes backed up in the same windows. Each window still
  contained 11 loopback replies with kernel round trips under 0.1 ms.
  The ordinary race itself peaked at 20 ms to the router, so the startup
  spikes locate a separate delay on the local network path without
  identifying the source of the original in-race pause.

### PS1 step breakdown during replay

- A temporary core measured PS1 execution, GPU DMA, video scanout and
  VBlank audio work in four more 900-step Pine Valley runs with the same
  four-player graphics settings. The M5 Pro was on AC power and both
  Quick Tunnel connectors registered in Tbilisi. Two runs used normal
  scanout. The paired runs omitted only the scanout copy during replay.
- In the normal scanout hold, controller 2's 15 replay steps took 104 ms.
  GPU DMA accounted for 8.1 ms, the video update for 0.12 ms, and the
  VBlank audio update for 1.2 ms. The remaining 94.7 ms was inside other
  emulation work. Removing the scanout copy saved about 0.1 ms in the
  video update around the hold and had no measurable pacing benefit.
- The longest displayed intervals were 75.0 ms ordinarily and 125.0 ms
  with the two-route hold in the normal scanout arm, versus 83.3 and
  133.3 ms with the copy omitted. Median press-to-gateway times in the
  ordinary runs were 7.6 and 8.4 ms, and median times to the first
  confirmed displayed turn were 97.9 and 102.3 ms. All four clients
  matched the server's sampled race state after reconciliation on all
  3,600 steps. There were no catch-up episodes, room stalls or scheduled
  audio gaps above 5 ms. The scanout experiment stayed out of the runtime.

### Guest hook address lookup comparison

- An exact address table covered the same 22 guest instruction hooks as
  the existing comparisons. A standalone WASM loop classified the same
  addresses in both implementations and favored the table. Four more
  four-player Pine Valley runs compared the two implementations in the
  same room and build, with both Quick Tunnel connectors in Tbilisi.
- In the ordinary runs, the per-controller median guest execution time
  during replay was 6.0–6.2 ms with the existing comparisons and
  6.5–7.2 ms with the table. The longest displayed interval was 83.3 ms
  in both runs. Median press-to-confirmed-display times were 97.7 and
  102.0 ms, respectively.
- With the two-route hold, the second player's longest displayed
  interval was 133.3 ms with the comparisons and 141.7 ms with the
  table. Both test turns sent during the hold reached confirmed frames
  in both runs. All four clients matched the server's sampled race state
  after reconciliation on all 3,600 steps, with no catch-up, room stalls
  or scheduled audio gaps above 5 ms. The isolated lookup speedup did
  not translate into a shorter replay in the game. The original core
  was restored.
- During the ordinary run with the existing comparisons, controller 3
  had an 83 ms TCP read gap on both paths and a 99 ms gap at the game
  callback. The gateway sent the affected steps 19 ms apart. Around the
  same event, controllers 1 and 4 had effective step gaps of 66 and 68 ms,
  while controller 2 stayed within 25 ms. The router round trip reached
  72 ms and loopback stayed near 0.1 ms. The longest displayed interval
  around the event was 67 ms. This reproduces a shorter three-client
  delivery gap, with delay visible before Chrome delivered the packets.
  The exact cause of the original 283 ms pause remains open.

### Background transfer controls

- Five 900-step Pine Valley runs used four visible Chrome windows on the
  AC-powered M5 Pro at **16:9**, **+100%**, and **Enhanced 2×**. Three runs
  delivered three 12 MiB synthetic HTTP responses each during the race.
  The same Mac served and received every response. The loopback control
  used 512 KiB writes. The Cloudflare runs used 512 KiB and 32 KiB writes
  with the same nominal rate. The QUIC primary registered in Tbilisi and
  the HTTP/2 mirror in Sofia.
- During the corresponding windows, the maximum router RTT was 10 ms
  without a transfer, 9 ms with the loopback transfer, and 68 ms with
  either Cloudflare transfer. The two Cloudflare runs delivered about
  45–52 Mbit/s and had maximum effective step gaps of 112 and 100 ms.
  The gateway sent the affected steps about 20 ms apart. The burst run
  recorded a 97 ms browser-facing TCP read gap and 480 out-of-order bytes
  on controller 3's mirror while loopback RTT stayed near 0.1 ms. Both
  Cloudflare transfer runs peaked at 100 ms between displayed frames in
  the measured windows.
- Median press-to-confirmed-display times were 97 ms without a transfer,
  102 ms on loopback, and 124 and 118 ms during the two Cloudflare transfer
  runs. A separate two-route hold gave a 301 ms effective step gap and a
  142 ms displayed-frame interval. All four clients matched the server's
  sampled race state after reconciliation across 4,500 steps, with no
  catch-up, room stalls or scheduled audio gaps above 5 ms. The transfer
  controls show one way to induce shared-path delay on this setup. They do
  not establish the trigger of the original 283 ms pause.

### Concurrent transfer rate control

- Three more 900-step runs kept the same four-player setup and used two
  Quick Tunnel connectors in Tbilisi. Each load pulse downloaded two 6 MiB
  synthetic responses concurrently. The high-rate run delivered 59–78
  Mbit/s. The capped run delivered 23–24 Mbit/s on average but still
  received up to 1 MiB within a 100 ms window. The router RTT peaked at
  161 ms and 100 ms, respectively, compared with 15 ms in the matching
  unloaded windows.
- With the cap, controller 2's primary TCP socket stopped returning bytes
  for 270 ms. Chrome delivered adjacent steps 283 ms apart and macOS
  counted 120 out-of-order bytes. The gateway sent those steps 20 ms apart.
  In that window the effective stream stayed within 100 ms and the
  longest displayed interval stayed within 67 ms. The high-rate arm
  also recorded a 276 ms TCP pause on controller 3's primary socket.
- Across the 12 matched input presses per arm, median time to a confirmed
  displayed turn was 102 ms unloaded, 103 ms at the higher rate, and
  119 ms under the cap. The sampled race state matched the server after
  reconciliation on all 2,700 steps. No client recorded catch-up, room
  stalls, or scheduled audio gaps above 5 ms. An average rate limit alone
  did not remove the burst in this control. The harness for the original
  283 ms incident read local disc ZIPs in all four windows, so the room's
  shared-disc download does not explain that incident.

### HTTP response framing control

- A separate HTTP fixture served two synthetic 4 MiB responses at a time
  in 32 KiB writes. Both arms used `application/octet-stream` and the same
  pacing. Only the response framing changed. The fixed-length arm sent
  `Content-Length`. The other arm omitted it and used HTTP chunked
  encoding. Direct loopback delivery stayed within 24 ms between reads
  with either framing.
- On a QUIC Quick Tunnel in Tbilisi, two fixed-length trials reached
  1,024 KiB received per 100 ms even though the origin wrote at most
  320 KiB per 100 ms. The HTTP client went up to 288 ms between chunks.
  The two chunked trials reduced those maxima to 464 KiB and 107 ms.
  Median delivery time for an origin block fell from 258–264 ms to
  61–68 ms across the two clients. Cloudflare documents buffering of
  proxied HTTP responses and its handling of streaming responses.
  [Cloudflare Tunnel troubleshooting](https://developers.cloudflare.com/tunnel/troubleshooting/#cloudflare-tunnel-is-buffering-my-streaming-response-instead-of-streaming-it-live)
- This fixture isolates HTTP response framing as a cause of bursts in
  the synthetic bulk traffic. It did not change the WebSocket protocol,
  exercise chunked bulk traffic during a race, or identify the trigger
  of the historical pause in a room using local ZIPs.

### Chunked transfers during a race

- Six 900-step runs used four visible Chrome windows on the AC-powered
  M5 Pro at Pine Valley, **16:9**, **+100%**, and **Enhanced 2×**. Both
  Quick Tunnel connectors registered in Tbilisi. Four runs alternated
  the fixed-length and chunked formats in reverse order. In each run the
  same Mac served and received three pairs of 6 MiB synthetic responses
  at 22–24 Mbit/s. The two remaining runs had ordinary traffic and a
  controlled hold on both WebSocket routes, respectively.
- In the transfer windows, the longest individual WebSocket delivery
  gap fell from 267 to 70 ms with chunked encoding. The longest effective
  step interval fell from 124 to 50 ms and the longest displayed interval
  from 108 to 83 ms. Maximum router RTT fell from 102 to 36 ms while the
  gateway's step interval stayed within 23 ms. Across 12 matched test
  presses per run, the two fixed-length medians to confirmed display were
  100 and 108 ms, compared with 101 and 109 ms for the two chunked runs.
- All four clients matched the server's sampled race state after
  reconciliation on all 5,400 steps, with zero catch-up episodes or room
  stalls. The fixed-length repeat had one 11 ms scheduled audio gap.
  The separate two-route hold still produced a 307 ms effective delivery
  gap and a 150 ms displayed-frame interval.
- The private gateway now streams successful shared ZIP downloads and
  sends the archive size in `X-Sledstorm-Disc-Size`. The browser uses that
  size for progress and incomplete-download checks. Direct downloads
  still provide their size through `Content-Length`, as do gateway HEAD
  requests. The changed gateway returned the exact synthetic 4 MiB
  archive through Cloudflare with its SHA-256 intact and rejected requests
  without the access cookie. The local gateway test also exercised an
  interrupted upstream archive response. The original local-ZIP incident
  remains unresolved.

### Cloudflare and loopback in the same room

On an M5 Pro on AC power and Wi-Fi, three visible Chrome windows used the
two Quick Tunnel routes and a fourth connected to the same gateway over
loopback. All four used local ZIPs, 16:9, +100% draw distance and Enhanced 2×
on Pine Valley. The loopback client used the same playback configuration
as the tunnel clients for the timing comparison.

- During the 4,500-step run, controller 2 had a 143 ms gap in ordered
  delivery. Chrome recorded 139 ms without a TCP read on the primary
  socket and 136 ms on the mirror. The gateway emitted the affected steps
  about 20 ms apart. The same steps reached the loopback client about
  21 ms apart. The Wi-Fi gateway probe reached 121 ms at the same time,
  while the loopback probe stayed around 0.1 ms.
- Controller 3 also had an isolated 219 ms TCP read gap on the mirror
  while the Wi-Fi gateway probe stayed below 9 ms. The primary kept the
  ordered delivery gap to 64 ms. The two observations show distinct
  timing patterns. The exact path of the original 283 ms event remains
  unverified.
- With a 283 ms hold on the primary for all three tunnel clients, the
  largest ordered delivery gap was 55 ms and the largest interval
  between displayed frames was 83 ms. Holding both routes raised those
  peaks to 299 ms and 117 ms. For the same steps, the loopback client
  received data 18 ms apart and its largest displayed-frame interval
  in that run was 75 ms.
- All four clients matched the dedicated runtime after reconciliation on
  all 6,300 sampled steps across the three runs, with no catch-up episodes
  or room stalls. The three steering inputs sent during the dual-route
  hold reached the gateway 158–203 ms after the press.
- The compatibility check previously rejected the loopback client because
  its mirror address differed. After separating transport settings from
  the game identity, the regular launcher at `http://127.0.0.1:8000/`
  also created a room that a second Chrome window joined through its
  Cloudflare invitation.

### Two-stage replay of the historical delivery gap

- In the original trace, controllers 2 and 3 first waited 146–148 ms
  for step 10,807. That was the only new step until another 258–262 ms
  passed. Controller 1 kept receiving steps through 10,813 before it
  joined the pause. The three controllers resumed together. Controller 4
  continued receiving steps while the gateway sent to all four normally.
- Four Chrome clients repeated that sequence on the AC-powered M5 Pro
  through the Sofia Quick Tunnel connectors. All clients used local ZIPs
  and ran Pine Valley at 16:9, +100%, and Enhanced 2×. The gateway held
  downstream data in two stages for controllers 2 and 3 and in one stage
  for controller 1. It left controller 4 and the upstream direction
  alone.
- In the control build, the one new confirmation cut the prediction limit
  from 11 steps to 2 while the following data was still delayed. Keeping
  the widened limit through that isolated confirmation avoided the first
  presentation pause, but consumed the 18-step budget sooner. The test
  client then waited for the bulk of the data and replayed the affected
  steps. Controllers 2 and 3 peaked at 133–150 ms between displayed
  frames in two current-build runs, and at 133–183 ms in two runs
  with the experimental policy. The experimental policy was left out
  of the game.
- The two ordinary runs recorded 24 presses each. Median press-to-gateway
  time was 42.1 and 42.4 ms, and median time to the first confirmed
  displayed turn was 186.5 and 185.5 ms. These measurements separate
  the client's response to the isolated step from the still unknown
  cause of the original network interruption.
- When only the primary route was held, its step intervals reached
  269 ms. The mirror kept ordered delivery within 52.1 ms and the
  displayed frame interval within 66.7 ms. All four clients matched
  the dedicated runtime after reconciliation on all 6,300 sampled
  steps across the seven runs, with no catch-up episodes or room stalls.

### Pacing prediction after an isolated late step

- A test client paced speculative steps after the isolated confirmation
  instead of spending the remaining prediction budget at the usual rate.
  The budget still capped the client at 18 steps ahead of the confirmed
  input. The four-player Pine Valley setup used the same graphics settings,
  local ZIPs and two Quick Tunnel routes on the AC-powered M5 Pro.
- In two comparisons with the two-stage downstream hold, controller 2
  presented three or four frames between bursts on the current policy
  and five or seven with pacing. Controller 3 went from three to five.
  The longest frame interval near the burst fell from 142–158 ms to
  83–125 ms on controller 2 and from 133–158 ms to 83–133 ms on controller 3.
- Test steering started on a wall-clock timer in the middle of the
  second gap. The experimental policy reached the gateway in 6–33 ms
  for those two controllers, versus 16–35 ms on the current policy.
  This measures delivery of the input while the downstream route is
  held. A confirmed display of the turn still waits for the server data.
- The launcher enables pacing only when exactly one confirmation follows
  a gap of at least 100 ms. In the final-build comparison, controllers
  2 and 3 peaked at 67 and 83 ms near the burst, versus 133 ms each on
  the earlier policy. Controller 1 saw a 133 ms interval with the final
  build and 100 ms in the comparison. Pacing did not activate for that
  controller. With steady acceleration, controllers 2 and 3 both stayed
  within 67 ms near the burst and none of the clients needed to replay
  steps there.
- Pacing did not activate in the final ordinary run. Both ordinary
  final-series runs peaked at 83 ms between displayed frames. The
  median press reached the gateway in 94.1 and 96.7 ms, respectively,
  over 24 presses each. This pair used a higher-latency connection than
  the earlier prototype runs, so compare timings within each pair.
- All four clients matched the dedicated runtime on 4,500 sampled steps
  in the final series, with zero catch-up episodes or room stalls. An
  earlier prototype had one unconfirmed sample with a different rider
  coordinate on all four clients. The following sample matched again.
  The imposed delivery gap persisted with the final build.

### Cloudflare frontend location changed between runs

- Two successive browser sessions used the same Quick Tunnel pair while
  both cloudflared connectors stayed registered in Tbilisi. The first
  session's eight WebSocket upgrade responses all reported `TBS` in
  `CF-Ray`. The second session's eight responses all reported `BUD`,
  although Chrome connected to the same pair of advertised IPv4 addresses.
  The browser-facing TCP handshake took 5–41 ms in the first session
  and 64–71 ms in the second. Median gateway-to-browser step transit
  went from 9–10 ms on both routes to 101–139 ms on the primary and
  33–76 ms on the mirror, depending on the controller.
- The different baseline delays coincided with this change in serving
  location. The WebSocket response header identifies
  the data center that processed the request. Cloudflare's anycast
  addresses can be served by multiple locations, so pinning the two
  observed IPv4 addresses would not pin the serving location. The older
  283 ms trace has no equivalent upgrade headers or TCP read timestamps.
  [Cloudflare routing documentation](https://developers.cloudflare.com/support/troubleshooting/general-troubleshooting/geographic-traffic-routing/)

## Development checks — dedicated draw distance

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

## Development checks — WebGL2 preview

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

## Development checks — frame recovery

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

## Development checks — personal cameras and lobby

- In Chrome, an isolated PAL race fixture drew the original **1st** and **3rd**
  banners in the center of the corresponding personal view. The private
  rendering pass preserved the console-state digest.
- A forced respawn fade darkened controller 1's view while controller 2
  retained its normal view. Skipping controller 2's personal render kept
  pixel-identical output in both 16:9 and 4:3.
- A guest in a second local Chrome context selected **Return to lobby**, kept
  the room URL, and joined again as controller 2.

## Development checks — draw distance and final race verification

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

### Pine Valley render settings in isolation

- Local Chrome replayed the same 900 PAL steps from before GO on an
  M5 Pro. Each comparison used the same checkpoint and steering inputs.
  The table excludes the countdown when measuring intervals between
  completed emulator steps that advanced the race clock.

| Solo setting | Draw distance | Step interval p95 / max | Emulator work p99 |
| --- | --- | ---: | ---: |
| 4:3, 1× | Original | 44.0 / 61.5 ms | 9.8 ms |
| 4:3, 1× | +100% | 45.3 / 62.5 ms | 16.0 ms |
| 16:9, 1× | Original | 45.7 / 66.6 ms | 16.2 ms |
| 16:9, 1× | +100% | 45.4 / 53.8 ms | 16.7 ms |
| 16:9, software 2× | Original | 45.6 / 56.8 ms | 18.2 ms |
| 16:9, software 2× | +100% | 45.6 / 63.2 ms | 18.9 ms |
| 16:9, WebGL2 2× | Original | 46.1 / 55.4 ms | 16.3 ms |
| 16:9, WebGL2 2× | +100% | 46.1 / 55.2 ms | 17.0 ms |

- All eight replays ended with the same console-state digest. The +100%
  setting reached a 20-cell span from a stock 10 at each tested setting.
  The extended runs did not rebuild the view twice on any sampled step.
  The start, first bend and last sampled 1× frames showed no missing
  terrain in the captured solo camera. The cold WebGL2 run had one
  87 ms emulator step before GO. The timed race portion peaked at 55 ms.
- The follow-up filled in the 4:3 software 2× settings on the same fixture.
  Step interval p95/max was 45.5/63.5 ms at Original and 45.7/57.1 ms at
  +100%. The range reached 20 cells at +100%, and both runs matched the
  earlier console-state digest. The captured bend retained its geometry
  and HUD in both settings.

### Four-player Pine Valley start and race

- With four Chrome windows on the same M5 Pro using a Quick Tunnel, the
  wide Enhanced 2× countdown showed black strips where the original fog
  backdrop ended at the 4:3 boundary. A saved start-grid state reproduced
  the defect locally. Reducing the terrain span by one cell did not clear
  the strips in the later countdown checkpoints.
- The private wide start view now extends the original shaded backdrop to
  the edges. The same local checkpoint kept its eight-cell terrain span,
  all four sleds and the same console-state digest in 4:3, 16:9 software 1×
  and 16:9 WebGL2 2×. Near-black pixels fell from 61% to zero in the sampled
  edge bands on the reproduced frame. The normal opening fade and exposed
  fog in the distance still appear during the countdown.
- Two Cloudflare runs with the fix confirmed that the wide strips were gone
  at the late countdown checkpoints. All four clients agreed with the server
  at each of the 900 timed race steps per run after rollback. Chrome's
  display trace peaked at 83.3 ms between changed frames, with no catch-up,
  room stalls or audio scheduling gaps over 5 ms. The runs on the new tunnel
  measured 45.8 and 42.3 ms median input arrival at the gateway, compared to
  15.5 ms in the baseline run on a different tunnel. Median time from input
  to the first displayed frame with that input was 186.2 and 194.2 ms,
  compared to 119.7 ms in the baseline. The tunnel change prevents a direct
  comparison of the rendering change's effect on input latency.

### Pine Valley input timing on one tunnel

- Four visible Chrome windows on the same M5 Pro used one Quick Tunnel
  URL and one WebSocket per client for every run. The test harness disabled
  the mirror route. The dedicated runtime and browser assets were identical
  across runs except for the client Wasm file before or after the start-grid
  backdrop fix. Each run measured 900 steps from 3.38 s to 21.36 s on the
  Pine Valley race clock at 16:9, +100% and WebGL2 Enhanced 2×.
- The probe injected 24 steering presses per run at the emulated pad. It
  matched the send time, the forwarded command at the gateway, the
  authoritative pad bundle, the first confirmed ready frame and Chrome's
  presentation feedback. The press-to-screen measurement excludes physical
  keyboard polling. The receive-to-ready stage includes PAL's drawing cadence
  and rollback reconciliation as well as rendering.

| Client Wasm | Press to screen median / max | Wire round trip median | Gateway to committed bundle median | Browser receipt to screen median | View build median |
| --- | ---: | ---: | ---: | ---: | ---: |
| Before the fix | 188.3 / 237.0 ms | 88.5 ms | 10.5 ms | 84.2 ms | 9.2 ms |
| After the fix | 192.8 / 233.8 ms | 85.9 ms | 14.3 ms | 83.1 ms | 8.9 ms |
| Before the fix, repeat | 187.5 / 220.0 ms | 90.7 ms | 13.5 ms | 78.3 ms | 9.1 ms |

- Wire round trip sums the client-to-gateway and gateway-to-client legs
  for each press. Chrome's matched WebSocket headers preceded the browser
  receive callbacks by a median of 1.3–1.7 ms. The browser responses carried
  Cloudflare's TBS code, while the tunnel connector registered in `sof01`.
  The earlier 119.7 ms and 194.2 ms runs had 16.2 ms and 94.5 ms wire
  round trips, respectively. The latter had a shorter receipt-to-screen
  median, 64.7 ms versus 84.2 ms. The higher transport time accounts for
  the earlier increase, and the same-tunnel runs showed no comparable
  increase after the rendering fix.
- In all three runs, each client matched all 900 server steps after
  reconciliation. The longest displayed frame interval was 83.3 ms.
  There were no catch-up episodes, room stalls or scheduled audio gaps
  above 5 ms.

### Pine Valley room stability

- Four visible Chrome windows on the AC-powered M5 Pro ran Pine Valley for
  4,500 steps at 16:9, +100% and Enhanced 2× with the normal primary and
  mirror WebSockets. Each client matched the dedicated room on all steps
  after reconciliation. There were zero catch-up episodes or room stalls.
- The longest displayed interval was 108.3 ms across the four views. All
  four cameras reached their longest interval at the same race steps.
  The gateway sent the steps about 20 ms apart, while ordered client
  delivery paused for about 92 ms and then delivered several together.
  The newly prepared frame reached Chrome's compositor submission in
  less than 1 ms. Five gaps between scheduled audio buffers measured
  11–16 ms, each near a 96–100 ms interval in ordered delivery.
- Closing the creator's window left the other three racers in motion.
  Controller 2 became the room owner and kept driving when controllers 3
  and 4 also disconnected. Controllers 4, 1 and 3 rejoined in that order
  using the same invitation and their existing browser storage. They got
  their original slots and controller 2 retained ownership. With a local
  ZIP, the invitation-to-sync time was 9.5–9.9 seconds per returning client.
  All four matched another 900 dedicated steps after reconciliation.
- A two-player race on the same tunnel matched the server on all 900 steps.
  Switching focus between the game windows kept both connections active.
  The longest display interval was 141.7 ms on controller 1. The next
  emulator step took about 15 ms. The client had spent about 120 ms
  waiting to advance while two sparse confirmations reset its speculative
  frame allowance. Controller 1 also recorded a 44 ms scheduled audio gap.
- A separate run with three connected controllers used the original game's
  four-position multiplayer layout with the fourth controller unassigned.
  All three personal views matched the dedicated room on 900 steps after
  reconciliation. There were no catch-up episodes, room stalls or audio
  gaps over 5 ms. The longest display interval was 133.3 ms. A preceding
  ordered-delivery interval reached 143.2 ms, and the next emulator step
  that prepared a view took about 16.5 ms.
- A two-player control on that same tunnel, also used for the four-player
  crossed comparison, matched the dedicated room on all 900 steps. It
  peaked at 116.7 ms between displayed frames, with no catch-up, room stall
  or audio scheduling gap over 5 ms.
- A four-player audio comparison configured two clients at 128 ms and two
  at 160 ms, with an approximately 111 ms hold on both delivery routes for
  each client. All four matched the server across 900 steps, and none had
  a scheduled audio gap above 5 ms. The higher setting added about 22 ms
  to the median audio queue in this control.
- One four-player room combined 16:9 WebGL2 2× at +100%, 4:3 1× at Original,
  16:9 1× at +100%, and 4:3 software 2× at +100%. All clients matched the
  server over 900 steps. The first controller switched to a separate tab
  in the same Chrome window and stayed hidden for 12 seconds. The other
  clients advanced about 600 steps, and the first controller retained its
  seat and reported a two-step backlog after returning.
- Outside the injected packet-delay windows in that mixed run, controller
  2's ordered delivery stopped for 510 ms. Chrome's network trace showed
  gaps on both WebSockets while the gateway sent normally every 20 ms.
  The client showed a 233 ms display interval and an 87 ms scheduled audio
  gap, then reconciled with the room. These interruptions remain possible
  when both routes stop delivering data.
- Two crossed four-player trials reproduced short gaps by releasing ordered
  confirmations one at a time before delivering the rest of the batch. An
  experimental policy kept some speculative steps available after each
  partial confirmation. Its longest displayed intervals were 91.7 ms in
  both runs, compared with 125 ms under the current policy. All four
  clients matched the server across 900 steps in each run. Outside the
  injected windows, the measured synthetic press-to-confirmed-display
  median was 246.7 ms under the experiment and 227.1 ms under the control.
- Restricting the experimental policy to a larger speculative lead made
  the input medians nearly equal (225.5 and 226.1 ms) in a 4,500-step
  comparison. It also missed some of the targeted gaps. A slower-paced
  variant reduced the worst controlled-gap display interval from 108.3 to
  66.7 ms with similar end-to-end input medians (235.5 and 236.0 ms), but
  spent about 19 ms longer from packet receipt to confirmed display and
  replayed more steps. All sampled steps reconciled. Those variants were
  evaluated separately from the early reconciliation change below.
- Requiring two late confirmations in a row was also tested with the two
  policies swapped between controllers on the same tunnel. The worst
  display intervals in the injected windows were 116.7/108.3 ms in the
  first control/experiment pair and 75.0/91.7 ms in the crossed pair.
  Across 52 ordinary steering presses per policy, median receipt-to-display
  time was 76.5/76.9 ms and press-to-display was 253.8/257.1 ms. All four
  clients matched all 1,800 sampled server steps, but the change in frame
  pacing did not repeat across the two trials.
- An isolated native build moved reconciliation ahead of the next emulator
  step when a live client had new confirmed input. Two four-player runs
  swapped the enabled and disabled controllers on the same tunnel. Outside
  the injected gaps, median receipt-to-confirmed-display time was 78.6 ms
  in the control (51 matched presses) and 56.0 ms with early reconciliation
  (52 presses). End-to-end medians were 246.3 and 217.3 ms. All 1,800
  server steps matched after reconciliation. The longest display interval
  was 116.7 ms under both policies across the runs. An enabled controller
  recorded one 20 ms audio scheduling gap during the crossed run.
- Two further four-player runs combined early reconciliation with paced
  progress after partial confirmations. The policies switched controller
  assignments between runs. Across the four injected windows per policy
  in each run, the combined policy peaked at 58.3 ms between displayed
  frames in both runs, compared with 183.3 ms and 125.0 ms for the controls.
  Outside those windows, median press-to-confirmed-display time fell from
  251.6 to 223.1 ms across 52 matched presses per policy. The median from
  packet receipt to display fell from 83.2 to 59.7 ms. All four clients
  matched all 1,800 sampled server steps after reconciliation. No enabled
  client reported catch-up, room stalls or audio scheduling gaps over 5 ms.
- The normal launcher served the rebuilt core to a mixed-render four-player
  room. All four clients matched the server on 900 steps. The maximum
  display interval was 91.7 ms and no audio scheduling gap exceeded 5 ms.
  The first browser stayed hidden for 12 seconds and returned with zero
  reported backlog. The room owner then closed the tab, controller 2
  continued, and controllers 4, 1 and 3 recovered their seats in that order.
- After those rejoin events the same room matched all 900 additional steps.
  There was no catch-up or room stall. The longest display interval was
  125 ms, and six audio scheduling gaps measured 24–32 ms. The affected
  clients had ordered-delivery gaps of 80–90 ms followed by overlapping
  reconciliation work.
- Fresh two- and three-player rooms used the same rebuilt core and tunnel
  as the mixed run. Each client matched all 900 server steps in its room.
  There was no catch-up or room stall. Peak display intervals were 150.0 ms
  with two players and 100.0 ms with three. The two-player run recorded a
  single 13 ms scheduled audio gap. The three-player run had none above
  5 ms.
- Two further four-player runs used six delivery windows per client based
  on the observed delay pattern, with staggered steering presses and
  releases. All four ran Pine Valley at 16:9, +100% and Enhanced 2×. The
  runs used the same primary and mirror routes and swapped the 128 and
  160 ms WebAudio settings between controllers. Every client matched all
  1,800 sampled server steps after reconciliation. There was no catch-up
  or room stall.
- At 128 ms, three scheduled audio gaps measured 14, 16 and 18 ms. In the
  affected windows, ordered deliveries were 92–106 ms apart. Confirmed
  inputs changed during the windows and the clients replayed six or fourteen
  steps. In one window the browser scheduled no new buffer for 56 ms with
  47 ms of audio left.
  None of the clients configured at 160 ms had a scheduled gap over 5 ms
  across these two runs.
- A run using 160 ms in all four mixed-render clients matched all 900
  sampled server steps. The ordinary race window had no audio scheduling
  gaps above 5 ms, and the longest display interval was 100 ms. The
  median synthetic steering press reached the screen in 212.3 ms across
  24 samples. Median client-to-gateway and gateway-to-client times were
  76.4 and 53.1 ms. Frame preparation after receipt took 43.6 ms and
  Chrome's presentation feedback followed 15.0 ms later at the median.
- The same four clients recovered their controller assignments after
  closing the creator and rejoining out of order. A repeat of the injected
  delay after rejoining produced seven audio gaps of 11–57 ms at 160 ms.
  The four clients matched the server on all 900 sampled steps after
  correction. In the worst window on controller 2, two early corrections
  replayed thirteen steps in roughly 99 ms at the same forward frame
  boundary before the next live step could produce audio.
- An experimental build allowed a forward step between two sliced early
  corrections at the same boundary. Two more mixed-render runs swapped
  the experimental and control builds between seats. After rejoining,
  the longest spans spent replaying at one boundary fell from 128 to
  52 ms and from 105 to 60 ms. The longest display intervals increased
  from 150 to 183 ms and from 133 to 192 ms. Across those two rejoin
  windows, the control had five scheduled audio gaps and the experiment
  had ten. Both builds matched the server after reconciliation and had
  no catch-up or room stalls. The experimental guard was removed.
- In an ordinary four-player repeat using the restored core and 160 ms
  setting, all four clients matched the room for 900 steps before and
  after the controller rejoin sequence. There was no catch-up or room
  stall. No audio gap exceeded 5 ms before the rejoin. After the rejoin,
  five audio gaps measured 13–30 ms. Median scheduled audio headroom
  fell to 79–84 ms for the three affected clients, around half the
  configured capacity. The unaffected client retained about 147 ms. Two-
  and three-player repeats matched all 900 sampled server steps per client
  with no catch-up, room stalls or audio scheduling gaps over 5 ms. Their
  longest display intervals were 100 and 133 ms.
- RetroArch normally targets half its audio capacity. Two crossed trials
  compared this target with three quarters at the same 160 ms capacity.
  In ordinary play before any rejoin, client medians rose from 106–118 ms
  of scheduled audio to 136–148 ms, with no gaps in either group. Median
  frame preparation after packet receipt was 43.3 and 43.4 ms across
  20 matched presses per group. In ordinary play after rejoining, the
  audio gap count fell from four to two, and the longest gap fell from
  33 to 26 ms. With staged packet delays after rejoining, the count fell
  from five to two and the longest gap from 67 to 39 ms. All clients
  reconciled with the server through the 900 steps in each window.
- Two further crossed trials kept the 160 ms capacity and three-quarter
  target in both builds. The new build could add up to 1.5 percentage
  points to the audio resampling ratio while the queue was below target.
  After rejoining, the three affected seats held 117–119 ms with faster
  refill and 86–95 ms with the earlier regulator. The earlier regulator
  recorded two gaps of 23 and 28 ms in ordinary play. No gap exceeded 5 ms
  with faster refill. Both arms passed the staged packet delays without
  an audio gap over 5 ms. The clients matched all 900 server steps in
  every sampled window, with no catch-up or room stalls.
- With faster refill, median press-to-confirmed-display time in ordinary
  play was 236.8 ms versus 218.7 ms before rejoining (20 matched presses
  per arm) and 245.6 ms versus 262.4 ms afterward (14 per arm). Median
  emulator preparation after receipt was 43.8 versus 40.7 ms before
  rejoining and 33.7 versus 49.3 ms afterward. The resampling adjustment
  operates in the audio driver. The input timings include the varying
  tunnel path and the cost of reconciling the confirmed inputs.
- The final launcher served the same rebuilt core on one Quick Tunnel to
  two-, three- and four-player rooms. Each client matched the server on
  all 900 steps per sampled window. The mixed four-player room also
  matched another 900 steps after rejoining. There were no catch-up
  episodes, room stalls or scheduled audio gaps above 5 ms in those runs.
- While the first tab was hidden for 12 seconds, the other three clients
  advanced 602–603 steps. The first tab returned with a two-step backlog.
  Controller 2 took ownership after the creator closed their tab and
  continued alone. Controllers 4, 1 and 3 rejoined with their original
  slots in 10.6–11.5 seconds each, including local ZIP loading.
- The final maximum intervals between displayed frames were 100 ms with
  two and three players, 108 ms with four players before rejoining and
  117 ms afterward. The last interval followed a 97 ms gap in ordered
  delivery. There was a 113 ms interval between prepared frames, and
  Chrome submitted the new frame within 0.5 ms of preparation.
- The 44 browser and network tests, four HTTP handler tests and the native
  presentation isolation checks passed.

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

- The current Quick Tunnel checks used two to four Chrome clients on one
  M5 Pro. Full races on separate computers and networks, longer mixed-render
  sessions and remote input latency still need coverage. A pause on both
  delivery routes can still produce a visible hitch or an audio gap.
- Extended draw distance is experimental and defaults to **Original**. The
  current graphics matrix covers Pine Valley. Higher settings can cause brief
  stutters and the renderer can shorten the range in dense scenes. The native
  camera also has earlier checks on Hard Pack and Kodiak Canyon. More course
  and weather combinations remain open.
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
