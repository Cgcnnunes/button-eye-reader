# Changelog

## 0.5.1

- Document the complete new-user workflow and distinguish optional Access email permission from
  application invitations.
- Submit invitation/reset SQL as inline D1 queries instead of file imports, preserving structured
  JSON confirmation and returned account IDs; explain recovery after an ambiguous issuance error.

## 0.5.0

- Bind the provisioned, separate TEST/PROD D1 databases so deployment migrations use real database
  IDs; document why local configuration changes must be committed before CI deployment.
- Add invitation-only custom accounts and administrator-issued one-use password setup/recovery, with
  remembered sessions and explicit logout.
- Store each account's phrases, catalogue order and four speaking positions in separate TEST/PROD
  Cloudflare D1 databases; new accounts use defaults without importing browser-local phrases.
- Restore the eye/speech logo on the logged-out home only. Keep the four-target board unbranded.
- Add caregiver-only ordering controls and insertion positions for new phrases; acknowledge saves
  after persistence and reject conflicting revisions instead of overwriting another session.
- Document database provisioning, migrations, administrator setup/recovery and deployment
  prerequisites; physical iPad and live Cloudflare acceptance remain required.

## 0.4.1

- Prioritize the catalogue's first twelve phrases as requested, add thirst and retire four
  templates. Apply the same ordering to saved catalogues while preserving custom text; retired
  default assignments fall back to the corresponding starting slot.
- Use vertically centered vector pagination arrows and a distinct blue for previous/next controls.
- Clarify saved-phrase navigation, add large directional pagination arrows and highlight the current
  catalogue page.
- Remove catalogue action subtitles so phrase text remains centered without extra labels.
- Fit all tablet screens to dynamic viewport height with adaptive target text, spacing and form
  sizing; remove overflow hiding and validate A16-sized portrait/landscape and shorter viewports.
- Increase separation between speaking targets and navigation for native Eye Tracking.
- Add a bottom-left caregiver toggle and expanding labelled panel for sound, phrase entry and system
  Eye Tracking help; support close/Escape focus restoration without pretending to toggle tracking.
- Remove the initial speech-status prompt while preserving speech feedback and errors.
- Remove the text brand/logo, center speaking text without action subtitles, move experimental
  status next to the footer version and raise the board catalogue button to at least 96px.
- Start with yes/no/bathroom/pain phrases, add the pain phrase to the catalogue and upgrade
  recognized old bottom defaults without overwriting customized selections or dropping phrases.

## 0.4.0

- Replace app-managed camera tracking, calibration and dwell with standard button activation for
  Apple's built-in iPad Eye Tracking; retain touch, four speaking targets and pt-PT speech.
- Remove the custom tracking header/debug marker, MediaPipe models/dependency, camera controls and
  related deployment checks. Deny website camera access and remove unused WASM/blob allowances.
- Remove the unshipped calibration-report feature, private R2 bindings, report authentication and
  cleanup schedules; preserve optional TEST Access authentication.
- Document native setup, caregiver writing limitations and supervised physical-device acceptance.

## 0.3.3

- Simplify setup, architecture, testing and release guides with diagrams and tables.
- Update Cloudflare navigation and explain optional browser and automated TEST access policies.

## 0.3.2

- Enable eye/iris markers and per-target validation diagnostics in TEST and temporarily in PROD
  without a request header.

## 0.3.1

- Add opt-in production eye/iris markers and per-target validation diagnostics, enabled only by
  `x-test-production: true` on the initial HTML request.

## 0.3.0

- Add full-screen camera calibration with face-position guidance, eye-follow targets and a caregiver
  face-size reference control.

## 0.2.4

- Fit the communication board and its controls in shorter iPad landscape viewports without clipping
  the displayed phrases.

## 0.2.3

- Clarify that production reviewer approval is conditional on GitHub settings availability and
  configuration, document the current tag-only environment restriction, and explain how to recover
  from a PROD URL mismatch after deployment.
- Name the production Worker `button-eye-reader-prod` to match the configured PROD URL.
- Clarify that pushes to `main` start TEST, but only eligible commits pass release checks and
  deploy.

## 0.2.2

- Start TEST on pushes to `main`, validate merged-PR release provenance before deployment, and
  promote PROD by dispatching the exact tested release tag.

## 0.2.1

- Make Cloudflare Access optional for TEST; send service-token headers only when both secrets are
  configured, and document the Service Auth policy setup.

## 0.2.0

- Authenticate protected TEST smoke checks with a Cloudflare Access service token without exposing
  credentials to builds or PROD, and report rejected requests without following redirects.
- Document all deployment settings, human/service Access policies and the merged-PR TEST environment
  branch rule.
- Accept GitHub's exact squash PR-number suffix, correctly link feature-run provenance to the
  deployed squash commit, and update action runtimes with a pinned Ubuntu runner.
- Keep PR validation scoped to PRs and independently verify merged code inside TEST deployment.
- Remove polling of a separate main validation run from TEST release and PROD promotion.
- Preserve successful TEST provenance checks, exact artifact promotion and all three workflows.

- Superseded PR validation cancellation and separate TEST/PROD deployment queues with up to 100
  waiting runs per environment.
- Separate TEST Worker deployment after validated squash merges; same-tag GitHub prereleases with
  generated release notes only after authenticated TEST deployment checks.
- Manual tag-only PROD workflow with successful-run provenance, artifact identity/expiry/checksum
  validation, approval support, exact tested static assets and stable release promotion.
- Explicit Worker environments and safer local TEST deployment command.
- Deployment regression tests and clean-start instructions for TEST/PROD Workers, tokens, GitHub
  environments and manual promotion without Workers Builds.

## 0.1.0

Initial experimental iPad-first pt-PT communication board.

- Four configurable speaking buttons, a gaze-accessible local catalogue and caregiver-only phrase
  entry.
- Local camera/iris processing, calibrated gaze verification, two-second dwell, repeat prevention,
  visible capture/voice/storage errors and touch fallback.
- Strict TypeScript linting/sorting/spacing, Prettier, typed tooling, Husky and sequential
  Commitlint rules.
- Regression/coverage gates, feature PR policy, mandatory documentation on every commit and
  checkbox-driven semantic release tags.
- Cloudflare static deployment and developer/AI/manual-device testing documentation.

Physical iPad eye accuracy, Safari voice accent/permissions and long-session performance require
accompanied manual acceptance testing before relying on the app.
