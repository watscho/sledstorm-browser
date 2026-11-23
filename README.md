# Sled Storm Browser

Play the original **Sled Storm (1999), PlayStation PAL SLES-02194**, with up
to four players in desktop browsers. A dedicated room keeps the game running
on the host computer. Players can use a personal camera and the original HUD
while sharing the game's menus, races and pause state.

<p align="center">
  <img src="docs/images/sled-storm-pal-cover.jpg" alt="Sled Storm PlayStation PAL cover art" width="320">
</p>

## Choose how to run it

| What you want to do | What to use |
| --- | --- |
| Join a friend's room | Open the full invitation in a compatible desktop browser. |
| Play solo offline or host through a macOS window | Open **Sled Storm Server.app** on an Apple Silicon Mac with macOS 15 or later. |
| Host and manage a room from the terminal on Apple Silicon | Run **SledStormServer**, the standalone Node.js SEA build. |
| Work on the emulator or run the project directly from a checkout | Use the **Python launcher** with the source-built emulator. |

### Join an existing room

Open the full private HTTPS invitation in a compatible desktop browser.
Choose how to load the game data and press **Join Room** or **Join game**.
Players only need the invitation and access to matching game data. The host
runs the server. [Joining and racing](docs/multiplayer.md) ·
[Supported devices and browsers](docs/platforms.md)

### macOS app

Use the app for day-to-day play and hosting on Apple Silicon. The preview
bundles the server, emulator, Chromium and `cloudflared`. Its native window
handles setup and room controls. The game opens in your browser. Use a
supplied preview ZIP or build one locally. [Build the macOS preview](docs/sled-storm-server.md#build-it)

1. Extract the preview ZIP and open **Sled Storm Server.app**.
2. In **Settings**, choose your PAL game folder.
3. Choose **Single Player** for offline play, or **Multiplayer** to open a
   dedicated room. For internet play, send guests the full link from
   **Copy Invite** once the public address is ready.

Use **Stop Server** to close the room and keep the app open. Closing the
window, pressing **⌘Q**, or clicking **Quit server** shuts down the server.
If players are in the room, confirm before disconnecting them.
[App setup and build](docs/sled-storm-server.md#first-run)

### Standalone SEA server

SEA means **Single Executable Application**. `SledStormServer` bundles the
project's server and the Node.js runtime into one executable.
Keep the generated `resources/` directory beside it. The macOS app uses
the same server. Run SEA directly when you want command-line control or
the browser admin panel for dedicated hosting.

After [preparing the emulator](docs/setup.md#one-time-setup), build SEA
from the repository root and open its panel.

```sh
npm ci --prefix server
npm run build:sea --prefix server
./dist/sea/SledStormServer panel
```

Choose the game folder and disc policy in the panel, then press
**Start Server**. `panel` starts the server in the background. For
terminal-only hosting, run `serve` in one terminal and use `configure`,
`start`, `status` and `invitation` from a second terminal. Use `quit` to
shut down the server.
[Full SEA commands](docs/sled-storm-server.md#run-sea-from-the-terminal)

### Python launcher from source

Use this workflow for development, to rebuild the emulator, or to try
hosting outside the Apple Silicon package. Prepare the emulator and
install the tools in the [source setup guide](docs/setup.md). Dedicated
hosting uses Chrome or Chromium. Internet invitations also use
`cloudflared`.

| Hosting mode | On the host computer | With an internet invitation |
| --- | --- | --- |
| Dedicated room | `python3 server.py` | `python3 tools/play-online.py` |
| Room run by the creator's browser | `python3 server.py --browser-hosted` | `python3 tools/play-online.py --browser-hosted` |
| Room run by the creator's browser, with each player providing game files | `python3 server.py --disc-mode local` | `python3 tools/play-online.py --disc-mode local` |

Open [the local launcher](http://127.0.0.1:8000/), choose **Start game**
and use **Copy invite link** for internet play. A dedicated room keeps
running when the creator's tab closes. For a browser-hosted room, keep
that tab open. Press **Ctrl+C** in the terminal to stop the Python launcher.
[Python commands and disc options](docs/setup.md#start-and-stop)

## Game files

Use a lawfully obtained PAL SLES-02194 CUE and all eleven BIN tracks. A
guest can select matching files or a ZIP, or download game data if the
host allows it. Enable downloads only for files you may distribute.

The packaged server can resume a download at the same Quick Tunnel
address. When a new tunnel gives you a different address, choose your
saved ZIP again in **Game files**. [Disc setup](docs/setup.md#add-the-game-files)
· [Downloads and browser storage](docs/multiplayer.md#disc-downloads-and-browser-storage)

## What you can do

- Play the original multiplayer modes in a room with independent browser
  controls. The operator of the packaged server can host without taking a
  controller slot.
- Choose personal graphics presets, keyboard or gamepad mappings, and audio
  settings. Open **Performance** to check speed and synchronization.
- Save a synchronized solo session to a named slot, keep an autosave, or move a
  checkpoint with a compatible `.sledsave` file.

[Graphics, controls and saves](docs/browser-lobby.md) ·
[Emulator and networking architecture](docs/browser-emulator.md)

## Release status

**Version 1.3.1.** The macOS app and SEA are internal Apple Silicon
previews. The Python launcher is the established source workflow.
Developer ID signing, notarization, clean-Mac installation and the full
cross-device race matrix are still open.

[Documentation](docs/README.md) ·
[Release checklist and verification](docs/verification.md) ·
[Changelog](CHANGELOG.md)

## Credits

The [MIT license](LICENSE) covers original project contributions. The
[third-party notices](THIRD_PARTY_NOTICES.md) cover emulator components,
rendering work and artwork. The PAL cover scan is from
[PSX Data Center](https://psxdatacenter.com/images/hires/P/S/SLES-02194/SLES-02194-F-ALL.html).
