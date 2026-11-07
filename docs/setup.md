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

## Add the game files

Put exactly one PAL SLES-02194 CUE and all eleven referenced BIN tracks in
`game/`. Keep the original filenames and CUE references. For example:

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
python3 tools/play-online.py --dedicated
```

Open [the launcher](http://127.0.0.1:8000/) after **Host launcher** appears.
Click **Start game**, then **Copy link**. Follow the
[friends guide](multiplayer.md) for the native multiplayer menus.

For play only on this computer:

```sh
python3 server.py
```

Open the same localhost address. This starts the runtime and relay without an
internet tunnel. Its invitations work only on this computer.
Add `--dedicated` to test the roster and controller recovery locally.

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

## Updating

Stop hosting before updating. From a clean project checkout:

```sh
git pull --ff-only
python3 tools/bootstrap-emulator.py
python3 tools/build-emulator.py
```

Start hosting again and send a new invitation. Everyone in the room uses the
same served build. New dedicated rooms enable the native full-size camera and
single-player HUD by default.

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
| Chrome not found for dedicated hosting | Install Chrome on the host, or set `SLED_CHROME_BIN` to its executable path. |
| Friend cannot open the invitation | Copy the complete generated HTTPS invitation, keep hosting running, and check internet access. |
| Invitation begins with 127.0.0.1 | Start the online helper, wait for its tunnel, then start a fresh game and copy its invitation. |
| Slow first join | Wait for the disc to load and RetroArch to apply the host's current state. In shared-disc mode, guests first download all tracks. |
| Guest joins the room but has no rider | Register that controller in the game's multiplayer menu before starting a new race. Rejoining a live race uses an existing racer. |
| Browser-hosted room waiting for a player | Bring the affected game window back to the foreground. If the connection closed, guests can select **Rejoin room** to return to the invitation. |
| Catching up to the live race | Wait for the browser to catch up. The dedicated server keeps advancing. If the connection closes, use **Rejoin room** to reclaim your controller. |
| Keyboard does not respond | Click the game to focus it. Check the key hints below the game. Classic uses arrows to steer, S to confirm or accelerate, Enter to pause and W to go back. |
| Gamepad is missing | Connect it before starting, press a button and check **Controls** for the device name. The browser must expose a standard gamepad mapping. |
| Guests download the disc on every launch | This is expected for temporary Quick Tunnel addresses in shared-disc mode. See [browser storage](multiplayer.md#disc-downloads-and-browser-storage). |
| State mismatch | Stop the session and start a fresh room with matching files, BIOS and build. |

Private helper logs are in `.cache/online/`. Do not publish access links, room
tokens or game files when reporting a problem. See [verification](verification.md)
for tested behavior and remaining limits.
