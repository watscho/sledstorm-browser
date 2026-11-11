# Launcher settings

Open [http://127.0.0.1:8000/](http://127.0.0.1:8000/) after starting the
[hosting command](multiplayer.md). Set preferences before pressing **Start game**.
An invitation opens the same launcher with **Join game** instead.

The launcher groups settings into **Game**, **Display and audio**, **Controls**
and **Game files** tabs, with a live launch summary and PAL cover artwork.
Tabs support arrow-key navigation; **Reset settings** restores available launch
controls to their defaults and clears selected files. Guest room settings remain
locked to the invitation. The selected tab and personal settings are remembered
in the same browser at the same address. Select local disc or BIOS files again
after a refresh.

**Quality** retains the 1.0.0 graphics defaults: **16:9**, **Clean**,
**Enhanced 2×** and **+100%** draw distance. Existing personal graphics choices
are preserved and matched to a preset when possible; other combinations use
**Custom**. **Reset settings** restores Quality. Host disc ZIP selection is
remembered separately from local CUE/BIN and BIOS inputs.

The lobby lists the browser requirements and hardware starting points for
players and dedicated hosts. See [hardware and connection](setup.md#hardware-and-connection)
for details.

## Before launch

| Setting | What it does | Shared with the room? |
| --- | --- | --- |
| Graphics preset | **Performance**, **Balanced**, **Quality** or **Custom**. Presets set aspect ratio, filter, Enhanced 2× and draw distance together. | No; personal. |
| Progress | **All content unlocked** or **Original progression**. The preset changes temporary menu memory. | Yes; guests inherit it. |
| Race aspect ratio | **16:9 · Widescreen** is the default in solo PAL races and PAL races with personal cameras in RetroArch rooms. Choose **4:3 · Original** for the original proportions. Menus and shared split-screen use 4:3. | No; personal. |
| Draw distance (experimental) | Defaults to **+100%** for extra terrain. **Original** targets the solo range on personal PAL cameras. Dense scenes can shorten the range, and higher values can cause brief stutters. | Personal. |
| Image filter | **Clean** (Sharp Bilinear) is the default. **Crisp pixels**, **Smooth**, and **CRT · Lottes** are also available. The toolbar and **F7** can change the filter during play. | No; personal. |
| Enhanced 2× | Enabled by default. Solo PAL races and personal cameras in RetroArch rooms render at twice the width and height. Other scenes upscale the original frame. Change before starting or joining. | No; personal. |
| Volume | Browser audio volume. | No; personal. |
| Separate cameras | Full personal camera and original single-player HUD for two to four racers. Enabled by default. | Yes; guests inherit it. |
| Optional PlayStation BIOS | Dedicated rooms use the built-in BIOS. In a browser-hosted room, select your own BIOS or leave it empty for HLE. | Every player in a browser-hosted room must use the same choice/file. |
| Game files (local-file mode) | Select the CUE and all eleven BIN tracks. | Every player supplies matching contents. |
| Keep or choose game data (shared-disc invitations) | With a Quick Tunnel, select or save a ZIP once. A verified source makes **Join game · Ready** green. Returning guests reuse it at the same address; Join can renew its read permission. Turning the option off skips the initial picker. On a permanent address, turning off **Keep game data** clears the cached copy after startup. | No; personal. |

Set volume, aspect ratio, draw distance and Enhanced 2× before starting. The image filter
can also change during play. The launcher remembers these settings, along
with progress, camera and game data preferences, on the same browser origin.
Create a new room to change progression or camera behavior.
Choose game modes, riders and courses in the game.

## Graphics presets

Choose a preset in **Display and audio** before starting or joining:

| Preset | Race aspect ratio | Image filter | Enhanced 2× | Extra draw distance |
| --- | --- | --- | --- | --- |
| **Performance** | 4:3 | Crisp pixels | Off | Original |
| **Balanced** | 16:9 | Clean | Off | +50% |
| **Quality** (default) | 16:9 | Clean | On | +100% |

All individual graphics controls remain available. Changing one immediately
selects **Custom**, including changing the filter from the toolbar or with
**F7** during play. Custom remains selected even if the values happen to match
a preset. Volume, controls, progression and the room's camera option do not
change the graphics preset.

The browser remembers both the selected preset and your latest Custom settings.
After trying a preset, select **Custom** to restore your manual combination.
If the current room does not support widescreen or extra draw distance, those
features use 4:3 and Original distance while the preferred settings are kept
for a supported room. Presets are starting points; performance depends on the
device, course and active renderer.

## Personal controls

In **Controls**, choose **Classic** (arrows + S) or **WASD** (WASD + Space).
To customize either preset, select a button on the DualShock illustration and
press a replacement key. The label beside each button shows its assigned key.
L2 and R2 appear above the illustration, and ⌫ means Backspace.

**Escape** cancels capture. If a key is already assigned, the two bindings swap.
The active preset and **Custom** layout are saved separately. Switching to
Classic or WASD keeps the Custom bindings for when you switch back.
**Reset controls** restores Classic and clears the saved Custom layout.
Keyboard preferences are saved per browser origin. A new temporary Quick Tunnel
address has its own preferences. When browser storage is unavailable, changes
apply for the current page only.

Connect a controller through USB or Bluetooth and press a button to expose it
to the browser. The device name and input indicator show what the browser can
see. **Automatic** samples the first controller with a standard browser mapping;
you can choose a specific detected device or **Keyboard only**. Device selection
is remembered when the same controller reconnects. Nonstandard mappings are marked
unsupported. A physical gamepad has not been qualified on the test machine.

With a supported gamepad connected, open **Remap controller buttons**, choose
a PlayStation action and select **Press to bind**. Release any held button, then
press the button to assign. Existing assignments swap. The browser remembers
the mapping for that controller model.

The left stick and D-pad steer; the bottom face button (Xbox A / PlayStation ×)
accelerates/confirms, the top face button (Y / △) goes back, and Start / Options
pauses. Keyboard input remains available alongside the chosen controller. One
browser supplies one room controller; connecting another physical gamepad does
not add another participant. Disconnecting the pad releases its sampled input.
The browser frontend cannot bypass these local device preferences.

### In-game shortcuts

These shortcuts are listed separately in **Controls** and work once the game is running:

- **F7** — cycle image filters.
- **F8** — download a PNG screenshot.
- **⌘S**, **Ctrl+S**, or **F9** — choose a manual save slot.
- **⌘L**, **Ctrl+L**, or **F10** — open Saved games. Use **F10** if the browser opens its address bar.
- **Alt+Enter** — toggle fullscreen. **Esc** closes the save dialog first, then exits fullscreen.

## After launch

The link icon in the session toolbar copies the complete invitation and briefly
shows a check mark. Its tooltip is **Copy invite link**. The URL stays off screen.
When the online helper is running, the host's localhost launcher generates the
public HTTPS link automatically. A guest can copy and reshare the same room
invitation. A new game launched from the root page creates a different room.

The emulator hover toolbar is hidden, and the pointer is hidden over the game.
Use the session toolbar above the game for fullscreen and returning to the lobby.
Use the camera icon (**Screenshot**) in the session toolbar to download a PNG.

Four controller indicators below the game light up when the corresponding
player is connected. Your slot also has a green controller outline and a
**You** label, including when you play with a keyboard. In a dedicated room,
reopen the invitation in the same
browser and at the same address to rejoin a running race. **Controls** in the launcher shows detected gamepads
before starting.

Click the game to focus it. With Classic controls, use arrows, **S** for
confirm/accelerate, **Enter** for Start/pause and **W** for triangle/back. The
remaining Classic bindings are **A** (Square), **D** (Circle), **Q/E** (L1/R1),
**Z/C** (L2/R2) and **Right Shift** (Select).
The hint below the game reflects your selected keyboard bindings. The shared
pause menu appears in its original 4:3 proportions over each personal view.

## Solo sessions

Open the **Saved games** disk icon beside **Start game / Join game**, or use
**Saved games** in the game toolbar. Click outside the dialog or its close
button to dismiss it. A tall library scrolls with the whole page; it has no
internal scroll area. Closing restores the launcher's scroll position and focus.
The library has six
**Manual slots** and the three latest **Autosaves**, each with a scene preview,
name and local checkpoint date. Select either type explicitly before loading.
Older saves migrate automatically: the previous manual save becomes Slot 1,
and the previous autosave joins the automatic history. They retain their dates
and may have no preview until you save again.

**Save game / F9** opens the manual slots. Choose an empty slot, enter a name
and save. On an existing checkpoint, **Load game** is the primary action on
both tabs. **Save current game…** below it asks before overwriting the selected
manual slot. **Rename** opens an inline name editor with **Save name / Cancel**;
renaming keeps the
checkpoint date unchanged. **Delete** also asks for confirmation. **Undo
deletion** restores the most recent deleted checkpoint even after closing and
reopening the library. If its original slot has been reused, the button offers
another empty slot. Only the latest deleted checkpoint is retained. Select an
autosave and choose **Keep in manual slot** to preserve it beyond rotation.

While the creator plays alone, a snapshot is taken about every 15 seconds while
the tab is visible, with another attempt when it becomes hidden. **Return to
lobby** updates the autosave. The game continues while the library is open;
automatic saving pauses until it closes, and controller input is released while
using dialogs. Manual slots are independent of autosave rotation.

Saving and loading require a synchronized solo session. They pause when a guest
joins, a controller is reserved for rejoining, or the game is in a multiplayer
race or attract demo. Existing checkpoints stay available for browsing and
export. With the verified PAL disc, saving resumes when the creator is alone
again and has returned to the solo game. The library explains what is blocking
saving or loading.

**Load game** starts a fresh solo room from the selected checkpoint. During an
active game, confirm loading first; the current game is backed up to an
autosave before leaving. The checkpoint's progression and camera settings are
restored, while your current graphics, volume and controls remain personal.
You can share the fresh room's invitation after loading. **Start game** starts
a new game from the lobby.

**Export file** downloads a `.sledsave` file containing the snapshot, preview, name,
date and gameplay settings. **Import save** verifies the file and shows its
preview before you choose a manual destination. Nothing is replaced until you
confirm; importing and keeping an autosave preserve the original checkpoint
date. Files must match the selected disc, BIOS/HLE and pinned emulator build.
Invalid formats, unsupported versions, damaged checksums and oversized data
are rejected. Files are limited to 6 MiB and decompression is bounded to the
pinned snapshot size.

Checkpoints live in this browser at the same address; another temporary tunnel
address has separate storage. Export files to move saves between addresses or
keep an external backup. Atomic writes preserve existing checkpoints if storage
fills up, and conflicting edits from another tab are rejected instead of
silently overwriting a changed slot. In local-disc mode, choose the matching
CUE/BIN files and optional BIOS before opening the library. Save files do not
include the game disc or BIOS. **All content unlocked** remains available in
solo play with the verified PAL disc.

## Presentation and progress

RetroArch rooms render each racer's PAL camera with the game's full-size
renderer and original single-player HUD in an isolated pass. Turning
**Separate cameras** off uses the game's original shared-screen presentation.
See the
[architecture guide](browser-emulator.md) for implementation details.

The [all-content preset](unlocked-profile.md) changes session memory, including
rider, sled and course selection. Rooms use fresh temporary memory cards;
persistent single-player cards and disc files are unchanged.

Use **Fullscreen** above the game to show only the game, hiding invitations,
toolbars and emulator controls. Press **Escape** to return to the normal view.
**Return to lobby**
asks before disconnecting your controller. A dedicated room continues while
others are connected. Leaving a browser-hosted room as its host ends the room.
Returning to the lobby preserves the room invitation in the URL. The header
logo also keeps that invitation; during play it opens the same exit confirmation.
Choose the root launcher address explicitly when you want to create a new room.

## Loading and status

The launcher reports disc download progress when it has a download size,
then shows when it is preparing the emulator or synchronizing the room. It
covers the guest's game and mutes guest audio until RetroArch applies the
current room state. The
**Performance → Technical details** panel shows the controller, player count, synchronized
frame and completed console steps. The session toolbar shows loading,
synchronization and errors, and switches to a green **LIVE** indicator when
the local game is synchronized. It shows a status message again if the browser
needs to catch up or loses the connection. PAL targets 50 console steps/s. The counter measures console
steps, while audio and displayed frame pacing need separate checks. A
browser-hosted room can wait for a suspended player. In dedicated mode the
server advances independently of browser input. If your browser falls far
behind or cannot catch up during ordinary play,
**Catching up to the live race…** appears while it temporarily skips personal
camera rendering and mutes the game. The live view and audio return when the
browser catches up. After a closed connection, reopen the invitation and select
**Join game**.

### Performance diagnostics

Open **Performance** below the game. Its summary stays visible when collapsed
and reports whether the game is running smoothly, catching up, waiting for the
room or experiencing browser hitches. The panel provides a suggested next step.

- **Game speed** measures progress along the live console timeline over a
  recent window of about six seconds. PAL targets 50 console steps/s; 100%
  means the timeline is advancing at that rate. Replayed core steps do not
  inflate this value in RetroArch rooms.
- **Browser smoothness** measures browser animation intervals separately.
  It shows the 95th percentile, longest interval and intervals of at least
  100 ms in the last six seconds. These are browser timing samples, not a
  measurement of game frames actually painted on screen.
- **Room sync** shows synchronization state, dedicated-room backlog and time
  since the confirmed room frame advanced. The backlog's time estimate is
  relative to the live room; neither that estimate nor confirmation age is ping
  or end-to-end input latency. Connection delays and local load can both
  contribute to falling behind.
- **Graphics** shows the currently active world renderer, resolution mode,
  preset and effective aspect ratio/draw distance. Menus and unsupported scenes
  can use software rendering even when WebGL2 is available for the race.

Measurements restart after backgrounding, reconnecting, synchronization or
loading a snapshot, so those transitions do not count as normal game slowdown.
Audio quality needs a separate listening check.

**Download report** saves a JSON file with current settings, measurements and
up to a minute of recent samples. It contains no room invitation, game files or
emulator snapshot. Nothing is uploaded. Developer counters and the local
snapshot button remain available under **Performance → Technical details**.

To stop the servers and tunnel, return to the hosting terminal and press
**Ctrl+C**. This closes dedicated rooms as well as the launcher.
