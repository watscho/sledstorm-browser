# Installation and local play

## Requirements

The host needs macOS or Linux, Python 3.10+, Git, Bash, make, Node.js 22+ with npm,
bsdtar/libarchive, several GB of free disk space, and a desktop browser supporting
WebAssembly and WebGL2. macOS has been tested; Linux and Windows/WSL have not
been qualified. Internet hosting also needs
[cloudflared](https://github.com/cloudflare/cloudflared#installing-cloudflared).

Dedicated hosting also needs Chrome on the host to run the room emulator.

Friends joining an internet room only need a compatible desktop browser and the
complete invitation. They can join with the host's disc in the default mode.
In local-file mode, every player supplies a matching CUE/BIN set.

## Hardware and connection

For a player, try a modern 4-core CPU and 8 GB of RAM as a starting point.
Use a desktop browser with WebAssembly SIMD and WebGL 2, turn on graphics
acceleration, and start with the default **Clean · Sharp Bilinear** filter.
Try **Enhanced 2×** once the original resolution runs smoothly. On the host,
`python3 tools/prepare-hardware-preview.py` enables optional WebGL2 acceleration
for dedicated 16:9 races with **Clean** or **Crisp pixels**.

For one dedicated room where you also play on the host, start with a modern
6-core CPU, 16 GB of RAM, and about 5 GB of free disk space for the toolchain,
game files and generated archive. These figures are planning estimates; the
project has not benchmarked minimum hardware. The dedicated room adds a
separate [headless Chrome](https://developer.chrome.com/docs/automation-and-testing/headless)
runtime even if you close your player tab.

Use Ethernet or a stable Wi-Fi connection. In shared-disc mode the host's
upload also carries the initial game download for guests without a saved copy.

## One-time setup

```sh
git clone https://github.com/watscho/sledstorm-browser.git
cd sledstorm-browser
python3 tools/bootstrap-emulator.py
python3 tools/build-emulator.py
mkdir -p game
```

Bootstrap verifies and extracts the pinned EmulatorJS release. The build fetches
pinned PCSX-ReARMed and RetroArch sources, installs an isolated Emscripten SDK,
installs the Node relay dependencies, and compiles the native adapters. Downloaded
sources and output stay in ignored `vendor/` and `.cache/` folders. No game data
is downloaded. Keep the terminal open until both commands finish successfully.

Run `python3 tools/prepare-hardware-preview.py` after the build to enable the
optional WebGL2 renderer. The generated module stays under `web/generated/`.

## Upgrade an existing installation

Stop the hosting helper with **Ctrl+C**. From a clean project directory on
`main`, update the source, refresh the pinned assets and rebuild the emulator.
If your checkout is on another branch, switch to `main` first.

```sh
git pull --ff-only
python3 tools/bootstrap-emulator.py
python3 tools/build-emulator.py
```

If you use the WebGL2 renderer, rerun `python3 tools/prepare-hardware-preview.py`.
Start the launcher again and create a new room. If playing online, send a
fresh invitation so everyone loads the same build. The camera, Netplay and
audio changes in this update require the rebuilt emulator. Solo saves are
matched to the disc, BIOS and emulator build at the same browser address.

## Add the game files

The tested edition is **Sled Storm (Europe) (En,Fr,De,Es)** for PlayStation,
**PAL SLES-02194**. Use a lawfully obtained disc image. The tested first data
track (Track 01, MODE2/2352) has SHA-1
`c5506c3eb3601d68d11f2c8754e03a6b06be5f2d`. The launcher uses that checksum
to identify the PAL data track. The CUE and all eleven BIN tracks are required
for a complete disc set.

Put exactly one CUE and its referenced BIN files in `game/`. Keep the original
filenames and CUE references. Example layout:

```text
sledstorm-browser/
└── game/
    ├── Sled Storm.cue
    ├── Sled Storm (Track 01).bin
    ├── Sled Storm (Track 02).bin
    └── … all remaining tracks through Track 11
```

These filenames are illustrative; use the names referenced by your CUE. Keep
only one CUE-containing folder directly under the project root. The server
rejects ambiguous disc sets. The supported camera/progression hooks require the
verified PAL disc; other regions, standalone ISO/CHD and PS2 Sled Storm are not
supported by this setup.

## Start and stop

For dedicated internet play, with Chrome and `cloudflared` installed:

```sh
python3 tools/play-online.py
```

Open [the launcher](http://127.0.0.1:8000/) after **Host launcher** appears.
Click **Start game**, then **Copy invite link**. Follow the
[friends guide](multiplayer.md) for the native multiplayer menus.

For dedicated play on this computer, with Chrome installed:

```sh
python3 server.py
```

Open the same localhost address. Rooms run in a separate headless Chrome
instance. Without an internet tunnel, invitations work only on this computer.
Use `python3 server.py --browser-hosted` to host the room in the creator's
browser without starting a separate Chrome instance.

> [!TIP]
> **Stop:** press **Ctrl+C** in the terminal that started hosting. The online
> helper prints **Online stack stopped.** and stops all processes it started.
> The local server stops its own relay too. Close the browser tabs afterwards.
> Run only one hosting command at a time.

On the first shared-disc launch, the server prepares `.cache/disc.zip` with all
audio tracks and computes the disc identity. It reuses that cache until the
source files change. Guest browsers load the complete disc before playing. See
[disc downloads and browser storage](multiplayer.md#disc-downloads-and-browser-storage)
for when a new download is needed.

## Each player supplies local files

Use this when every player has the same CUE/BIN set:

```sh
python3 tools/play-online.py --disc-mode local
```

For local-only hosting, use `python3 server.py --disc-mode local`. In this mode,
the server can start without a game folder. Each browser selects the CUE and all
eleven BIN files before launch; all track contents must match. Files are read
inside that browser. Host disc downloads are blocked. This mode uses
browser-hosted rooms. The creator's tab must stay open.

## Troubleshooting

| Problem | What to do |
| --- | --- |
| Missing Python, Node, npm, make or Git | Install the missing prerequisite, reopen the terminal and rerun setup. |
| Cannot extract the release archive | Install bsdtar/libarchive. macOS system `tar` supports the archive format. |
| Missing assets or native build manifest | Complete both setup commands successfully before hosting. |
| Missing or ambiguous CUE | Keep one CUE-containing game folder directly under the project root. |
| Missing BIN or disc mismatch | Keep every referenced track, preserve names, and use matching PAL files. |
| Port already in use | Press Ctrl+C in the terminal running the existing server before starting another. |
| cloudflared not found | Install it, or set `CLOUDFLARED_BIN` to its executable path. |
| Chrome not found for dedicated hosting | Install Chrome, set `SLED_CHROME_BIN` to its executable path, or launch with `--browser-hosted`. |
| Friend cannot open the invitation | Copy the complete generated HTTPS invitation, keep hosting running, and check internet access. |
| This room is no longer available | Copy a fresh invitation from the host's running game. A previous room link stops working when that room expires or the server restarts. |
| Invitation begins with 127.0.0.1 | Start the online helper, wait for its tunnel, then start a fresh game and copy its invitation. |
| Copy invite link says the Cloudflare Tunnel is inactive | Stop the local server with **Ctrl+C** and run `python3 tools/play-online.py`. Wait for **Host launcher**, then start a room and copy its invitation. |
| Slow first join | Wait for the game data download to finish. **Synchronizing with the room** appears once RetroArch starts receiving the current game state. |
| Guest joins the room but has no rider | Register that controller in the game's multiplayer menu before starting a new race. Rejoining a live race uses an existing racer. |
| Browser-hosted room waiting for a player | Bring the affected game window back to the foreground. If the connection closed, guests can reopen the invitation. Local-file guests select their files again. |
| Catching up to the live race | This appears when recovery lasts more than a brief delay. The dedicated server keeps advancing even when only one controller is connected. If the connection closes, reopen the invitation in the same browser and select **Join game**. |
| Keyboard does not respond | Click the game to focus it. Check the key hints below the game. Classic uses arrows to steer, S to confirm or accelerate, Enter to pause and W to go back. |
| Gamepad is missing | Connect it before starting, press a button and check **Controls** for the device name. The browser must expose a standard gamepad mapping. |
| 16:9 is unavailable | Use the verified PAL disc and start a solo race or a dedicated room with **Separate cameras** enabled. Menus and shared split-screen use 4:3. |
| Enhanced 2× looks like the original resolution | Enter a solo PAL race or a dedicated race with personal cameras to use native 2×. Other scenes upscale the finished frame. |
| Draw distance is unavailable, varies by scene or stutters | **Display and audio → Draw distance (experimental)** applies to solo PAL races and dedicated personal cameras. Higher values set a ceiling, and the renderer can shorten the range in dense scenes. If you see brief stutters, try a lower value or **Original**. |
| Save or load icon is hidden | Use the room creator's browser, with only its controller connected and no reserved seats or active multiplayer race. |
| Guests download the disc on every launch | In Chrome with a Quick Tunnel, keep **Keep or choose game data** checked and use **Use existing ZIP** to select the same archive. See [browser storage](multiplayer.md#disc-downloads-and-browser-storage). |
| State mismatch | Stop the session and start a fresh room with matching files, BIOS and build. |

Private helper logs are in `.cache/online/`. Do not publish access links, room
tokens or game files when reporting a problem. See [verification](verification.md)
for tested behavior and remaining limits.
