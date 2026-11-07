# Launcher settings

Open [http://127.0.0.1:8000/](http://127.0.0.1:8000/) after starting the
[hosting command](multiplayer.md). Set preferences before pressing **Start game**.
An invitation opens the same launcher with **Join game** instead.

The launcher groups settings into **Game**, **Display and audio**, **Controls**
and **Game files** tabs, with a live launch summary and PAL cover artwork.
Tabs support arrow-key navigation; **Reset settings** restores available launch
controls to their defaults and clears selected files. Guest room settings remain
locked to the invitation.

## Before launch

| Setting | What it does | Shared with the room? |
| --- | --- | --- |
| Progress | **All content unlocked** or **Original progression**. The preset changes temporary menu memory. | Yes; guests inherit it. |
| Image | Crisp or smooth filtering. | No; personal. |
| Volume | Browser audio volume. | No; personal. |
| Separate cameras | Full personal camera and original single-player HUD for two to four racers. Enabled by default. | Yes; guests inherit it. |
| Optional PlayStation BIOS | Dedicated rooms use the built-in BIOS. In a browser-hosted room, select your own BIOS or leave it empty for HLE. | Every player in a browser-hosted room must use the same choice/file. |
| Game files (local-file mode) | Select the CUE and all eleven BIN tracks. | Every player supplies matching contents. |
| Keep or choose game data (shared-disc invitations) | With a Quick Tunnel, **Join game** offers to open or save a ZIP. Turning the option off skips the picker. On a permanent address, turning off **Keep game data** clears the browser's cached copy after startup. | No; personal. |

All launcher controls are disabled once the game starts, including personal
volume and image settings. Set them before launching. Create a new room to
change progression or camera behavior. Native game modes, riders, sleds and courses are chosen inside
the game rather than in the browser launcher.

## Personal controls

In **Controls**, choose **Classic** (arrows + S) or **WASD** (WASD + Space).
To customize either preset, select a button on the DualShock illustration and
press a replacement key. The label beside each button shows its assigned key.
L2 and R2 appear above the illustration, and ⌫ means Backspace.

**Escape** cancels capture. If a key is already assigned, the two bindings swap.
**Reset controls** restores Classic. Existing layouts carry over when updating.
Keyboard bindings are saved per browser origin. A new temporary Quick Tunnel
address has its own preferences. When browser storage is unavailable, changes
apply for the current page only.

Connect a controller through USB or Bluetooth and press a button to expose it
to the browser. The device name and input indicator show what the browser can
see. **Automatic** samples the first controller with a standard browser mapping;
you can choose a specific detected device or **Keyboard only**. Device selection
is for the current launch and is not persisted. Nonstandard mappings are marked
unsupported. A physical gamepad has not been qualified on the test machine.

The left stick and D-pad steer; the bottom face button (Xbox A / PlayStation ×)
accelerates/confirms, the top face button (Y / △) goes back, and Start / Options
pauses. Keyboard input remains available alongside the chosen controller. One
browser supplies one room controller; connecting another physical gamepad does
not add another participant. Disconnecting the pad releases its sampled input.
The browser frontend cannot bypass these local device preferences.

## After launch

**Copy invite link** in the session toolbar copies the complete invitation and briefly
shows **Copied**. The URL stays off screen.
When the online helper is running, the host's localhost launcher generates the
public HTTPS link automatically. A guest can copy and reshare the same room
invitation. A new game launched from the root page creates a different room.

The emulator hover toolbar is hidden, and the pointer is hidden over the game.
Use the session toolbar above the game for fullscreen and returning to the lobby.

Four controller indicators below the game light up when the corresponding
player is connected. In a dedicated room, reopen the invitation in the same
browser and at the same address to rejoin a running race. **Controls** in the launcher shows detected gamepads
before starting.

Click the game to focus it. With Classic controls, use arrows, **S** for
confirm/accelerate, **Enter** for Start/pause and **W** for triangle/back. The
remaining Classic bindings are **A** (Square), **D** (Circle), **Q/E** (L1/R1),
**Z/C** (L2/R2) and **Right Shift** (Select).
The hint below the game reflects your selected keyboard bindings. The native pause menu affects the
shared console, so all players see it in the original 4:3 proportions.

## Presentation and progress

Dedicated rooms render each racer's camera with the game's full-size
renderer and original single-player HUD in an isolated pass. Browser-hosted
rooms replay the local racer's geometry into a private framebuffer. Turning
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

## Loading and status

The launcher reports disc download progress when it has a download size,
then shows when it is preparing the emulator or synchronizing the room. It
covers the guest's game and mutes guest audio until RetroArch applies the
current room state. The
**Technical details** panel shows the controller, player count, synchronized
frame and completed console steps. Loading, synchronization and errors appear
above the game. PAL targets 50 console steps/s. The counter measures console
steps, while audio and displayed frame pacing need separate checks. A
browser-hosted room can wait for a suspended player. In dedicated mode the
server advances independently of browser input. If your browser falls far
behind or cannot catch up during ordinary play,
**Catching up to the live race…** appears while it temporarily skips personal
camera rendering and mutes the game. The live view and audio return when the
browser catches up. After a closed connection, reopen the invitation and select
**Join game**.

To stop the servers and tunnel, return to the hosting terminal and press
**Ctrl+C**. This closes dedicated rooms as well as the launcher.
