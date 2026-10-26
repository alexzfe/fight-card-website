# TDD evidence: Elo display rework and the how-it-works page (Astro)

- **Source:** the 2026-10-26 UI session. The user asked for fewer tooltips, a labelled finish meter and bigger
  headshots, with the Elo still readable at a glance; then a separate page explaining both numbers in depth.
- **Branch:** `feat/elo-ui` (from `feat/elo`). Supersedes the display in `elo-site.tdd.md` (peak tooltip, boxed tags).

## User journeys

1. As a visitor, I read each fighter's Elo at a glance: on its own line under the record, in full-strength text.
   `provisional` / `inactive` follow it as quiet, unboxed words.
2. As a visitor, nothing on the card hides behind a tooltip. Peak and best win are under Stats, next to height,
   reach, stance and age.
3. As a visitor, I can tell what the meter means: every fight says "Finish chance" above it, upcoming or completed.
4. As a visitor, I can see the fighters: headshots are 64 px on phones and 72 px wider (main event 88/96 px).
5. As a visitor, the footer tells me what Elo, provisional and inactive mean, and links to a page that explains
   both numbers with formulas, charts and a worked example.
6. As the operator, a model re-export can't leave that page quoting old numbers: a unit test fails until
   `site/src/lib/finish-model.ts` is updated.

## Checkpoint commits (on `feat/elo-ui`)

| Commit | Stage | Evidence |
|---|---|---|
| `2fcbae9` | RED (card) | vitest: 3 failed / 94 passed (`formatBestWin is not a function` ×2; `best_win` loaded as `undefined`). Playwright: 7 failed / 25 passed (Elo still inline with the record; tags boxed; no Stats Elo rows; `[data-tip], [title]` present; no `finish-label`; headshots 48 px; footer without the tag line). |
| `fbe0bb3` | RED (page) | vitest: `elo-math.test.ts` and `finish-model.test.ts` fail to load (modules missing); 97 passed. Playwright not run at this commit; the page tests failed against the card-only tree before `03c4d36` (no footer link, no page styles). |
| `e0ed4d2` | GREEN (card) | Card e2e tests all pass. The two page tests that need the footer link and page styles still fail, as expected until the next commit. |
| `03c4d36` | GREEN (page) | `npm test` 107/107, `npm run test:e2e` 37/37, `astro check` 0 errors. One test changed after RED: the page's h1 includes its kicker ("Methodology: How finish chance and Elo work"), as event headings do. |

## Test specification

| # | What is guaranteed | Test | Type |
|---|---|---|---|
| 1 | `formatBestWin` gives opponent over `Elo 1684 · Jun 2022`; null without a win | `tests/unit/format.test.ts › formatBestWin` | unit |
| 2 | `best_win` loads from `fighters.json`, and data without it still loads | `tests/unit/data.test.ts › keeps the best win`, `› defaults the Elo fields…` | unit |
| 3 | Expected score, K, decay and the rating change match `docs/ELO.md` (64% at +100; K 144.46 at debut, 93.09 after 10; 1700 → 1680 → 1662; +31.9 for the worked example; a split win costs a clear favourite) | `tests/unit/elo-math.test.ts` | unit |
| 4 | The page's finish-model numbers equal `model/manifest.json` and `model/thresholds.json`; importance shares total 100% | `tests/unit/finish-model.test.ts` | unit |
| 5 | The Elo sits on its own line under the record, in the body text colour; nothing when unknown | `site.spec.ts › a corner shows the Elo on its own line…` | e2e |
| 6 | Tags are muted, unboxed words; none on an established, active fighter or an unknown Elo | `site.spec.ts › provisional and inactive are quiet unboxed words…` | e2e |
| 7 | Stats has Elo (with P4P), Peak and Best win rows, each only when either corner has a value | `site.spec.ts › Stats lists each corner's Elo, peak and best win` | e2e |
| 8 | No `[data-tip]` or `[title]` on the upcoming or the completed card | `site.spec.ts › nothing on the card hides behind a tooltip` | e2e |
| 9 | Every fight has a visible "Finish chance" caption, upcoming and completed | `site.spec.ts › the finish meter is labelled…` | e2e |
| 10 | Headshots are 64/72 px, main event 88/96 px | `site.spec.ts › headshots are 64px on phones…` | e2e |
| 11 | The footer explains provisional and inactive | `site.spec.ts › the footer explains the Elo tags` | e2e |
| 12 | The footer links to `/how-it-works/`; the page has both sections, at least 6 formulas and 5 labelled charts, the tier cut points and the High tier's 62%, the worked example's +32, and fits 360 px | `site.spec.ts › how it works page` | e2e |

Fixture change: Alex Alpha gains `best_win` {Finn Foxtrot, 1702, 2025-09-20}.

## Commands and final output

```
$ cd site && npm test
      Tests  107 passed (107)

$ npm run test:e2e
  37 passed

$ npx astro check
- 0 errors
```

## On a model re-export

`tests/unit/finish-model.test.ts` fails until `site/src/lib/finish-model.ts` matches the new export. Copy the
values from `model/manifest.json` and `model/thresholds.json`. Recompute `importance` from `model/model.txt`:
total gain per column, grouped by base feature (strip `_min`/`_max`/`_sum`/`_absdiff`/`_pair`) into the seven
themes listed in that file.
