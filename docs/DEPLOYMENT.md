# Deployment setup

GitHub Actions deploys two Cloudflare Workers. **Do not connect Workers Builds, Pages, Git build
integrations, deployment hooks or Cloudflare Pipelines.** TEST is deployed from eligible reviewed
squash merges; PROD promotes the exact tested artifact and tag, without rebuilding.

## 1. Check your starting point

- Read [CONTRIBUTING.md](CONTRIBUTING.md), [RELEASES.md](RELEASES.md) and [TESTING.md](TESTING.md).
- Use the Node version in `.nvmrc`, run `npm ci` and `npm run verify`.
- Confirm the Cloudflare account, existing Workers and existing D1 databases before changing them.
- Set up GitHub branch/tag protection and deployment environments as documented in RELEASES.
- Complete Access configuration **before merging or applying migration 0002**. The committed
  TEST/PROD configuration contains the linked applications' team domain and distinct audience tags.
  Verify these against the dashboard before deploying; top-level local vars remain placeholders.
- Deployment preflight checks the selected environment's team-domain/audience syntax **before**
  applying D1 migrations. This stops placeholders, not a syntactically valid but incorrect
  audience/team or missing edge policy. The operator must verify actual Access settings first.

After confirming or updating the selected environment's configuration, run the matching preflight
before merge/migration:

```powershell
node scripts\deployment.ts access test
```

Use `node scripts\deployment.ts access production` for PROD instead. The workflow runs the same
preflight before its migration command. Top-level local placeholders are not checked.

Dashboard navigation and session-duration support were checked against official documentation on
2026-11-09, not your signed-in account. Check your account's available options if labels differ.

## 2. Worker names, origins and D1 isolation

| Environment | Wrangler environment | Worker name              | Intended site URL                                      |
| ----------- | -------------------- | ------------------------ | ------------------------------------------------------ |
| TEST        | `test`               | `button-eye-reader-test` | `https://button-eye-reader-test.cgcnnunes.workers.dev` |
| PROD        | `production`         | `button-eye-reader-prod` | `https://button-eye-reader-prod.cgcnnunes.workers.dev` |

Copy actual URLs from **Workers & Pages > Worker > Settings > Domains & Routes** or deployment logs;
do not guess another account's subdomain. Keep `workers_dev: true` and `preview_urls: false`. For a
new account, configure its workers.dev subdomain and each intended deployment hostname before its
first deployment. Use a Worker-only placeholder without Git integration if needed to configure
Access beforehand. Do not publish an unprotected app while waiting to configure Access.

Static assets use `./dist`; `run_worker_first: true` applies application security headers to every
asset. It does **not** configure Access. Access must protect the **entire hostname, every path**,
including `/`, `/index.html`, `/app`, `/api/*`, built assets and `release.json`, on both
environments. Audit any custom domains, routes, alternate hostnames and version URLs too: remove
unused entry points or protect each one. Protecting only previews or only `/app` is insufficient.

The existing, distinct TEST/PROD D1 IDs in `wrangler.jsonc` remain unchanged; do not create
replacement databases for this migration. The top-level all-zero database ID is local only. Never
bind TEST and PROD to the same database. For another account, provision separate databases and
replace the remote IDs through a reviewed feature PR:

```powershell
npx wrangler login
npx wrangler whoami
npx wrangler d1 create button-eye-reader-test
npx wrangler d1 create button-eye-reader-prod
```

Keep the binding named `DB` and `migrations_dir: "migrations"`. Missing D1, missing/placeholder
Access configuration or unavailable infrastructure fail closed with HTTP 503 on the API. Browser
local storage is not an authority or fallback for cloud boards.

## 3. Configure Cloudflare Access first

Cloudflare Access is the **single login**. There are no application passwords, invitations, reset
links, account-administration CLI or application session cookies. Separate self-hosted Access
applications protect TEST and PROD, with separate audience tags and independently managed policies.
The same human may use both, but their D1 boards remain separate.

Cloudflare offers a [Zero Trust Free plan](https://www.cloudflare.com/plans/zero-trust-services/)
for small deployments. Stay within current Access, Workers and D1 Free limits; monitor usage.
Removing password derivation avoids its former CPU expense, but does not guarantee unlimited free
traffic or establish production runtime performance. A paid password-hashing plan is no longer a
requirement of this application.

### Protect both entire hosts

For **each** Worker:

1. Open **Workers & Pages > Worker > Access > Protect this Worker behind Access**.
2. Choose **All traffic**, not **Previews only**, and apply Access. Edit an existing protection
   application rather than creating overlapping applications.
3. In **Zero Trust > Access controls > Applications**, inspect its hostname coverage. Ensure the
   entire deployment hostname is included without a path restriction.
4. Configure a human **Allow** policy and a separate automation **Service Auth** policy below. Do
   not add **Bypass**, **Everyone**, or service tokens to the human Allow rule.
5. Save and reload to confirm settings persisted; repeat independently for the other Worker.

For an unprotected Worker, **Protect this Worker behind Access** opens **Manage Worker access**. The
dialog defaults to **Previews only**: explicitly choose **All traffic**. Use **Authentication
policy > Add policy** to configure a restricted human Allow policy before **Apply Access** becomes
available. Create a separate PROD policy rather than attaching TEST's reusable policy when
environment membership must remain independent. Applying protection immediately changes live access;
coordinate with users even though it does not deploy code or migrate D1. If **Add policy** only
lists pre-configured or existing policies, cancel the unsaved dialog, create the restricted policy
first under **Zero Trust > Access controls > Policies**, then return to the Worker, select **All
traffic**, and attach the new policy. Do not substitute **Cloudflare account** or **Email domain**
for an explicit caregiver email list.

If the Access tab already shows **Worker Access > All traffic** and **Require login on every URL:
production and previews**, keep that protection. Use **Manage Access app** to review its existing
human Allow and Service Auth policies instead of creating a duplicate application.

The Worker's **Access > Application values** panel also exposes the **AUD tag** and **JWKS** URL.
Copy that application's AUD tag for its environment. The hostname in the JWKS URL is the
`ACCESS_TEAM_DOMAIN`; omit `https://` and `/cdn-cgi/access/certs`. These values identify the linked
application without needing to search another settings screen.

Do not use **Protect all Workers** unless you deliberately intend to protect every unrelated Worker
in that account. No Tunnel is needed for a hosted Worker.

**Branding tradeoff:** whole-host Access runs before any static HTML is served. An unauthenticated
visitor sees Cloudflare's login, not this application's branded home. The branded home and entry
control are available only after Access admission. A public branded pre-login home would require a
separate public hostname or a different edge policy and is not part of this architecture.

### Add a caregiver with email OTP

1. Open **Zero Trust > Integrations > Identity providers > Add new identity provider** and choose
   **One-time PIN**. New organizations do not necessarily enable OTP automatically.
2. Edit the chosen TEST or PROD application, enable One-time PIN as its login method, and attach a
   human **Allow** policy with **Include > Emails**, listing only approved caregiver addresses.
   Under **Application details > Login methods**, turn off **Accept all available identity
   providers** and select only **One-time PIN** for an email-code-only deployment. If the selection
   shows **Select all**, remove that selection and choose One-time PIN explicitly. Leave other
   providers unselected, and leave **Authenticate with Cloudflare One Client** off. Do not delete
   organization-wide providers: other applications may need them.
3. Save, reload and confirm the login method and policy. Add the user separately to the other
   environment if required; allowing TEST does not permit PROD.
4. Open the HTTPS site in iPad Safari, enter the approved email, select **Send login code**, then
   enter the emailed code and select **Sign in**. Codes expire after ten minutes. Access
   deliberately reports that a code was sent even when an address is not allowed.
5. Enter the board. The first valid human session creates default preferences keyed by the verified
   Access `sub`. The displayed `username` is the verified email, not a separate account username.

An email OTP login requires a real mailbox controlled by the caregiver, not a legacy custom username
or an example address. There is no second username/password login. Updating the Allow list does not
transfer a legacy board; use the verified-owner archive recovery procedure below.

In the current policy editor, use **Policy rules > Include > Emails** to manage approved addresses,
keep **Policy details > Action > Allow**, and keep **Policy session duration > Same as application
session duration** when using the application's timeout. Save with **Save policy**, then reopen to
verify. Review which applications use a reusable policy before editing it: changes affect every
attached application. For independent TEST/PROD membership, attach separate policies. Remove example
or obsolete addresses only after confirming they are not intended users; never document real
caregiver addresses or login codes.

Use the
[OTP guide](https://developers.cloudflare.com/cloudflare-one/integrations/identity-providers/one-time-pin/)
for current setup and blocked-email troubleshooting. A supported identity provider may replace OTP,
but the Worker still requires a signed human email claim. Revocation is managed in Access, not D1.
Removing an email from a policy does not erase its board; agree retention and verified recovery
procedures separately.

### Set session durations deliberately

The
[session-management guide](https://developers.cloudflare.com/cloudflare-one/access-controls/access-settings/session-management/)
currently supports a **global duration up to one month** and an application duration up to one
month:

- **Zero Trust > Access controls > Access settings > Set your global session duration**: choose
  **one month (approximately 30 days)** to avoid unnecessary repeated OTP challenges. This setting
  is organization-wide; review its effect on unrelated Access applications before changing it. Save,
  reload, and confirm the displayed value is **1 month**.
- On each **Applications > Edit > Session Duration**, choose **24 hours**. In the current editor,
  this control appears under **Application details > Basic information**. Keep an existing 24-hour
  value rather than changing it unnecessarily.
- Inspect every human policy's **Session Duration**. Use **Same as application session timeout** or
  an explicit **24 hours**; a policy override takes precedence over the application duration.

These are different timers. Application expiry triggers policy re-evaluation and can renew access
using a still-valid global identity session without a new OTP. This is not a guaranteed fixed 30-day
application session. Cloudflare One Client authentication, if enabled, can take precedence; do not
enable it inadvertently. Check actual saved options and test renewal in Safari.

The app never rotates its own session cookie. Logout clears in-memory communication data/stops
speech before browser navigation to `/cdn-cgi/access/logout`, handled by Access. There is no
`POST /api/logout`. Test actual Access logout/re-entry, including any identity-provider session, on
the intended shared device.

### Configure the signed identity verifier

In each application's **Additional settings**, copy the **Application Audience (AUD) Tag**. Find the
exact team domain from Zero Trust, for example `<team>.cloudflareaccess.com`. Replace:

| Wrangler environment vars        | Value to configure                                                                   |
| -------------------------------- | ------------------------------------------------------------------------------------ |
| `ACCESS_TEAM_DOMAIN`             | Exact lowercase team hostname ending in `.cloudflareaccess.com`; no scheme/path/port |
| `env.test.vars.ACCESS_AUD`       | TEST application's actual 64-character hexadecimal audience tag                      |
| `env.production.vars.ACCESS_AUD` | PROD application's actual, distinct audience tag                                     |

Update each environment's `ACCESS_TEAM_DOMAIN`, and configure top-level vars only if you need local
use. These identifiers are not credentials; never put service secrets or bearer JWTs in Wrangler
vars, browser bundles or source. Placeholder strings intentionally cause API 503 until replaced.
Deleting/recreating an Access application changes its audience and requires coordinated
configuration.

The Worker verifies `Cf-Access-Jwt-Assertion` with JOSE `createRemoteJWKSet`/`jwtVerify`, restricted
to RS256, the exact HTTPS issuer, the environment audience and required `exp`, `iat`, `sub`. Future
issued-at times, invalid signatures, expiry, invalid human emails and service-token claims are
rejected. Keys are fetched/cached only from the validated configured team host at
`https://<team>.cloudflareaccess.com/cdn-cgi/access/certs`; an arbitrary JWT issuer cannot choose a
fetch destination. Unverified email headers, old app cookies and service credentials never establish
caregiver identity. See
[JWT validation](https://developers.cloudflare.com/cloudflare-one/access-controls/applications/http-apps/authorization-cookie/validating-json/).

### Configure automation independently in BOTH environments

1. In **Zero Trust > Access controls > Service credentials > Service Tokens**, create a distinct
   smoke-test token for each environment, with a deliberate expiration. If TEST already has a valid
   token but PROD has none, keep TEST's token and create only PROD's. Select **Create Service
   Token**, use a descriptive environment-specific name, choose its duration, and select **Generate
   token**. Copy the Client ID and once-displayed Client Secret privately into the matching GitHub
   environment. Do not share or capture the generated-credentials screen.
2. Copy its Client ID/Client Secret directly into that GitHub environment's secrets below.
3. Attach an application policy with action **Service Auth**, **Include > Service Token** and only
   that environment's token. Keep the human Allow policy separate. In **Application details >
   Policies**, use **Create new policy** if needed. Saving the policy does not necessarily save its
   application attachment: also select **Save** on the application, reopen it, and confirm both
   policies remain. If navigation warns of unsaved changes, stay on the page and save the
   application before leaving.
4. Save and reload both applications, verify token expiration, and plan rotation.

Reuse an existing environment-specific service token and policy when the policy has action **Service
Auth**, includes only the intended token, and the token is unexpired with matching GitHub
environment secrets. The token name need not contain "smoke"; an existing deployment-named Access
token can serve these requests. Do not confuse it with the separate Cloudflare API deployment token.
Create a replacement only when needed, update the environment secrets, verify smoke checks, then
revoke the superseded token after confirming no other consumer needs it. Existing GitHub secret
names alone do not prove the credentials belong to an active, PROD-specific Access token. If only
TEST's token exists in Zero Trust, create PROD's token and update both production Access secrets
together with its matching values. Keep the deployment API token unchanged, and never reuse TEST's
Access token for PROD.

Workflows send `CF-Access-Client-Id` and `CF-Access-Client-Secret` only for that environment's smoke
requests. Both values are required together on TEST **and** PROD. Never inject them into Safari,
extensions, bookmarks or app code. These credentials allow build-identity assets through the edge;
`GET /api/session` must still return the Worker's 401 JSON error for automation, not a human board.
Expired/missing credentials can instead be rejected/redirected by Access before the Worker runs.
Smoke requests must not follow login redirects.

Official references:
[Worker Access](https://developers.cloudflare.com/workers/configuration/cloudflare-access/),
[service tokens](https://developers.cloudflare.com/cloudflare-one/access-controls/service-credentials/service-tokens/),
[policies](https://developers.cloudflare.com/cloudflare-one/access-controls/policies/).

## 4. Back up and migrate D1 with a maintenance window

**Migration 0002 irreversibly drops password/session/invitation/rate-limit tables. Back up before
applying it.** Do not edit already-applied `0001_accounts.sql`. Migration and Worker deployment are
not atomic: the preceding password-authentication Worker is incompatible with the new schema.
Arrange a brief maintenance window for each environment, restrict entry at the edge if needed, and
apply migration 0002 immediately before deploying the new Access Worker. Workflows apply migrations
before deploying, so a failed Worker deployment can leave an incompatible old Worker live. Recover
forward with this release; **do not revert to the old Worker**. Restoring a database/old release
requires separate authorized recovery planning, not an ordinary artifact rollback.

Before each environment's first Access release:

```powershell
npx wrangler whoami
npx wrangler d1 migrations list DB --env test --remote
npx wrangler d1 execute DB --env test --remote --command "SELECT name FROM sqlite_master WHERE type='table'; PRAGMA table_info(accounts);"
New-Item -ItemType Directory -Force .wrangler\backups
npx wrangler d1 export DB --env test --remote --output .wrangler\backups\test-before-access.sql
```

Repeat deliberately with `--env production` and a separate `production-before-access.sql`. Protect
the backups: they contain legacy password hashes and private phrases. `.wrangler` is ignored; do not
commit, upload to CI artifacts or share these files. Confirm export success and a secure recovery
copy before proceeding. Use administrator credentials with **Account > D1 > Edit**. Remote export
may temporarily make D1 unavailable; perform it at an agreed quiet time. Wrangler also prints a
temporary signed download URL granting access to the export. Treat that URL as a secret: do not
paste complete export output into chat or logs. Report only export success/failure. Use a fresh
timestamped output filename when an earlier backup must be retained.

If a remote D1 command returns **7403** (account invalid or unauthorized), stop before migration.
Run `npx wrangler whoami` privately to inspect the active authentication method and account. For API
token authentication, confirm **Account > D1 > Edit** and the intended account resource scope. An
Access service token is not a D1 administration credential. For OAuth authentication, confirm the
signed-in account and D1 access. A configured API token may take precedence over Wrangler login;
check local credential configuration privately without printing secrets. Do not delete databases or
alter migration history to resolve an authorization error.

Inspect the migration ledger and schema before applying. For an existing database, migration 0001
must already be recorded and its schema must match the original migration. A fresh database applies
0001 then 0002. If the tables exist but Wrangler reports 0001 pending, stop: inspect the actual
`d1_migrations` schema/rows and compare every table, index and constraint with 0001. An authorized
owner must review and baseline the matching already-applied migration using Wrangler's ledger schema
before allowing 0002. If schemas differ, investigate and plan an explicit corrective migration. **Do
not replay 0001, add blind `IF NOT EXISTS`, or blindly mark mismatched migrations applied.** Verify
with `migrations list` again after any reviewed ledger repair.

After Access policies/configuration and backups are verified, the deployment workflow applies:

```powershell
npx wrangler d1 migrations apply DB --env test --remote
```

PROD runs the equivalent `--env production` command on promotion, after its own backup and
maintenance preparation. Manual application is an operator recovery/setup action, not a substitute
for the standard release workflow.

Migration 0002:

- Creates `user_preferences(access_subject, board, revision)` with a nonnegative revision.
- Copies existing `id`, `username`, `board`, `revision` into `legacy_board_archive`.
- Drops `sessions`, `account_tokens`, `login_limits`, then `accounts` in foreign-key-safe order.
- Copies **no password hashes, session tokens, invitations or authentication versions** to the
  archive.

The archive protects prior phrases for deliberate owner-verified recovery. It is **not** an
authentication authority and is never automatically matched to Access email or subject. Even a
matching legacy username does not authorize recovery. Confirm the rightful owner and their verified
Access subject independently, validate the old board, and perform a reviewed transfer with revision
coordination so a live board is not silently overwritten. Back up before any recovery write. Only
after all needed recovery is completed, or a verified owner confirms none is needed, may an
authorized administrator explicitly remove the archive with `DROP TABLE legacy_board_archive`. There
is no automatic cleanup. Agree phrase, archive and backup retention policies first.

## 5. Deployment credentials and GitHub environments

Create GitHub environments named exactly `test` and `production`. Use environment secrets:

| Setting                           | Type     | `test`                           | `production`                     |
| --------------------------------- | -------- | -------------------------------- | -------------------------------- |
| `CLOUDFLARE_ACCOUNT_ID`           | Secret   | Actual Workers account ID        | Actual Workers account ID        |
| `CLOUDFLARE_API_TOKEN`            | Secret   | TEST deployment token            | PROD deployment token            |
| `DEPLOYMENT_URL`                  | Variable | TEST root HTTPS origin           | PROD root HTTPS origin           |
| `CLOUDFLARE_ACCESS_CLIENT_ID`     | Secret   | TEST smoke service Client ID     | PROD smoke service Client ID     |
| `CLOUDFLARE_ACCESS_CLIENT_SECRET` | Secret   | TEST smoke service Client Secret | PROD smoke service Client Secret |

`DEPLOYMENT_URL` has no path, query or fragment. GitHub supplies `GITHUB_TOKEN`. Access service
credentials are separate from Cloudflare deployment/admin tokens and caregiver OTP.

Find the
[account ID](https://developers.cloudflare.com/fundamentals/account/find-account-and-zone-ids/), not
a zone ID. Create separate [API tokens](https://dash.cloudflare.com/profile/api-tokens/) with
**Account > Workers Scripts > Edit** and **Account > D1 > Edit**, scoped to the intended account.
workers.dev requires no zone/DNS editing; do not grant AI, Containers or unrelated permissions.
Account-scoped permissions do not restrict a token to one Worker; deliberate environment selection
still matters. Keep administrator/Access-policy management credentials separate and least-privilege.

Restrict GitHub `test` to **main** and `production` to **tags matching `v*`**, not branches. Save,
reload and verify the rules. Configure production reviewers/prevent self-review if available;
without a supported configured reviewer rule there is **no human approval pause**. Never expose PROD
secrets to PR jobs. See [RELEASES.md](RELEASES.md#repository-protection).

## 6. API, local testing and safe diagnostics

Worker API contract after edge admission:

- `GET /api/session` returns `{username, csrf, board, revision}` for a verified human. Username is
  display email; identity/storage use Access `sub`, with issuer/audience fixed per environment.
  Concurrent first loads initialize defaults once without replacing an existing board.
- `PUT /api/board` receives `{board, revision}` with `x-csrf-token`, exact same-origin `Origin` and
  JSON content type; an optional `Sec-Fetch-Site` must be `same-origin`. Success returns
  `{board, revision: previous + 1}`. An atomic subject/revision update rejects stale saves with 409.
- Invalid/missing/expired/service identity is 401 with only `{error: string}` and no board. Errors
  use visible pt-PT messages; missing configuration/infrastructure is 503. Removed custom
  login/setup/logout routes are not implemented. Access itself may redirect unauthenticated edge
  traffic before the Worker can return an API response.

CSRF is SHA-256 of a versioned tuple containing the fixed team/audience and stable verified subject,
not the rotating JWT or email. It is **not a secret/authentication credential**. Its stability
prevents JWT renewal from invalidating an open board's save token. Authorization still requires a
fresh verified human JWT; exact Origin, JSON-only bounded bodies, the custom CSRF header and no
cross-origin response access are the cross-site safeguards. No permissive CORS is provided. API
responses/assets set no-store, deny framing, disallow referrers and disable app
camera/microphone/geolocation; this does not disable Apple's system Eye Tracking.

Vite alone has no backend. For local packaging/security-header checks:

```powershell
npm run build
npx wrangler d1 migrations apply DB --env test --local
npx wrangler dev --env test --local --port 8787
```

Local HTTP is permitted only on loopback (`localhost`, `127.0.0.1`, `[::1]`), **without bypassing
identity verification**. Placeholder configuration returns 503; configured requests without a
genuine signed Access assertion return 401. There is no local invitation, fake caregiver identity,
password fixture or production verification-disable flag. Use the offline tests for authenticated
backend development and the real Access-protected TEST host for Safari integration.

```powershell
npx vitest run tests\worker.test.ts tests\access.test.ts --coverage --coverage.include=src/access.ts --coverage.include=src/worker.ts
```

Tests generate disposable RSA keys/JWTs in memory, mock only the configured HTTPS JWKS fetch and use
real Miniflare D1 with both migrations. They verify
forged/expired/wrong-issuer/wrong-audience/service rejection, subject isolation, renewal-stable
CSRF, concurrency, migration archival and safe failures. Mocks are test dependencies, not deployment
configuration; no signed fixtures/private keys or face images are stored. Per-file coverage remains
90% statements/lines/functions and 80% branches.

Observability storage stays disabled. For a live diagnosis, use
`npx wrangler tail --env test --format pretty`, reproduce once and stop. Share only the fixed
`Access request failed` category, allowlisted exception type and known operation (`/api/session`,
`/api/board`, `other`). Never share complete tail output, tokens, JWTs, emails, phrases, query
strings or request bodies. `access-key-service` means JWKS/verification infrastructure is
unavailable; `database-operation` means D1/SQLite failed; `unexpected-operation` covers other
failures. No raw exception message is logged. A successful tail execution outcome does not mean the
HTTP request succeeded.

## 7. Deploy and verify

1. Configure BOTH whole-host Access applications, both service policies/secrets and real verifier
   vars first. Back up and prepare the migration maintenance window.
2. Squash-merge a reviewed PR with green checks. Wait for the entire **Deploy to TEST** workflow:
   verification, migrations, Worker deployment, smoke checks, artifact and prerelease.
3. Verify an unapproved browser cannot fetch home/API/assets; an approved email can complete the
   single OTP login and load/save its board. Verify automation can retrieve assets but receives
   exactly Worker 401 JSON/no-store from `/api/session`, never a caregiver board or Access login
   HTML.
4. On the intended iPad, record the `release.json` tag/SHA and acceptance from TESTING before the
   next merge changes TEST. Test logout/renewal and preserved four speaking targets.
5. Promote the exact tested prerelease tag using [RELEASES.md](RELEASES.md#promote-to-prod), after
   PROD Access settings, backup and maintenance preparation. Verify the final workflow, footer and
   `release.json`, human login and automation separation.

Smoke/local tests prove build identity and software behavior, **not** remote policy configuration,
Free-plan capacity, Safari audio authorization or physical iPad Eye Tracking accuracy.

## Troubleshooting

Start with the failed GitHub Actions step, not unrelated dashboard warnings.

| Problem                              | Check/action                                                                                  |
| ------------------------------------ | --------------------------------------------------------------------------------------------- |
| Unexpected Cloudflare build          | Disconnect Git/Workers Builds/hooks; only Actions publishes.                                  |
| Permission failure                   | Actual account, token expiry, Workers Scripts/D1 permissions.                                 |
| API 503 immediately                  | Replace Access placeholders, verify exact team/AUD and DB binding/schema.                     |
| Migration table already exists       | Inspect schema and ledger; back up and review baseline, never blind `IF NOT EXISTS`.          |
| Old Worker fails after 0002          | Complete forward deployment during maintenance; old password Worker is incompatible.          |
| Email code does not arrive           | Allow email in the correct environment, enable OTP, check spam/email gateway.                 |
| Smoke redirect/401/403 before assets | Both service secrets, expiry and separate Service Auth policy on that environment.            |
| Smoke `/api/session` returns 200     | Unsafe human/service identity separation; stop promotion and investigate.                     |
| Branded home missing before login    | Expected whole-host edge protection, not an asset bug.                                        |
| JWT rejected                         | Exact team issuer/AUD, clock, expiry, human email and service-token exclusion; never log JWT. |
| Save conflicts                       | Reload and deliberately reconcile revisions; do not overwrite silently.                       |
| URL/old site mismatch                | Actual Worker name/origin, deployment completion and `release.json`.                          |
| Artifact expired/tampered            | Eligible TEST retry and repeated acceptance; never silently rebuild PROD.                     |
| Release creation failed              | Repair permission and retry eligible commit; never move/delete its tag.                       |
| PROD changed but workflow failed     | Inspect live state; no atomic rollback. Recover forward or use authorized recovery.           |

Stable releases cannot be downgraded by promotion. Deleting Workers does not reset immutable release
history. Emergency rollback needs authorization and a database-compatible separate procedure.
