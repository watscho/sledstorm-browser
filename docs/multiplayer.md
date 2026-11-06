# Playing with friends

## How a session works

Each browser runs the same recompiled game locally. The relay exchanges
controller inputs and state checks, not streamed video. Players behave like
controllers connected to one console; original multiplayer menus and rules
still apply. Every participant uses the host's served build and supplies matching
disc data. Friends do not need Python, Node or a compiler.

Pressing **Start game** from the root launcher creates a random room and starts
immediately, even alone. **Invite friends → Copy link** copies the full URL,
including the encoded `#session=...` fragment. Opening that link and pressing
**Join game** assigns a free controller in that room. Opening the bare launcher
and starting again creates a different room. At most four controllers join a
room; up to eight rooms can coexist in one relay.

The invitation carries a random capability and shared settings. Base64url is
encoding, not encryption. Keep complete access/invitation links private; anyone
with them can join a free seat. Rooms disappear when the final client disconnects
or the relay restarts. A copied link cannot recover a deleted room.

## Local test on one computer

1. Follow [setup.md](setup.md), start `python3 research/serve_port.py`, and open
   [the launcher](http://127.0.0.1:8001/).
2. Choose settings and press **Start game**.
3. Copy the invitation to a second browser window and press **Join game**.
4. Use the original multiplayer menu flow below. Focus each window to operate
   that player's keyboard. Background throttling can slow the shared simulation.

This tests the room flow on one machine. A loopback URL cannot be used by a
friend on another computer.

## Quick start with Cloudflare

After [setup and build](setup.md), install `cloudflared` from the
[official downloads](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/).
From the repository root run:

```sh
python3 tools/play-online.py
```

The helper starts the loopback runtime/relay, private gateway, and a Cloudflare
Quick Tunnel to **8003**. It waits for the connector to register, then prints the
complete `https://<temporary-host>.trycloudflare.com/access/<token>` launcher
URL. If `cloudflared` is not on PATH, set `CLOUDFLARED_BIN` to its executable;
the helper also recognizes an existing `.cache/cloudflared/cloudflared`.

Open the printed URL yourself first, select **Game files → CUE + all BIN files**,
then **Start game → Invite friends → Copy link**. Send that final invitation
to your friend; it contains both the gateway access path and the room fragment.
Each friend selects their own matching disc files and presses **Join game**.
Then use the native multiplayer race flow below. Sending only the launcher's
access URL does not join an existing room.

Keep the terminal open and the host awake. **Ctrl+C** stops all helper-owned
process groups, including the relay, and invalidates the temporary link.
The helper refuses to start over occupied ports 8001–8003. It records private
logs and the active launcher link in ignored `.cache/online/` with restricted
file permissions; these are never committed. Do not paste access links into
public issues or changelogs.

The endpoint serves compiled runtime assets, OpenBIOS and metadata through the
gateway. Disc bytes remain outside its allowlist. The following manual workflow
is equivalent, and the same license and qualification limits apply.

## Manual internet hosting

HTTPS/WSS forwarding and one browser host boot have been verified through
Cloudflare; separate-device internet gameplay has not yet been qualified.
The local servers bind to loopback. For remote access put HTTPS
and WebSocket forwarding in front of the **private gateway on port 8003**.
Do not forward the development disc server on 8001 or the raw relay on 8002.

Start the runtime in terminal 1, from the repository root:

```sh
python3 research/serve_port.py
```

Start the gateway in terminal 2:

```sh
node research/network/public-server.mjs
```

It prints a private URL ending in `/access/<random-token>` and records that path
in ignored `.cache/gateway-access.txt`. Every restart creates a new access token.
The gateway serves only its runtime allowlist and same-origin `/relay` WebSocket
route. It blocks `/disc/*` and requires each client to select local game files.

Expose **only 8003** through your chosen HTTPS reverse proxy with WebSocket
upgrade support. A temporary development option is Cloudflare Quick Tunnel:
install `cloudflared` following the [official download instructions](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/),
then run in terminal 3:

```sh
cloudflared tunnel --url http://127.0.0.1:8003
```

This creates an internet endpoint when you run it. Cloudflare documents temporary
URLs and their lifetime in its [Quick Tunnel guide](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/).
A stable deployment needs a persistent HTTPS hostname and an always-running host.
A custom proxy must preserve `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`, forward `/relay` as WebSocket, and
serve JS/Wasm/BIOS/metadata from the same origin. With TLS termination, forward
`X-Forwarded-Proto: https` so the access cookie receives its Secure attribute.

The host now:

1. Takes the HTTPS hostname printed by the proxy and appends the gateway's exact
   `/access/<random-token>` path. Open this combined URL in the browser.
2. Opens **Game files** and selects the local CUE plus all 11 BIN tracks.
3. Chooses settings, presses **Start game**, and copies **Invite friends**.
4. Sends that complete generated invitation to the friend. It contains the
   access path and `#session=...`; the bare HTTPS URL is insufficient.

Each friend:

1. Opens the complete invitation in a desktop browser.
2. Selects their own matching CUE and all BIN tracks in **Game files**.
3. Checks personal controls/audio and presses **Join game**. Shared settings
   come from the invitation and are read-only.
4. Waits for catch-up, then joins through the original game menus.

The host also selects local files when using the gateway. Its manifest compares
filenames, sizes and content identity against the host's disc. Browser file
selection is local; disc bytes are not uploaded by this gateway. Clients do
receive the compiled game-derived JS/Wasm, OpenBIOS, disc metadata, controller
history and checksums. This is not a disc redistribution service, and the
[license boundaries](../THIRD_PARTY_NOTICES.md) still apply to runtime hosting.

## Start a native multiplayer race

1. Invite everyone before starting a race; late arrivals replay input history
   from boot and temporarily pause existing clients while catching up.
2. In the original game, choose multiplayer quick race.
3. Each player presses their confirm button (default **X**) to join, then
   selects/confirms their character and sled as allowed by the native menu.
4. The first controller advances the shared menu and selects/confirms the track.
5. Race. **Enter** is Start on the default keyboard; native pause/options affect
   the shared console. Closing the menu restores each two-player personal view.

Two-player WebGL2 has independent full views with single-player HUDs. Software
and three/four-player races use the original split layout. Four connected
browsers do not mean four independent full-screen cameras.

## Lifetime and connection limits

Keep the runtime, gateway, proxy and active game browsers running. Sleeping the
host, closing its terminals or throttling peers can interrupt play. No automatic
resume across server restarts exists. Controller disconnects become neutral
input; native game rules determine whether a replacement can participate in a
race already underway. State mismatches stop a room instead of letting games
diverge. There is no rollback; geographic latency and slow clients remain
unqualified. Invite early and begin with a short race.

Stop the proxy, gateway and runtime with **Ctrl+C** in their respective terminals.
The access cookie lasts eight hours; reload through the private access link if
it expires. A restarted proxy may have a different hostname, so regenerate links
from the new origin and start a new session.
