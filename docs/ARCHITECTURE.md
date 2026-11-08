# Architecture and sources of truth

## Purpose and limits

Button Eye Reader is an experimental pt-PT communication board for an iPad A16. Four large phrases
can be spoken by touch or calibrated gaze. Catalogue navigation and slot replacement must remain
usable without typing; only adding a new phrase is caregiver-only. This is not a medical device or
an emergency communication system.

The app is static TypeScript and CSS, bundled by Vite. There is no UI framework, server, account,
database or external speech API. Node.js is build/tooling only. Cloudflare Workers Static Assets
serves the build over HTTPS. GitHub Actions deploys merges to a separate TEST Worker; PROD is a
manual tag-only promotion of the tested artifact. Do not connect Workers Builds; Cloudflare
Pipelines (data ingestion) is not used.

## Runtime flow

1. [main.ts](../src/main.ts) loads validated browser storage or the initial board and renders the
   board, catalogue, replacement screen or caregiver form.
2. [store.ts](../src/store.ts) owns phrase validation and immutable slot updates. A successful
   storage write is required before updating the in-memory board. Corrupt storage is reported and
   preserved, not replaced.
3. [speech.ts](../src/speech.ts) selects an exact pt-PT system voice when available, prevents queued
   repeats and exposes failures. A touch gesture may be necessary on Safari. Missing voices are
   reported; do not promise the correct accent.
4. [gaze.ts](../src/gaze.ts) owns front-camera capture and the MediaPipe lifecycle. Model/WASM are
   loaded from the same origin. Video never leaves the browser. No face, multiple faces, closed
   eyes, frozen frames or errors cannot count as valid gaze samples.
5. [gaze-math.ts](../src/gaze-math.ts) extracts iris/head features and fits a normalized
   ridge-regression mapping. Nine calibration points are followed by four independent validation
   points. Every validation point requires at least 12 samples, with 90% within 12% on **both**
   screen axes.
6. [dwell.ts](../src/dwell.ts) requires 2,000 ms on the same inset target. Selection locks the
   selected rectangle until 400 ms of valid gaze outside it. Missing tracking does not unlock
   repeats; gaps above 350 ms restart progress.

Raw and smoothed gaze must both agree with a target. Calibration is discarded on viewport changes,
scrolling, backgrounding, writing or stopping the camera. No calibration is persisted. These
safeguards reduce errors, not eliminate them.

## Sources of truth

| Concern                                     | Authority                                                                     |
| ------------------------------------------- | ----------------------------------------------------------------------------- |
| Phrase text/default ordering/storage schema | `src/store.ts`                                                                |
| Gaze/dwell acceptance thresholds            | `src/gaze-math.ts`, `src/dwell.ts`, `src/main.ts`; boundary tests             |
| App and repository version                  | `package.json`; lockfile root mirrors it                                      |
| Displayed app version                       | Vite injects `package.json` version                                           |
| Released version                            | Immutable annotated `vX.Y.Z` tag after successful TEST; prerelease until PROD |
| Branch high-water mark                      | `.reader-sequence.json`, advanced by `branch:new`                             |
| Commit/PR/release rules                     | `scripts/policy.ts`; hooks and CI share it                                    |
| Formatting and lint                         | `.prettierrc.json`, `eslint.config.mjs`                                       |
| Build/deploy identity                       | `wrangler.jsonc`; dashboard Worker name must match                            |
| Required contributor process                | [CONTRIBUTING.md](CONTRIBUTING.md)                                            |

GitHub workflows own build/deploy commands and release promotion; GitHub Environments own secrets,
URLs and approvals. Merged-PR provenance distinguishes feature-run metadata from the deployed squash
SHA and verifies the PR association through GitHub before promotion. Wrangler defines the two Worker
names and static assets. Create both Workers without a GitHub Workers Builds connection. Follow
[DEPLOYMENT.md](DEPLOYMENT.md) for fresh setup or changing deployment settings. Reload the dashboard
to verify persistence and check the new build's branch/commit before declaring deployment
successful. `release.json` identifies the deployed SHA/tag. PR and TEST independently run the shared
`npm run verify` command; PR validation runs only on PR events. TEST does not depend on a separate
validation run. PROD checks the exact successful TEST workflow attempt (including verification) and
immutable artifact ZIP digest, without recompiling. TEST/PROD use different origins, so phrase
storage is independent. Cloudflare Access protects TEST: human testers sign in and the TEST
smoke-test step uses a separate service token from GitHub environment secrets. Every TEST request
authenticates without following redirects; PROD smoke tests remain public and never send Access
credentials. Secrets are not exposed to browser code or build artifacts. Smoke tests verify exact
asset bytes and headers, not physical-device acceptance. Failure after a Cloudflare deployment can
leave that version live even if the GitHub release update fails; there is no cross-provider
transaction.

The storage schema's `version: 1` is **not** the application semantic version. Do not bump the
storage schema just because an app release changes.

## Structure and dependency choices

- `src/`: browser code and CSS; no network uploads or secret credentials.
- `scripts/`: typed Node scripts for assets, policy and releases.
- `tests/`: Vitest units, jsdom UI tests and repository policy tests.
- `public/`: static headers/notices and ignored generated vision assets.
- `.github/`: read-only PR validation, `deploy-to-test.yml`, tag-dispatched `deploy-to-prod.yml`, PR
  template and concise always-on Copilot instructions.
- `docs/`: architecture, contribution rules, commands/manual tests and releases.

TypeScript is pinned to the supported 6.0 series because typescript-eslint currently declares
support below 6.1. Do not independently upgrade to TypeScript 7. Node 22.22.2+ runs the erasable
TypeScript tooling scripts directly. Do not add parameter properties, runtime enums or decorators to
those scripts.

The minimatch override fixes the tooling-only glob-amplification advisory in the linters' transitive
10.x dependency. Version 11 retains the imported API and supports the repository's Node baseline;
lint and test validation cover its integration. Remove the override when upstream tooling adopts a
patched version.

Never alphabetize phrase arrays, calibration point arrays or workflow steps: their order controls
behavior. Alphabetize static object/type keys, import specifiers/declarations and named exports
through ESLint. Do not reorder side-effect imports or spread-dependent objects in ways that alter
behavior.

Extend options with pages of a few large targets, not a crowded main screen. Preserve pt-PT copy,
local processing and the caregiver-only keyboard boundary.
