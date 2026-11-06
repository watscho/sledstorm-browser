# Browser lobby

Open `http://127.0.0.1:8001/` after starting `python3 research/serve_port.py`.
The single launch action creates an independent shared-console session and starts
immediately, even with one player. The generated `#session=…` link connects up to
four browsers as four controllers. Opening the root page and launching again
creates a separate game. The game is still an experimental port.

## Interface and settings

- Game: all-content preset and optional fullscreen on launch.
- Display and audio: accelerated or software renderer, 1× / 2× resolution,
  nearest / bilinear texture filtering, volume and mute.
- Controls: classic, WASD or individual keyboard bindings. Conflicting keys
  swap, so one key never ambiguously presses multiple pad buttons. Gamepad
  presence and standard mapping are reported from the browser Gamepad API.
- Files: automatically use the host disc in shared mode, or select CUE + all
  11 BIN locally. Local mode requires every player to select files.

The preview is an original decorative mountain illustration, not game artwork
or a selected track. Racer and track selection still takes place in the
original game's menu; no nonfunctional browser race selectors are presented.

Preferences are validated and stored under `sledstorm.lobby.v1` in this
origin's localStorage. Disc contents, invitation tokens and game saves are
not stored there. Storage denial does not prevent play.

## Actual runtime wiring

`launch-settings.js` is the shared contract. Before main starts, `port.js`
writes `/keybinds.ini` into the temporary Wasm filesystem, and passes the same
bindings to online pad sampling. It writes quality/filter choices to the
game TOML, configures the internal-resolution environment and sets host audio
volume. The browser-only `web_preferences.c` reapplies volume after native
initialization; `sled_volume_set` adjusts host output during play. Neither
volume nor keyboard bindings modifies authoritative guest state.

The WebGL2 two-player profile uses separate 16:9 camera projections and the
single-player HUD for each local seat. The resource substitution is activated
only after the game selects two humans, and is restored for other player counts. Three/four-player gameplay retains the
original game's screen layout and HUD atlas. Software rendering uses the
original layout.

Native pause/options menus use the game's `0x800C34E0` menu latch (set by
`0x8006D004`, cleared by `0x8006D0F8`). While it is set, the two-player crop and
projection are disabled and HUD packet transforms are bypassed, so the shared
menu uses the original 4:3 presentation. Closing it restores each personal
camera. This does not change pause/input logic. The resource override runs at
`0x8005F344` before the game's load8/load9 table lookup; both resource families
are restored for other human counts. Native modes, menus, racers and tracks remain in the game.

The creator's quality, filtering, renderer/camera and unlock mode travel in the
base64url invitation and v4 execution identity. Keyboard, fullscreen and volume
remain personal. Shared controls are read-only for guests. Base64 is an encoding,
not encryption; anyone with the full invitation can occupy a free controller.
Previous invitation formats must be recreated with this build.

`serve_port.py` starts the loopback relay automatically if it is not already
running. A later arrival replays the room's recorded controller history from boot.
Existing clients pause at an exact frame until the new controller catches up.
This can take time in a long-running session; invite friends before the race.
No guest memory or disc data is stored in the relay. Four pads use Multitap slots
1A–1D; the browser bridge preserves the device's polling state between frames.
Disconnecting frees that controller; remaining players continue with neutral input
for the missing seat. The original game decides whether a racer can join mid-race.

The relay retains up to 900,000 input frames per room (five simulated hours at
50 Hz), at most eight rooms. Closing the final browser deletes that room; its link
cannot restore it. Connections send heartbeats and stale rooms expire after
30 seconds without messages. There is no rollback or persistent session save.
State mismatches stop the affected room rather than allowing divergent games.

The manifest exposes `X-Disc-Mode` and `X-Disc-Local-Required`. The gateway uses
`local` by default, denying disc routes. Explicit `shared` mode requires a private
access token and forwards only GET extents on disc indices 0–11, with validated
integer offsets and lengths capped at 4 MiB. The source verifies file bounds.
Both deny full-file disc downloads, HEAD disc requests and arbitrary paths.
The browser's bounded async disc cache is shared by the local/host-file flows.
No native runtime rebuild is needed to switch the gateway's disc policy.

## Interaction and accessibility

Visible labels, native form controls, keyboard-operated tabs with roving focus,
focus indicators, inline live errors, a skip link, reduced-motion support and
an exit confirmation are provided. The mobile layout keeps the launch action
in reach; its desktop equivalent is hidden from that layout's accessibility
tree. Diagnostics are collapsed and avoid per-tick announcements.

References used: [WAI form labels](https://www.w3.org/WAI/tutorials/forms/labels/),
[WAI forms tutorial](https://www.w3.org/WAI/tutorials/forms/).
This is not a claim of formal accessibility conformance.

The browser-generated GPU also implements the one-word GP0(1Fh) IRQ1 request,
including GPUSTAT bit 24 and the existing GP1 acknowledge/reset behavior. The
unmodified upstream decoder recognized its length but fell through to fatal.
The real GPU parser regression uses the exact command word captured during a
four-player load. That fix alone did not resolve the load: the HUD resource
substitution also had to be limited to two-human races. Four-client Pine Valley
gameplay then passed in both software and WebGL2. Reference: [PSX GPU IRQ1 specification](https://psx-spx.consoledev.net/graphicsprocessingunitgpu/#gp01fh-interrupt-request-irq1).

Run `sh tools/check-port.sh` for configuration, remapping, bounded runtime
adapter and transport checks. Current browser evidence is in
`docs/verification.md`.
