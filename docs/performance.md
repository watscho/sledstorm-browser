# Performance

## Settings and two-player tests

Fresh settings default to **WebGL2, 1× resolution**. A 2× render target has four
times as many pixels; that is not a claim of four times the frame cost. Existing
saved settings and room invitations retain their chosen resolution. Select 1×
or Reset settings before creating a new room if an older browser still uses 2×.
Software rendering retains the original split layout and is a compatibility
option, not a guaranteed speed improvement.

Each player still runs a complete game simulation. Two game tabs on one computer
compete for CPU, GPU and memory. A room waits for its slowest active controller.
Hidden-page timer/render throttling can therefore slow the whole room; Chrome
documents this behavior in its [background timer throttling guide](https://developer.chrome.com/blog/timer-throttling-in-chrome-88).
Mute one of the two local clients when evaluating sound: otherwise two copies
of the soundtrack play through the same speakers and can overlap out of phase.
Two separate visible windows can also help isolate visibility effects, but one visible game
on each physical computer is the intended multiplayer test.

Shared-disc mode fetches game bytes for each client. Startup may read the
approximately 283 MiB data track; a bigger block cache does not eliminate a
whole-disc scan or share runtime memory between tabs. Local-file mode avoids
HTTP disc transfers. Cloudflare adds a network path even for computers on the
same Wi-Fi.

## Live counters

A line under the game shows one-second samples:

- **Simulation Hz**: consumed input/simulation rows per wall-clock second. It is
  not rendered FPS. Catch-up can run faster than normal gameplay; background
  throttling or a stalled peer can make it much slower.
- **Network wait**: sampled time spent awaiting input/history rows. This includes
  waiting for another player's simulation; it is not ping or CPU utilization.
- **Disc requests / MiB**: cumulative remote requests and bytes received.
- **Cache**: cumulative logical disc-read hit rate, not a byte hit rate.
- **Audio fill/target** and **dry samples/s**: host output queue health.
  A near-empty queue and positive dry-sample rate indicate insufficient audio supply.
  The rate uses the upstream bridge's dry sample counter, not a count of clicks.
  Callback scheduling can still cause audible glitches without that counter
  increasing; audio listening has to be checked separately.
- **Background tab**: the page is currently hidden according to Page Visibility.

Compare the same game scene and shared settings. Record whether the second
player is still catching up or reading the disc before attributing a slowdown
to graphics. These counters do not replace a browser CPU/GPU profiler.

## Changes in the unreleased performance branch

Standard WebAssembly SIMD is an **experimental, default-off** CMake option:
`-DSLED_WEB_SIMD=ON`. It uses `-msimd128`, without relaxed SIMD or fast-math, and
requires Wasm SIMD support. The tested variant did not establish a menu speedup,
so it is not the default fix for stutter. Explicitly set
`-DSLED_WEB_SIMD=OFF` when returning an existing SIMD-configured cache to scalar.

Catch-up now discards host audio output instead of playing compressed history;
guest SPU samples and clocks still advance. Native audio fill/underrun counters
are exposed read-only. For deeper local diagnosis, open the launcher with
`?perf=1` before starting; native per-stage/audio diagnostic summaries appear
under Technical details. The option is personal and stripped from invitations.

Previously both WASI `fd_read` and controller exchange entered a Promise-based
Asyncify suspension even when bytes/controller rows were already available.
They now use a synchronous completion path and only unwind for real I/O.
Guest reads, iovec/seek semantics, controller ordering and digest cadence stay
unchanged. The browser CMake explicitly marks `exchange_frame` as an Asyncify
import, so actual waits can still unwind and resume correctly.

The disc adapter retains at most **16 MiB** in one LRU across all tracks.
Remote blocks are at most 4 MiB; local Blob blocks are 1 MiB. In-flight fetch
buffers are additional transient memory, not part of retained cache bytes.
Simultaneous requests for the same block share one operation. A short or failed
read is not cached. There is no whole-disc persistent browser cache.

## Recorded synthetic comparison (macOS, 2026-11-06)

Baseline: commit `4b8013a`. Both variants used the same native fixture and a
3,000,000-byte synthetic disc, checked byte-for-byte by C assertions. The fixture
alternates distant sectors, reads a hot sector repeatedly, then checks boundary
and EOF behavior. The fake HTTP source has a 5 ms delay; this is not a real
internet throughput benchmark.

| Workload | Before | After |
| --- | --- | --- |
| Remote fixture: requests | 36 | 1 |
| Remote fixture: bytes transferred | 37,603,008 | 3,000,000 |
| Remote fixture: Wasm suspensions | 539 | 1 |
| Local Blob fixture: Wasm suspensions | 539 | 3 |
| Controller bridge: 200 rows, 2 delayed arrivals | 200 suspensions | 2 suspensions |

The controller fixture checks all four pads, frame order and digest phase through
the actual C/JS/Wasm bridge. The relay/client suite separately checks four live
controllers and late replay. The cache suite checks track isolation, coalescing,
eviction bounds and short-read retry.

These results establish reduced overhead in specific paths. They do **not**
establish a gameplay FPS multiplier, two-computer race performance or freedom
from browser background throttling. Full emulation/recompilation, software
VRAM authority, WebGL presentation and Asyncify instrumentation still cost CPU
and memory.

After installing the pinned SDK, run `sh tools/check-port.sh` to compile and run
the current fixtures. Optional `--baseline` modes in `tools/test-disc-fs.mjs`
and `tools/test-network-bridge.mjs` expect separately built old variants under
ignored `.cache/perf-baseline/`; those snapshots are not required for normal
checks and are not distributed as game artifacts.

## Menu/audio investigation

After the I/O/bridge changes, one scalar Chrome client ran at approximately
50 simulation steps/s. Two scalar tabs reached the animated main menu with
samples around 20.7–31.1 steps/s. A standard-SIMD trial also fell below realtime
in that scene (about 17–20 steps/s in the sampled interval), so no SIMD speedup
is claimed. These are diagnostic samples, not a controlled gameplay benchmark.

The audio probe on the slow two-client menu showed nearly empty output queues
against a 180 ms target and rapidly increasing dry-sample counters. Native
cadence summaries showed SPU supply around 15–17 kHz instead of 44.1 kHz while
simulation ran around 17–19 Hz. CPU snapshots showed two busy renderer processes,
so renderer sharing was not established as the cause in this test.

Thus two-tab animated-menu stutter is **not fully resolved** by this patch.
A larger audio buffer or an audio-only speed change cannot sustain missing
samples indefinitely. Further work needs profiling of the canonical runtime/
software raster path or moving heavy execution/audio scheduling away from the
UI thread. Two separate computers, one active game each, remain an important
separate qualification target. The recorded audio result is based on counters;
audible quality was not independently listened to during automation.
