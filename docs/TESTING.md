# Testing

**PC/simulated tests do not establish physical iPad Eye Tracking accuracy.** Test the intended iPad,
user, mounting position and lighting before relying on this experimental prototype.

## Commands

Use Node.js **22.22.2+** (see `.nvmrc`). `npm ci` installs dependencies and hooks; no vision
model/WASM download is needed.

| Command                                      | Purpose                                                  |
| -------------------------------------------- | -------------------------------------------------------- |
| `npm run dev`                                | Local Vite site                                          |
| `npm run check`                              | Strict TypeScript validation                             |
| `npm run lint` / `npm run lint:fix`          | Type-aware lint / fixes; zero warnings                   |
| `npm run format` / `npm run format:check`    | Format / check                                           |
| `npm test` / `npm run test:watch`            | Coverage suite / interactive runner                      |
| `npm run verify`                             | Format check, lint, coverage tests, type-check and build |
| `npm run build` / `npm run preview`          | Compile / preview static assets                          |
| `npx wrangler dev --local`                   | Local Worker and static security headers; build first    |
| `npx wrangler deploy --env test --dry-run`   | Validate TEST packaging without publishing               |
| `npm run deploy`                             | Manual TEST deployment; not an eligible release          |
| `npm run branch:new` / `npm run commit:next` | Allocate feature branch / next commit scope              |
| `npm run release:prepare -- patch`           | Prepare version; choose major/minor/patch                |
| `npm run docs:check` / `npm run repo:check`  | Staged-doc policy / CI PR policy                         |

Required contributor workflow: [CONTRIBUTING.md](CONTRIBUTING.md).

## Automated coverage

Tests cover phrase storage/persistence, speech errors and busy guards, standard button activation,
caregiver-labelled writing, UI flow and release/deployment policy. Regressions check that app
camera, custom tracking and report infrastructure are absent. Each included file requires **90%
statements/lines/functions and 80% branches**. Do not lower gates; the ignored HTML report is
`coverage/index.html`.

```sh
npm test -- tests/main.test.ts tests/speech.test.ts tests/worker.test.ts --coverage.enabled=false
```

Ordinary click tests verify app behavior, not Apple's detection, calibration, dwell or Safari's
speech authorization. No simulated gaze implementation ships.

## Apple Eye Tracking setup

1. Check your exact model and iPadOS version against Apple's current
   [iPad User Guide](https://support.apple.com/guide/ipad/welcome/ipados), searching for Eye
   Tracking. Not every iPad supports the feature.
2. Open **Settings > Accessibility > Eye Tracking** on a supported device. Labels vary by system
   language/version; search Settings if needed.
3. Follow Apple's on-device calibration. Use a stable mount, a clear front camera and even lighting;
   follow the system's positioning guidance rather than the removed app face-size limits.
4. Adjust system pointer/dwell options to the user's needs. The website imposes no extra two-second
   timer, calibration test or custom tracking header.
5. Open HTTPS TEST in Safari. Have a caregiver test sound by touch first, then test standard button
   activation using native Eye Tracking.

The website cannot read gaze coordinates, verify eye accuracy, control system settings or disable
native tracking in the caregiver form. No app-camera permission is necessary: system Eye Tracking
uses the camera independently of website permissions.

If TEST has optional Access protection, use
[browser email-code login](DEPLOYMENT.md#optional-browser-access-email-code-on-ipad-safari).
Unprotected TEST opens directly. Do not inject service-token secrets into Safari or app code.

Record **app version, `release.json` tag/SHA, model/iPadOS, browser, system dwell settings,
orientation and results** before a later merge replaces TEST. TEST and PROD browser storage are
independent.

## Supervised acceptance checklist

Use non-sensitive phrases. Stop if selections are wrong; keep another communication method
available. No face images or recordings are needed for testing.

- [ ] Four speaking targets and catalogue/caregiver controls fit in portrait and landscape,
      including reduced Safari viewport height and 100-character phrases.
- [ ] Sound test and all touch phrases work; check actual pt-PT accent, volume and missing-voice
      errors.
- [ ] Native Eye Tracking activates each speaking button at least ten times. Record intended
      selections, successes, misses, wrong selections and latency.
- [ ] Prolonged fixation and repeated system activations do not cause unacceptable repeated speech.
      Check both during speech and after speech finishes; the busy guard is not a gaze repeat lock.
- [ ] Catalogue has four choices/page; first/last navigation disables correctly.
- [ ] Navigate, select and replace phrases with native input; reload and confirm persistence.
- [ ] Caregiver additions persist; empty/duplicate/overlong input is rejected and text is literal.
      The caregiver manages system tracking if needed during writing.
- [ ] Backgrounding/leaving stops speech; returning preserves saved phrases. Check speech
      authorization again.
- [ ] Rotation, scrolling and interrupted system tracking remain usable; follow Apple's
      recalibration guidance when needed.
- [ ] Supervise a 15-minute session; record drift, misses, wrong selections, latency, heat and
      battery use.

No physical iPad acceptance has been established by automated tests. Native tracking is not clinical
validation or proof of ongoing reliability.

## Testing together

Share the version/tag/SHA, steps, system settings and observed outcomes, without sensitive phrases
or face images. There is no app diagnostic collection or cloud report storage.

The assistant can inspect a shared desktop browser but cannot remotely control your iPad. Desktop
checks validate layout and ordinary clicks, not physical iPad Eye Tracking or camera behavior.
