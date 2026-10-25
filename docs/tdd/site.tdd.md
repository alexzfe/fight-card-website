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

## Round 2: card segments, quiet accents, finish meter (2026-10-25)

Uncommitted at time of writing. RED was observed in the working tree before implementation:

- vitest: `card.test.ts` fails with `Cannot find module '../../src/lib/card'`. `data.test.ts › fails on an unknown card segment`: `expected [Function] to throw an error`.
- Playwright: 4 failed / 13 passed: the segment headings, main-event marker and finish meter were not found, and the stats summary was shorter than 44 px.

GREEN: `npm test` 82/82, `npm run test:e2e` 17/17, `astro check` 0 errors. The zero-JS and 50 KB budget tests still pass.

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 26 | Segment labels: Main card / Prelims / Early prelims | `tests/unit/card.test.ts › segmentLabel` | unit | PASS |
| 27 | Fights grouped main card → prelims → early prelims, keeping card order within each, even when ufcstats interleaves them (late additions are appended to its list). Unknown segments form one trailing "Other bouts" group. No segments → one unlabelled group. Empty card → no groups | `card.test.ts › groupBySegment` | unit | PASS |
| 28 | Loader rejects an unknown `segment` value | `data.test.ts › fails on an unknown card segment` | unit | PASS |
| 29 | Home shows an h2 per segment, each with its fights | `site.spec.ts › the card is split into…` | e2e | PASS |
| 30 | An event without segment data shows no h2 | `site.spec.ts › an event without segment data…` | e2e | PASS |
| 31 | Only the first fight is marked "Main event" | `site.spec.ts › the main event is marked` | e2e | PASS |
| 32 | Meter lights 3/2/1 bars for High/Medium/Low; unscored has no meter | `site.spec.ts › the finish meter…` | e2e | PASS |
| 33 | Stats toggle is ≥44 px tall and ≥200 px wide at 360 px | `site.spec.ts › the stats toggle…` | e2e | PASS |

Not covered by tests: palette contrast (checked by hand: every text colour ≥5:1 on its background in both themes), the cross-document view transition and the `<details>` height animation (both CSS-only, behind `prefers-reduced-motion: no-preference`, and inspected in Chromium only).

A second RED/GREEN followed the pipeline backfill. Real data for Bonfim vs. Brady repeated the Main card and Prelims headings because ufcstats appends late bouts at the end of its list. The interleaving test failed (`2 failed | 4 passed`), and the order-by-segment grouping then passed.

## Round 3: tier colours, no corner colours, opponent tooltips (2026-10-25)

RED: `each finish tier has its own colour` failed because Medium used the body text colour and Low the muted grey. `hovering a form tile names the opponent` failed because the tile had no `data-tip`. GREEN: `npm test` 82/82, `npm run test:e2e` 19/19, `astro check` 0 errors.

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 34 | High, Medium and Low each have a colour distinct from body text, from muted text and from each other. Unscored stays muted | `site.spec.ts › each finish tier has its own colour` | e2e | PASS |
| 35 | Form tile carries `data-tip` "<opponent> · <method round · month year>". Its tooltip is hidden until hover, then shows the opponent | `site.spec.ts › hovering a form tile names the opponent` | e2e | PASS |

Checked by hand: tier text on its 12% tinted pill is ≥5.1:1 in light mode and ≥6.3:1 in dark. No horizontal overflow while a tooltip is shown at 390 px or 1440 px. Tiles use `tabindex="-1"`, so a tap focuses them and shows the tip without adding Tab stops. The Stats panel lists the same fights for keyboard and screen-reader users. Touch tap behaviour was not tested on a real iOS or Android device.

## Round 4: event rail (2026-10-25)

This replaces the chip row. With real data, four of six chips read "Fight Night · <date>", and the fighter names showed only in a hover title. Options A (rail), B (popover switcher) and C (prev/next stepper) were proposed. B was built as an uncommitted preview and compared side by side; the user chose A.

RED (`4662c6a`): 7 unit tests failed (`eventTile is not a function`, `byDateAscending` missing). 6 e2e tests failed: tile count, touch target, selected tile in view, kept scroll, sticky, eager prerender with a view transition. GREEN: `npm test` 85/85, `npm run test:e2e` 24/24, `astro check` 0 errors.

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 36 | Tile = "<Mon D> · <prefix unless UFC Fight Night> · Results if completed" over the headliners. No colon → the whole name is the headline | `format.test.ts › eventTile` | unit | PASS |
| 37 | The rail runs in calendar order, past then upcoming | `events.test.ts › byDateAscending` | unit | PASS |
| 38 | Tiles in date order with headliners; no "Fight Night" text; the today marker sits between past and upcoming; clicking navigates and moves `aria-current` | `site.spec.ts › event tiles run in date order…` | e2e | PASS |
| 39 | Every tile is ≥44 px tall at 360 px | `site.spec.ts › event tiles are comfortable touch targets` | e2e | PASS |
| 40 | Landing on the last event at 360 px, its tile is fully on screen | `site.spec.ts › the selected tile is in view on a phone` | e2e | PASS |
| 41 | The rail's scrollLeft carries over to the next event page | `site.spec.ts › the rail keeps its scroll position…` | e2e | PASS |
| 42 | The rail is pinned to the top after scrolling the page | `site.spec.ts › the event rail stays at the top…` | e2e | PASS |
| 43 | Speculation rules prerender eagerly; an active `@view-transition` rule exists; the selected tile is `view-transition-name: current-event` | `site.spec.ts › switching events prerenders eagerly…`, `build.test.ts` | e2e/build | PASS |
| 44 | No JS files, and at most one inline script per page (the rail scroll keeper, <1.5 KB, no `src`) | `build.test.ts › ships no JavaScript beyond…` | build | PASS (replaces "ships zero JavaScript") |

Decision: the "zero JavaScript" invariant was relaxed to allow one inline scroll keeper, as approved in the plan. Without it, the rail jumps back to the start on every page, and a selected tile past the phone's edge stays hidden. The script restores position at `pagereveal`, so pages prerendered before the click still pick up the latest scroll. The user can still opt to remove it.

Checked by hand (screenshots at 390×844, 900 px and 1440×900, light and dark, real data): one centred row on desktop, and a swipeable row with a fade on narrower screens. The first desktop pass wrapped to two rows and made the sticky header tall; that was fixed with `justify-content: safe center` and no wrap. Not tested: the transition motion itself, keyboard traversal beyond the focus-ring style, and Safari/Firefox (the transition falls back to a plain navigation there).
