# Sled Storm Browser

Play the original **Sled Storm (1999), PlayStation PAL SLES-02194**, with up
to four players in desktop browsers. A dedicated room keeps the game running
on the host computer. Players can use a personal camera and the original HUD
while sharing the game's menus, races and pause state.

<p align="center">
  <img src="docs/images/sled-storm-pal-cover.jpg" alt="Sled Storm PlayStation PAL cover art" width="320">
</p>

## Choose how to play

| I want to | Start here |
| --- | --- |
| Join a friend's room | Open the full invitation in a compatible desktop browser and choose a game-data source. [Join and race](docs/multiplayer.md) |
| Host with the Apple Silicon app | Open the internal preview on macOS 15 or later, select your disc folder, start a room and copy the invitation. [App setup](docs/sled-storm-server.md#first-run) |
| Host from the terminal | Build the emulator and run the Python launcher. [Source setup](docs/setup.md) |
| Check my device or browser | Compare the available workflows and the tested platforms. [Device guide](docs/platforms.md) |

Use a lawfully obtained PAL CUE and all eleven BIN tracks. A guest can use
their own matching files, select a ZIP, or download game data when the host
enables sharing. Only enable host downloads for files you may distribute.

## What you can do

- Play the original multiplayer modes in a room with independent browser
  controls. The operator of the packaged server can host without taking a
  controller slot.
- Choose personal graphics presets, keyboard or gamepad mappings, and audio
  settings. Open **Performance** to check speed and synchronization.
- Save a synchronized solo session to a named slot, keep an autosave, or move a
  checkpoint with a compatible `.sledsave` file.
- Reuse a verified ZIP on a new Quick Tunnel address. The packaged server's
  shared download can continue from verified browser storage on the same origin.

[Graphics, controls and saves](docs/browser-lobby.md) ·
[Emulator and networking architecture](docs/browser-emulator.md)

## Release status

**Version 1.2.0.** The Python launcher is the established source workflow.
Sled Storm Server is an internal Apple Silicon preview. Signed installation,
clean-Mac qualification and races on separate physical devices are still on
the release checklist.

[Documentation](docs/README.md) ·
[Release checklist and verification](docs/verification.md) ·
[Changelog](CHANGELOG.md)

## Credits

The [MIT license](LICENSE) covers original project contributions. The
[third-party notices](THIRD_PARTY_NOTICES.md) cover emulator components,
rendering work and artwork. The PAL cover scan is from
[PSX Data Center](https://psxdatacenter.com/images/hires/P/S/SLES-02194/SLES-02194-F-ALL.html).
