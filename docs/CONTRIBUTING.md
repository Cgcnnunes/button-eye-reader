# Contributor and AI rules

Read [ARCHITECTURE.md](ARCHITECTURE.md), [TESTING.md](TESTING.md) and [RELEASES.md](RELEASES.md)
before changing behavior. The same rules apply to humans and AI agents.

## Work only through feature PRs

1. Start from clean, up-to-date `main`. Run `npm run branch:new`. It fetches main and tags,
   fast-forwards local main, then creates `reader-00001`, `reader-00002`, etc. It updates
   `.reader-sequence.json`; include that change in the PR. Branch and commit counters are
   independent. Keep active branch refs until merged so concurrent branch allocations are not
   reused.
2. Implement a complete, surgical change with regression tests and meaningful documentation. Never
   push implementation commits directly to main.
3. Choose major, minor or patch and run `npm run release:prepare -- patch` (substitute the selected
   kind). Update the changelog and relevant docs.
4. Run `npm run verify`, stage the intended files, and run `npm run commit:next`.
5. Commit with the returned number:

   ```sh
   git commit -m "feat(reader-00001): add phrase board"
   ```

   Allowed types: **feat, chore, refactor, fix, doc** (not `docs`). The description starts with an
   ASCII lowercase letter. The **whole subject** is at most 120 characters, without a trailing
   wrapper parenthesis. Five-digit IDs increase by one from valid committed subjects on the current
   branch. Do not skip IDs, reuse them on the same history, or bypass hooks.

6. Push the feature branch and create a PR to main using the repository template. Exactly one of the
   major/minor/patch checkboxes must be selected. The PR title uses the **first** new commit ID
   relative to main, because it becomes the squash commit. Additional feature commits use subsequent
   IDs.
7. Require green CI, review and an up-to-date branch. Update/rebase against main and renumber
   feature messages when main has advanced. Do not amend/rebase published work without explicit
   coordination; force-push only your own feature branch with permission and `--force-with-lease`.
8. **Squash merge only**, with the squash subject exactly equal to the PR title. No merge
   commits/rebase merges on main. Squashing frees intermediate feature IDs: the next main commit
   follows the last squash ID, not discarded feature IDs. The release workflow checks this policy
   and creates an immutable `vX.Y.Z` tag only after successful TEST deployment. The GitHub release
   remains prerelease until manually promoted to PROD with that tag; see
   [DEPLOYMENT.md](DEPLOYMENT.md).

Legacy `Initial commit` is the sole bootstrap history exception. Existing commits and private
tooling checkpoint refs are not rewritten. The initial implementation and safeguards are delivered
in the first feature PR.

## Mandatory documentation on every commit

Each new feature commit must stage an actual addition/modification to at least one: `README.md`,
`CHANGELOG.md`, `docs/**/*.md` or `.github/copilot-instructions.md`. The pre-commit hook checks the
staged diff; PR CI checks **every** feature commit. Deleting a doc or ticking a PR checkbox does not
satisfy the rule. Enforcement can check that a doc changed, not whether the explanation is
meaningful: review must confirm accuracy. Update directly affected architecture, commands, behavior
and tests; do not add unrelated filler to satisfy the hook.

## Code style and safety

- Strict, type-aware ESLint, zero warnings. No explicit `any`, unsafe typed access, non-null
  assertions, floating promises or unhandled async event callbacks.
- Explicit return annotations on named functions/methods and assigned helpers. Inline/contextually
  typed callbacks may use the receiving API's return type.
- Single quotes, semicolons, two spaces, trailing commas and LF; Prettier owns formatting. ESLint
  owns semantic sorting and statement separation.
- Blank lines between executable statements/blocks. Adjacent imports, exports and related variable
  declarations are grouped; object/type members do not need blank lines. Run fixers rather than
  hand-maintaining layout.
- Static imports, exports, object keys and interface/type members are alphabetical. Preserve arrays,
  workflow steps and side-effect ordering.
- `no-unnecessary-condition` is intentionally not enforced: DOM declarations and indexed array types
  cannot prove actual camera capabilities, received landmarks or existence of runtime data. Keep
  those defensive checks. Numeric interpolation is allowed, but object/unknown interpolation is not.
- Runtime guards and `unknown` for external/JSON data; never use `as any`, double casts or broad
  catch-and-default behavior. Errors must be visible.
- Do not change communication/gaze thresholds, number of targets, storage schema, language or voice
  policy without updating boundary tests and documentation.

## Hooks, CI and review

`npm ci` installs Husky. Pre-commit order:

1. Confirm a feature branch and **staged documentation**.
2. `lint-staged`: ESLint auto-fix, then Prettier on staged source; Prettier on staged
   CSS/HTML/JSON/Markdown/YAML. It manages partially staged files.
3. Type-check, then the full regression suite with coverage.

Commit-msg runs Commitlint's exact format and sequence rules. The expensive checks run only after
cheap failures are caught. Review the resulting staged diff after fixers; hooks test the current
worktree, while CI validates committed content.

CI uses a read-only token, checks branch/title/all commit docs/sequence/version, then runs
formatting, lint, coverage and production build. Local hooks are bypassable Git safeguards, **not**
a replacement for server-side branch protection. Never treat a passing build as proof of
eye-tracking accuracy.
