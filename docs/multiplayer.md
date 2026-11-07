# Playing with friends

## Host: start and invite

Complete the [one-time setup](setup.md), add your PAL CUE/BIN files to `game/`,
and install `cloudflared`. From the project folder:

```sh
python3 tools/play-online.py
```

1. Wait for **Host launcher** in the terminal.
2. Open [http://127.0.0.1:8000/](http://127.0.0.1:8000/) on the host computer.
3. Choose settings and click **Start game**.
4. Click **Copy link** in the session toolbar and send the complete
   invitation to each friend.

The invitation automatically uses the private HTTPS tunnel address. The host
reads its disc locally. Keep the terminal open, the computer awake and the game
tab active. No router port forwarding is needed.

## Friend: join

1. Open the complete invitation in a desktop browser.
2. Adjust volume, image filtering or [personal controls](browser-lobby.md#personal-controls) if desired.
3. Click **Join game** and wait for disc loading and synchronization.
4. Click the game to focus keyboard input.

The default mode uses the host's disc. Friends can join without installing tools
or selecting files. If the host chose `--disc-mode local`, every player selects
their own matching CUE and all eleven BIN tracks before joining. Everyone must
use the same BIOS file or leave it empty for HLE.

## Disc downloads and browser storage

The full disc includes all music tracks. On localhost or a permanent HTTPS
hostname, the browser saves one copy for that address and reuses it in new rooms
as long as the disc fingerprint matches and the saved copy is still available.
When storage is unavailable, the download remains usable for the current launch.

The hosting helper creates a temporary Quick Tunnel. Each shared-disc guest
launch through a `trycloudflare.com` address downloads the disc for that session
only. A custom deployment with the same HTTPS origin can reuse browser storage
across restarts. See [Hosting details](#hosting-details) for gateway requirements
and [Cloudflare Tunnel setup](https://developers.cloudflare.com/tunnel/get-started/)
for permanent hostnames.

Copies saved by earlier builds on temporary addresses can still occupy disk
space. In Chrome, open `chrome://settings/content/all`, search for
`trycloudflare.com`, and remove site data for old game addresses. This removes
their saved disc copies and other site data, such as access cookies.

## Start a race

1. Invite everyone before entering a race.
2. In the original game, player 1 chooses **Start → Multiplayer quick race**.
3. Each participant presses **S** to join with the default keyboard layout,
   then selects and confirms a rider.
4. Player 1 advances to course selection and starts the race.
5. Use arrows to steer, **S** to accelerate, **Enter** to pause, and **W** for
   triangle/back in menus.

The room acts like one console with up to **four controllers**. Each browser
has its own camera and original single-player HUD when **Separate cameras** is
enabled. Native pause/options menus are shared and keep their 4:3 proportions.
To return to a race, reopen the same invitation while the host is still
playing. RetroArch restores the current state after the disc loads. An open
controller slot can resume its existing racer.

## Stop hosting

> [!TIP]
> Press **Ctrl+C** in the hosting terminal and wait for **Online stack stopped.**
> This stops the helper's runtime, relay, gateway and tunnel. Then close the game
> tabs. Closing a tab alone does not stop the servers.

To play again, run the same command, start a fresh game, and send a new invite.
A stopped tunnel's temporary link cannot be reused.

## Choose a disc mode

| Mode | Start command | What players provide |
| --- | --- | --- |
| Host disc (default) | `python3 tools/play-online.py` | Host supplies one CUE/BIN set; guests download it automatically. |
| Local files | `python3 tools/play-online.py --disc-mode local` | Each player selects matching CUE/BIN files in their browser; host disc downloads are blocked. |

Both modes use the same HTTPS invitation flow, including when players share a Wi-Fi network.
The helper needs internet access. `127.0.0.1` always means the computer opening
that address; send the generated HTTPS invitation to another computer.

## Rooms and synchronization

Starting from the root launcher creates a private RetroArch Netplay room. The
full invitation grants access to a free controller slot and carries progression
and camera settings. Keep the link private. The URL fragment uses Base64 to
encode the invitation data.

Each browser runs its own emulator. Once its disc is ready, RetroArch loads
the host's current state and synchronizes controller input. A guest who returns
to a free controller slot can continue the corresponding racer. Sled Storm
only creates racers in its own multiplayer setup, so choose every rider there
before starting. A disconnected slot can be taken by another guest with the
invitation. The host and all guests need matching disc data, BIOS, and emulator
build. A browser tab prefers its previous controller slot if the slot is
still free. Closing the host ends the room.

## Hosting details

The helper owns the local runtime on **8000**, private gateway on **8005**,
RetroArch relay on **8006**, legacy relay on **8004**, and the Cloudflare Quick
Tunnel. It refuses occupied ports. Its
private logs and temporary access metadata live under ignored `.cache/online/`.
Use `CLOUDFLARED_BIN` if the executable is not on PATH; the helper also recognizes
`.cache/cloudflared/cloudflared`.

The HTTPS gateway requires private access, serves an asset allowlist and proxies
same-origin `/netplay` WebSockets. In shared mode it allows the complete disc
archive; in local mode disc downloads are blocked. A custom deployment must
provide HTTPS/WSS, retain COOP/COEP headers and route only through the private
gateway. Direct LAN hosting and persistent public deployment are not provided
by this helper. Component licenses and game rights are described in
[third-party notices](../THIRD_PARTY_NOTICES.md).

See [verification](verification.md) for the scope of internet testing.
