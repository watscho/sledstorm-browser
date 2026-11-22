# Sled Storm Server

The internal macOS preview is a self-contained host for Apple Silicon
with a declared minimum of **macOS 15**. It bundles Node.js, Chromium and
`cloudflared`. Setup and room controls run in the browser; the app runs the
dedicated room and leaves all four controller seats for browser players.

Use a locally built or supplied internal `*-preview.zip`. The
[release checklist](verification.md#release-checklist) tracks Developer ID,
notarization and installation on a clean Mac. For Intel or Linux, see
[device options](platforms.md).

## First run

1. Extract the ZIP and open **Sled Storm Server.app**. The app opens its
   admin page in your default browser. Open the app again to return to
   the same running server.
2. Under **Needs setup**, choose the folder holding the
   [PAL CUE and eleven BIN tracks](setup.md#add-the-game-files). The system
   dialog can open behind the browser.
3. Choose a [disc policy](#disc-policy). Click **Start server** if the room
   has not already started.
4. When the public address is ready, use **Copy invite link**. Use **Open
   game** to join from the host computer.

Closing the admin tab leaves the server running. The admin page stays on
loopback. Send players the private game invitation and keep it within the
group. Opening the app can auto-start a configured room when the launch
switch is enabled.

## Disc policy

| Policy | What guests can use |
| --- | --- |
| **Players use only their own game files** | Matching CUE/BIN or a saved ZIP. The public gateway blocks downloads of the host's disc. |
| **Players may download the game files from this server** | Matching files, a saved ZIP or a host download. Enable it for files you may distribute. |

Either policy keeps the dedicated room available. The emulator on the
host still uses the host's disc. The shared download checks 8 MiB chunks
and can resume at the same address if the browser stores progress.
On a new Quick Tunnel address, select the saved ZIP again. Change the
disc folder, policy or room options while the room is stopped.

## Manage the room

| Control | Effect |
| --- | --- |
| **Start server** | Prepare the disc, open a room and start the public tunnel. If the tunnel is unavailable, play on the host still works and Start server can retry the address. |
| **New game** | Replace the game inside the current room. Players rejoin using the same invitation. |
| **Stop room** | Close the game and tunnel. The admin service stays available. Starting again creates new links. |
| **Quit server** | Stop the room, tunnel and admin service. A pending folder chooser closes too. |

When a player is connected or has a reserved controller, the panel asks
for confirmation before interrupting the room. Room options include
progression and separate cameras. With the verified PAL disc, racers
can use their own camera and original HUD.

## Diagnostics and updates

Open **Details** for room and tunnel status, or select **Save diagnostics**
to export the app's JSON report. Review the report before sharing.
For launch problems, run the bundle executable from a terminal. Adjust
the example path if the app lives somewhere else.

```sh
"/Applications/Sled Storm Server.app/Contents/MacOS/SledStormServer" status
"/Applications/Sled Storm Server.app/Contents/MacOS/SledStormServer" diagnostics
```

Other commands include `configure --game-folder <folder> --disc-policy
<shared-allowed|local-only>`, `start`, `invitation`, `new-game`, `stop`,
`quit` and `self-test`. Use the panel for room options and auto-start.
`invitation` prints private links. The CLI asks for `--force` to stop,
quit or start a new game while players occupy seats.

Stop and quit before replacing the app. The app stores its data separately.

| Location | Contents |
| --- | --- |
| `~/Library/Application Support/Sled Storm Server` | Configuration and the live instance record. |
| `~/Library/Caches/Sled Storm Server` | Prepared game-data information and emulator browser profiles. |
| `~/Library/Logs/Sled Storm Server` | Server log. |

Browser checkpoints belong to the browser and game address. Export a
`.sledsave` to back up or move a compatible checkpoint. The local game URL
`http://127.0.0.1:8000/` is also used by the Python workflow.

To remove the preview, quit the server and move its app to the Trash.
Remove the three state folders only if you want to discard settings,
cache and logs. Manage browser saves separately.

## Build it

On Apple Silicon, prepare the pinned emulator using the
[source setup](setup.md#one-time-setup), then run:

```sh
npm ci --prefix server
npm run package:macos --prefix server
npm run package:macos:zip --prefix server
```

The app and ZIP are created under `dist/macos/`. The ZIP command checks
a fresh extraction and prints its SHA-256. See the
[release workflow](verification.md#build-and-sign-a-candidate) for signing,
notarization and qualification.
