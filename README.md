# Button Eye Reader

An experimental **pt-PT communication board for iPad Safari**. Four large buttons speak phrases
using touch or standard button activation from Apple's built-in Eye Tracking on a supported iPad.

**Not a medical device or a reliable emergency communication system.** Use supervised testing and
another communication method if selections are wrong. Native Eye Tracking does not guarantee perfect
accuracy.

## Features and limits

| Feature        | Behavior                                                                           |
| -------------- | ---------------------------------------------------------------------------------- |
| Speaking board | Four configurable phrases; 26 initial phrases                                      |
| Catalogue      | Four choices per page; choose a phrase, then replace a board slot without typing   |
| New phrases    | Caregiver-only writing workflow; up to 100 characters                              |
| Speech         | Local system voice, preferring exact pt-PT; Safari may require touch authorization |
| Eye Tracking   | Configured and calibrated in iPad settings, not in the website                     |
| Accounts       | Cloudflare Access authorized-email login; no app passwords or invitation links     |
| Storage        | Per-account Cloudflare D1 phrases, catalogue order and four speaking positions     |
| Privacy        | No app camera access or face/eye measurements; speech stays local                  |

- Apple manages tracking, pointer and dwell timing. The app receives ordinary button clicks, not
  gaze coordinates, and cannot detect accuracy or disable system tracking in the writing area.
- Speech prevents overlapping audio; this is not a look-away repeat lock. Test repeated activation
  on the intended iPad, including after speech finishes.
- Speech failures/missing pt-PT voices are reported; accent and continuing authorization are not
  guaranteed.
- Phrases are stored in Cloudflare D1, not imported from old browser storage. A new account starts
  with defaults. Sign in to the same account to restore its last saved board on another device. TEST
  and PROD have separate accounts and data. Do not enter sensitive information.
- Caregivers can reorder the four speaking positions and the catalogue independently, and choose
  where a new phrase is inserted. Changes are acknowledged only after the server saves them.
  Concurrent updates report a conflict instead of silently overwriting another device's changes.
- Cloudflare Access protects the entire TEST and PROD sites and manages login/session expiry.
  Administrators allow caregiver emails in its dashboard. The Worker verifies the signed human
  identity before opening that user's board; automation tokens cannot retrieve or save boards.
- Custom account/password code has been removed. A forward database migration archives only existing
  board data for deliberate recovery, removes obsolete authentication tables/password hashes, and
  creates preferences keyed by verified Access identity. Back up D1 before migration.

## Start locally

Use Node.js **22.22.2+** (see `.nvmrc`) and npm:

```sh
npm ci
npm run build
npx wrangler d1 migrations apply DB --local --env test
npx wrangler dev --local --env test
```

Local unauthenticated API requests intentionally fail closed; there is no developer identity bypass.
See [DEPLOYMENT.md](docs/DEPLOYMENT.md) for signed-token testing and required Access configuration.
Static Vite development/preview alone does not provide the account API. Use Access-protected HTTPS
TEST on the iPad for release acceptance. There are no vision models to download or custom tracking
headers to set.

## Guides

| Need                                             | Read                                    |
| ------------------------------------------------ | --------------------------------------- |
| Contributor/AI rules and exact commit process    | [CONTRIBUTING.md](docs/CONTRIBUTING.md) |
| Runtime flow and safety invariants               | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Apple Eye Tracking setup and physical iPad tests | [TESTING.md](docs/TESTING.md)           |
| Cloudflare/GitHub setup and managed iPad login   | [DEPLOYMENT.md](docs/DEPLOYMENT.md)     |
| Versions, TEST releases and PROD promotion       | [RELEASES.md](docs/RELEASES.md)         |
| Release history                                  | [CHANGELOG.md](CHANGELOG.md)            |

GitHub Actions deploys TEST after eligible squash merges; PROD requires manual promotion of the
exact tested tag/artifact. **Do not connect Workers Builds.** Dashboard changes are owner actions,
not consequences of editing repository files.

Repository code/docs/tooling use English; site content and localized fixtures use pt-PT. Every
commit needs meaningful docs; use feature branches and reviewed squash PRs. The app version comes
from `package.json` and appears in the footer.
