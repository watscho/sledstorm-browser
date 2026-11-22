# Changelog

All notable changes to this browser wrapper are recorded here. Versions use
semantic versioning for the browser wrapper.

## Unreleased

### Added - 2026-11-22

- The packaged server offers its game files in numbered pieces of 8 MiB,
  listed with their SHA-256 hashes in a manifest (`/game-data/manifest` and
  `/game-data/<archive>/chunks/<n>`), so that a player's page can fetch only
  the pieces it lacks. The public address passes them only where the host
  lets players download the game files, and in no other spelling of their
  paths.
- "Download from server" fetches those pieces two at a time and checks each
  one against the manifest before it counts. Checked pieces are kept in the
  browser's storage for the address, so a download cut by a reload, a closed
  tab or a crash continues where it stopped instead of starting over, and a
  damaged piece is fetched again. The whole disc is checked once more before
  the game starts, and the pieces are removed once it has started. A busy
  server or a long wait in its queue pauses the download instead of ending
  it. If storage is unavailable, full or held by another tab, the parts
  that cannot be saved stay in memory. The page explains which parts a
  reload will need again. The Python launcher still sends the whole disc.
- On a stable address, the browser is asked to keep its storage when the
  player chooses "Keep game data". If the browser copy or the portable ZIP
  cannot be saved, the player sees a notice when the game starts.
- The packaged server sends the game files to at most four invited players
  at once; up to sixteen more wait their turn, and any beyond that are told
  that the server is busy. A download whose player leaves frees its place at
  once, and one whose player stops reading within a minute. The room and
  the host's own game page never wait behind invited players.
- An invited player chooses where the disc comes from, in the Game files
  tab: "Use my game files", "Use saved ZIP", or "Download from server" where
  the host lets players download the game files. The choice made last is
  chosen again on the next visit while it is offered, and the launch
  summary's "Game data" row says whether it is ready. Under "Players may
  download the game files from this server" a guest may now play from their
  own files or a ZIP too.
- In Chrome and other browsers with its file picker, game files or a ZIP
  chosen once are used again on the same address without choosing them
  again: the browser keeps access to the files, not a copy of them, and asks
  again on Join when it must.
- A copy of another disc is refused as soon as it is chosen, and a
  remembered copy that was changed, moved or deleted is refused on Join,
  each with what to do instead; nothing else is tried in its place.
- A compressed ZIP says how much memory the browser keeps while the game
  runs, and that the CUE and BIN files or an uncompressed ZIP avoid it.

### Changed - 2026-11-22

- If the host's game files change during a download, the page tells the
  player to ask the host to start hosting again. An unmarked 503 from a
  proxy can be retried.
- The Quick Tunnel dialog's "Use existing ZIP" chooses the saved ZIP, which
  may be any ZIP of the host's disc, not only the exact copy saved from that
  host; a ZIP that is not the room's disc is told in the Game files tab.
  "Join game · Ready" and "Join game · ZIP selected" give way to the launch
  summary's "Game data" row, and "Reset settings" no longer forgets the
  chosen game files. A new Quick Tunnel address starts a fresh download.
  Selecting a portable ZIP from the previous address can start the game
  without downloading the disc again.

### Added - 2026-11-21

- Host with "Players use only their own game files" (`--disc-policy
  local-only`). The room and the game on this computer still load the disc
  from this server over the loopback address; the public address gives no
  game files away in any spelling of their path, and tells an invited
  player's page so with the header `X-Sled-Disc: local`. That page then asks
  for the player's own CUE and BIN files, which must be the host's files
  under the same names. The room, its links and its identity are the same
  under both choices.
- The game's page and the packaged server take the same discs, by rules they
  share: one CUE whose `BINARY` lines name 1 to 99 tracks beside it, at most
  1 MiB of CUE and 1 GiB in all, a track found by its name whatever its case
  or Unicode normalization. A player's own CUE no longer has to list eleven
  tracks; the room's disc identity decides whether the files fit the room.
  A CUE that is not a text file, or that names a track with a control
  character or lists itself, is refused by both.
- Under "Players use only their own game files" an invited player may choose
  one ZIP of the disc instead of its CUE and BIN files. The page reads it
  itself, stored or deflated, with the CUE in a folder of the archive and
  Finder's extra files ignored, and checks each file's size and CRC-32; a
  damaged, encrypted, ZIP64 or unsafe ZIP is refused with its reason, and
  nothing else is tried in its place. An exact copy of the host's archive
  is used as it is.
- Run the packaged server's room from its page. "New game" ends the room's
  game and opens the next one at once under the same links; the players are
  told to open the invitation again. The room's options, all content unlocked
  or the original progression and separate cameras, are chosen on the page
  while the room is stopped and apply from the next start; a disc other than
  the verified PAL one plays with the original progression and a shared
  camera. A stop, a new game and a quit with players in the room ask first,
  from the server's own answer, and the command `quit` needs `--force` then.
  The command `new-game` does the same from a terminal.
- Save a diagnostic report from the page ("Save diagnostics") or print it
  with the command `diagnostics`, also when no server runs: the application,
  its parts, the system, the host's state, the settings without the folder's
  path, and the last lines of the log, with folders, tokens, links and public
  host names taken out.
- Replace the packaged application in place: opening another build stops an
  older server whose room is empty and starts its own; a server with players
  keeps running and keeps the page of its own build.
- A guide to the packaged server, `docs/sled-storm-server.md`.
- Set up and run the packaged server from its page. Opening the application
  shows a page that asks for the game folder, chosen in the system's dialog,
  and for the disc policy, neither chosen in advance; then starts the server,
  shows its state and players, offers the guests' link to copy and "Open
  game" for this computer, stops the room, switches the start at launch, and
  quits. A stop or a quit with players in the room asks first; a double click
  does not answer the question. The page reads the server once a second, says
  in a sentence when it is gone, and puts whatever the server sends into the
  page as text. A cancel in the dialog changes nothing, one dialog is open at
  a time, and quitting the server closes it.
- Open the page of the packaged server through a link that works once.
  Opening the application asks the running server for a token that is good
  once and for a minute and opens the page with it; the page trades the token
  for a session of its own tab and takes it out of the address. No cookie is
  used. A page of another site, and the game page, can neither read nor ask
  anything of the server's control port, and nothing behind the public
  address reaches it. Opening the application again opens another tab on the
  same server, and closing the tabs stops nothing.
- Stop and start hosting on a running packaged server, with the commands
  `stop` and `start` and with the same requests for the page. A stop closes
  the room, the public address and the local game page and leaves the server.
  With a player in the room, or a controller kept for one, it needs `--force`,
  and so does a start that closes such a room because the game files changed.
  A start on a server that is hosting tries again what has failed there, the
  room or the public address, and leaves the rest as it is. A start that is
  asked for while the server quits is refused.
- Count the players of the room in the packaged server's status: connected,
  and away with a controller kept.
- Add `autoStart` to the packaged server's `config.json`, true when absent. A
  server whose file says `false` hosts nothing after it is opened until a
  start is asked for. The game folder, the disc policy and this switch can be
  read and changed through the control port; the folder and the policy only
  while nothing is hosted.
- Let a player save and load in the room of the packaged server. The player
  the room belongs to, while alone in it, saves to the same library as before
  and loads a save into the same room: the server starts a second emulator
  with the save, moves the room to it once it is ready, and the player's page
  comes back by itself on its controller. The room's name, its invitation and
  its options stay. A refusal, a damaged save or an emulator that cannot start
  leaves the running game as it was, and the player reads why. While another
  player is connected, or a controller is kept for one, saving and loading are
  paused and the list says so. Slots, autosaves, export, import and the stored
  format are unchanged, and a save made by wrapper 1.1.0 at the same address
  loads in the room. Checked by hand on a real disc.
- Give the RetroArch Netplay relay a `restore` role for a room that a server
  owns, with the options `saves`, `onRestoring`, `transferMs`, `reservedMs`
  and `retryMs`, and report `restoring` in its status. A save has a minute to
  arrive. A room starts one emulator for a load beside its own and no more:
  it takes no new load until the emulator of the last one is gone, nor for
  five seconds after a load that did not complete. A room made by a browser
  keeps `release-for-load` and starts a new room for a load, as before.
- Show `Saved games` to every player of a server's room before joining. The
  list can be managed there; loading is done in the game.

### Fixed - 2026-11-21

- Confirm a browser's kept copy of the game page by an `ETag`, never by its
  date, in the packaged server. The Python launcher and every build serve
  `127.0.0.1:8000`, and a browser that had used one of them could be told that
  its copy was current and run that client against the packaged server, which
  refused the invitation. The emulator's files are asked about on every load
  as well.

### Added - 2026-11-20

- Let the packaged server host the game origin without Python. `configure`
  stores a game folder and an explicit disc policy. The server then prepares
  the disc, serves the web client, the emulator files, the session info and
  the disc archive on `127.0.0.1:8000`, and runs the Netplay relay and the
  gateway in its own process. The disc identity is unchanged. The archive is
  streamed from the user's own files with fixed ZIP metadata instead of being
  copied into a cache, so it no longer depends on file times. No tunnel and no
  dedicated emulator start yet; the Python launchers remain the way to play.
- Add an `origins` option to the RetroArch Netplay relay. Its default is the
  existing launcher origin.
- Let the packaged server open the Cloudflare Quick Tunnel and its mirror by
  itself. A pinned `cloudflared` ships as a resource. The server reads
  readiness from the program's metrics listener, then checks the public
  address with a real HTTPS and WebSocket round trip that does not ask the
  system resolver before the new name exists. A lost tunnel is restarted
  within bounds, an address that is down is no longer handed out, and a
  missing mirror never blocks hosting. `invitation` prints the private link.
  A guard process ends the tunnel programs if the server is killed.
- Run a room's emulator in a Chromium that ships inside the packaged server.
  The browser is a pinned, unmodified open-source build, so the packaged
  server needs no installed Chrome. It gets a profile in the server's cache,
  no name to resolve but `127.0.0.1`, and its crash reports stay in the
  server's own folder. Stopping the host waits until its browsers are gone,
  and a browser that ignores the stop is killed. A real room was played from
  the packaged server by hand, with one player.
- Give the dedicated runtime options for the page address, further browser
  switches, the profile location, extra environment variables and a grace
  period. Each default is the launcher's existing behavior, except that a
  browser which ignores its stop is now killed after five seconds, and that a
  start which fails is reported once its browser and profile are gone.
- Let the packaged server own its room. It opens one room at the start of
  hosting, before any player and with four free controllers. Every player
  joins with the same invitation, the room has no idle timeout, and a lost
  emulator is followed by a new game in the same room. `invitation` prints the
  link for guests and a link for the server's own computer. Saving and loading
  in such a room come with the next step.
- Compute the room identity from a fixed list of fields that the server and
  the players' pages share: disc, core, adapter, native build, BIOS and room
  options. The way the disc is delivered no longer changes it. Invitations to
  a Netplay room now carry version 8, and a version 7 link is refused with a
  sentence of its own. Rooms made by earlier versions cannot be joined.
- Tell a player "Dedicated emulator disconnected" whenever a dedicated room
  loses its emulator. Before, the reason depended on which of the emulator's
  connections the relay saw end first. A player whose stream alone ends is now
  let go 100 ms later.

### Added - 2026-11-15

- Start the packaged host server in `server/`: TypeScript bundled into one
  CommonJS file and built as a Node.js 26.13.1 single executable for macOS on
  Apple Silicon, with a draft application bundle. The existing gateway and
  Netplay relay modules are bundled unchanged. This is a packaging proof: it
  does not start the emulator, a room or a tunnel yet, and the Python launchers
  remain the way to play.
- Add packaged smoke tests that run the built executable from a read-only
  bundle with an empty search path, and `docs/sea-server-plan.md` with the
  staged plan, decisions and verification log.

## 1.1.0 - 2026-11-12

Save library, graphics presets and performance diagnostics. Native emulator
and adapter pins are unchanged; upgrading from 1.0.0 needs no native rebuild.

### Added - 2026-11-12

- Place a labeled save-library icon beside Start/Join game. Use a consistent
  Load game primary action for existing manual and automatic checkpoints, with
  saving/copying below it. Add explicit name editing, grouped export/rename
  controls and a separate confirmed delete action. Close on backdrop clicks,
  retain native modal focus handling and use document scrolling for tall dialogs.
- Add a Saved games library in the launcher and game toolbar: six manual slots,
  three rotating autosaves, scene previews, checkpoint dates and custom names.
  Choose the exact manual save or autosave to load, or keep an autosave in a
  manual slot. Preserve personal graphics and controls when restoring.
- Export and import portable `.sledsave` files with compressed snapshots,
  previews and original checkpoint dates. Verify disc, BIOS, core, format,
  bounded sizes and SHA-256 checksums before offering an import destination.
- Migrate existing manual and automatic snapshots without changing the database
  version or deleting their original data. Use atomic writes and slot revisions
  to preserve saves on storage failures and conflicting edits from another tab.
  Confirm replacements and deletions, and retain the latest deletion for undo
  after reopening the library.
- Add a disc-free browser check page for real IndexedDB migration, autosave
  rotation, simultaneous writers, failed-write rollback and restoration.

### Fixed - 2026-11-12

- Fix EmulatorJS's exit-time `ErrnoError` when loading a save or returning to the
  lobby. Mount a fresh in-memory save filesystem to match its existing unmount
  callback; retain the pinned emulator and fresh room memory-card behavior.
- Keep physical gamepad input out of modal dialogs and scope launcher tabs to
  their own settings panels.

### Added - 2026-11-11

- Add Performance, Balanced and Quality graphics presets while keeping all
  manual controls. Quality retains the existing defaults. Editing any graphics
  control, including the live image filter, selects Custom; volume is independent.
  Remember the selected preset and keep Custom settings when switching presets.
- Add a Performance panel with live timeline speed, browser animation timing,
  room synchronization, active rendering settings and practical status messages.
  Reset measurements after backgrounding or synchronization and retain the raw
  Technical details inside the panel.
- Download a local JSON performance report with recent measurements and graphics
  settings. Keep room invitations, game files and emulator state out of reports.

## 1.0.0 - 2026-11-11

First 1.0 source release of the browser wrapper.

- Remove the experimental build label from the release version and launcher.
- Remember a guest's selected ZIP at the same Quick Tunnel address. Retain
  its handle when read permission resets and renew access from Join without
  reopening the source picker. Revalidate the file before reuse.
- Turn the launch button green and show **Join game · Ready** after verifying
  the selected ZIP; show **ZIP selected** when read access needs renewal.
- Preserve the room invitation when returning to the lobby or clicking the
  header logo, and confirm exits from an active game.
- Enable Enhanced 2× and +100% draw distance by default, including Reset
  settings. Migrate existing graphics defaults once, then remember personal
  changes normally.
- Remove obsolete generated GTE projection hooks before rebuilding cached
  native sources, fixing upgrades that failed to link.
- Refresh setup, hosting, controls, storage, architecture and verification
  documentation for 1.0.0. Keep experimental draw distance labeled separately
  and retain the documented platform and multiplayer coverage limits.

See [release verification](docs/verification.md#100-verification-summary) for
the checks performed and their scope.

## 0.9.4 - 2026-11-10

- Restore the slopes, backdrop and sleds in dense frames at the Pine
  Valley lap and finish line in multiplayer.

## 0.9.3 - 2026-11-10

- Restore the snowbanks and backdrop during the Pine Valley multiplayer
  opening sweep while keeping all four sleds visible.

## 0.9.2 - 2026-11-10

- Restore the PAL speedometer's smoothing and keep every racer's marker on
  each personal minimap.
- Use the solo terrain span as the baseline for personal cameras. Fall back
  to the stock multiplayer range when the geometry budget is tight.
- Keep each racer's personal view behind the original shared pause menu.
- Restore the original PAL tread marks in personal views and clip stretched
  segments near the camera.

## 0.9.1 - 2026-11-10

Pine Valley multiplayer presentation and reconnect fixes.

### Race presentation

- Restore the original PAL fragment effects from signs and the Pine Valley
  ice wall in personal cameras.
- Restore PAL snowfall in personal cameras using each racer's snow positions.
- Extend the PAL fog backdrop to the widescreen edges during a race.
- Draw only the side margins in the first software Enhanced 2× pass when
  PAL's stock-range pass redraws the center.
- Use the full-size PAL renderer for browser-hosted personal cameras to
  restore terrain outside the original split-screen pane.
- Stop the private PAL world draw after the selected camera's view.
- Play the original finish placement animation in the finishing player's
  personal camera.

### Room stability

- Remember a synchronized browser-hosted guest's controller after the tab closes.
- Use faster compression for dedicated room snapshots to shorten the sound
  interruption for players who stay in the race when someone rejoins.

### Build and diagnostics

- Save local diagnostic snapshots from synchronized RetroArch rooms.
- Check the Python version and prepare the Emscripten zlib port on fresh builds.

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
