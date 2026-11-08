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
| Storage        | Phrases and assignments in this browser's `localStorage`; no cross-device sync     |
| Privacy        | No app camera access, eye measurements, diagnostic collection or uploads           |

- Apple manages tracking, pointer and dwell timing. The app receives ordinary button clicks, not
  gaze coordinates, and cannot detect accuracy or disable system tracking in the writing area.
- Speech prevents overlapping audio; this is not a look-away repeat lock. Test repeated activation
  on the intended iPad, including after speech finishes.
- Speech failures/missing pt-PT voices are reported; accent and continuing authorization are not
  guaranteed.
- Changing origin, clearing browser data or private browsing can lose phrases. No encrypted phrase
  storage/export; do not enter confidential information. Corrupt data is reported, not overwritten.

## Start locally

Use Node.js **22.22.2+** (see `.nvmrc`) and npm:

```sh
npm ci
npm run dev
```

Open Vite's localhost URL. Use HTTPS TEST on the iPad for release acceptance. There are no vision
models to download or custom tracking headers to set.

## Guides

| Need                                             | Read                                    |
| ------------------------------------------------ | --------------------------------------- |
| Contributor/AI rules and exact commit process    | [CONTRIBUTING.md](docs/CONTRIBUTING.md) |
| Runtime flow and safety invariants               | [ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Apple Eye Tracking setup and physical iPad tests | [TESTING.md](docs/TESTING.md)           |
| Cloudflare/GitHub setup and optional iPad login  | [DEPLOYMENT.md](docs/DEPLOYMENT.md)     |
| Versions, TEST releases and PROD promotion       | [RELEASES.md](docs/RELEASES.md)         |
| Release history                                  | [CHANGELOG.md](CHANGELOG.md)            |

GitHub Actions deploys TEST after eligible squash merges; PROD requires manual promotion of the
exact tested tag/artifact. **Do not connect Workers Builds.** Dashboard changes are owner actions,
not consequences of editing repository files.

Repository code/docs/tooling use English; site content and localized fixtures use pt-PT. Every
commit needs meaningful docs; use feature branches and reviewed squash PRs. The app version comes
from `package.json` and appears in the footer.
