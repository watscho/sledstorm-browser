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
| Real Quick Tunnel, DATA-05 and DATA-06 | Interrupt delivery on the same origin over an external network. Count reused and requested chunks after reopening and after corrupting one saved synthetic chunk. Check the concurrency limit, retry wait budget and room responsiveness on a slower link. | Open |
| Browser storage and origin changes, DATA-07 and DATA-08 | Record Safari and Firefox versions and what each does with own files, a saved ZIP and the supported download fallback. Exercise private windows, a genuinely full scratch disk and interruption during shutdown. Check preservation of earlier data on native picker cancellation where supported. On a new Quick Tunnel origin, check the initial download state and reuse of a previously saved ZIP. | Open |

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
