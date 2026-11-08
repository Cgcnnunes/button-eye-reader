# Button Eye Reader

An experimental **pt-PT communication board for iPad Safari**. Four large buttons speak phrases by
touch or calibrated gaze using the front camera.

**Not a medical device or a reliable emergency communication system.** Eye detection does not prove
accurate gaze. Use supervised testing and another communication method if selections are wrong.

## Features and limits

| Feature           | Behavior                                                                               |
| ----------------- | -------------------------------------------------------------------------------------- |
| Speaking board    | Four configurable phrases; 28 initial phrases                                          |
| Catalogue         | Four choices per page; choose a phrase, then replace a board slot without typing       |
| New phrases       | Caregiver-only text entry; up to 100 characters; gaze stops before writing             |
| Speech            | Local system voice, preferring exact pt-PT; Safari may require touch authorization     |
| Gaze              | Nine calibration points, four independent verification points, two-second dwell        |
| Repeat prevention | Look outside the selected target for 400 ms of valid gaze                              |
| Storage           | Phrases and assignments in this browser's `localStorage`; no cross-device sync         |
| Privacy           | Camera processing and model/WASM loading stay local/same-origin; no image/video upload |

- Eye/iris markers and failure diagnostics are enabled locally and in TEST, and temporarily in PROD
  without headers. No remote calibration-report collection/storage is implemented.
- Face framing is based on apparent image size, not centimetres or a measured head pose.
- Each verification target needs at least 12 samples and 90% within 12% on both screen axes. Passing
  does not guarantee ongoing accuracy.
- Missing/multiple faces, closed eyes, stale frames or out-of-range data pause selection.
- Viewport changes, scrolling, backgrounding and writing stop the camera and require recalibration.
- Speech failures/missing pt-PT voices are reported; accent and continuing authorization are not
  guaranteed.
- Changing origin, clearing browser data or private browsing can lose phrases. No encrypted phrase
  storage/export; do not enter confidential information. Corrupt data is reported, not overwritten.

## Start locally

Use Node.js **22.22.2+** (see `.nvmrc`) and npm:

```sh
npm ci
npm run dev
```

Open Vite's localhost URL. Camera access on an iPad needs HTTPS; use TEST, not a PC's HTTP IP
address. Installation prepares self-hosted MediaPipe model/WASM assets and verifies the model
checksum. The first download needs internet. Detection runs on the main thread; check iPad
responsiveness, heat and battery use.

## Guides

| Need                                            | Read                                    |
| ----------------------------------------------- | --------------------------------------- |
| Contributor/AI rules and exact commit process   | [CONTRIBUTING.md](docs/CONTRIBUTING.md) |
| Runtime flow and safety invariants              | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Commands, calibration and physical iPad tests   | [TESTING.md](docs/TESTING.md)           |
| Cloudflare/GitHub setup and optional iPad login | [DEPLOYMENT.md](docs/DEPLOYMENT.md)     |
| Versions, TEST releases and PROD promotion      | [RELEASES.md](docs/RELEASES.md)         |
| Release history                                 | [CHANGELOG.md](CHANGELOG.md)            |

GitHub Actions deploys TEST after eligible squash merges; PROD requires manual promotion of the
exact tested tag/artifact. **Do not connect Workers Builds.** Dashboard changes are owner actions,
not consequences of editing repository files.

Repository code/docs/tooling use English; site content and localized fixtures use pt-PT. Every
commit needs meaningful docs; use feature branches and reviewed squash PRs. The app version comes
from `package.json` and appears in the footer.
