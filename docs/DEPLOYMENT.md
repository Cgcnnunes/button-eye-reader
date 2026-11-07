# Deployment with Cloudflare and GitHub

Guide for developers and AI agents: **GitHub Actions deploys Workers Static Assets to two
independent Workers**, starting from an account with no Workers. Workers Builds is not used;
Cloudflare Pipelines is a data-ingestion product and is not used.

- Squash merge into `main` -> validation -> TEST Worker -> smoke tests -> artifact -> `vX.Y.Z` tag
  and GitHub **prerelease**, with notes generated since the previous stable release.
- Dispatch **Deploy to PROD** with that tag -> provenance validation -> environment approval ->
  download the same artifact -> PROD Worker -> smoke tests -> make the same release stable.

Pushes, merges and tag creation do not deploy PROD. The site is not rebuilt for PROD.

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
6. Repeat steps 1-5 with name **`button-eye-reader`** for PROD, and copy its own HTTPS URL.
7. Reload each Worker's settings and confirm the exact names, enabled URLs and absence of any GitHub
   Workers Builds connection or deployment hooks.

The initial contents of **both** Workers are placeholders, not the communication app. The first
successful merged-PR workflow replaces TEST's starter. PROD keeps its starter until you test that
prerelease and explicitly dispatch PROD promotion.

Expected URL shapes (replace `<account-subdomain>` with the actual value, do not paste
placeholders):

```text
TEST: https://button-eye-reader-test.<account-subdomain>.workers.dev
PROD: https://button-eye-reader-prod.<account-subdomain>.workers.dev
```

Copy actual URLs from the dashboard instead of guessing or reusing a previously deleted Worker's
URL.

- Keep these URLs publicly accessible without Cloudflare Access for this configuration. Smoke tests
  check public responses; protecting TEST with Access would require additional service
  authentication in the workflows. Do not use confidential test phrases.
- Confirm names in `wrangler.jsonc`: `env.test.name` is `button-eye-reader-test`;
  `env.production.name` is `button-eye-reader`. `workers_dev: true` and `preview_urls: false` are
  explicit; TEST uses a stable address rather than a version-specific Preview URL.
- Confirm that `assets.directory` matches the build output (`./dist` in this project).

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

Restrict both environments to runs from **`main`**. For `production`, configure required reviewers
and prevent self-approval if the GitHub plan supports it. Dispatch uses the workflow from `main` as
its control plane but deploys only the selected tag's commit. If the plan/repository does not
support required reviewers, dispatch is still manual, but there is no mandatory second approval. Do
not claim that protection is active unless configured.

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

Never share `CLOUDFLARE_API_TOKEN`, screenshots containing secrets or deployment-hook URLs.
Authenticate directly on GitHub/Cloudflare login pages, not through chat.

## 4. First merge and TEST acceptance

After creating both Workers and configuring secrets, URLs and approvals, squash-merge the workflow
PR. Under **Actions -> Deploy to TEST** (`deploy-to-test.yml`), confirm:

1. Checkout of the squash SHA, `npm run verify` and successful `Validate` for the same main commit.
2. Deployment with `--env test`, with no PROD deployment.
3. TEST URL smoke tests: `release.json` with SHA/tag, exact HTML/model/WASM bytes, WASM MIME type
   and security headers.
4. Artifact `tested-site-<run-id>-<attempt>`, retained for 90 days.
5. An immutable annotated `vX.Y.Z` tag and GitHub prerelease with automatically generated notes
   since the previous stable release, TEST link and run/artifact provenance.

Wait for the run to finish successfully, not just for the tag to appear. TEST has a stable URL:
later merges replace its content, but each prerelease retains its artifact. Test on the iPad and
record **tag, SHA and results** before the next merge; the marker identifies the current TEST
version. Do not approve an old tag based on a TEST Worker already serving a different tag.

Automated checks do not establish eye-tracking accuracy, pt-PT voice availability or human
acceptance. Use [TESTING.md](TESTING.md) with non-confidential test phrases.

## 5. Deploy PROD exclusively by tag

1. Open **Actions -> Deploy to PROD** (`deploy-to-prod.yml`) -> **Run workflow**.
2. Use the workflow from **`main`** and enter **`tag`**, for example `v0.2.0`, with the TEST
   prerelease you actually tested. Branches, SHAs, lightweight tags, stable releases and tags
   without provenance are ineligible. Check **`test_approved`** to confirm testing of that SHA/tag;
   without confirmation, the workflow fails before deployment.
3. The first job validates tag/ancestry on main, manifest versions, prerelease status, the exact
   successful TEST attempt, the latest successful `Validate` for that SHA, and artifact ID/digest
   and validity. It also rejects versions equal to or below the latest stable release.
4. Review and approve the `production` environment if configured. Validation is repeated after
   approval to detect changes during the wait.
5. The job downloads the original ZIP, checks SHA-256 and the marker, deploys with
   `--env production` and checks the PROD URL. **It does not run Vite or recompile the site.**
6. Only afterwards does the same GitHub release become stable/latest. The tag remains unchanged.

### Workflow concurrency

`execute-pr-validation.yml` groups runs by PR number: a new push or other validation event for that
PR cancels its previous run. Different PRs remain independent. Main push validation uses the commit
SHA and is not canceled by later pushes, because TEST requires successful validation of its exact
SHA.

TEST and PROD each have their own concurrency group, `cancel-in-progress: false` and `queue: max`.
Only one run per environment executes at a time; up to 100 additional runs wait rather than replace
each other. Additional runs beyond that limit are canceled by GitHub. TEST and PROD can execute
simultaneously because they deploy different Workers.

GitHub processes waiting runs in FIFO order by the time they enter the concurrency queue, not
necessarily dispatch/merge order. Confirm TEST completion and the exact tested SHA before promotion.
Do not push directly to `main`: that can run validation but does not produce an eligible TEST
prerelease.

## 6. Troubleshooting

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
  PROD retains its starter or previous approved deployment.
- **Tag creation succeeds but release creation fails:** do not move/delete the tag; rerun the
  original workflow. Recovery accepts only the same tag SHA. Existing prerelease provenance is
  updated only after another successful TEST deployment.
- **PROD deploys but smoke tests/GitHub promotion fail:** PROD may already have changed. This is not
  an automatic rollback or cross-provider transaction. Inspect the public version and retry the same
  promotion while the release remains a prerelease. Redispatch is blocked once stable. Emergency
  rollback requires authorization and a separate procedure, not an old tag selected in this
  promotion workflow.

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
