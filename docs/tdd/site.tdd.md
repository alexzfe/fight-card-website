# TDD evidence: site (Astro)

- **Source plan:** `PLAN.md` (Product, Site; milestones 3 and 6, display side), the site brief, and `docs/CONTRACT.md`.
- **Owner:** site agent. **Branch:** `feat/v1`.

## User journeys

1. As a visitor, I open `/` and immediately see the next UFC card: every fight, both fighters, records, weight class, title flag and finish badge.
2. As a visitor, I tap an event chip to switch cards. Each event has a shareable `/events/<slug>/` URL.
3. As a visitor, I tap "Stats" on a fight to see height, reach, stance and age at the event date, with no JS.
4. As a visitor to a past event, I see each result next to the frozen badge (`High → KO/TKO R1 4:12`), with the winner highlighted.
5. As a phone user (360 px), I get a readable, mirrored layout with no horizontal page scroll, in light or dark mode.
6. As the operator, a build against bad data fails loudly. The home page ships zero JS and stays under 50 KB of HTML+CSS. `/healthz` returns `ok`.

## Checkpoint commits (on `feat/v1`)

| Commit | Stage | Evidence |
|---|---|---|
| `8048600` | RED | vitest: 4 files fail with `Cannot find module ../../src/lib/{format,events,data,data-dir}` (compile-time RED, missing implementation). `astro build` / build test / Playwright: config import of `data-dir` fails. |
| `14c129b` | GREEN | `npm test`: 5 files, 70 tests pass. `npm run test:e2e`: 9 passed. |
| `c7b5cd2` | RED (layout bug found in a 360 px screenshot) | Playwright `fight row is mirrored…`: `Expected: <= 103.5, Received: 331.2`. The badge column was rendered after both corners, so the red name wrapped one letter per line. |
| `54cb155` | GREEN | Playwright 10/10. `npm test` 70/70. |
| `46d08d6` | REFACTOR | `npm test` 70/70. Coverage 99.1% stmts / 98.3% branches. Playwright 10/10. `astro check`: 0 errors. |

(`formatDate` was added mid-GREEN with its own RED: `× formats a plain date`, then pass.)

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Record shows `w-l-d`, plus ` (n NC)` only when nc > 0 | `tests/unit/format.test.ts › formatRecord` | unit | PASS |
| 2 | Height in inches → `5'11"`. Rounding never shows `12"`. Null → `—` | `format.test.ts › formatHeight` | unit | PASS |
| 3 | Reach → `72"` / `75.5"`, null → `—` | `format.test.ts › formatReach` | unit | PASS |
| 4 | Age is full years at the event date (birthday inclusive). Null dob → null | `format.test.ts › ageAt` | unit | PASS |
| 5 | Result string `KO/TKO R1 4:12`; missing parts skipped; no/empty result → null | `format.test.ts › formatResult` | unit | PASS |
| 6 | Tier labels High/Medium/Low; null → `—` | `format.test.ts › tierLabel` | unit | PASS |
| 7 | Initials, chip label (`UFC 323`, `Fight Night`), dates without TZ drift | `format.test.ts › initials/dates/chipLabel` | unit | PASS |
| 8 | Events ordered upcoming soonest-first, then completed most-recent-first. Input not mutated | `tests/unit/events.test.ts › orderEvents` | unit | PASS |
| 9 | Next event = soonest upcoming, else latest completed, else undefined. Slug lookup | `events.test.ts › nextEvent/findBySlug` | unit | PASS |
| 10 | `DATA_DIR` resolved relative to `site/`, default `../data` | `tests/unit/data-dir.test.ts` | unit | PASS |
| 11 | Fixture data dir loads in display order, with fighters and model info | `tests/unit/data.test.ts › loadData with the fixture set` | unit | PASS |
| 12 | Loader fails loudly (`DataError`, file path in message) on: missing dir, bad JSON, missing field, missing event file, bad tier, bad date, unknown fighter, event id ≠ filename, status ≠ index list, winner not in fight, fighters.json key ≠ id, missing image file, duplicate slug. Null model allowed | `data.test.ts › loadData contract violations` | unit | PASS |
| 13 | Fixture build emits `/`, all 4 event pages and `/healthz` (`ok`) | `tests/build/build.test.ts` | integration | PASS |
| 14 | **Zero JS:** no `.js`/`.mjs` in `dist/`, and no `<script` in any HTML | `build.test.ts › ships zero JavaScript` | integration | PASS |
| 15 | **Budget:** home HTML + linked CSS < 50 KB (actual: 11,248 B, CSS inlined) | `build.test.ts › keeps home page HTML + CSS under 50 KB` | integration | PASS |
| 16 | Headshots emitted as avif + webp `<picture>` with fixed width/height on every `<img>` | `build.test.ts › converts headshots…` | integration | PASS |
| 17 | Home shows the next event (h1), 4 fights, names, records incl. NC, weight class, title marker, badges incl. `—` | `tests/e2e/site.spec.ts › home page shows the next event…` | e2e | PASS |
| 18 | Initials avatar for fighters without a photo | `site.spec.ts › renders initials…` | e2e | PASS |
| 19 | Exactly one chip is `aria-current="page"`. Chips ordered upcoming then past. Clicking navigates to `/events/<slug>/` and moves the marker | `site.spec.ts › marks the current event chip`, `chips are ordered…` | e2e | PASS |
| 20 | `<details>` expands to show height, reach, stance, age | `site.spec.ts › details expand…` | e2e | PASS |
| 21 | Completed event shows `High → KO/TKO R1 4:12`, highlights the winner, and has no winner on a draw | `site.spec.ts › completed event shows results…` | e2e | PASS |
| 22 | No horizontal overflow at 360 px (home + completed event) | `site.spec.ts › no horizontal overflow at 360px` | e2e | PASS |
| 23 | Fight row is mirrored (red · badge · blue), and names don't break mid-word at 360 px | `site.spec.ts › fight row is mirrored…` | e2e | PASS |
| 24 | Footer shows "Finish model as of Oct 1, 2026" and the ufcstats / ESPN attribution | `site.spec.ts › shows the footer attribution`, `build.test.ts` | e2e | PASS |
| 25 | `/healthz` returns 200 `ok` from `astro preview` | `site.spec.ts › healthz returns ok` | e2e | PASS |

## Commands and final output

```
$ cd site && npm test
 Test Files  5 passed (5)
      Tests  70 passed (70)

$ npm run test:coverage   (src/lib/**)
Statements   : 99.09% ( 109/110 )
Branches     : 98.3% ( 58/59 )
Functions    : 100% ( 27/27 )
Lines        : 98.88% ( 89/90 )

$ npm run test:e2e        (builds with DATA_DIR=tests/fixtures/data, then playwright/chromium)
  10 passed (1.9s)

$ npx astro check
- 0 errors
```

## Coverage and known gaps

- `src/lib/site-data.ts` (one line: `loadData(__DATA_DIR__)`) shows 0% because it only runs inside the `astro build` subprocess. Test #13 exercises it indirectly.
- `.astro` components are not instrumented by v8. Their behaviour is covered by the build and e2e tests (#13–#25).
- Lighthouse (target ≥95 mobile) was not run. The zero-JS and 11 KB home page make it likely, but it is unmeasured.
- Light and dark mode were checked visually with 360 px screenshots, but no test asserts them.

## Notes and interpretations

- The brief named `<Image>`. Headshots use `astro:assets` `<Picture>` (the same pipeline) so each one serves avif with a webp fallback. Each is 48×48, cropped `fit="cover" position="top"`, with a 2x density.
- `DATA_DIR` is resolved once in `astro.config.mjs` and injected as `__DATA_DIR__`. Resolving it from `import.meta.url` broke once the code was bundled into `dist/.prerender`.
- `trailingSlash` is left at its default. `'always'` made `astro preview` 404 on the extensionless `/healthz`.
- Astro 7's `astro preview` keeps a lock file and can background itself. The Playwright webServer uses `--ignore-lock`.
