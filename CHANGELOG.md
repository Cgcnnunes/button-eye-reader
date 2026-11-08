# Changelog

## 0.2.2

- Deploy TEST on protected `main` pushes and promote PROD by dispatching the exact tested release
  tag.

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
