# Repository instructions

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
- Preserve four speaking targets, pt-PT, local camera processing, gaze repeat locks, independent
  calibration verification and the caregiver-only writing boundary.
- Simulated/PC camera tests do not establish physical iPad eye-tracking accuracy. Report remaining
  device limitations honestly; never collect face images for tests.
