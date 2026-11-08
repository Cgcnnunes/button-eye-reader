# PRs, versions and deployment

## Repository setup (owner action)

1. In GitHub **Settings → Branches / Default branch**, choose `main` and confirm it exists remotely.
2. In **Settings → General → Pull Requests**, enable **squash merging only**. Set the default squash
   subject to the PR title. Disable merge commits and rebase merging. Keep documentation/PR context
   in the body.
3. Protect main using a ruleset: require a PR, the `validate` check from **Execute PR Validation**,
   up-to-date branches, linear history, no force pushes/deletion, and approval as desired. Configure
   rules so admins do not accidentally bypass.
4. Permit `Deploy to TEST` to create tags/prereleases and protected `Deploy to PROD` to update
   releases. Optionally protect release tags against modification/deletion while allowing the
   workflow to create new ones.
5. Follow [DEPLOYMENT.md](DEPLOYMENT.md): create TEST and PROD Workers from scratch without Workers
   Builds and GitHub `test`/`production` environments with scoped secrets, correct URLs and the
   `production` tag restriction. Configure required reviewers if GitHub offers that setting; do not
   assume a reviewer gate exists if it is unavailable.

Branch settings/merge permissions are server-side configuration, not something installing Husky or
committing YAML can enforce on its own.

## Version workflow

Versions use **only `vX.Y.Z`** tags, first as GitHub prereleases, then stable on PROD promotion.
There is no `-rc` tag or second tag on promotion. One application/repository version comes from
`package.json`; the lockfile root mirrors it and Vite exposes it in the footer. Never hardcode
another release number in runtime code.

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
after another PR merges/releases. Existing prerelease tags also consume version numbers; do not
reuse them just because they have not reached PROD. If the previous TEST workflow has not finished,
wait; do not invent a version or overwrite a tag.

## Automatic TEST prerelease after main push

`execute-pr-validation.yml` runs only for PRs targeting main and cancels older runs of that PR after
a new push. PR validation and TEST each run `npm ci` and `npm run verify` independently; PR policy
and merged-release policy remain specific to their respective workflows. The shared verification
command avoids duplicating the check sequence; no additional reusable workflow is needed. Each
deployment workflow serializes its own environment with `queue: max` and no cancellation of active
runs. Up to 100 runs wait; excess runs are canceled. TEST and PROD have independent queues. Queue
order follows entry into the concurrency group, not guaranteed merge/dispatch order.

`deploy-to-test.yml` handles pushes to `main`, checks out the pushed SHA, and runs full verification
independently of PR validation. For release policy and provenance, it uses GitHub's commit-to-PR API
to identify the unique merged same-repository PR for that squash commit, then:

- verifies a one-parent squash commit whose subject equals the PR title, optionally followed by
  GitHub's exact ` (#<PR-number>)` suffix; other title changes are rejected;
- checks documentation changed and the selected semantic version;
- deploys only `button-eye-reader-test` and verifies assets, marker and headers, using the TEST
  service token when Access is configured; PROD smoke checks remain unauthenticated;
- stores the exact static build as an immutable Actions artifact with 90-day retention;
- creates an annotated immutable tag and a GitHub prerelease with automatically generated notes
  based on the previous stable production release, plus TEST URL and provenance;
- adds a short workflow summary naming the TEST prerelease and its URL;
- refuses to move an existing tag to another commit;
- permits retries at that exact commit while the release is still a prerelease; a stable release
  cannot be retested or mutated by this workflow.

It does not create a second version-bump commit or push code directly to main. Tags are historical
release markers. Pushing to main changes TEST only, not PROD. Protect main with required PRs and
checks before enabling the workflow on a public repository; any push to main triggers TEST. The
workflow does not merge PRs. An authorized owner/developer must review and squash merge only after
green checks. If tagging succeeds but GitHub release creation fails, fix permissions and rerun the
same workflow; do not delete the tag.

## Manual PROD promotion

Run `deploy-to-prod.yml` through **Actions → Deploy to PROD → Run workflow** and select the exact
`vX.Y.Z` TEST prerelease in **Use workflow from**. The workflow rejects branch refs; its selected
tag is also the release being promoted, so a separate tag input is unnecessary. The checkbox
`test_approved` was only a self-attestation and could not prove that testing happened, so it is
removed.

The tag-ref flow requires the selected tag to contain this version of `deploy-to-prod.yml`; older
prereleases retain the workflow definition that was present when they were created.

The workflow requires the selected ref to be an annotated `vX.Y.Z` tag that is an ancestor of main,
matching manifest versions and TEST provenance, the exact successful TEST attempt including its code
verification, and an unexpired artifact with its original ID/digest. It blocks stable releases and
downgrades. The `production` environment should be restricted to `v*`; this repository currently has
that rule, but GitHub does not expose a required-reviewer control in its settings. Thus a validly
dispatched tag can proceed after automated validation without a second-person approval. When
required reviewers are available and configured, they provide an independent human gate and the
workflow repeats validation after approval. Otherwise, only users with write access can dispatch,
and testing the exact tag/SHA before dispatch remains an operational requirement, not an enforced
approval. The workflow downloads and hashes the exact original ZIP, deploys the tested static files
without a build, and only after PROD smoke tests marks that same release stable/latest. Generated
notes and the tag SHA are retained.

Human acceptance must identify the tested tag/SHA before TEST is overwritten by a later main push.
Dispatch and automated validation do not prove iPad acceptance.

If Cloudflare succeeds but smoke tests or release promotion fail, PROD may already be updated.
Investigate and retry while the release is still prerelease; no automatic rollback is promised.
Artifacts expire after 90 days: rerun TEST and repeat acceptance, never silently rebuild for PROD.
Only releases with successful TEST provenance are eligible; deleting Workers does not reset tags.

## Small PR template

Use the repository template unchanged: short summary, exactly one release kind,
verification/documentation/manual-test checkboxes. Include device limitations instead of claiming
physical iPad validation from simulated tests.
