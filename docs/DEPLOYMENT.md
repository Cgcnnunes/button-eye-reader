# Deployment with Cloudflare and GitHub

Guide for developers and AI agents: **GitHub Actions deploys Workers Static Assets to two
independent Workers**. It includes a clean-start procedure for accounts without existing Workers;
inspect existing Workers before applying those steps. Workers Builds is not used; Cloudflare
Pipelines is a data-ingestion product and is not used.

- Push to `main` starts the TEST workflow. Only a commit that passes verification and merged-PR
  release checks -> TEST Worker -> smoke tests -> artifact -> `vX.Y.Z` tag and GitHub
  **prerelease**, with notes generated since the previous stable release.
- Dispatch **Deploy to PROD** from that tag -> provenance validation -> (if configured) environment
  reviewer approval -> download the same artifact -> PROD Worker -> smoke tests -> make the same
  release stable.

Pushes, merges and tag creation do not deploy PROD. A valid PROD deployment requires an explicit
workflow dispatch by someone with write access. A separate reviewer approval is enforced only if
GitHub offers and the `production` environment has that protection rule configured. Every push to
`main` starts the TEST workflow, but commits that fail its release checks do not deploy. Protect
`main` with required PRs and checks before making the repository public. The site is not rebuilt for
PROD.

## 1. Prerequisites

- Push the project to GitHub, including `package-lock.json` and `wrangler.jsonc`. Do not push
  `node_modules`, `dist`, generated models, tokens or credentials.
- Confirm on GitHub that **`main` exists remotely, contains the app and is the default branch**. Do
  not use a temporary branch as the workflow source.
- Sign in to Cloudflare and select the account that will contain both Workers.
- Install Node compatible with `.nvmrc` and `package.json`; run `npm ci` and `npm run verify`. Do
  not disable tests, lint, hooks or asset checks to work around failures.

## 2. Create both Workers from scratch

Create the Workers **before merging the workflow PR** so their URLs and credentials can be
configured:

1. Open Cloudflare **Workers & Pages -> Create application**.
2. Choose the Worker starter/Hello World option, not GitHub/Git integration and not Pages. Menu
   wording can vary; use the flow that creates a Worker without connecting a repository.
3. Set the name to **`button-eye-reader-test`** and deploy the starter.
4. Open its settings and confirm its public `workers.dev` route is enabled. If Cloudflare asks for
   an account subdomain, choose it first; both Workers use that account subdomain.
5. Copy the complete TEST HTTPS URL from the dashboard. Open it and confirm the starter responds.
6. Repeat steps 1-5 with name **`button-eye-reader-prod`** for PROD, and copy its own HTTPS URL.
7. Reload each Worker's settings and confirm the exact names, enabled URLs and absence of any GitHub
   Workers Builds connection or deployment hooks.

For a new setup, the initial contents of **both** Workers are placeholders, not the communication
app. A successful eligible main-push workflow replaces TEST's starter. PROD keeps its starter until
you test a prerelease and explicitly dispatch PROD promotion. Existing deployments may already
contain other content; inspect each Worker before proceeding.

Expected URLs for this repository:

```text
TEST: https://button-eye-reader-test.cgcnnunes.workers.dev
PROD: https://button-eye-reader-prod.cgcnnunes.workers.dev
```

Copy actual URLs from the dashboard instead of guessing or reusing a previously deleted Worker's
URL.

- Cloudflare Access protection for TEST is optional; keep PROD publicly accessible without Access.
  If TEST is protected, configure the service-token settings below. Do not use confidential test
  phrases.
- Confirm names in `wrangler.jsonc`: `env.test.name` is `button-eye-reader-test`;
  `env.production.name` is `button-eye-reader-prod`. The production Worker's name must match the
  PROD `DEPLOYMENT_URL` hostname. `workers_dev: true` and `preview_urls: false` are explicit; TEST
  uses a stable address rather than a version-specific Preview URL.
- Confirm that `assets.directory` matches the build output (`./dist` in this project).
- `wrangler.jsonc` routes `/` and `/index.html` through `src/worker.ts` before serving the `ASSETS`
  binding unchanged. The shipped HTML enables eye diagnostics without a request header in TEST and,
  temporarily, in PROD. These diagnostics are not authentication and do not protect private content.
  Any future PROD-only disablement must keep diagnostics enabled in local and TEST environments and
  preserve promotion of the exact tested artifact.

For **another app**, also replace Worker names in `scripts/deployment-policy.ts` and its tests, not
just the Wrangler configuration. Do not copy tokens, account identifiers or this app's URLs. Future
resources such as databases and bindings need separate TEST/PROD configuration; separate Workers do
not automatically isolate shared resources.

## 3. Tokens and GitHub environments

### Token permissions

In Cloudflare **My Profile -> API Tokens -> Create Token -> Create Custom Token**, create a TEST
deployment token and a separate PROD deployment token. Give each a descriptive environment-specific
name and **Account -> Workers Scripts -> Edit**, with account resources set to **Include -> Specific
account -> your selected account**. Create the token and copy its value directly into the matching
GitHub environment secret; the value may only be shown once. This `workers.dev` site does not
require zone/domain editing permissions. If logs identify another required permission, add only that
permission. This is an account-level permission, not Worker-level isolation: separate tokens improve
management/revocation but do not inherently prevent one token from modifying another Worker in the
same account. Never expose PROD credentials to PR jobs.

The form may warn about missing permissions for AI, Containers, Browser Rendering, Email or Secrets
Store. **Do not broaden permissions just to remove that warning**: this static app does not use
those products. Change permissions only when deployment logs identify a necessary missing
permission, limited to the required service/account. Replace deleted, expired or rotated tokens in
the corresponding GitHub environment secrets.

Find the account identifier in the Cloudflare dashboard's account details (not a zone identifier).
Under GitHub repository **Settings -> Environments -> New environment**, create exactly **`test`**
and **`production`**. Open each environment, use **Add environment secret** for secrets and **Add
environment variable** for the URL. In **each environment**, configure:

- Secret **`CLOUDFLARE_ACCOUNT_ID`**: account identifier for the Workers.
- Secret **`CLOUDFLARE_API_TOKEN`**: that environment's token.
- Variable **`DEPLOYMENT_URL`**: the corresponding Worker's root HTTPS `workers.dev` URL, without a
  path, query or fragment. The workflow checks it against Wrangler's deployment URL.

Use **environment secrets**, not repository-wide PROD credentials. GitHub supplies `GITHUB_TOKEN`
automatically; do not create a PAT for these workflows.

For `test`, select **Deployment branches and tags -> Selected branches and tags** and allow the
**`main`** branch. For `production`, select **Selected branches and tags** and add a **tag** rule
with the pattern **`v*`**; do not add a branch rule. Verify the page lists the rule: selecting this
mode with no rules still allows all refs. This environment restriction complements, but does not
replace, the workflow's tag and provenance validation.

If GitHub offers **Environment protection rules -> Required reviewers**, add the intended reviewer
and enable **Prevent self-review** if available. Reviewer availability depends on repository
visibility and GitHub plan; for example, Free, Pro and Team offer required reviewers for public
repositories. If the setting is unavailable, the environment does **not** pause for human approval.
In this repository's current settings, `production` is restricted to the `v*` tag pattern, but no
required-reviewer control is available. Therefore, a valid, explicitly dispatched tag deployment may
proceed after automated validation without a second person approving it. Do not describe this setup
as requiring reviewer approval. Recheck this setting if repository visibility or plan changes.

The PROD workflow must be dispatched from an existing release tag; it rejects branch refs and uses
the selected tag as its release identifier. The manual dispatch checkbox was removed because it was
only a self-attestation, not verifiable evidence of testing.

Under **Settings -> Actions**, allow the workflows and actions used here. Jobs declare their
permissions: TEST needs `contents: write` and `actions: read`; PROD uses read permissions for
validation and write permissions only in the protected job that promotes the release. Allow the bot
to create tags/releases; protect tags against modification/deletion without blocking authorized
creation. Protect `main` with required PRs, squash-only merging and the `validate` check from
**Execute PR Validation** (`execute-pr-validation.yml`).

Node comes from `.nvmrc` through `actions/setup-node`; Workers Builds no longer needs
`NODE_VERSION`; do not configure a Cloudflare build command. TEST runs `npm ci` with lifecycle
scripts to prepare model/WASM. PROD intentionally runs `npm ci --ignore-scripts`: it installs
tooling and reuses TEST's `dist`, without rebuilding assets.

### Optional: protect TEST with Cloudflare Access

If you enable Access for TEST, make sure its application covers the TEST hostname and all paths. In
Cloudflare **Zero Trust -> Access controls -> Applications**, configure that application. Create a
token under **Access controls -> Service credentials -> Service Tokens**, then add a policy with
action **Service Auth** and **Include -> Service Token** selecting that token. An **Allow** policy
does not authorize service-token requests.

Store the token's Client ID and Client Secret as `CLOUDFLARE_ACCESS_CLIENT_ID` and
`CLOUDFLARE_ACCESS_CLIENT_SECRET` secrets in the GitHub **`test`** environment. The TEST smoke
checks send these headers when both secrets are set, and fail if only one is set. If TEST is not
protected with Access, leave both secrets unset. Keep PROD public; its smoke checks never send
Access credentials.

Required GitHub environment settings:

| Setting                           | Kind     | `test`                            | `production`                      |
| --------------------------------- | -------- | --------------------------------- | --------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`           | Secret   | Selected Cloudflare account ID    | Selected Cloudflare account ID    |
| `CLOUDFLARE_API_TOKEN`            | Secret   | TEST deployment API token         | PROD deployment API token         |
| `DEPLOYMENT_URL`                  | Variable | TEST root HTTPS `workers.dev` URL | PROD root HTTPS `workers.dev` URL |
| `CLOUDFLARE_ACCESS_CLIENT_ID`     | Secret   | Optional: Access service token ID | Not configured                    |
| `CLOUDFLARE_ACCESS_CLIENT_SECRET` | Secret   | Optional: Access service token    | Not configured                    |

The TEST workflow exposes Access secrets **only to its smoke-test step**, not installation,
validation or bundling. When configured, both headers are sent on every TEST smoke request,
including marker retries and model/WASM checks. Requests do not follow redirects, preventing
credentials from being forwarded to another hostname. No Access secrets belong in browser code,
static assets, release provenance or logs.

Creating or rotating secrets and policies requires owner action in GitHub/Cloudflare; committing the
workflow does not configure either provider. Local development does not need Access credentials.

Never share deployment tokens, Access client secrets, screenshots containing secrets or
deployment-hook URLs. Authenticate directly on GitHub/Cloudflare login pages, not through chat.

## 4. First merge and TEST acceptance

After creating both Workers and configuring deployment secrets, URLs and the `production` tag
restriction, squash-merge the workflow PR. The merge's push to `main` starts **Actions -> Deploy to
TEST** (`deploy-to-test.yml`). The workflow deploys only if verification and merged-PR release
checks pass. Confirm:

1. Checkout of the pushed `main` SHA and successful `npm run verify` inside the TEST workflow
   itself.
2. Deployment with `--env test`, with no PROD deployment.
3. TEST URL smoke tests: `release.json` with SHA/tag, exact HTML/model/WASM bytes, WASM MIME type
   and security headers. If TEST is protected by Access, confirm the service-token credentials work.
4. Artifact `tested-site-<run-id>-<attempt>`, retained for 90 days.
5. An immutable annotated `vX.Y.Z` tag and GitHub prerelease with automatically generated notes
   since the previous stable release, TEST link and run/artifact provenance. The workflow summary
   should identify the prerelease version and TEST URL.

Wait for the run to finish successfully, not just for the tag to appear. TEST has a stable URL:
later merges replace its content, but each prerelease retains its artifact. Test on the iPad and
record **tag, SHA and results** before the next merge; the marker identifies the current TEST
version. Do not approve an old tag based on a TEST Worker already serving a different tag.

Automated checks do not establish eye-tracking accuracy, pt-PT voice availability or human
acceptance. Use [TESTING.md](TESTING.md) with non-confidential test phrases.

## 5. Deploy PROD exclusively by tag

1. Open **Actions -> Deploy to PROD** (`deploy-to-prod.yml`) -> **Run workflow**.
2. Select the tested **`vX.Y.Z` tag** in **Use workflow from**. Do not select a branch. No separate
   tag input or `test_approved` checkbox is needed; the selected tag is the release identifier. The
   workflow rejects branch refs, SHAs, lightweight tags, stable releases and tags without
   provenance. GitHub's documented Run workflow selector is a Branch dropdown; if it does not offer
   tags in this repository, dispatch the workflow with a tag `ref` through GitHub CLI or API instead
   of selecting `main`.
3. The first job validates tag ancestry on main, manifest versions, prerelease status, the exact
   successful TEST attempt (including its code verification), and artifact ID/digest and validity.
   It also rejects versions equal to or below the latest stable release. A branch-selected dispatch
   may start a validation job, but it fails before reaching PROD.
4. If required reviewers are configured for `production`, the job waits for an eligible reviewer to
   approve; validation is repeated afterwards to detect changes during the wait. If this rule is
   unavailable or not configured, there is no approval pause and deployment proceeds after
   validation.
5. The job downloads the original ZIP, checks SHA-256 and the marker, deploys with
   `--env production` and checks the PROD URL. **It does not run Vite or recompile the site.**
6. Only afterwards does the same GitHub release become stable/latest. The tag remains unchanged.

### Workflow concurrency

`execute-pr-validation.yml` groups runs by PR number: a new push or other validation event for that
PR cancels its previous run. Different PRs remain independent. This workflow runs only for PRs
targeting main, not for pushes to main.

There are exactly three workflows. PR validation and TEST both install dependencies with `npm ci`
and run `npm run verify` (format, lint, coverage tests, type-check and build). PR validation also
runs `npm run repo:check` for PR policy; TEST checks the merged squash/release policy instead. TEST
does not wait for or query a separate PR/main validation run. The shared command already owns the
verification sequence, so a fourth reusable workflow is unnecessary for these few steps. PROD
verifies the successful TEST run and its artifact instead of rebuilding the tested site.

TEST and PROD each have their own concurrency group, `cancel-in-progress: false` and `queue: max`.
Only one run per environment executes at a time; up to 100 additional runs wait rather than replace
each other. Additional runs beyond that limit are canceled by GitHub. TEST and PROD can execute
simultaneously because they deploy different Workers.

GitHub processes waiting runs in FIFO order by the time they enter the concurrency queue, not
necessarily dispatch/merge order. Confirm TEST completion and the exact tested SHA before promotion.
Protect `main` with required PRs, squash-only merges and the validation check. Every push to `main`,
including a direct push, starts TEST; commits without the required merged-PR release provenance fail
before deployment. Human-test the exact prerelease tag/SHA before TEST is replaced by a later
successful eligible push.

## 6. Troubleshooting

Workflows use `actions/checkout@v5` and `actions/setup-node@v5` (Node 24 action runtime), while
application tooling still uses `.nvmrc`. Runners are pinned to `ubuntu-24.04` to avoid changes to
the `ubuntu-latest` image. These are separate from the application's Node version.

Release validation accepts the PR title with or without GitHub's exact ` (#<PR-number>)` squash
suffix. A different suffix/title is rejected. The TEST push workflow looks up the merged PR
associated with the pushed squash commit and records both the PR head and deployed SHA in its
provenance. PROD verifies that association through GitHub. An old workflow rerun uses its original
code; merge this fix and test the new run instead.

If TEST deployment settings are empty, configure `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` and
`DEPLOYMENT_URL` in the `test` GitHub environment. If TEST is protected by Access, also configure
both `CLOUDFLARE_ACCESS_CLIENT_ID` and `CLOUDFLARE_ACCESS_CLIENT_SECRET`. Repository changes cannot
supply missing secrets.

Read **GitHub Actions logs** for validation, installation, build and deployment. Browser-console
warnings from the Cloudflare dashboard are not necessarily application failures.

- **Unexpected Cloudflare build triggered by a merge:** these Workers must not be connected to
  Workers Builds or hooks. Only GitHub Actions should publish them.
- **GitHub checkout failure:** confirm repository access, that `main` exists remotely and the
  workflow references the intended commit.
- **Worker name mismatch:** compare the selected Worker with the configured Wrangler `name`.
- **Missing Wrangler configuration or assets:** check the root directory and configuration; confirm
  TEST built `dist` or PROD downloaded the artifact.
- **Incompatible Node or `.ts` script errors:** check the detected version, `.nvmrc` and
  `actions/setup-node`.
- **Deployment authentication/permission error:** check account, token validity and token selection.
  Correct only the permission identified in the logs.
- **PROD smoke test says the configured environment URL does not match the deployed Worker:**
  Wrangler has already deployed before the smoke test, so the Worker named in its output may already
  be updated even though the workflow failed and the release remains a prerelease. Compare
  `DEPLOYMENT_URL` with the configured Worker name and the Wrangler target in the run log. For this
  repository, the intended TEST and PROD URLs are
  `https://button-eye-reader-test.cgcnnunes.workers.dev` and
  `https://button-eye-reader-prod.cgcnnunes.workers.dev`. The failed v0.2.2 run explicitly reports
  that it uploaded Worker `button-eye-reader` at `https://button-eye-reader.cgcnnunes.workers.dev`,
  so it did **not** deploy to the intended PROD Worker. The `v0.2.2` tag retains that old Worker
  name; release policy forbids moving or reusing the tag for another Worker. The corrected
  configuration in this PR targets `button-eye-reader-prod`. After the PR is merged, confirm that
  its TEST workflow succeeds and creates the `v0.2.3` prerelease; then promote that exact tag.
- **TEST environment rejects `main`:** allow the `main` branch in the GitHub `test` environment.
  Keep `production` restricted to tags matching `v*`.
- **TEST smoke request redirects to Access login or returns 401/403:** deployment may already have
  succeeded, but smoke checks cannot authenticate. If TEST is protected, check both Access secrets,
  token expiration and the application's **Service Auth** policy selecting that token. If TEST is
  not meant to be protected, check for an unexpected Access policy on its hostname.
- **Missing model/WASM:** read `postinstall`/`assets` errors, including download and checksum
  failures; do not skip the script.
- **Test, lint, format or build failure:** reproduce the command locally and fix the root cause
  through the normal PR process.
- **Old site despite a started build:** confirm deployment finished successfully and that you opened
  the correct production address.
- **Expired/deleted artifact or mismatched digest:** promotion is blocked. Do not arbitrarily
  rebuild a tag for PROD. Rerun TEST for the same prerelease if it is not stable, then repeat human
  acceptance before promotion.
- **TEST fails before tagging:** fix the cause and rerun the original workflow or submit a new PR.
  PROD receives no new deployment; its existing content remains in place.
- **Tag creation succeeds but release creation fails:** do not move/delete the tag; rerun the
  original workflow. Recovery accepts only the same tag SHA. Existing prerelease provenance is
  updated only after another successful TEST deployment.
- **PROD deploys but smoke tests/GitHub promotion fail:** the Worker named in Wrangler's output may
  already have changed. This is not an automatic rollback or cross-provider transaction. Inspect
  which Worker was deployed and diagnose the failure. Retry the same promotion only for a transient
  issue with an otherwise correct deployment; a code/configuration correction requires a new release
  tag. Redispatch is blocked once stable. Emergency rollback requires authorization and a separate
  procedure, not an old tag selected in this promotion workflow.

## 7. Verify deployment, not just the build

- Confirm installation, verification, asset upload, deployment and final success in TEST logs. PROD
  instead verifies/downloads the tested artifact and checks its deployment. A started build or
  passing tests alone do not establish publication.
- Copy the production HTTPS URL from logs/dashboard; do not guess the account subdomain or use a
  Preview URL as the final address.
- Open the site and confirm title, footer version, four phrases and both catalogue controls.
- Confirm the model and both WASM files in `vision/` are served successfully, not as fallback HTML.
  WASM must use `Content-Type: application/wasm`.
- Confirm CSP and Permissions Policy: camera access only for the same origin, microphone and
  geolocation disabled.
- On the iPad, test sound, catalogue, persistence and calibration using [TESTING.md](TESTING.md).
  Computer verification does not establish eye accuracy or iPad voice availability.

Deleting Workers does not delete GitHub tags/releases. Only prereleases created by a successful TEST
workflow with valid provenance are eligible; do not manually reuse an older tag for setup. Choose
the final domain before storing phrases: `localStorage` does not migrate between origins.

## References and maintenance

- [Official Worker environments](https://developers.cloudflare.com/workers/wrangler/environments/)
- [GitHub environment configuration](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments)
- [Architecture and sources of truth](ARCHITECTURE.md)
- [Contributor rules](CONTRIBUTING.md)

Wrangler defines Worker identity/assets/environments; GitHub Actions defines commands and promotion;
GitHub Environments defines secrets, URLs and approvals. Do not connect Workers Builds to these
Workers. Keep these surfaces consistent and do not claim dashboard settings are configured merely
because they are documented in the repository.
