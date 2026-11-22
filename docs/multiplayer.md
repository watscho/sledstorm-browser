# Playing with friends

## Host

Start the [macOS app preview](sled-storm-server.md#first-run) or
[Python source launcher](setup.md#start-and-stop). Choose a disc policy and
copy the full private HTTPS invitation. Share it with your players. The
`127.0.0.1` address is for the computer opening it.

Keep the hosting computer awake and the server running. The packaged room
can stay open with zero players. Python's browser-hosted mode uses the
creator's tab to run the room.

## Join

1. Open the full invitation in a [compatible desktop browser](platforms.md).
2. Choose personal graphics, audio and controls. Progression and camera mode
   come from the room.
3. In **Game files** or the join dialog, use a matching **CUE and eleven BIN
   tracks**, choose a **saved ZIP**, or select **Download from server** when
   available.
4. Click **Join game**, wait for **LIVE**, and click the game to focus the
   keyboard.

Choose game files from the same PAL SLES-02194 disc, including every music
track. Dedicated rooms use the built-in BIOS. Browser-hosted players use the
same BIOS file or choose the built-in HLE option together.

## Disc downloads and browser storage

Where a room enables host downloads, the full archive includes the music
tracks. Each guest can make their own choice among the offered sources.

| Situation | What happens |
| --- | --- |
| Package download interrupted at the same address | Reload the invitation to reuse verified chunks where the browser can store them. |
| Host restarts and gets a new Quick Tunnel address | Browser progress belongs to the old address. Choose the previously saved ZIP again on the new one. |
| Browser supports keeping file handles | The launcher can remember your selection per address. If access expires, **Join game** can ask for it again. |
| Browser uses a file input or refuses storage | Choose files again as needed. The download remains available where the host allows it. |

When the browser offers **Save a ZIP and join**, keeping the ZIP makes
future joins at a new address quicker. A deflated ZIP can use substantial
additional memory. Prefer individual tracks or a stored ZIP on a machine
with limited RAM. Preview chunk/resume behavior is described in the
[server guide](sled-storm-server.md#disc-policy).

## Start a race

1. Let all racers connect before selecting a race.
2. If the game opens on the language screen, player 1 chooses a language and
   confirms with **S** in the Classic preset.
3. Choose **Start → Multiplayer quick race** in the original menus.
4. Each player presses **S** to register and confirms a rider. Player 1
   chooses the course and starts.
5. With Classic controls, steer with the arrows, hold **S** to accelerate,
   press **Enter** to pause and **W** to go back in menus.

A room has up to four controllers. **Separate cameras** gives racers their
own view and original HUD. Players can mix personal 4:3 and widescreen
settings. The shared pause/options menu keeps its original 4:3 shape.

## Reconnect or stop

Reopen the same invitation in the same browser at the same address and
rejoin. A dedicated room can reserve a controller during a race for the
returning player. A new lobby assignment can replace the previous
credential. In browser-hosted play the creator's tab must stay open.

To end a packaged room, use **Stop room** or **Quit server**. For Python
hosting, press **Ctrl+C** in the host terminal. The tunnel's temporary
invitation expires when hosting stops. If the host gets a new address,
use the new invitation.

[Controls and saves](browser-lobby.md) · [Verification](verification.md)
