# Testing

**PC/simulated tests do not establish physical iPad Eye Tracking accuracy.** Test the intended iPad,
user, mounting position and lighting before relying on this experimental prototype.

## Commands

Use Node.js **22.22.2+** (see `.nvmrc`). `npm ci` installs dependencies and hooks.

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

Tests cover signed Access identity validation and cloud persistence, phrase validation/ordering,
speech errors and busy guards, standard button activation, caregiver-labelled writing, UI flow and
release/deployment policy. Regressions check that app camera, custom tracking and report
infrastructure are absent. Each included file requires **90% statements/lines/functions and 80%
branches**. Do not lower gates; the ignored HTML report is `coverage/index.html`.

Worker database tests initialize real Miniflare D1 directly from `0001_user_preferences.sql`. They
check the exact application table/columns, required fields, default revision, primary-key uniqueness
and nonnegative revisions. Reapplying the baseline preserves an existing board/revision. Retired
application tables and migrations are not used to initialize test databases. An existing remote
schema must be compared with the baseline before deployment; `IF NOT EXISTS` alone cannot detect a
mismatched table.

Worker logging regressions verify one Info per API success, Warn for rejected requests/conflicts,
Error for configuration/infrastructure/asset server failures, and no successful-asset noise. Exact
structured-field assertions and private input markers check that identities, bodies, headers, raw
paths/query strings and exception messages are not emitted. Packaging tests guard persistent custom
logs, query redaction and disabled invocation logs/traces. These tests cover application fields and
configuration, not Cloudflare's attached metadata, live retention or Access dashboard policy.

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
   follow the system's positioning guidance.
4. Adjust system pointer/dwell options to the user's needs. The website uses standard button
   activation without adding its own dwell timer or calibration.
5. Open HTTPS TEST in Safari. Have a caregiver test sound by touch first, then test standard button
   activation using native Eye Tracking.

The website cannot read gaze coordinates, verify eye accuracy, control system settings or disable
native tracking in the caregiver form. No app-camera permission is necessary: system Eye Tracking
uses the camera independently of website permissions.

TEST and PROD require Cloudflare Access login. Follow [DEPLOYMENT.md](DEPLOYMENT.md), use an allowed
caregiver email and complete the email-code login. Do not inject service-token secrets into Safari
or app code.

Record **app version, `release.json` tag/SHA, model/iPadOS, browser, system dwell settings,
orientation and results** before a later merge replaces TEST. TEST and PROD accounts/data are
independent.

## Supervised acceptance checklist

Use non-sensitive phrases. Stop if selections are wrong; keep another communication method
available. No face images or recordings are needed for testing.

Real Access email-code login, long-session behavior and logout must be tested on configured HTTPS
TEST before PROD promotion; mocked browser identities are UI evidence only.

- [ ] Four speaking targets and catalogue/caregiver controls fit in portrait and landscape,
      including reduced Safari viewport height and 100-character phrases.
- [ ] Tablet targets have height-adaptive gaps; the bottom-left caregiver toggle opens a full-width
      panel with labelled sound, add-phrase and Eye Tracking help. The initial speech prompt is
      empty. Navigation, writing and return to the board still work; helpers do not overlap long
      status/error text.
- [ ] Panel close/Escape restores focus, navigation closes it, and help shows "Ajustes ->
      Acessibilidade -> Rastreamento dos Olhos" without claiming to toggle native tracking.
- [ ] Guidance is at the top with no logo; speaking buttons show only centered phrase text. The
      board catalogue button has larger text, and experimental status is beside the footer version.
      The board catalogue button adapts from 72px to 96px.
- [ ] New cloud boards start with yes/no/bathroom/pain and the prescribed first twelve templates.
      Caregiver-selected order is not reset on login.
- [ ] Allow a caregiver email in TEST Access, complete login and load the board. The home logo is
      absent on the board. An unallowed email and an expired/forged token cannot read or write
      preferences; automation tokens cannot act as caregivers.
- [ ] Reorder speaking positions and catalogue independently; add at the start/middle/end. Reload
      and sign in on another browser to confirm exactly the last saved order/assignments.
- [ ] Simultaneous saves from two browsers reject the stale revision without overwriting either
      silently. Offline/server errors do not claim a successful save. Logout routes through Access,
      stops speech and clears the displayed board. Account A cannot access account B's board.
- [ ] Refresh after Access application-token renewal and verify saves still work. Removing an
      allowed user/revoking their Access sessions prevents subsequent login; existing JWTs may
      remain valid until Access enforces revocation/expiry. Confirm configured duration on-device.
- [ ] The current D1 baseline preserves existing Access boards/revisions and migration records.
      Verify the resulting schema against the current storage model and follow baseline adoption in
      [DEPLOYMENT.md](DEPLOYMENT.md#4-back-up-and-migrate-d1-with-a-maintenance-window).
- [ ] Sound test and all touch phrases work; check actual pt-PT accent, volume and missing-voice
      errors.
- [ ] Native Eye Tracking activates each speaking button at least ten times. Record intended
      selections, successes, misses, wrong selections and latency.
- [ ] Prolonged fixation and repeated system activations do not cause unacceptable repeated speech.
      Check both during speech and after speech finishes; the busy guard is not a gaze repeat lock.
- [ ] Catalogue has four choices/page; first/last navigation disables correctly.
- [ ] Saved-phrase navigation shows large left/right arrows and a highlighted current-page label;
      labels update on navigation and arrow decorations do not change accessible button names.
- [ ] Pagination arrows and text share a vertical center; previous/next use a distinct blue while
      the return control keeps its original color.
- [ ] Navigate, select and replace phrases with native input; reload and confirm persistence.
- [ ] Replacement shows four tinted targets with dashed borders and only centered phrase text. The
      header identifies the chosen phrase; cancel leaves the board unchanged. Only a successful save
      highlights the updated position in green; a failed save keeps the replacement choices.
- [ ] Touch, keyboard and ordinary click activation give brief color feedback without moving targets
      or delaying speech/navigation. Reduced-motion mode removes animation while retaining pressed
      colors and visible keyboard focus.
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

### Viewport-fit checks

The iPad (A16) display is 1640×2360 physical pixels
([Apple specifications](https://www.apple.com/ipad-11/specs/)). Desktop browser checks use nominal
820×1180 / 1180×820 CSS viewports and reduced Safari-height scenarios, not a physical-device result.

Check board, catalogue, replacement and writing at 820×1180, 820×1000, 1180×820, 1180×650, 1180×550,
768×900 and 1024×600. Require no horizontal/vertical page overflow, no button/input text clipping,
and all controls/status/footer bounds inside the viewport. Include the Access entry/error screen,
caregiver ordering and the expanded six-option panel. Repeat with 100-character phrases and
simultaneous speech/error feedback. Use mocked API sessions for isolated layout checks; test real
Access login and persistence separately on HTTPS TEST. Mocked identities do not establish
authentication or physical-device acceptance. Native dropdown expansion and the on-screen keyboard
need device testing.

On the actual iPad, repeat with Safari toolbars shown/hidden and after rotation. Software keyboard,
Split View and enlarged text/zoom alter available space and need separate physical acceptance; do
not claim that desktop tests establish those conditions or all possible content lengths.

Check replacement labels are centered on both axes with dashed borders, including 100-character
phrases. Confirm successful-save highlighting, click-animation cleanup, stationary targets and
zero-duration feedback in reduced-motion mode. Record the version/tag/SHA with results; rerun these
checks when the UI changes.

Measure all four speaking targets before, during and after speech feedback. Their x/y/width/height
must remain identical when status and error text appears or clears. Feedback replaces the helper
sentence beside the caregiver footer toggle, including while its panel is open. The header retains
its question/hint layout. Long notices must remain readable by scrolling in the fixed-height region,
including keyboard focus, without resizing targets or overlapping controls.

## Testing together

Share the version/tag/SHA, steps, system settings and observed outcomes, without sensitive phrases
or face images. Browser/device telemetry is not uploaded; minimal Worker operational logs are
described in [DEPLOYMENT.md](DEPLOYMENT.md#operational-logs-and-privacy).

The assistant can inspect a shared desktop browser but cannot remotely control your iPad. Desktop
checks validate layout and ordinary clicks, not physical iPad Eye Tracking or camera behavior.
