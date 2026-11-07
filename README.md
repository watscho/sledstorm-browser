# Sled Storm Browser

**Version 0.3.0 · experimental · [Changelog](CHANGELOG.md)**

Play **Sled Storm (1999), PlayStation PAL SLES-02194**, in your browser with up
to **four players in one room**. Each browser runs PCSX-ReARMed and controls one
sled, with its own full camera and the original single-player HUD. Game modes,
riders, sleds and courses are selected in the original game menus.

<p align="center">
  <img src="docs/images/sled-storm-pal-cover.jpg" alt="Sled Storm PlayStation PAL cover art" width="420">
</p>

*Cover scan: [PSX Data Center](https://psxdatacenter.com/images/hires/P/S/SLES-02194/SLES-02194-F-ALL.html).
Original game artwork is not covered by the wrapper's MIT license.*

## ▶ Start, invite, stop

> [!IMPORTANT]
> **Only the host installs and runs this project.** Friends open an invitation
> in their browsers. With the default settings, one CUE/BIN set on the host is
> enough; friends do not select game files or install development tools.

### 1. Set up once

On macOS or Linux, install **Python 3.10+, Git, Bash, make, Node.js 22+ with
npm**, and **bsdtar/libarchive** (`tar` on macOS). Internet play also requires
[cloudflared](https://github.com/cloudflare/cloudflared#installing-cloudflared).
Use a desktop browser with WebAssembly and WebGL2. macOS has been tested;
Linux setup has not been qualified.

Clone the project and build it from the terminal:

```sh
git clone https://github.com/watscho/sledstorm-browser.git
cd sledstorm-browser
python3 tools/bootstrap-emulator.py
python3 tools/build-emulator.py
mkdir -p game
```

Copy your **PAL SLES-02194 CUE file and all eleven BIN tracks** into `game/`.
Keep their filenames unchanged. The scripts download emulator dependencies,
not the game. The first build can take time and needs several GB of free space.
You only need to repeat the build after updating emulator or native adapter code.

### 2. Start the game

Open a terminal in the project folder and run:

```sh
python3 tools/play-online.py
```

Wait until the terminal prints **Host launcher**, then:

1. Open **[http://127.0.0.1:8000/](http://127.0.0.1:8000/)** on the host computer.
2. Choose your settings and click **Start game**.
3. Click **Copy link** in the session toolbar and send the complete link
   to your friends. It automatically uses the public HTTPS address.
4. Each friend opens the link and clicks **Join game**. Wait for synchronization.

Keep the terminal open and the host computer awake. Guests using a temporary
Quick Tunnel download the full disc, including music, on each launch. Localhost
and permanent hostnames can reuse a saved browser copy. Each new game started
from the launcher gets its own room. See [disc downloads and browser storage](docs/multiplayer.md#disc-downloads-and-browser-storage).

### 3. Enter a race together

In the original game, choose **Start → Multiplayer quick race**. Each player
presses **X** to join, chooses a rider and confirms. Player 1 then chooses the
course and starts the race. Up to **four players total** can join a room.

| Key | Action |
| --- | --- |
| Arrow keys | Navigate / steer |
| **X** | Confirm / accelerate |
| **Enter** | Start / pause |
| **A** | Triangle / back |

Click the game if the keyboard does not respond. Invite everyone before the
race for the shortest wait.

### 4. Switch everything off

> [!TIP]
> In the terminal running the game, press **Ctrl+C** once.
> Wait for **Online stack stopped.** This stops the game server, relay, gateway
> and Cloudflare Tunnel started by the helper. Then close the game tabs.
>
> Closing a browser tab alone does **not** stop hosting. To play again, run the
> same start command and send a **new** invitation; temporary links expire when
> hosting stops.

## Other ways to play

| What you want | Command |
| --- | --- |
| Internet play; host supplies the disc | `python3 tools/play-online.py` |
| Internet play; each player selects matching CUE/BIN files | `python3 tools/play-online.py --disc-mode local` |
| Play only on this computer, without a tunnel | `python3 server.py` |

Run only one hosting command at a time. Stop it with **Ctrl+C** before changing
modes. For local-only play, use the same localhost address; its invitation only
works on that computer. Two computers on the same Wi-Fi can use the internet
mode and its HTTPS invitation.

## Settings and session behavior

Before launching, choose progress, image filtering, volume and separate cameras.
**All content unlocked** is enabled by default and applies to temporary game
memory. Disc files and persistent memory cards are unchanged. Optional BIOS
files must match across all players; leaving BIOS empty uses HLE.

Guests inherit the room's progression and camera settings. Volume and image
filtering are personal. Native pause menus remain shared and retain their 4:3
proportions. Each browser emulates the console locally; networking exchanges
controller inputs and state checks, rather than streaming video.

## Current limits

Four browsers on one Mac raced together with separate controls, cameras and
HUDs. All agreed at 19,500 core steps; short final measurements were 48.5–50.3
steps/s against a PAL target of 50. Two browsers also loaded and joined through
the Cloudflare HTTPS tunnel. See [verification](docs/verification.md).

Late arrivals replay the session from boot, temporarily pausing the room.
Long sessions take longer to join, and the slowest player can slow everyone
down. Keep game tabs active. Rooms are temporary; rollback, host migration and
persistent session recovery are not implemented. Multiplayer scenery and detail
follow the original game. Separate physical computers, audible soundtrack
quality, hidden tabs and all courses have not been comprehensively tested.

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

Original wrapper, networking and tooling contributions are **MIT**, copyright
**Vacho Aivazov**. Upstream components retain their own licenses. Game images,
BIOS, compiled emulator binaries, memory cards and private invitations are
excluded from Git. Game content and trademarks belong to their respective
owners. This project is not affiliated with Electronic Arts or upstream authors.
