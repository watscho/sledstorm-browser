# Changelog

All notable changes to this browser wrapper are recorded here. Versions use
semantic versioning for the browser wrapper.

## 0.9.0 - 2026-11-10

Draw distance and dedicated race stability update.

### Graphics

- Add an experimental draw distance slider for solo PAL races and dedicated
  personal cameras. Keep the original range as the default and explain the
  risk of brief stutters at higher settings in the launcher.
- Reserve geometry for sleds and shadows during the opening countdown in
  personal cameras.
- Extend the original fog backdrop across the wide multiplayer start view
  so uncovered edges match the center of the scene.
- Use the optional WebGL2 renderer for Enhanced 2× in dedicated 16:9 PAL
  races with Clean or Crisp pixels. Keep the software renderer as a fallback.
- Add an opt-in local WebGL2 preview that draws the 16:9 PAL race world at
  2736×1024 with eNGE and keeps the original HUD.
- Add optional Sharp Bilinear texture sampling to the local WebGL2 preview.
- Center the local player's finish placement banner on personal cameras.
- Keep the last personal widescreen frame during catch-up or brief gaps in
  rendering so the view does not flash to 4:3 or shared split-screen.
- Adapt the extra terrain to the available geometry budget and keep the
  original terrain range through the opening camera sweep and countdown.
- Skip unused center pixels in the widescreen fallback and avoid setting up
  a private render when PAL supplies no new world geometry.
- Reuse the initialized solo camera and skip split-screen packet capture in
  solo races. Keep extra ordering-table scans in diagnostic mode only.

### Netplay and audio

- Use RetroArch's browser-native WebAudio driver in the local preview and
  dedicated rooms when available. Yield between emulator steps when the
  audio queue fills.
- Speed up frame recovery for dedicated rooms and delay the catch-up overlay
  until recovery lasts a second. Room creators see a startup message while
  their browser connects to the dedicated runtime.
- Keep held controller inputs through short delivery gaps shared by multiple
  players, avoiding spurious releases and the resulting race replay.
- Send each dedicated Netplay step and its committed controller inputs
  together before the server emulates the step.
- Yield long Netplay replays between groups of emulation steps in visible
  dedicated PAL races through Quick Tunnel.
- Apply newly confirmed input before drawing the next frame in dedicated
  PAL races so the camera shows the corrected turn sooner.
- Keep dedicated PAL clients moving when late inputs arrive in small batches
  during a delivery gap.
- Use a 160 ms WebAudio queue for dedicated PAL clients through Quick Tunnel.
  Keep more audio queued during multiplayer races and refill it faster when
  late inputs trigger several replayed steps.
- Preserve a short steering tap for one step when a brief delivery gap
  batches the press and release in a dedicated PAL race.
- Briefly retain a recent WebGL2 camera frame while a dedicated client works
  through a moderate backlog. Keep full recovery for large or persistent
  backlogs.
- Pace dedicated rooms independently of display refresh. Keep PAL prediction
  short during steady delivery, widen it during a brief interruption and
  reuse the latest confirmed controller state for predicted steps.
- Mirror small dedicated-room messages and controller input over a separate
  Quick Tunnel connector. Use the first ordered copy and fall back to the
  primary connector's mirror endpoint when the separate route is unavailable.
- Allow direct and tunneled connections to the same room by checking game
  compatibility independently of the mirror address.
- Restore the separate mirror after its connector exits while keeping the
  current room and controller assignments. Keep the temporary mirror available
  until the replacement's first packet reaches the ordered stream.
- Prefer QUIC for Quick Tunnel connectors with cloudflared's automatic
  HTTP/2 fallback.

See the [verification summary](docs/verification.md#090-verification-summary)
for the tested configurations and remaining limits.

## 0.8.4 - 2026-11-08

- Keep the room invitation when a guest returns to the lobby so they can
  select **Join game** again.

## 0.8.3 - 2026-11-08

- Document the tested European PlayStation disc edition, the required CUE and
  eleven BIN tracks, and the SHA-1 checksum of the first data track.

## 0.8.2 - 2026-11-08

- Remove the experimental static recompilation engine and its build tools.
  The browser launcher uses PCSX-ReARMed and RetroArch Netplay.

## 0.8.1 - 2026-11-08

- Default to dedicated rooms in the localhost launcher when using a shared
  disc. Use `--browser-hosted` to run the room in the creator's browser without
  a separate Chrome instance. Local disc selection still uses browser hosting.
- Extend the stock respawn fade across the full 16:9 race view at both 1× and
  Enhanced 2×. The HUD stays visible during the fade.

## 0.8.0 - 2026-11-08

### Graphics

- Default to true 16:9 race rendering in solo PAL races and dedicated
  personal cameras, with 4:3 available in the launcher. Native menus and
  shared split-screen retain 4:3.
- Default to Clean filtering using Sharp Bilinear. Add CRT Lottes, live filter
  switching and PNG screenshots.
- Offer Enhanced 2× in every lobby. The PCSX-ReARMed rasterizer draws
  supported races at twice the internal resolution. Other scenes upscale
  their finished frame.
- Draw the original solo HUD once at native resolution in enhanced races.
  This fixes seams on the minimap and duplicated points digits. Personal
  multiplayer cameras also use the original digit animation for awards.

### Saves and controls

- Keep a single **Start game** button. Add automatic solo snapshots and
  separate manual saves in browser storage. **Load last save** restores a
  compatible snapshot into a new room with a fresh invitation.
- Pause solo saving when another controller joins or keeps a reserved race
  seat. On the verified PAL disc, saving becomes available again when the
  creator is alone and the multiplayer race has ended.
- Add per-device gamepad remapping, preserve Custom keyboard bindings when
  switching presets, and mark the local seat for keyboard and gamepad players.
- Add toolbar icons with tooltips and shortcuts for saving, loading,
  screenshots and fullscreen.

### Launcher

- Restore the selected settings tab and personal preferences after a reload.
- Add mountain, snowmobile and snow-trail artwork and a compact guide to
  player and host requirements. Keep the launch button in its summary on
  narrow screens.
- Show connection progress in the session toolbar and a green **LIVE**
  indicator once the room synchronizes.

## 0.7.0 - 2026-11-07

- Replaced the player roster with four compact controller indicators below the game.
- Made dedicated hosting the default for the online launcher in shared-disc mode.
- Rejoining a running race uses the saved controller for that room and browser.
  New lobby assignments replace older credentials.
- Copy invite link requires a public HTTPS address and uses the current tunnel.
- Check invitations before downloading the disc and show download progress
  separately from game synchronization.
- Keep the game visible behind synchronization and catch-up messages, and give
  suspended browser tabs more time to resume their connection.
- Preserve the PAL points popup on each player's personal HUD after an award.
- Let guests reuse a verified ZIP across temporary tunnel addresses, save a
  new ZIP before joining, or join with a download for the current session.

## 0.6.0 - 2026-11-07

- Added dedicated RetroArch rooms that keep running when the creator leaves.
  The four-seat roster shows player names, readiness and reconnecting players.
- Added private controller recovery links. Dedicated rooms reserve disconnected
  controllers during a race and release held inputs when a browser stops sending.
- Added shared-disc download progress and a gamepad tester in the player panel.
- Dedicated clients temporarily skip personal rendering while catching up to
  the live race. The server and other players keep advancing.
- Enabled the original full-size PAL camera renderer and single-player HUD
  in dedicated rooms. Rejoining sends the current snapshot only to the
  returning client.
- Verified four-player controller recovery through Cloudflare and checked the
  native camera on Pine Valley, Hard Pack and Kodiak Canyon.

## 0.5.0 - 2026-11-07

### Online play

- Made RetroArch Netplay the default transport in the browser lobby. Guests
  receive the host's current emulator state after loading matching game files.
- Added a private WebSocket relay for up to four controllers through the
  Cloudflare gateway. The room checks game files, BIOS and build identity.
- Returning guests can resume an existing racer in an available controller
  slot. The same slot selects the local camera and single-player HUD.
- The launcher covers the guest's view and mutes audio during synchronization.
  Technical details show the assigned controller, player count and live frame.

### Verification

- Tested Pine Valley through a real Cloudflare Quick Tunnel with four Chrome
  contexts on one Mac in local-disc mode. Guests 2–4 returned to the live race
  using the original link, and the race continued with three and two connected
  controllers. See the [verification record](docs/verification.md).

## 0.4.0 - 2026-11-07

### Disc loading

- Reuse one saved disc per browser origin on localhost and permanent hostnames
  when the disc fingerprint matches. Quick Tunnel launches download for the
  current session to avoid accumulating copies across temporary hostnames.

### Interface

- Updated the default keyboard layout to arrows for directions, S for Cross,
  W/A/D for Triangle/Square/Circle, Q/E for L1/R1, Z/C for L2/R2, Enter for
  Start and Right Shift for Select. Existing saved layouts are retained.
- Added an interactive DualShock illustration to **Controls**. Select any of
  the 14 supported buttons to change its keyboard binding.

- Simplified the lobby heading and session toolbar. **Copy link** copies the
  invitation directly. Controller and synchronization counters appear in
  **Technical details**. The emulator hover toolbar and pointer stay out of the
  game view.

- Fullscreen now shows only the game, without invitations, session toolbars or
  the emulator control bar; Escape restores the normal session view.

- Styled native select fields for the icy palette with an inset caret and compact
  keyboard focus indicator.
- Added personal Classic/WASD/custom key bindings, conflict swapping and browser
  persistence, plus gamepad detection, input status, device selection and a
  keyboard-only mode. Routed emulator input through the synchronized sampler
  so frontend gamepad callbacks cannot bypass the chosen device policy.

- Restored the tabbed launch interface, responsive settings/summary layout,
  PAL cover artwork, keyboard tab navigation and reset action for the emulator.
- Added a focused game stage with invitations, fullscreen and confirmed return
  to the lobby, retaining existing room and native simulation behavior.

### Documentation

- Unified setup, multiplayer, launcher, progression and verification guides
  around the current emulator, with a prominent start/invite/stop walkthrough.
- Simplified README navigation and separated component notices from play instructions.
- Audited all project guides against runtime code, corrected invitation encoding
  and launch-setting behavior, completed local diagnostic steps, and added a
  documentation index plus context for preserved upstream license texts.

## [0.3.0] - 2026-11-07

### Added

- Added a reproducible PCSX-ReARMed / RetroArch native build with true
  console-step gating, exact source pins and SHA-256 output manifests.
- Connected invitation rooms, four controller seats, strict state checks and
  deterministic late-join replay to the browser emulator. Verified independent
  controller input in a four-browser race, agreement at 19,500 core steps,
  and a third client catching up in the earlier boundary test.
- Added compact controller history, muted accelerated replay and uncompressed
  host-disc ZIPs to reduce history memory and repeated extraction overhead.
- Added source-audited state canonicalization and focused protocol/core tests.
  Snapshot joining remains experimental and disabled after timer restoration
  differences were found. In that release, joining replayed history from boot.
- Added experimental per-player full-camera GPU replay for two to four racers,
  including the PAL divider bounds and the original single-player HUD/atlas.
  The local HUD uses isolated interpreter execution with event dispatch frozen;
  CPU registers, RAM, instruction cache and canonical GPU state are restored.
  Added full-state presentation qualification and partial-failure isolation tests.
- Added the PAL unlock preset and launch controls for progress, image filtering,
  volume and camera presentation; invitation links inherit shared settings.
- Added emulator local-file mode, per-track content identity and blocked host
  disc routes alongside authenticated host-disc mode.
- Corrected the pinned core's Multitap option to `pcsx_rearmed_multitap =
  "port 1"` and verified all four native controllers.
- Preserved private access paths when guests reshare invitations. Added a local
  host launcher that publishes HTTPS invitations without downloading its own
  disc through Cloudflare, plus explicit replay/waiting status.
- Preserved original vendor assets and persistent single-player memory cards.
  Added a loopback-only diagnostic snapshot and camera laboratory.
- Documented current limits: separate physical devices,
  audible soundtrack quality and broad course coverage remain unqualified.

### Changed

- Made the emulator and shared host disc the defaults for the tunnel helper.
  This version still offered the previous runtime as an optional engine.
- Rewrote the primary README/setup flow around the emulator; retained earlier
  build and rendering documentation as explicitly marked legacy guides.

## [0.2.0] - 2026-11-06

### Added

- Explicit **Host disc** mode: `python3 tools/play-online.py --disc-mode shared`.
  One CUE/BIN set on the host is sufficient; other browsers start/join without
  choosing files. The protected gateway serves authenticated, bounded extents.
- Explicit **Local files** mode via `--disc-mode local`, preserving the default
  requirement for each browser to provide matching files and blocking host reads.
- Mode-aware file status, launch hints and host-disc transfer progress during
  startup; gateway authorization/range tests and
  real HTTP-handler tests using synthetic disc tracks.

### Changed

- Full-file and HEAD disc requests are refused by the development server;
  shared requests validate track index, query parameters, bounds and a 4 MiB cap.
- Guests retain the gateway access path in copied invitations after redirects.
- Updated setup/hosting documentation explains both modes and that Cloudflare
  also works for two computers on the same Wi-Fi, without being an offline LAN.


## [0.1.0] - 2026-11-06

### Added

- WebAssembly integration for the pinned PAL SLES-02194 recompilation and
  project-local bootstrap/build tooling.
- Browser multiplayer for up to four controller slots, independent room links,
  deterministic input history catch-up and content/state checks.
- Two-player WebGL2 personal cameras, original single-player HUD proportions,
  and original 4:3 pause/options presentation.
- English launch settings for graphics, audio, controls, fullscreen, local disc
  selection and an optional all-content progression preset.
- Private disc-free gateway and a one-command Cloudflare Quick Tunnel helper:
  `python3 tools/play-online.py`.
- PAL SLES-02194 README cover scan, with source and separate artwork attribution.
- Detailed setup, hosting, friend invitation, troubleshooting and verification
  guides; upstream source pins and preserved third-party notices.
- MIT licensing for original contributions, Copyright (c) 2026 Vacho Aivazov.

### Qualification

- Automated adapter/transport checks and a clean-source build passed on macOS.
- Local two-player gameplay was checked; three/four-player presentation retains
  the original split layout. Four independent cameras are not implemented.
- A live Cloudflare endpoint passed private HTTPS access, file blocking,
  synthetic two-client WSS synchronization and one real browser host boot.
- A real two-device internet race still requires participant testing; endpoint
  checks do not establish multiplayer latency/reliability.
- Disc images, saves, downloaded upstream sources, compiled output and private
  access/session links are excluded from the Git repository.

[0.3.0]: https://github.com/watscho/sledstorm-browser/tree/v0.3.0
[0.2.0]: https://github.com/watscho/sledstorm-browser/tree/v0.2.0
[0.1.0]: https://github.com/watscho/sledstorm-browser/tree/v0.1.0
