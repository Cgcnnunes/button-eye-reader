# Repository instructions

- Keep repository code, comments, documentation and tooling messages in English. Use pt-PT only for
  user-facing site content and localized test fixtures. Describe site controls in English in docs.
- Read [contribution rules](../docs/CONTRIBUTING.md), [architecture](../docs/ARCHITECTURE.md),
  [testing](../docs/TESTING.md) and [releases](../docs/RELEASES.md) before changing code.
- Work on an incrementing `reader-00001` feature branch; never push implementation commits directly
  to main. Use `npm run branch:new` and commit its sequence ledger.
- Every commit must include meaningful documentation and tests for behavior shifts. Get the next
  commit ID using `npm run commit:next`; only feat/chore/refactor/fix/doc, lowercase description,
  exact five-digit scope and at most 120 subject characters.
- Run `npm run lint:fix`, `npm run format`, then `npm run verify`. Do not disable hooks, use
  any/non-null assertions, lower coverage gates or bypass required CI.
- PR to main using the standard template, exactly one major/minor/patch choice, and a matching
  prepared package version. Squash subject must equal the validated PR title. Never amend/rewrite
  published work or force-push without approval.
- Preserve four speaking targets, pt-PT, standard accessible button activation, speech busy guards
  and the caregiver-only writing workflow. Apple manages Eye Tracking; do not add app camera
  capture, gaze calibration or dwell logic. The app cannot disable system tracking in the writing
  area.
- Simulated/PC button tests do not establish physical iPad eye-tracking accuracy. Report remaining
  device limitations honestly; never collect face images for tests.
