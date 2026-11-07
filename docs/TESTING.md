# Commands and testing

## Setup and commands

Install Node.js **22.22.2+** (the exact baseline is in `.nvmrc`) and npm, then:

```sh
npm ci
npm run dev
```

`npm ci` installs dependencies, local model/WASM assets and Husky. The initial model download needs
internet; a checksum mismatch fails explicitly.

| Command                                    | Purpose                                                  |
| ------------------------------------------ | -------------------------------------------------------- |
| `npm run dev`                              | Local Vite site; open the shown localhost URL            |
| `npm run assets`                           | Restore self-hosted model/WASM; no video upload          |
| `npm run check`                            | Strict TypeScript validation of browser, tests and tools |
| `npm run lint` / `npm run lint:fix`        | Type-aware ESLint, zero warnings / fixes                 |
| `npm run format` / `npm run format:check`  | Prettier write / read-only check                         |
| `npm test`                                 | Full Vitest regression suite and enforced coverage       |
| `npm run test:watch`                       | Interactive tests while developing                       |
| `npm run verify`                           | Format check → lint → tests/coverage → type-check/build  |
| `npm run build`                            | Type-check and compile static assets into `dist`         |
| `npm run preview`                          | Serve the compiled site locally                          |
| `npx wrangler dev --local`                 | Local Cloudflare runtime, including production headers   |
| `npx wrangler deploy --env test --dry-run` | Validate the TEST package without publishing             |
| `npm run deploy`                           | Manual TEST only; does not create release provenance     |
| `npm run branch:new`                       | Fetch and create the next five-digit feature branch      |
| `npm run commit:next`                      | Print the next valid commit scope                        |
| `npm run release:prepare -- patch`         | Prepare app/lockfile version for the PR bump             |
| `npm run docs:check`                       | Verify staged docs and feature branch                    |
| `npm run repo:check`                       | CI-only PR policy check; requires a GitHub event file    |

Tests cover storage validation/persistence, phrase replacement, camera cancellation and errors,
voice errors, regression mapping, per-point calibration acceptance, exact dwell timing/repeat locks,
the UI flow and commit/PR/version policies. Coverage includes all browser TypeScript and shared
policy logic, including deployment provenance guards. Tests reject failed/unrelated workflows,
stable or malformed tags, expired/tampered artifacts, checksum mismatches and wrong Worker output.
Every included file requires 90% lines/statements/functions and 80% branches. Do not lower
thresholds to hide missing tests. HTML coverage is in `coverage/index.html` (ignored by Git).

## Local gaze testing without a camera

```sh
npm test -- tests/main.test.ts --coverage.enabled=false
npm test -- tests/gaze-math.test.ts tests/dwell.test.ts --coverage.enabled=false
```

The jsdom UI tests substitute the camera transport, feed synthetic eye features through the **real
calibration, validation, mapping and dwell code**, and exercise catalogue pagination → phrase choice
→ slot replacement → speech. They also reject static signals, absent tracking and premature/repeated
selection. Camera lifecycle tests separately test the real capture wrapper with modeled permission,
loading, cancellation and stale-video failures.

Simulation is test-only: there is no public URL option that bypasses calibration or adds a fake gaze
controller to the shipped app. Deterministic tests prove logic, not actual camera accuracy or Safari
audio.

## Manual option 1: physical iPad

Use the Cloudflare **HTTPS** site in updated Safari, page zoom 100%, normal browsing, without Split
View. Prefer landscape. A local Windows PC address over HTTP does not grant camera access on the
iPad; use the separate HTTPS TEST Worker instead. Record its `release.json` tag/SHA and manual
results before the next merge overwrites TEST. Its phrase storage is separate from PROD. A locally
trusted HTTPS certificate can also work, but requires configuring trust on the iPad and is not part
of this minimal setup.

The assistant cannot automatically inspect your iPad or camera. Shared desktop browser tools do not
connect to remote iPad Safari. Apple's Safari Web Inspector normally needs a **Mac**, cable/trusted
device and enabled Web Inspector; the Windows environment here does not provide that. You can share
non-sensitive screenshots, visible error text and manual results voluntarily. Avoid including the
person's image, private phrases or other identifying information.

## Manual option 2: PC webcam and shared browser

Connect a webcam, run `npm run dev` and open its **localhost** URL in the PC browser. Use the
sound-test control, then the enable-gaze control, grant camera access and calibrate. To test
compiled assets and CSP too, run `npm run build`, then `npx wrangler dev --local`.

If you explicitly share that desktop browser page, the assistant can inspect the interface, errors,
highlighted targets and browser console, and interact with controls. **The app hides the camera feed
and does not stream it to the assistant.** Sharing the page does not mean the assistant can see your
face or directly measure eye movement. It can observe application feedback while you report where
you look. Do not add camera recording/uploading just for diagnostics.

A PC webcam has different optics, field of view, resolution, processing speed and browser
permissions/voices. PC success is useful for debugging, **not** validation of iPad performance.
Recalibrate separately on each device.

## Repeatable manual checklist

Use a fixed mount, uniform lighting, the screen at eye level and only one person in the image. Use
non-sensitive test phrases. Record device/browser/orientation, app version, which tests passed, and
exact visible errors.

- [ ] Four large phrases and both lower controls fit without scrolling in both iPad orientations,
      including a 100-character phrase.
- [ ] Each phrase speaks correctly by touch; accent is pt-PT and volume/output work. Lack of an
      installed pt-PT voice is reported.
- [ ] Catalogue has four choices/page; first/last navigation is disabled correctly.
- [ ] Select a catalogue phrase, choose a slot, reload: replacement persists.
- [ ] Add a phrase, choose it, reload: it persists; duplicate/empty/overlong input cannot silently
      succeed. User text is rendered literally, not as markup.
- [ ] Deny camera access: visible error, working touch fallback, no stuck startup.
- [ ] Calibration follows nine points and verifies four points. No touching/head movement is
      required to follow them. Unstable/static signals must not enable gaze.
- [ ] Once active, test each target at least ten times. It never speaks before two seconds, never
      speaks for an empty gap and does not repeat while staring.
- [ ] Look away for at least 400 ms before selecting again. No face/multiple faces/ closed eyes
      pause selection; losing tracking does not unlock repeats.
- [ ] Use **only gaze** for catalogue, next/previous, choosing a phrase and slot replacement. New
      text entry remains caregiver-only.
- [ ] Rotate/resize/scroll/background the page: camera stops; recalibration required.
- [ ] Cancel startup/calibration, then restart: no leaked camera or stuck UI.
- [ ] Run an accompanied 15-minute session; note drift, wrong selections, latency, audio permission
      expiry, heat and battery use. Stop if there are incorrect choices.

For each target, record intended selections, successful selections, wrong selections and misses.
Automated calibration thresholds are not a clinical acceptance criterion. Any unreliable behavior
means the prototype must not be relied on for communication.
