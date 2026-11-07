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
| Optional PlayStation BIOS | Select your own BIOS, or leave empty for HLE. | Every player must independently use the same choice/file. |
| Game files (local-file mode) | Select the CUE and all eleven BIN tracks. | Every player supplies matching contents. |

All launcher controls are disabled once the game starts, including personal
volume and image settings. Set them before launching. Create a new room to
change progression or camera behavior. Native game modes, riders, sleds and courses are chosen inside
the game rather than in the browser launcher.

## Personal controls

In **Controls**, choose **Classic** (arrows + X), **WASD** (WASD + Space), or
click any key button and press a replacement. **Escape** cancels capture.
A conflicting key swaps with the previous binding, keeping one key per button.
**Other PlayStation buttons** reveals the remaining bindings. **Reset controls**
restores Classic. Key bindings are saved under `sledstorm.controls.v1` in this
browser's localStorage; denied storage falls back to session-only preferences.
Keyboard layouts are independent for each player and are excluded from room
settings and invitation links. Choose them before launch.

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

**Copy link** in the session toolbar copies the complete invitation and briefly
shows **Copied**. The URL stays off screen.
When the online helper is running, the host's localhost launcher generates the
public HTTPS link automatically. A guest can copy and reshare the same room
invitation. A new game launched from the root page creates a different room.

The emulator hover toolbar is hidden, and the pointer is hidden over the game.
Use the session toolbar above the game for fullscreen and returning to the lobby.

Click the game to focus it. With Classic controls, use arrows, **X** for
confirm/accelerate, **Enter** for Start/pause and **A** for triangle/back.
The hint below the game reflects your selected keyboard bindings. The native pause menu affects the
shared console, so all players see it in the original 4:3 proportions.

## Presentation and progress

Separate cameras replay the local player's geometry into a private framebuffer
and render the original single-player HUD in an isolated pass. Multiplayer
world detail remains that of the original game. Turning this setting off uses
the game's original shared-screen presentation. See the
[architecture guide](browser-emulator.md) for implementation details.

The [all-content preset](unlocked-profile.md) changes session memory, including
rider, sled and course selection. Rooms use fresh temporary memory cards;
persistent single-player cards and disc files are unchanged.

Use **Fullscreen** above the game to show only the game, hiding invitations,
toolbars and emulator controls. Press **Escape** to return to the normal view.
**Return to lobby**
asks before disconnecting your controller; remaining players can continue.
This does not stop hosting.

## Loading and status

The launcher reports loading, history catch-up and waiting for peers. Catch-up
audio is muted until the browser reaches live play. The **Technical details** panel
shows controller number, connected-player count, synchronized frame, completed
console steps and state-check status. Normal live play leaves the status area
above the game empty; loading, synchronization and errors remain visible. PAL targets
50 steps/s; this counter alone does not establish audio quality or distinct
displayed frames. Keep peer tabs active to avoid browser suspension.

To stop the servers and tunnel, return to the hosting terminal and press
**Ctrl+C**. Closing this page only disconnects its controller.
