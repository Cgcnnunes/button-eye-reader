# PRs, versions and deployment

## Repository setup (owner action)

1. In GitHub **Settings → Branches / Default branch**, choose `main`. A main branch has been pushed.
   Confirm the setting before deleting the old remote `master`; GitHub will not allow deleting its
   current default branch.
2. In **Settings → General → Pull Requests**, enable **squash merging only**. Set the default squash
   subject to the PR title. Disable merge commits and rebase merging. Keep documentation/PR context
   in the body.
3. Protect main using a ruleset: require a PR, required `Validate / validate` status check,
   up-to-date branches, linear history, no force pushes/deletion, and approval as desired. Configure
   rules so admins do not accidentally bypass.
4. Permit the merged-PR `Release` workflow's contents-write token and tag creation. Optionally
   protect release tags against modification/deletion while allowing the workflow to create new
   ones.
5. Configure Cloudflare Workers Builds on **main**, not master, with build command
   `npm ci && npm run verify` and deploy command `npx wrangler deploy`. Worker name must match
   `wrangler.jsonc`; Node must satisfy `.nvmrc`.

Branch settings/merge permissions are server-side configuration, not something installing Husky or
committing YAML can enforce on its own.

## Version workflow

Versions use **only `vX.Y.Z`** tags. One application/repository version comes from `package.json`;
the lockfile root mirrors it and Vite exposes it in the footer. Never hardcode another release
number in runtime code.

The first merged implementation releases **v0.1.0** (bootstrap, select minor). After that, the
checked PR kind controls:

| Checkbox | Example from 1.2.3 | Meaning                                               |
| -------- | ------------------ | ----------------------------------------------------- |
| major    | 2.0.0              | Breaking behavior, data/API contract or compatibility |
| minor    | 1.3.0              | Backward-compatible capability                        |
| patch    | 1.2.4              | Backward-compatible fix, docs or tooling maintenance  |

Before committing, run `npm run release:prepare -- minor` (or major/patch). It fetches tags and
updates both manifests; update `CHANGELOG.md` and other relevant documentation in the **same**
feature commit. Use one selected checkbox in the standard PR template. Changing it afterwards may
require preparing the version again. CI rejects disagreement between the checkbox and package
version.

Require current main before squash merging. Concurrent PRs must refresh their commit IDs/version
after another PR merges/releases. If the previous release workflow has not finished, wait; do not
invent a version or overwrite a tag.

## Automatic release after merge

The `Release` workflow handles a **merged PR to main**, checks out its merge SHA, runs full
verification, then:

- verifies a one-parent squash commit whose subject exactly equals the PR title;
- checks documentation changed and the selected semantic version;
- creates an annotated immutable tag and a GitHub release with the PR summary;
- refuses to move an existing tag to another commit;
- permits retries when the tag/release already exists at that exact commit.

It does not create a second version-bump commit or push code directly to main. Tags are historical
release markers; Cloudflare deployment is triggered by the main update and carries the manifest's
version, not by the release tag. The workflow does not merge PRs. An authorized owner/developer must
review and squash merge only after green checks. If tagging succeeds but GitHub release creation
fails, fix permissions and rerun the same workflow; do not delete the tag.

The first PR introduces the release workflow itself. GitHub must load it from main after merge; if
GitHub does not trigger it for that bootstrap merge, rerun/re-dispatch the merged-PR workflow only
after confirming its event/merge SHA, rather than creating an unverified manual release.

## Small PR template

Use the repository template unchanged: short summary, exactly one release kind,
verification/documentation/manual-test checkboxes. Include device limitations instead of claiming
physical iPad validation from simulated tests.
