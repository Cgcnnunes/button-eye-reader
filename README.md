# Button Eye Reader

## Developers and AI

Start with [contributor rules](docs/CONTRIBUTING.md),
[architecture and sources of truth](docs/ARCHITECTURE.md),
[commands and local/manual testing](docs/TESTING.md) and
[PRs, versioning and releases](docs/RELEASES.md). Every commit requires meaningful documentation.
Use feature branches, strict checks and reviewed squash PRs to main.

Repository code, comments, documentation and tooling messages must be in **English**. Only
user-facing site content is **pt-PT**. Describe controls in English in documentation; localized test
fixtures must still match the actual site.

The current version is in `package.json` and the app footer; released versions use immutable
`vX.Y.Z` tags. See [CHANGELOG.md](CHANGELOG.md).

A **pt-PT** communication board designed primarily for Safari on the **iPad A16**. Four large
buttons speak words or phrases. Touch is supported alongside an **experimental gaze-selection
prototype** using the front camera.

## Included features

- Four configurable phrases, initially meaning yes, no, wanting water and needing help.
- Phrase selection: a catalogue with four phrases per page. Choose a phrase, then the speaking
  button to replace. The entire flow supports touch or gaze without typing.
- Add phrase: caregiver-only text entry, storing up to 100 characters per phrase. Gaze is disabled
  before opening the keyboard.
- 28 initial pt-PT phrases. New phrases and button assignments are stored in `localStorage`. There
  is no account, database, cross-device synchronization or image collection.
- System speech, preferring a **pt-PT** voice. No external speech service is used.
- Automatic nine-point calibration and four-point validation. Selection requires **2 seconds** of
  continuous gaze. The gold bar shows progress. Another selection requires 400 ms of valid gaze
  outside the selected button.
- Full-screen mirrored camera view during calibration, with a detected-face outline, face target,
  eye-follow circles and a caregiver button to save the current apparent face size as the seating
  distance reference. In use, gaze pauses when the face or eyes leave the supported area. This is
  image-based guidance, not a physical distance or head-pose measurement.
- Eye and iris markers and validation-failure diagnostics are enabled locally and in TEST, and
  temporarily in PROD, without a special request header. Images remain on the device.
- Camera shutdown on leaving the page, resizing/reorienting, scrolling or opening text entry.
  Recalibration is required afterwards.

## Important limitations

**This is not a medical device or a reliable emergency communication system.** An ordinary iPad
camera is not equivalent to dedicated eye-tracking hardware. MediaPipe detects the face and irises;
a calibrated regression estimates screen position from those signals. Accuracy is not guaranteed,
and some positions, eye movements or lighting conditions may prevent the app from working.
Calibration does not require head movement, but eye-only performance must be confirmed on the
intended device and with its intended user.

Gaze is enabled only if **every** validation point has at least 12 samples and 90% of them have
errors no greater than 12% of screen width and 12% of screen height. This initial check does not
prove ongoing accuracy. No face, multiple faces, closed eyes, frozen frames or data outside the
calibrated range interrupt selection. Incorrect detections can still select the wrong phrase. If
errors occur, disable gaze and use another supervised communication method.

Safari may block speech without a recent touch gesture. The sound-test and enable-gaze controls
initiate speech through touch, but **do not guarantee** permanent authorization. Speech failures and
the absence of a confirmed pt-PT voice are shown on screen. Check Portuguese voice availability in
the iPad accessibility/spoken-content settings, volume and audio output. Listen to the actual accent
before use.

Face guidance checks the detected face's position and apparent size, and whether both eyes can be
used by the tracker. It does not measure physical distance or guarantee that the head is facing
straight ahead. Adjust the target while the iPad is fixed in its intended mount, then validate the
guidance with the intended user.

Phrases persist only in this browser and origin. Changing domains, clearing browser data, private
browsing or losing the device may remove them. Do not enter confidential information: this initial
version has no encryption or export. Existing invalid data is not silently overwritten.

## Development

Requires Node.js **22.22.2 or later** and npm. Node is used only for building and deployment; the
published site is static TypeScript and Vite, with no UI framework.

```sh
npm ci
npm run dev
```

Open the local address printed by Vite. `localhost` allows camera access on the computer. For camera
testing **on the iPad**, use a Cloudflare **HTTPS** address; a local HTTP IP address does not grant
camera permission.

```sh
npm test
npm run build
```

Installation copies MediaPipe WASM and downloads the Face Landmarker float16 v1 model (~3.8 MB) from
official Google storage, verifying its SHA-256. The initial installation needs internet. Generated
files are stored in `public/vision/`, ignored by Git and included in `dist/` during the build. The
browser loads model/WASM **from the site itself**, not a CDN. No video is uploaded. Detection is
limited to approximately 12 frames per second on the main thread; test responsiveness, temperature
and battery usage on the iPad.

## Deployment with Cloudflare and GitHub

Use **Cloudflare Workers Static Assets**, deployed by **GitHub Actions** to two Workers. Cloudflare
Pipelines is a data-ingestion product and is not used. **Do not connect Workers Builds**: automatic
deployment would bypass the workflow's tag/provenance checks and explicit PROD promotion.

Follow the [setup, recovery and verification guide](docs/DEPLOYMENT.md), also reusable for other
static apps. **Before enabling workflows, confirm that `main` exists on GitHub and is the default
branch.** Reload dashboards after saving configuration and verify both Workers and GitHub
environments; external settings do not change just because YAML changes.

Every push to `main` starts the TEST workflow. Only a commit that passes validation and has the
required merged-PR provenance is deployed to **TEST**; after success, the workflow creates a
`vX.Y.Z` tag and GitHub prerelease with generated notes. After testing that exact tag, dispatch
**Deploy to PROD** from it: the workflow validates provenance and deploys the same artifact without
rebuilding, then makes the release stable. See the guide for credentials, the exact TEST/PROD URLs,
the `production` tag restriction and the conditional reviewer setting.

For a new setup, create both TEST and PROD Workers using the guide and copy their actual URLs. The
respective workflow replaces content on its configured Worker; inspect existing Workers before
deploying. Choose the final origin before storing phrases; changing domains does not transfer
`localStorage`.

Authenticated local alternative for **TEST only**, without creating an eligible prerelease:

```sh
npx wrangler login
npm run deploy
```

For another account or app, configure Workers and GitHub Environments using the guide. No Cloudflare
or GitHub credentials are included in the project.

## First supervised iPad test

1. Use updated Safari, normal browsing, 100% page zoom and no Split View. Prefer landscape; portrait
   also uses a 2-by-2 grid.
2. Mount the iPad securely at eye level with uniform lighting. Only the intended user should appear
   in the camera. Do not change the distance after calibration.
3. Tap the sound-test control. Confirm pt-PT voice, volume and audio output.
4. Test all four speaking buttons by touch, a catalogue replacement, a new phrase and persistence
   after reloading.
5. Tap the enable-gaze control, grant camera permission and ask the user to follow the centre of the
   circle with their eyes, without touching. Stable calibration takes approximately 40 seconds.
6. After validation, look outside the last circle. Test **every** button several times. Confirm
   there is no speech before two seconds, no repeat without looking away and no selection in gaps.
7. Test the catalogue, next/previous navigation, phrase selection and replacement using gaze alone.
   Confirm pauses with closed eyes or another face entering the camera.
8. Change orientation or leave and return: the camera must stop and require recalibration. Run a
   longer supervised session to detect drift and audio failures.

Automated tests cover data, regression, validation thresholds, dwell, camera lifecycle and speech
errors. They do not establish eye accuracy, accent, permissions or performance on a physical iPad:
those are acceptance criteria before relying on the prototype.

## Structure and extensions

- `src/main.ts`: UI and catalogue/replacement flow.
- `src/store.ts`: initial phrases, validation and immutable speaking-button updates.
- `src/dwell.ts`: timed selection, safety margins and repeat prevention.
- `src/gaze.ts` / `src/gaze-math.ts`: camera, landmarks and calibration.
- `src/speech.ts`: pt-PT speech, queue prevention and audio errors.
- `src/style.css`: typography, spacing and iPad layout.

Keep few targets on screen: future options should use pages of four items rather than adding buttons
to the main board.

References: [GitHub Actions](https://docs.github.com/en/actions),
[Static Assets](https://developers.cloudflare.com/workers/static-assets/),
[MediaPipe Face Landmarker](https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker).
