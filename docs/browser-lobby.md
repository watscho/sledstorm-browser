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

The lobby lists the browser requirements and hardware starting points for
players and dedicated hosts. See [hardware and connection](setup.md#hardware-and-connection)
for details.

## Before launch

| Setting | What it does | Shared with the room? |
| --- | --- | --- |
| Progress | **All content unlocked** or **Original progression**. The preset changes temporary menu memory. | Yes; guests inherit it. |
| Race aspect ratio | **16:9 · Widescreen** is the default in solo PAL races and PAL races with personal cameras in RetroArch rooms. Choose **4:3 · Original** for the original proportions. Menus and shared split-screen use 4:3. | No; personal. |
| Draw distance (experimental) | **Original** targets the solo range on personal PAL cameras. Select up to **+100%** for extra terrain. Dense scenes can shorten the range, and higher values can cause brief stutters. | Personal. |
| Image filter | **Clean** (Sharp Bilinear) is the default. **Crisp pixels**, **Smooth**, and **CRT · Lottes** are also available. The toolbar and **F7** can change the filter during play. | No; personal. |
| Enhanced 2× | Select before starting or joining. Solo PAL races and personal cameras in RetroArch rooms render at twice the width and height. Other scenes upscale the original frame. Off by default. | No; personal. |
| Volume | Browser audio volume. | No; personal. |
| Separate cameras | Full personal camera and original single-player HUD for two to four racers. Enabled by default. | Yes; guests inherit it. |
| Optional PlayStation BIOS | Dedicated rooms use the built-in BIOS. In a browser-hosted room, select your own BIOS or leave it empty for HLE. | Every player in a browser-hosted room must use the same choice/file. |
| Game files (local-file mode) | Select the CUE and all eleven BIN tracks. | Every player supplies matching contents. |
| Keep or choose game data (shared-disc invitations) | With a Quick Tunnel, **Join game** offers to open or save a ZIP. Turning the option off skips the picker. On a permanent address, turning off **Keep game data** clears the browser's cached copy after startup. | No; personal. |

Set volume, aspect ratio, draw distance and Enhanced 2× before starting. The image filter
can also change during play. The launcher remembers these settings, along
with progress, camera and game data preferences, on the same browser origin.
Create a new room to change progression or camera behavior.
Choose game modes, riders and courses in the game.

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
- **⌘S**, **Ctrl+S**, or **F9** — save the game.
- **⌘L**, **Ctrl+L**, or **F10** — load a save. Use **F10** if the browser opens its address bar.
- **Alt+Enter** — toggle fullscreen. **Esc** exits fullscreen.

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

Start a room normally. While the creator plays alone, the browser saves a
snapshot about every 15 seconds while the tab is visible, and attempts a save
when the tab becomes hidden. **Return to lobby** updates the autosave. The
**Save game** icon writes a separate manual snapshot. A guest joining pauses saves and
preserves the last solo snapshot. With the verified PAL disc, saving resumes
when the creator is alone again and the multiplayer race has ended. A controller
reserved for a player to rejoin also keeps saving paused.

Use **Load last save** in the game toolbar while playing alone. It opens a new
room from your manual save, or from the latest autosave if you have no manual
save. The toolbar shows a message if there is no compatible save. You can
share a fresh invitation after loading. **Start game** starts
a new game from the lobby.
**All content unlocked** is available in solo play with the
verified PAL disc. Snapshots are kept at the same browser address and matched
to the disc, BIOS and core.

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

## Loading and status

The launcher reports disc download progress when it has a download size,
then shows when it is preparing the emulator or synchronizing the room. It
covers the guest's game and mutes guest audio until RetroArch applies the
current room state. The
**Technical details** panel shows the controller, player count, synchronized
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

To stop the servers and tunnel, return to the hosting terminal and press
**Ctrl+C**. This closes dedicated rooms as well as the launcher.
