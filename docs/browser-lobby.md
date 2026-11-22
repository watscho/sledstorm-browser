# Controls, graphics and saves

Each player chooses controls, graphics and audio in their browser. The room
supplies progression and camera settings. See [playing with friends](multiplayer.md)
for game data, invitations and the original multiplayer menus.

## Before launch

In **Display and audio**, choose a graphics preset. Lower draw distance or
disable Enhanced 2× if the browser falls behind. Personal graphics can
differ between players in the same room.

| Preset | Race aspect ratio | Filter | Enhanced 2× | Extra draw distance |
| --- | --- | --- | --- | --- |
| **Performance** | 4:3 | Crisp pixels | Off | Original |
| **Balanced** | 16:9 | Clean | Off | +50% |
| **Quality** (default) | 16:9 | Clean | On | +100% |

Changing an individual graphics setting activates **Custom**. The browser
keeps the last Custom combination when you try a preset. Unsupported scene
or room settings use the available renderer and view. Refer to
[Performance](#diagnostics) for the effective settings.

## Personal controls

Choose **Classic** (arrows and **S**) or **WASD** (WASD and **Space**). Select
a button on the controller illustration and press the replacement key.
**Escape** cancels and a duplicate assignment swaps the bindings.

For a controller, connect it over USB or Bluetooth and press a button so
the browser detects it. Choose **Automatic**, a detected controller or
**Keyboard only**. Use **Remap controller buttons** to change the mapping.
Each browser supplies one controller to the room. Physical gamepad
qualification is listed in [verification](verification.md).

| Shortcut | Action |
| --- | --- |
| **F7** | Cycle image filters. |
| **F8** | Save a PNG screenshot. |
| **F9** or **Ctrl/⌘+S** | Open manual save slots. |
| **F10** | Open Saved games. |
| **Alt+Enter** | Toggle fullscreen. |
| **Esc** | Close the save dialog or exit fullscreen. |

Preferences are stored for the current browser origin. A new Quick Tunnel
address has separate settings.

## Solo sessions

Open **Saved games** from the lobby or the game toolbar. The library
keeps six manual slots and three rotating autosaves. Select a checkpoint
to load, rename or export it. **Keep in manual slot** preserves an autosave
beyond rotation. Overwrite and deletion ask for confirmation, and the most
recent deleted checkpoint can be restored.

Saving and loading need a synchronized solo session. An additional
connected or reserved controller, multiplayer race or attract demo can
pause these actions. The library explains the current restriction.
Autosave pauses while the library is open.

- The Python workflow opens a fresh solo room for the loaded checkpoint.
  Share its fresh invitation if you continue playing together.
- In a packaged room, an eligible sole owner can load a checkpoint into
  the existing room. Its invitation and room options stay in place.

Use **Export file** to back up or move a `.sledsave` and **Import save** to
verify it before choosing a destination slot. A checkpoint must match
the disc, BIOS/HLE and pinned emulator build. Files are limited to
6 MiB with bounded decompression. A save contains the checkpoint,
metadata and preview. Keep the disc and BIOS separately.

Browser checkpoints belong to their origin. Export before clearing site
data or switching to another browser or address.

## Diagnostics

Open **Performance** below the game. PAL targets 50 console steps/s.
Game speed counts progress through the live console timeline. Browser
smoothness measures animation intervals separately. Room sync reports
catch-up, backlog and age of the latest confirmation. Interpret those
metrics separately from painted FPS and input latency.

**Download report** saves a JSON summary with current settings and recent
measurements. Keep the renderer, browser and room topology with the
report when diagnosing a performance difference.
