# Sled Storm Browser

**Version 1.0.0 · [Changelog](CHANGELOG.md) · [Release verification](docs/verification.md#100-verification-summary)**

[Personal camera parity](#personal-camera-parity)
 · [Pine Valley multiplayer fixes](#pine-valley-multiplayer-fixes)
 · [Draw distance and race stability](#draw-distance-and-race-stability)

Play **Sled Storm (1999), PlayStation PAL SLES-02194**, in your browser with up
to **four players in one room**. Each browser runs PCSX-ReARMed and controls one
sled, with its own full camera and the original single-player HUD. Game modes,
riders, sleds and courses are selected in the original game menus.

<p align="center">
  <img src="docs/images/sled-storm-pal-cover.jpg" alt="Sled Storm PlayStation PAL cover art" width="420">
</p>

*Cover scan: [PSX Data Center](https://psxdatacenter.com/images/hires/P/S/SLES-02194/SLES-02194-F-ALL.html).
Original game artwork is not covered by the wrapper's MIT license.*

## Version 1.0.0

The first 1.0 release includes dedicated four-player rooms, personal PAL cameras
and HUDs, remembered ZIP selection for returning guests, and room links that
survive returning to the lobby. A verified ZIP turns **Join game · Ready** green.
The launcher defaults to **16:9**, **Clean · Sharp Bilinear**, **Enhanced 2×**
and **+100%** draw distance. Personal choices remain adjustable.

Upgrading from 0.x requires rebuilding the native emulator. Follow
[the upgrade steps](docs/setup.md#upgrade-an-existing-installation), then start
a new room and send a fresh invitation. Source releases contain no game disc,
BIOS, memory cards or compiled emulator downloads. Platform and multiplayer
coverage is described in [known limits](#current-limits).

## ▶ Start, invite, stop

> [!IMPORTANT]
> **Only the host installs and runs this project.** Friends open an invitation
> in their browsers. One CUE/BIN set on the host is enough. Guests can download
> the shared archive for the session or reuse a ZIP they saved earlier.

### 1. Set up once

On macOS or Linux, install **Python 3.10+, Git, Bash, make, Node.js 22+ with
npm**, and **bsdtar/libarchive** (`tar` on macOS). Internet play also requires
[cloudflared](https://github.com/cloudflare/cloudflared#installing-cloudflared).
Install Chrome on the host for dedicated rooms. Use a desktop browser with
WebAssembly and WebGL2 to play. macOS has been tested;
Linux setup has not been qualified.

If you use nvm, run `nvm use` from the project folder before building or
hosting. The project selects Node.js 24 in `.nvmrc`. Run `nvm install` first
if that version is missing.

Clone the project and build it from the terminal:

```sh
git clone https://github.com/watscho/sledstorm-browser.git
cd sledstorm-browser
python3 tools/bootstrap-emulator.py
python3 tools/build-emulator.py
mkdir -p game
```

The tested edition is **Sled Storm (Europe) (En,Fr,De,Es)** for PlayStation,
**PAL SLES-02194**. Supply your own lawfully obtained disc image and copy its
**CUE file and all eleven BIN tracks** into `game/`. Keep the filenames
referenced by the CUE. See [disc identification](docs/setup.md#add-the-game-files)
for the tested data track's checksum. The scripts download only emulator
dependencies. The first build can take time and needs several GB of free space.
You only need to repeat the build after updating emulator or native adapter code.

For WebGL2 acceleration in dedicated 16:9 races, run
`python3 tools/prepare-hardware-preview.py` on the host after the build.

### 2. Start the game

Open a terminal in the project folder and run:

```sh
python3 tools/play-online.py
```

Wait until the terminal prints **Host launcher**, then:

1. Open **[http://127.0.0.1:8000/](http://127.0.0.1:8000/)** on the host computer.
2. Choose your settings and click **Start game**. While playing alone, use
   **Load last save** in the game toolbar to restore a saved game.
3. Click **Copy invite link** in the session toolbar and send the complete link
   to your friends. It automatically uses the public HTTPS address.
4. Each friend opens the link and clicks **Join game**. In the game data dialog,
   choose an existing ZIP, save a new ZIP and join, or join without saving.
   Wait for synchronization.

The four indicators below the game light up as controllers connect. If you
lose your connection during a race, reopen the room from the same browser
and address to resume your controller.

Keep the terminal open and the host computer awake. With a Quick Tunnel in
Chrome, **Join game** lets you open an existing ZIP or choose where to save one
when **Keep or choose game data** is checked. Select the same ZIP on a new tunnel
address to reuse the full disc, including music. You can also join without
saving. A permanent HTTPS address reuses its browser copy
automatically. Each new game started from the launcher gets its own room.
At the same tunnel address, returning to the lobby keeps your selected ZIP.
If Chrome resets file access, **Join game** renews access to that same file;
the source picker is not reopened. A new tunnel address has separate storage.
See [disc downloads and browser storage](docs/multiplayer.md#disc-downloads-and-browser-storage).

### 3. Enter a race together

In the original game, choose **Start → Multiplayer quick race**. Each player
presses **S** to join with the default keyboard layout, then chooses and confirms
a rider. Player 1 chooses the course and starts the race. Up to **four players total** can join a room.

| Key | Action |
| --- | --- |
| Arrow keys | Navigate / steer |
| **S** | Confirm / accelerate (Cross) |
| **Enter** | Start / pause |
| **W** | Triangle / back |
| **A** / **D** | Square / Circle |
| **Q** / **E** | L1 / R1 |
| **Z** / **C** | L2 / R2 |
| **Right Shift** | Select |

Open **Controls** before launching to choose Classic or WASD, click a button on
the DualShock illustration to rebind it, or remap a connected gamepad. Your
chosen layout, Custom bindings and controller mappings are saved in your
browser. See [personal controls](docs/browser-lobby.md#personal-controls).

Click the game if the keyboard does not respond. Register each rider before
starting the race. A returning guest can open the same invitation and resume
from the current race state once their game files load.

### 4. Switch everything off

> [!TIP]
> In the terminal running the game, press **Ctrl+C** once.
> Wait for **Online stack stopped.** This stops the game server, relay, gateway
> and Cloudflare Tunnel started by the helper. Then close the game tabs.
>
> In browser-hosted mode, closing the host's tab ends the room. The hosting terminal can still serve
> the launcher. To play again after stopping the tunnel, restart the helper
> and send the new invitation.

## Personal camera parity

Personal cameras now keep the original speedometer smoothing, display all
racers on the minimap and draw PAL tread marks on the snow. **Original** draw
distance uses the solo terrain span when the scene fits the geometry budget.
The shared pause menu appears in 4:3 over each player's own view.

The Pine Valley opening camera now keeps the snowbanks and backdrop visible
as it passes in front of the starting grid. The start checks used two, three
and four Chrome clients in both room types on one Mac, with 4:3, widescreen,
software Enhanced 2× and WebGL2. See the
[verification record](docs/verification.md#093-verification-summary).

Personal cameras also keep the Pine Valley scenery and sleds visible at the
lap and finish line. Both Chrome clients in a three-lap dedicated race
reached matching standings. See the
[lap and finish checks](docs/verification.md#094-verification-summary).

## Pine Valley multiplayer fixes

Personal cameras preserve the sign and ice-wall debris.
The PAL game awards 50 points for the sign and 500 for the ice wall. Both
browser-hosted and dedicated rooms use the full-size PAL camera for these
effects, snowfall, widescreen scenery and the local finish banner.

Browser-hosted guests return to their original controller when they reopen
the invitation in the same browser. Dedicated rooms compress the rejoin
snapshot faster, shortening the audio interruption for players still racing.

Verification covered full races with two, three and four Chrome clients on
one Mac. The [verification record](docs/verification.md#091-verification-summary)
lists the render modes, test results and follow-up coverage.

## Draw distance and race stability

The draw distance setting extends the view down the course, while dedicated
room synchronization keeps the race going when a player reconnects or
packets arrive in bursts.

| Area | What changed and why |
| --- | --- |
| **More terrain in view** | The PAL renderer draws farther while the scene has room in its geometry budget. It reduces the extra range in dense scenes and reserves space for sleds and shadows during the opening sweep and countdown. The wide start view extends the original fog backdrop across the sides. |
| **Fewer interruptions online** | The dedicated runtime advances at the PAL console rate. Small input messages can arrive over either of two WebSocket routes, and the client reconciles late input before the next view. A larger audio reserve and faster refill cover short bursts of replay work. |
| **Keep your controller** | The dedicated room keeps running when the creator closes their tab. Another player can take ownership while keeping their controller number, and returning players recover their original seats. |

> [!NOTE]
> **Draw distance is experimental.** **+100%** is the launcher default. In
> **Display and audio**, set a personal maximum up to **+100%** for solo PAL
> races or RetroArch rooms with personal cameras. The visible range can vary by
> scene, and higher settings can cause brief stutters, especially with 16:9
> and Enhanced 2×. Lower the slider or select **Original** if you notice them.

We tested the same Pine Valley section in **4:3 and 16:9**, at **1× and 2×**,
with both **Original** and **+100%** range. Final Cloudflare runs with two,
three and four Chrome clients matched the dedicated server at each of 900
sampled steps per window, including a second four-player window after rejoining.
Those runs recorded zero catch-up episodes, room stalls or scheduled audio gaps
over 5 ms. The longest displayed interval was 117 ms after a 97 ms pause in
ordered delivery. The clients ran on one M5 Pro. See the
[verification summary](docs/verification.md#090-verification-summary).

## Other ways to play

| What you want | Command |
| --- | --- |
| Dedicated internet room with persistent controller slots | `python3 tools/play-online.py` |
| Internet play hosted by the creator's browser | `python3 tools/play-online.py --browser-hosted` |
| Internet play; each player selects matching CUE/BIN files | `python3 tools/play-online.py --disc-mode local` |
| Play locally in a dedicated room, without a tunnel | `python3 server.py` |
| Play locally with the room hosted in the creator's browser | `python3 server.py --browser-hosted` |

Run only one hosting command at a time. Stop it with **Ctrl+C** before changing
modes. Use the localhost address for local-only play. To invite another
computer, including one on the same Wi-Fi, use the online launcher and copy
its HTTPS invitation.

## Settings and session behavior

Choose race aspect ratio, draw distance, image filtering, volume and
**Enhanced 2×** in **Display and audio**. Solo PAL races and personal cameras in
RetroArch rooms default to **16:9** with **Clean · Sharp Bilinear** filtering
and **Enhanced 2×** enabled. **Draw distance** is experimental and defaults to **+100%**.
**4:3 · Original** is available for races, and menus and shared split-screen
stay in 4:3.
The in-game toolbar also offers filter switching, PNG screenshots and
fullscreen (**Alt+Enter**).

The game autosaves in the browser while the room creator plays alone. Use
**Save game** for a manual snapshot or **Load last save** to open a fresh room
from it. Saves pause while a guest is connected or has a reserved race seat.
See [solo sessions and shortcuts](docs/browser-lobby.md#solo-sessions).

**All content unlocked** is enabled by default and applies to temporary game
memory. Disc files and persistent memory cards are unchanged. Optional BIOS
files must match across all players; leaving BIOS empty uses HLE.

Guests inherit the room's progression and camera settings. Volume and image
filtering are personal. Native pause menus retain their shared controls and
4:3 proportions over each personal camera. Each browser emulates the console
locally and exchanges controller inputs and emulator state through RetroArch
Netplay.

## Current limits

- **Game files.** Use the PlayStation PAL SLES-02194 CUE and all eleven BIN
  tracks. Standalone ISO/CHD, other regions and the PS2 game are outside the
  supported setup. [Disc setup](docs/setup.md#add-the-game-files)
- **Room behavior.** RetroArch sends the current emulator state to guests
  once they load the disc. Register each rider in the game's multiplayer menu
  before starting the race. A returning controller can resume its existing
  racer. In a dedicated room, the server keeps the race moving while browsers
  catch up or reconnect. Empty rooms stay available for a limited time while
  the hosting process runs.
  [Rooms and synchronization](docs/multiplayer.md#rooms-and-synchronization)
- **Presentation.** Solo PAL races and personal cameras in RetroArch
  rooms support widened race geometry and native 2× rendering. Shared
  split-screen and menus use the original frame for upscaling. The HUD
  keeps native rasterization in Enhanced 2×.
  [Camera details](docs/browser-emulator.md#cameras-progression-and-technical-settings)
- **Test coverage.** Current Pine Valley tunnel checks used two to four Chrome
  clients on one M5 Pro. Separate computers, other courses at extended draw
  distances, physical gamepads and soundtrack quality still need hands-on
  testing. Shared delivery interruptions can still cause visible hitches.
  [Verification record](docs/verification.md)

## Documentation

[Browse all documentation](docs/README.md).

- [Installation and troubleshooting](docs/setup.md)
- [Playing with friends and hosting](docs/multiplayer.md)
- [Launcher settings](docs/browser-lobby.md)
- [All-content preset](docs/unlocked-profile.md)
- [Emulator architecture and source pins](docs/browser-emulator.md)
- [Verification and known limits](docs/verification.md)
- [Contributing and checks](CONTRIBUTING.md)

## Sources and license

Built with [EmulatorJS](https://github.com/EmulatorJS/EmulatorJS),
[PCSX-ReARMed](https://github.com/EmulatorJS/pcsx_rearmed) and
[RetroArch](https://github.com/EmulatorJS/RetroArch). Exact versions and source
commits are documented in [third-party notices](THIRD_PARTY_NOTICES.md).

OpenEmu inspired the in-game shortcuts, solo save workflow and controller
remapping. See the [design credit and implementation sources](THIRD_PARTY_NOTICES.md#interface-inspiration).

Original wrapper, networking and tooling contributions are **MIT**, copyright
**Vacho Aivazov**. Upstream components retain their own licenses. Game images,
BIOS, compiled emulator binaries, memory cards and private invitations are
excluded from Git. Game content and trademarks belong to their respective
owners. This project is not affiliated with Electronic Arts or upstream authors.
