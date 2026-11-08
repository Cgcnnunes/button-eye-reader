# Deployment setup

GitHub Actions publishes this app to two Cloudflare Workers. **Do not connect Workers Builds, Pages
or deployment hooks.** Cloudflare Pipelines is unrelated and is not used.

```mermaid
flowchart LR
  PR["Reviewed squash PR"] --> Main["main"]
  Main --> Checks["Verification and release checks"]
  Checks --> Test["Deploy TEST"]
  Test --> Release["Smoke checks, artifact and prerelease"]
  Release --> Human["Test exact tag on iPad"]
  Human --> Dispatch["Manually dispatch tested tag"]
  Dispatch --> Prod["Validate artifact and deploy PROD"]
  Prod --> Stable["Smoke checks and stable release"]
```

## 1. Check your starting point

- `main` exists on GitHub and is the default branch.
- Run `npm ci`, then `npm run verify` with the Node version in `.nvmrc`.
- Select the Cloudflare account that will own both Workers.
- Inspect existing Workers before deploying: a deployment replaces their content.
- Set up repository protection using [RELEASES.md](RELEASES.md#repository-protection).

Dashboard labels change. The names below were checked against official documentation on 2026-11-08,
not against your signed-in account. Use the linked product page if navigation differs; do not select
an unrelated product just because a menu label is missing.

## 2. Worker names and URLs

| Environment | Wrangler environment | Worker name              | Site URL                                               |
| ----------- | -------------------- | ------------------------ | ------------------------------------------------------ |
| TEST        | `test`               | `button-eye-reader-test` | `https://button-eye-reader-test.cgcnnunes.workers.dev` |
| PROD        | `production`         | `button-eye-reader-prod` | `https://button-eye-reader-prod.cgcnnunes.workers.dev` |

These are this repository's intended URLs. Copy actual URLs from Cloudflare or deployment logs;
never guess the account subdomain or reuse a deleted Worker's URL.

**Existing Workers:** find them on
[Workers & Pages](https://dash.cloudflare.com/?to=/:account/workers-and-pages). Open each Worker and
find **Settings > Domains & Routes**. Confirm its `workers.dev` URL is enabled and that no Git
repository/build integration is attached.

**New account:** configure your account's `workers.dev` subdomain on Workers & Pages. The configured
Workers can be created by their first GitHub Actions deployments; you do not need to deploy a Hello
World starter first. Before that deployment, use the name/subdomain to configure each expected URL,
then verify it against the actual URL reported by Wrangler.

If you prefer creating placeholders in the dashboard, use a Worker-only creation option without Git
integration **if one is offered**. The current
[dashboard guide](https://developers.cloudflare.com/workers/get-started/dashboard/) emphasizes
Git-connected creation; do not follow that integration for this project.

Configuration checks in `wrangler.jsonc`:

- Worker names match the table; `workers_dev: true`, `preview_urls: false`.
- Static assets come from `./dist`.
- `/` and `/index.html` run through `src/worker.ts`, which serves assets unchanged.
- Eye diagnostics are enabled locally and in TEST, and temporarily in PROD, without headers. They
  are not an authentication mechanism.

For another account, update URLs and secrets. For another app, also change Worker names in
`scripts/deployment-policy.ts` and its tests. Separate Workers do not isolate future shared
databases or bindings automatically. Choose the final origin before saving phrases: browser storage
does not migrate between domains.

## 3. Deployment credentials

Deployment credentials are required. They are **not** the optional Access login credentials.

1. Find the account ID using Cloudflare's
   [account ID guide](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/).
   Do not use a zone ID.
2. Open [user API Tokens](https://dash.cloudflare.com/profile/api-tokens/). Create separate TEST and
   PROD tokens using a custom policy:
   - Policy type: **Account**.
   - Permission: **Workers Scripts > Edit**.
   - Resource: only the selected account.
3. Copy each token directly into its GitHub environment secret; it is shown only once.

This `workers.dev` deployment does not need zone/DNS editing. Do not grant permissions for AI,
Containers or other unused products just to clear a dashboard warning. Add permissions only when
deployment logs identify a necessary missing permission.

Separate tokens help rotation/revocation, but account-scoped permissions do not restrict a token to
one Worker. Never expose PROD credentials to PR jobs or put tokens in code, URLs, logs or chat. See
[API token setup](https://developers.cloudflare.com/fundamentals/api/get-started/create-token/).

## 4. GitHub environments

In the repository's **Settings > Environments**, create exactly `test` and `production`. Use
environment secrets, not repository-wide PROD secrets.

| Setting                           | Type     | `test`                   | `production`          |
| --------------------------------- | -------- | ------------------------ | --------------------- |
| `CLOUDFLARE_ACCOUNT_ID`           | Secret   | Workers account ID       | Workers account ID    |
| `CLOUDFLARE_API_TOKEN`            | Secret   | TEST deployment token    | PROD deployment token |
| `DEPLOYMENT_URL`                  | Variable | TEST root HTTPS URL      | PROD root HTTPS URL   |
| `CLOUDFLARE_ACCESS_CLIENT_ID`     | Secret   | Only if TEST uses Access | Leave unset           |
| `CLOUDFLARE_ACCESS_CLIENT_SECRET` | Secret   | Only if TEST uses Access | Leave unset           |

`DEPLOYMENT_URL` must have no path, query or fragment. GitHub supplies `GITHUB_TOKEN`; do not create
a personal token for these workflows.

Under deployment branch/tag restrictions, select specific refs:

- `test`: allow the **main branch**.
- `production`: allow **tags matching `v*`**, not branches.
- Save, reload and confirm the rules exist; selected-ref mode without rules is not a restriction.

If available, configure required reviewers and prevent self-review for `production`. Availability
depends on GitHub plan and repository visibility. **Without that rule, there is no approval pause.**
Check your current settings rather than relying on a previously observed dashboard.

Allow the repository's Actions and authorized tag/release creation. Protect existing tags against
rewriting/deletion without blocking the release workflow. Details:
[GitHub environments](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/manage-environments).

## 5. Optional TEST authentication

**Public TEST:** skip this section and leave both Access secrets unset. PROD stays public.
**Protected TEST:** configure an Access application covering its deployment hostname and all paths.
Protecting preview URLs alone does not protect the TEST URL.

For a new protected TEST:

1. On **Workers & Pages**, open **button-eye-reader-test**.
2. Open the **Access** tab and select **Protect this Worker behind Access**.
3. Choose **All traffic**, not **Previews only**. Here "all traffic" means traffic to this TEST
   Worker, not the app's PROD Worker.
4. Select/configure an authentication policy, then **Apply Access**.
5. Configure browser and automation policies below.

If already protected, edit its existing Access application rather than creating another. Enable Zero
Trust first if prompted. **Do not use Protect all Workers**: that would also protect PROD. Do not
configure a Tunnel for this already-hosted Worker. See
[Worker Access setup](https://developers.cloudflare.com/workers/configuration/cloudflare-access/#protect-one-worker).

| Who needs access?   | Authentication                            | Required policy when used                              |
| ------------------- | ----------------------------------------- | ------------------------------------------------------ |
| iPad/browser tester | One-time PIN or another identity provider | **Allow**, including approved users                    |
| GitHub smoke checks | Client ID + Client Secret                 | **Service Auth**, including the selected service token |

Access protection and browser login choices are optional. **Once TEST is protected, this
repository's automated smoke checks need service-token access.** Browser login cannot authenticate
those checks; Service Auth alone does not give Safari an email-code login.

### Optional browser access: email code on iPad Safari

Cloudflare offers a free Zero Trust plan. No paid Safari header tool is needed.

1. Find **Identity providers** in Zero Trust (currently **Integrations > Identity providers**). Add
   **One-time PIN**; new accounts do not necessarily have it enabled.
2. Edit the TEST Access application and enable One-time PIN as a login method.
3. Attach a separate **Allow** policy: **Include > Emails**, with approved tester addresses only.
4. Keep the existing **Service Auth** policy for automation.
5. Save, reload and confirm the login method and both policies persisted.
6. Open TEST in iPad Safari, request an email code and enter it. Sign in again when the session
   expires.

A different identity provider can replace One-time PIN with its matching Allow policy. Do not add an
everyone/Bypass rule to fix a login problem. Safari has no built-in custom-header setting; keep
service-token credentials out of extensions, bookmarks, query strings and app code.

### Optional automated access: service token

1. Find **Service Tokens** in Zero Trust (currently **Access controls > Service credentials >
   Service Tokens**).
2. Create a token, choose its expiration and copy its Client ID and Client Secret.
3. Attach a **Service Auth** policy to the TEST application: **Include > Service Token**, selecting
   that token. Keep it separate from the browser Allow policy.
4. Save both values in the GitHub `test` environment using the Access secret names in section 4.

The workflow sends `CF-Access-Client-Id` and `CF-Access-Client-Secret` only during TEST smoke
checks, including model/WASM requests. Both secrets must be set together. They are never bundled
into the app, and smoke requests do not follow redirects. PROD sends no Access credentials.

**Verify both paths:** an approved iPad browser can sign in; an unauthenticated browser is denied;
TEST smoke checks pass. To make TEST public, remove its Access protection and clear both GitHub
Access secrets together. Editing repository files does not configure Cloudflare policies or GitHub
secrets.

Official guides:
[One-time PIN](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/),
[Service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/),
[Policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/).

## Private calibration reports

Report collection is optional and disabled by default. The feature exists in TEST and PROD, but
cloud uploads need this setup. **Create both buckets before deploying this release**; bindings in
`wrangler.jsonc` reference these exact names.

1. Sign in using `npx wrangler login` and enable R2 for the selected account if needed. R2 has a
   free allowance, not unlimited free use; check account requirements/pricing before enabling it.
2. Create separate private buckets and lifecycle rules:

   ```sh
   npx wrangler r2 bucket create button-eye-reader-reports-test
   npx wrangler r2 bucket create button-eye-reader-reports-prod
   npx wrangler r2 bucket lifecycle add button-eye-reader-reports-test expire-reports reports/ --expire-days 7
   npx wrangler r2 bucket lifecycle add button-eye-reader-reports-prod expire-reports reports/ --expire-days 7
   ```

   Do not enable public `r2.dev` access or attach public bucket domains. The Worker uses the
   `REPORTS` binding; no R2 credentials belong in browser code.

3. In **Zero Trust > Access controls > Applications**, create a dedicated hostname/path application
   for each environment's report area. Cover `/diagnostics` and `/diagnostics/*`; reuse the existing
   identity provider, and allow only approved caregivers/reviewers. Do not protect the entire PROD
   Worker. Existing TEST access remains in place; use the report application's audience, not the
   broader TEST application audience. Check overlapping policies so a TEST login alone cannot bypass
   the report policy.
4. Find each report application's **Application Audience (AUD)** and your Access team hostname
   (`your-team.cloudflareaccess.com`). Store them as Worker secrets, separately for each
   environment:

   ```sh
   npx wrangler secret put REPORT_ACCESS_TEAM --env test
   npx wrangler secret put REPORT_ACCESS_AUD --env test
   npx wrangler secret put REPORT_ACCESS_TEAM --env production
   npx wrangler secret put REPORT_ACCESS_AUD --env production
   ```

   Enter the hostname without `https://`; enter the matching application's AUD when prompted. These
   settings are not service-token credentials. If a Worker does not exist yet, create it through the
   approved deployment process before adding its secrets. Uploads fail closed until configured.

5. Verify that approved browser sign-in can open `/diagnostics`, while unauthenticated requests
   cannot access its API. Direct `/diagnostics.html` also requires server-verified report access;
   use `/diagnostics` as the browser entry point. Check the hourly cleanup trigger in each Worker.
6. Use the caregiver diagnostic control: opt into the next calibration, close the panel, calibrate,
   then reopen it to review. Open the private area, authenticate, review again and confirm upload.
   Reports can then be downloaded or deleted. Failed, cancelled and successful attempts are useful.

| Report data                                                          | Purpose                                                                             |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------------------- |
| App version, camera/screen dimensions and duration                   | Compare setups and code versions                                                    |
| Frame callbacks, usable eyes, no/multiple faces and alignment counts | Identify tracking interruptions; callback rate is not camera frame rate             |
| Per-target eye means and standard deviations                         | Check signal separation/noise without saving individual samples or head coordinates |
| Signed mean errors, RMSE and within-limit counts                     | Identify direction, magnitude and consistency of verification failures              |

Numerical eye measurements can still be sensitive; these reports are not claimed to be anonymous.
Access may keep its own authentication logs. The app stores no face images, recordings, phrase text
or user identity. It does not upload automatically or alter the algorithm/verification thresholds.

Reports stop being accessible after seven days. Hourly cleanup and R2 lifecycle expiry delete them
afterwards; storage deletion is asynchronous. Exported copies are not automatically deleted. The
assistant has no standing account access: authorize retrieval or share a downloaded report
explicitly, without sharing login credentials.

## 6. Deploy and verify

1. Squash-merge a reviewed PR with green checks. The main push starts **Deploy to TEST**.
2. Wait for the whole workflow to succeed: verification, deployment, smoke checks, artifact and
   prerelease creation. A started build or a tag alone is not success.
3. On iPad, test the deployed version using [TESTING.md](TESTING.md). Record the tag/SHA from
   `release.json` before another merge replaces TEST.
4. Follow [PROD promotion](RELEASES.md#promote-to-prod) using that exact tested tag.
5. Confirm PROD's final workflow result, site footer and `release.json`. Verify sound, four phrases,
   catalogue controls and calibration on the device.

Smoke checks verify release identity, exact asset bytes, model/WASM responses and security headers.
They do not prove physical eye-tracking accuracy or Safari speech behavior.

## Troubleshooting

Start with the failed **GitHub Actions step**, not unrelated Cloudflare dashboard console warnings.

| Problem                                      | Check/action                                                                                                                                |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| Unexpected Cloudflare build                  | Disconnect Workers Builds/Git integration/hooks. Only Actions should publish.                                                               |
| Authentication/permission failure            | Account ID, correct token, expiration, and the specific permission in the log.                                                              |
| Missing configuration/assets                 | Repository root, `wrangler.jsonc`, TEST build or PROD artifact download.                                                                    |
| TEST environment rejects `main`              | Allow the main branch in GitHub's `test` environment.                                                                                       |
| iPad cannot sign in                          | Enabled identity provider and browser Allow policy; retain Service Auth.                                                                    |
| Email code does not arrive                   | Approved address, spam folder, login method. Access may say it sent a code even for a denied address.                                       |
| TEST smoke checks redirect or return 401/403 | Both Access secrets, expiration and Service Auth policy. If TEST should be public, check for unexpected protection.                         |
| URL/Worker mismatch                          | Compare `DEPLOYMENT_URL`, Wrangler name and actual deployed URL. Deployment may already have changed the wrong Worker.                      |
| Model/WASM or Node error                     | Asset download/checksum logs, `.nvmrc`, and setup-node output. Do not skip checks.                                                          |
| Old site                                     | Correct URL and final workflow success; compare `release.json`, not just a build notification.                                              |
| Tag exists but release creation failed       | Fix permissions and rerun the same commit; never move/delete the tag.                                                                       |
| Artifact expired/tampered                    | Rerun TEST for the same eligible prerelease and repeat acceptance. Never rebuild silently for PROD.                                         |
| PROD changed but workflow failed             | Inspect the deployed Worker; no automatic rollback. Retry a transient failure while still prerelease; code/config fixes need a new release. |

Stable releases cannot be redeployed/downgraded by this promotion workflow. Deleting Workers does
not reset GitHub tags/releases. Emergency rollback needs authorization and a separate procedure.
