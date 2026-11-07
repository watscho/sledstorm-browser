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
4. Click **Copy invite link** under **Invite friends** and send the complete
   invitation to each friend.

The invitation automatically uses the private HTTPS tunnel address. The host
reads its disc locally. Keep the terminal open, the computer awake and the game
tab active. No router port forwarding is needed.

## Friend: join

1. Open the complete invitation in a desktop browser.
2. Adjust personal volume and image filtering if desired.
3. Click **Join game** and wait for disc loading and synchronization.
4. Click the game to focus keyboard input.

The default mode uses the host's disc. Friends do not install tools or select
files. Each browser downloads the full disc, including music; the host's upload
speed affects initial loading. If the host chose `--disc-mode local`, every
player selects their own matching CUE and all eleven BIN tracks before joining.
BIOS is optional; everyone must use the same BIOS or all leave it empty for HLE.

## Start a race

1. Invite everyone before entering a race.
2. In the original game, player 1 chooses **Start → Multiplayer quick race**.
3. Each participant presses **X** to join, selects a rider, and confirms.
4. Player 1 advances to course selection and starts the race.
5. Use arrows to steer, **X** to accelerate, **Enter** to pause, and **A** for
   triangle/back in menus.

The room acts like one console with up to **four controllers**. Each browser
has its own camera and original single-player HUD when **Separate cameras** is
enabled. Native pause/options menus are shared and keep their 4:3 proportions.
The original game determines race rules and whether another rider can join a
race already in progress.

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

Both modes work through Cloudflare, including two computers on the same Wi-Fi.
The helper needs internet access. `127.0.0.1` always means the computer opening
that address; send the generated HTTPS invitation to another computer.

## Rooms and synchronization

Starting from the root launcher creates a new private room. Its full invitation
joins that room as a free controller. A room supports four players; the relay
supports up to eight rooms. The invitation includes access capabilities and
shared progression/camera settings. Keep it private: anyone holding the full
link can occupy a free seat. The URL fragment contains Base64-encoded JSON;
it does not encrypt the room credentials or settings.

Each browser runs its own emulator. Controller inputs are synchronized and state
checks detect divergence. Guests replay input history from boot to catch up;
the room pauses at a fixed boundary during synchronization. Long-running rooms
take longer to join. The slowest active peer can hold everyone up.

Closing the final client deletes the room. Restarting the relay clears rooms.
History is limited to 900,000 steps per room (five simulated hours at PAL 50 Hz);
reaching that limit ends the session. Rooms also expire after 30 seconds without
client messages.
There is no persistent room recovery, rollback or host migration. State
mismatches stop the room; restart with matching build, files and BIOS.

## Hosting details

The helper owns the local runtime on **8000**, relay on **8004**, private gateway
on **8005**, and the Cloudflare Quick Tunnel. It refuses occupied ports. Its
private logs and temporary access metadata live under ignored `.cache/online/`.
Use `CLOUDFLARED_BIN` if the executable is not on PATH; the helper also recognizes
`.cache/cloudflared/cloudflared`.

The HTTPS gateway requires private access, serves an asset allowlist and proxies
same-origin `/relay` WebSockets. In shared mode it allows the complete disc
archive; in local mode disc downloads are blocked. A custom deployment must
provide HTTPS/WSS, retain COOP/COEP headers and route only through the private
gateway. Direct LAN hosting and persistent public deployment are not provided
by this helper. Component licenses and game rights are described in
[third-party notices](../THIRD_PARTY_NOTICES.md).

See [verification](verification.md) for the scope of internet testing.
