# P6 slice 1 — macOS release package

The first P6 slice prepares an installable macOS arm64 candidate and checks
its contents against RELEASE-01. The candidate then goes through Finder,
network and gameplay qualification. A later qualification run records the
actual platforms and networks used before a public release decision.

The owner's brief, `dok.md`, defines the package in §13, P6 in §14,
RELEASE-01 in §15.2, the manual matrix in §15.3 and the release criteria in
§15.4. The brief is available in the owner's “Sled Storm - Node Sea” chat.
The review base is `.superpowers/sdd/p5-slice-3-tree.tar`. Before this plan
was written, its 233 files matched the working tree byte for byte, including
the executable bits, on top of `20c2064`.

## Phase 1 — package contents and RELEASE-01

- [x] Build an internal candidate with the pinned Node SEA, bundled
  Chromium and `cloudflared`, and the prepared emulator. Keep the existing
  ad-hoc development path. The release path must fail if any of those
  components or its required notices are missing. The local build starts with
  [`package-macos.mjs`](../../../server/scripts/package-macos.mjs),
  [`stage-resources.mjs`](../../../server/scripts/stage-resources.mjs) and
  [`build-sea.mjs`](../../../server/scripts/build-sea.mjs).
- [x] Stage `Contents/Resources/licenses/` from pinned inputs. Include the
  wrapper and `ws` notices, the Node.js license with bundled notices,
  `cloudflared` license and applicable notices, Chromium's license and
  credits for the shipped build, and the emulator notices. Record the
  corresponding source and patches required for distributed emulator
  components. Review the existing noncommercial code and cover/logo
  entries for the binary distribution using
  [`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md).
- [x] Check the resource manifest's application version and source revision,
  runtime versions and input hashes, emulator source pins and resource
  hashes against the build inputs. Record the working tree state on internal
  builds and use an exact source revision for the release candidate. Keep
  input hashes identifiable as such when code signing changes shipped bytes.
  Check the architecture and minimum OS of the SEA, Chromium and its helpers,
  and `cloudflared` before documenting a supported macOS floor. Resolve the
  mismatch between the current app's declared minimum and the bundled
  `cloudflared` before running the clean-Mac matrix.
- [x] Make a local ZIP containing the `.app` for Finder installation.
  Unpack it into a fresh directory and run RELEASE-01 against the extracted
  app. Check the runtime manifest and notices, the required executable
  resources and relative symlinks, and the absence of disc, BIOS, save,
  cache, profile, config, log and credential files. Use the expected
  resource inventory to detect unexpected files. Test missing required
  files and excluded content using small synthetic fixtures.
- [x] Run the packaged executable's `self-test` from that extraction and
  `npm run verify --prefix server`. Record the candidate revision and ZIP
  digest, the RELEASE-01 result and the review diff against the P5 snapshot.

## Phase 2 — signing and installation

- [ ] Prepare the Developer ID workflow and document the signing identity
  and notary authentication it needs in CI. Build the existing emulator and
  native adapter from the pinned sources in release CI. Inventory signed code in the
  bundle, including Chromium's helpers and framework and `cloudflared`.
  Sign from the innermost code to the app with the appropriate hardened
  runtime options and secure timestamps. Verify the SEA and shipped
  Chromium actually run with the entitlements selected for their JITs.
  Check D28's Chromium bundle identifier collision with a separately
  installed Chromium and record the result. [Apple's notarization requirements](https://developer.apple.com/documentation/security/notarizing-macos-software-before-distribution)
- [ ] With a Developer ID Application identity and notary access, submit
  the signed candidate with `notarytool`, record the submission outcome,
  review the notary log and staple and validate the ticket on the app.
  Build the final ZIP from the stapled app and rerun RELEASE-01 on that
  ZIP. Keep the build internal when credentials or notarization evidence
  are missing. [Apple's custom notarization workflow](https://developer.apple.com/documentation/security/customizing-the-notarization-workflow)
- [ ] Exercise Finder installation from a quarantined copy on clean Apple
  Silicon macOS with no developer toolchain, Node.js, Python runtime or
  separately installed server Chrome. For a signed candidate, exercise
  normal Gatekeeper approval and ticket validation, including first
  opening with the network disconnected. Record the exact OS and quarantine
  state. The earlier App Translocation check on the development Mac has
  its own evidence under P3. [Apple's distribution testing guidance](https://developer.apple.com/documentation/xcode/packaging-mac-software-for-distribution)
- [ ] Open the admin page from Finder, choose the game folder and start a
  real server-owned room. Close the tabs, reopen from Finder and confirm
  the same server is running. Exercise Stop and Quit and check that their
  owned processes and ports are released. Check sleep/wake, start without
  internet, tunnel availability after it returns, and logout after a
  Finder launch. Replace the app with the room stopped and verify the
  config, cache and compatible saves survive.
- [ ] Exercise the native folder picker on the clean Mac, including a
  folder in Documents, and record the consent prompt or prior authorization
  with the related TCC result. Reconcile this with the earlier P4 requests
  whose on-screen behavior was unobserved. Give cancellation and rejection
  their own results.

## Phase 3 — platform, network and gameplay qualification

Use the same candidate for the rows below. Give each row its own result
and record the build, date, device count, OS/browser versions, network
topology and actions performed. Use the owner's legitimately obtained local
game files on each device for SEA races with `local-only`. Use synthetic game
files for public delivery checks under `shared-allowed`.

| Check | Evidence to record | State |
| --- | --- | --- |
| Two physical player devices | Complete a race with both players controlling their racers independently. | Open |
| Three physical player devices | Complete a race and verify the third driver's control, camera and HUD. | Open |
| Four physical player devices | Complete a race with four independent controllers. Include a topology where guests and the host use different internet connections. Verify a run where the server operator uses zero controllers. | Open |
| Gameplay and saves | Record personal camera/HUD, race start and finish, shared pause, in-race rejoin and restored controller, transfer of room owner, graphics presets and load of an older compatible `.sledsave`. Record the device and topology for each observation. | Open |
| Real Quick Tunnel, DATA-05 and DATA-06 | Interrupt delivery on the same origin over an external network. Count reused and requested chunks after reopening and after corrupting one saved synthetic chunk. Check the concurrency limit, retry wait budget and room responsiveness on a slower link. | Passed through a real tunnel on one Mac with synthetic data. Guest on a separate connection and gameplay under transfer load remain open. |
| Browser storage and origin changes, DATA-07 and DATA-08 | Record Safari and Firefox versions and what each does with own files, a saved ZIP and the supported download fallback. Exercise private windows, a genuinely full scratch disk and interruption during shutdown. Check preservation of earlier data on native picker cancellation where supported. On a new Quick Tunnel origin, check the initial download state and reuse of a previously saved ZIP. | DATA-08 passed across two live origins in Chromium. Safari private mode passed on loopback. Firefox, native browser writes to a full volume and shutdown interruption remain open. |

For each race, capture core steps/s, browser frame pacing, catch-up and
disconnect events, host and guest CPU and RAM, data preparation time and
audio behavior. Compare with the Python launch path on matching hardware,
race scene and settings. Record steps/s, painted FPS and input latency as
distinct measurements, with values only for metrics that were measured.
Same-machine Chromium contexts are a separate integration result.

## Closeout

- [ ] Update [`sled-storm-server.md`](../../sled-storm-server.md) with Finder
  install, first run, diagnostics and replacement instructions for the
  candidate. Update [`verification.md`](../../verification.md) with results
  and remaining limitations and `THIRD_PARTY_NOTICES.md` with the binary
  contents, notices and corresponding source. Keep the source release
  instructions accurate for a checkout that builds its own runtime.
- [ ] Record the final archive digest, RELEASE-01 result and the completed
  manual rows. The public release decision requires the applicable signing,
  licensing and clean-machine checks and the actual gameplay matrix. Use
  the internal preview designation while those results remain open. The
  owner controls commits, pushes and publication.

## Status

- 2026-11-22. Plan drafted from the original brief and the verified P5
  snapshot. `notarytool` and `stapler` are installed on the development Mac.
  Its signing identity list contains zero valid Developer ID Application
  identities.
- The current development app passed `codesign --verify --deep --strict`
  with its ad-hoc signature. The manifest lists the SEA and all three
  bundled runtime components. `Contents/Resources/licenses/` is absent.
  This inventory precedes RELEASE-01, which runs on the extracted ZIP.
- The app and SEA declare macOS 13.5. `vtool` reports 13.0 for Chromium,
  its framework and helpers, and 15.0 for the bundled `cloudflared`.
  These are declared versions from the build, with clean-machine testing
  still open. Phase 1 starts by staging the notices and resolving the
  package's minimum OS declaration.
- `npm run verify --prefix server` passed all 11 baseline checks in 153 s,
  including the development build and all 30 packaged smoke tests.
- The Phase 1 arm64 ZIP is `dist/macos/Sled-Storm-Server-1.1.0-macos-arm64-preview.zip`.
  It is 236,067,163 bytes. Its SHA-256 is
  `8f8c0580af18bdbcdbb9d917590fdd1b0ac689b85fde20eed9bcb0e00400179c`.
  Its manifest records `20c206457f8f165d4819547211e3a8a8d707c23c` with
  `modified: true`. The app and manifest declare macOS 15.0 based on the
  highest deployment target of the shipped arm64 Mach-O files.
- RELEASE-01 passed on the fresh ZIP extraction. The check verified the
  runtime manifest, 15 license and notice files, 5 in-bundle relative
  symlinks, exact asset inventories, pinned runtime and emulator digests,
  and the ad-hoc signature. Missing notices and excluded content also failed
  the synthetic inventory tests. The Chromium credits came from the
  matching upstream license inputs documented in `THIRD_PARTY_NOTICES.md`.
- Compared with the P5 snapshot, Phase 1 adds the ZIP builder, inventory
  checks, license pins, deployment-target calculation and their documentation
  and tests. Four emulator build scripts under `tools/` were already absent
  when work resumed. This ZIP used the prepared emulator from the existing
  cache and the package check verified the embedded source and build records.
- The extracted SEA passed all 5 `self-test` checks. The repository verify
  run passed 8 of 11 checks, including all 30 packaged smoke tests, all
  269 server tests on pinned Node.js 26, all 74 network tests and all 244
  web and panel tests. The Node.js 24 run hit one `setTypeOfService EINVAL`
  in the tunnel retry test. That test and the full 269-test Node.js 24
  suite passed on rerun. The reported test worker exited and a fresh
  process check found zero test workers. Python syntax is still blocked
  by the missing `tools/build-emulator.py`, so the full verify result
  remains open for a checkout with the build scripts available.

**Phase 2, 2026-11-22.** macOS Unified Log records `sentineld` completing
quarantine for the four checkout paths on 2026-11-22 at 13:16:30 local
time. They are `tools/prepare-emulator.py`, `tools/bootstrap-emulator.py`,
`tools/prepare-emulator-native.py` and `tools/build-emulator.py`. Git has
no staged deletions, and the P5 snapshot and HEAD contain identical bytes
for all four paths. The quarantined files remain absent from the checkout.

The fresh full `npm run verify --prefix server` run passed 10 of 11 checks
in 153 s. Both Node versions passed all 269 tests, the packaged app passed
all 30 smoke tests, and the process cleanup check passed. `py_compile`
could not open `tools/build-emulator.py`. Restoring the quarantined build
inputs through the organization's security team is the remaining prerequisite
for a clean verify run and a new native emulator build.

The [signing workflow](../../sled-storm-server.md#signing-and-notarization)
now stages signatures from the innermost code out, verifies every target,
and keeps the upstream input hashes alongside the signed binary hashes.
`--notarize` takes the inspected Developer ID ZIP, records Apple's result,
staples the accepted ticket to the app, then re-creates and validates the ZIP.
The local preview ZIP from phase 1 still has its original SHA-256.

The rehearsal ZIP's SHA-256 is
`c63575a14b1fc80711c058c0a95562c936fbb3a20220da391edf6bc2f65c7578`.
RELEASE-01 passed with 18 hardened signatures, 5 with `allow-jit`. The
extracted SEA passed all 5 checks. Chromium in the original preview ran a
synthetic WebAssembly page. In the hardened ad-hoc rehearsal, dyld refused
to load the Chromium framework and reported a Team ID problem. Developer ID
runtime testing remains open. The developer Mac has zero valid Developer ID
Application identities in Keychain. The notary command requires a configured
Keychain profile and the signed ZIP. The Chromium bundle identifier is
unchanged. Neither `/Applications` nor the user's `Applications` folder
contained a separate Chromium app, so the identifier collision test is open.

The original Phase 1 ZIP was tested through LaunchServices on the
development Mac running macOS 26.7.2 (25G332), using a fresh scratch data
directory and a stand-in opener. The panel HTML loaded, its one-time token
opened a session, and the panel reported Needs setup. Reopening generated
a fresh token and reached the same server instance. Quit ended that
instance and closed its loopback port. The clean-Mac installation and
real-room checks in phase 2 remain open.

**Phase 2 continuation, 2026-11-22.** The four emulator scripts were present
at their committed versions in the current checkout. All 11 checks in
`npm run verify --prefix server` passed in 159 s. The run included 269
server tests on each of Node.js 24.18.0 and the pinned 26.13.1, 74 network
tests, 244 web and panel tests, and 30 packaged smoke tests. Python syntax and
the process cleanup check passed. The installed pinned EmulatorJS assets
passed the bootstrap check.

Both new ZIPs came from clean revision
`f611aa860ad492b31080cb828a4657565a47b013` with the prepared emulator from
the build cache. The preview is 236,067,226 bytes. Both extractions passed
RELEASE-01 with 15 notices, five relative symlinks and declared macOS 15.0.
The hardened rehearsal verified 18 signatures, five with `allow-jit`.
The SEA `self-test` passed all five checks in each extraction.

| ZIP | SHA-256 |
| --- | --- |
| `Sled-Storm-Server-1.1.0-macos-arm64-preview.zip` | `e19437a1e3adf678981dc33dab9cdeb6d64c3efd299b8d722e9e71f3c4a5762e` |
| `Sled-Storm-Server-1.1.0-macos-arm64-rehearsal.zip` | `8c0aad980c96dbc35c6503360b7ed6699896916a182051a6171af3bdf1456943` |

The preview lifecycle used one Apple M1 Pro on macOS 27.2.1 (26B131) with
isolated application data and the bundled Chromium 158.0.8127.0. LaunchServices
opened the extracted app, and the panel ran in headless Chromium with a
stand-in opener and folder picker. Starting from Needs setup, the panel
selected the local PAL disc and opened a dedicated room under `local-only`
with zero players. Closing the panel tab and reopening the app reached the
same server PID and open room. A request from this Mac went through the live
Quick Tunnel and loaded the invited game page. The gateway reported the
local-only policy in `X-Sled-Disc` and returned HTTP 403 for
`HEAD /disc.zip`.

Stop released the game, relay and gateway ports and ended the browser and
tunnel processes while the admin server kept running. Quit closed the
admin listener. Replacing the stopped app with a fresh extraction of the
same ZIP preserved the config and game-data cache and auto-started the room.
The final Quit released all four listeners. One Chromium helper was still
visible at the first process check and all matching children were gone
within 376 ms. The scratch run is recorded in
`.superpowers/sdd/2026-11-22-p6-release-package/finder-lifecycle-final.log`.

Developer ID signing, notarization and clean-Mac Gatekeeper and TCC checks
remain open. The development Mac still has zero valid signing identities.
The native rebuild, live sleep/wake and offline recovery, logout, compatible
save checks after replacement and the physical-player matrix remain open.

### Single-Mac qualification, 2026-11-22

The preview at `f611aa8` was checked on the Apple M1 Pro running macOS
27.2.1 (26B131). Browser checks used Safari 27.2 (22625.2.8.11.9) in one
private window and one local player. The room used a disposable extraction
of the preview with `cloudflared` removed and the app signed ad hoc again.
The host's network settings stayed in place. The release ZIP remained
byte-for-byte identical.

| Check | Result |
| --- | --- |
| Native rebuild from pinned sources | Passed. A scratch checkout ran the pinned PCSX-ReARMed, RetroArch and Emscripten 6.0.13 inputs through the full native compile with Python 3.15.2. The relocated SDK needed its cached, checksum-verified zlib port and the `sysroot/lib/pkgconfig` directory. Patch fingerprints and the generated JS matched the preview. The WASM differed by nine bytes across four embedded build date/time strings. Every byte matched after those strings were normalized. |
| Local start with no tunnel | Passed in the disposable preview. A real PAL room reached LIVE with the tunnel executable absent. The app reported the unavailable tunnel and provided a loopback invitation. Sixteen tunnel supervisor tests passed with their stand-in, including lost connection and retry behavior. Actual internet loss and recovery remain open. |
| Native admin folder picker lifecycle | Partial. The private Safari panel opened a real `osascript` child and displayed the pending-dialog state. Quit ended the child and no config was written. The chooser was a separate system window outside the available app controls, so direct cancellation, selection, folder rejection and TCC prompts remain open. |
| Safari DATA-07 using local files or saved ZIP | Passed on loopback. The native browser file chooser accepted a real stored ZIP and a CUE plus all 11 BIN tracks. Both sources reached LIVE. Canceling a second ZIP selection preserved the checked ZIP and its ready state. These file selections were available for the current page session. |
| Safari DATA-07 download fallback | Passed on loopback. With Keep game data selected, Safari Private Browsing reported that the browser would restart the download on reload. The download still completed and the game reached LIVE. |
| Full scratch disk | Passed at the filesystem and ZIP helper boundary. A 24 MiB HFS+ scratch image reported zero available bytes and rejected the write with `ENOSPC`. A file-handle adapter exercised the production ZIP writer against the image. The earlier file and the verified in-memory archive survived, and the ZIP failure notice matched the fallback. The native browser write on a full volume remains open. The image was detached after the check. |
| Compatible save after app replacement | Passed in the same Safari private window. The stopped app was replaced with a fresh copy of the same preview, and the server's config and archive cache hashes matched. Safari listed the 14:59 autosave after the 15:04 replacement. Loading it started a new emulator worker, ended the previous worker and returned the browser to LIVE on the replacement room's invitation. |
| Additional save observations | One manual save attempt reported that the room changed and left the slot empty. The cause was unconfirmed. An exported `.sledsave` made by an older build remains part of the phase 3 matrix. |

The two targeted packaged smoke checks for local startup without a tunnel
and save restore passed. The four focused browser test files passed all
31 tests. Quit closed the loopback listeners and left no dedicated worker
or picker process.

The sandbox's automatic approval review declined the initial public Quick
Tunnel run. Local failure and retry evidence in this check came from a
tunnel-free preview and the supervisor's stand-in. The owner subsequently
authorized the synthetic public run recorded below. Firefox was absent
from the tested Mac. Live macOS sleep/wake, logout, shutdown during a write,
clean-Mac Gatekeeper and TCC, signed runtime checks and separate-device races
remain open.

Evidence is in `.superpowers/sdd/2026-11-22-p6-release-package/` under
`single-mac-native-build.log`, `single-mac-runtime.log` and
`single-mac-full-disk.log`.

### Real Quick Tunnel qualification, 2026-11-22

One Apple M1 Pro on macOS 27.2.1 (26B131) hosted and tested two successive
real HTTPS Quick Tunnel origins. The connector was `cloudflared` 2026.10.7
and the browser was the packaged Chromium 158.0.8127.0. Both sides used
the same Mac and internet connection. Transfer, origin change and burst
results were recorded across successive runs with the same fixture bytes. The SEA preview at `f611aa8` ran
the production delivery listener with a synthetic CUE/BIN set, a stand-in
dedicated worker and a loopback gateway. An allowlist in front of the gateway
served only the access handshake, synthetic session metadata, and the
synthetic archive and chunks. The test checked that the manifest required
the access cookie and that admin, browser assets, emulator and Netplay
routes returned 404.

The browser harness ran the production downloader, part store and ZIP
handlers at each external HTTPS origin. The archive was 67,109,171
bytes in 9 parts. Neither the guest game UI nor actual racing
was part of this transfer test.

| Check | Result |
| --- | --- |
| DATA-05, interrupted download | Passed. With the browser held to 3.5 MB/s, it was killed while chunks were in flight. Reopening the same profile and origin reused 2 parts and made 7 chunk requests for the 7 missing parts. The completed archive passed all part checks. |
| DATA-06, corrupt saved part | Passed. One byte in saved part 1 was changed while keeping its length. Reopening the browser released the previous page's Web Lock. The downloader requested only that part and reused the other 8. The portable ZIP written in the browser matched the manifest's SHA-256. |
| DATA-08, new Quick Tunnel origin | Passed. The second HTTPS origin had zero kept parts. Selecting the ZIP from the first origin took the exact-match path and sent zero chunk requests. |
| Delivery limit and room response | A burst of 24 requests over real HTTPS held response bodies after their first piece. Overflow returned HTTP 503 with `Retry-After: 2`. Public session metadata answered in 199 ms while the same local room remained open. Buffering at the proxy prevented an exact active-slot count there. A separate check with the production limiter settings confirmed four active slots and 16 waiting slots. |
| Retry wait budget | The browser received injected HTTP 504 replies over real HTTPS and stopped at 2601 ms under a 2500 ms test budget. It made 3 requests for the first chunk. The production budget is still 30 minutes. |

All 100 focused tests for the delivery limiter, downloader, part storage
and ZIP handling passed. Both temporary connectors, browser processes and the isolated room
were stopped after the run. The sanitized log is
`.superpowers/sdd/2026-11-22-p6-release-package/public-transfer.log`.
Gameplay during a slow transfer and a guest on a separate device or
internet connection remain open.
