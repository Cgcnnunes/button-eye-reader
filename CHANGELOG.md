# Changelog

## 0.2.0

- Separate TEST Worker deployment after validated squash merges; same-tag GitHub prereleases with
  generated release notes only after public deployment checks.
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
