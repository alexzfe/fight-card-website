# TDD evidence: Elo on the site (Astro)

- **Source plan:** `docs/ELO.md` (**Display**, and **Contract** › Site `Fighter` fields) and the site brief for the Elo build.
- **Owner:** site agent. **Branch:** `feat/elo-rating-site` (from `feat/elo`).

## User journeys

1. As a visitor, I see each fighter's current Elo next to their record (`21-4-0 · Elo 1612`), and nothing when it is unknown.
2. As a visitor, I see a fighter's pound-for-pound rank with their Elo (`Elo 1690 · #4 P4P`).
3. As a visitor, I can tell a thin rating (`provisional`) or a stale one (`inactive`) from a quiet tag, without it competing with the name.
4. As a visitor, I can see a fighter's career peak by hovering over the Elo, tapping it, or tabbing to it. A screen reader hears it without any of these.
5. As the operator, data written before these fields existed still builds, and a P4P rank below 1 fails the build.

## Checkpoint commits (on `feat/elo-rating-site`)

| Commit | Stage | Evidence |
|---|---|---|
| `3bce1c1` | RED (from the orchestrator session) | Elo next to the record, nothing when unknown. |
| `725e301` | GREEN | The diff left uncommitted in the main checkout, applied unchanged. `npm test` 87/87, `npm run test:e2e` 26/26, `astro check` 0 errors. |
| `5218e29` | RED | vitest: 7 failed / 89 passed (`formatEloPeak is not a function`, `eloTags is not a function`, `expected 'Elo 1690' to be 'Elo 1690 · #4 P4P'`, defaults `expected [ undefined, undefined, …(2) ]`, `p4p_rank: 0` did not throw). Playwright: 5 failed / 26 passed (`Received: "Elo 1690"`; no `elo-tag`; `data-tip` was `""`; no `elo-peak`; the tap point hit nothing). |
| `82ee39a` | GREEN | `npm test` 96/96, `npm run test:e2e` 31/31, `astro check` 0 errors. |

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | `Elo 1690 · #4 P4P` with a rank, `Elo 1690` without one, null when the Elo is unknown (even if a rank is set) | `tests/unit/format.test.ts › formatElo` | unit | PASS |
| 2 | `Peak 1793`; null before there is a peak | `format.test.ts › formatEloPeak` | unit | PASS |
| 3 | Tags in the order `provisional`, `inactive`; empty when neither applies | `format.test.ts › eloTags` | unit | PASS |
| 4 | `fighters.json` without any Elo field still loads: `elo_peak`/`p4p_rank` are absent, and the two flags default to `false` | `tests/unit/data.test.ts › defaults the Elo fields…` | unit | PASS |
| 5 | `p4p_rank: 0` fails the build with `p4p_rank` in the message | `data.test.ts › fails on a P4P rank below 1` | unit | PASS |
| 6 | The Elo sits next to the record; nothing when it is unknown | `tests/e2e/site.spec.ts › a corner shows the Elo…` | e2e | PASS |
| 7 | A ranked fighter reads `Elo 1690 · #4 P4P`; an unranked one stays `Elo 1612` | `site.spec.ts › a ranked fighter shows the P4P rank…` | e2e | PASS |
| 8 | `provisional` and `inactive` tags appear in the muted colour; no tag on an established, active fighter; no tag when the Elo is unknown, even if flagged inactive | `site.spec.ts › provisional and inactive are quiet tags…` | e2e | PASS |
| 9 | The Elo carries `data-tip="Peak 1793"`. Its tooltip is hidden, shows on hover, hides when the pointer leaves, and shows on focus. Without a peak there is no tip and no Tab stop | `site.spec.ts › the peak shows in a tooltip…` | e2e | PASS |
| 10 | The peak is in the DOM as screen-reader-only text (`Peak 1793`), and only when there is a peak | `site.spec.ts › screen readers hear the peak…` | e2e | PASS |
| 11 | At 360 px the Elo's hit area is 44 px tall, running up from the label's bottom edge, and the Stats toggle below still gets its own taps | `site.spec.ts › an Elo with a peak is a 44px tap target…` | e2e | PASS |

Fixtures (`tests/fixtures/data/fighters.json`, on the home card):

| Fighter | Fields | Case |
|---|---|---|
| Alex Alpha | `elo` 1612, `elo_peak` 1655 | unranked, with a peak |
| Bruno Bravo | `elo` null, `elo_inactive` | unknown: nothing shown |
| Carla Charlie | `elo` 1690, `p4p_rank` 4, `elo_peak` 1793 | ranked, with a peak |
| Dana Delta | `elo` 1488, `elo_provisional` | provisional, no peak |
| Eli Echo | `elo` 1531, `elo_peak` 1604, `elo_inactive` | inactive, with a peak |

## Commands and final output

```
$ cd site && npm test
 Test Files  6 passed (6)
      Tests  96 passed (96)

$ npm run test:coverage
All files     |   99.25 |    98.73 |     100 |   99.11 |

$ npm run test:e2e
  31 passed (3.0s)

$ npm run check
- 0 errors
- 0 warnings
- 0 hints
```

## Notes and interpretations

- **Tooltip pattern:** this reuses the form-tile tip (`data-tip` + `::after`, shown on `:hover`/`:focus`; red corners grow rightwards, blue leftwards). The selectors were widened to `.elo[data-tip]` rather than copied. A native `title` was left out because it would show a second tooltip on top of the CSS one. The brief's "title plus an accessible label" is met with a screen-reader-only `Peak 1793` next to the label.
- **Tab stop:** unlike the form tiles (`tabindex="-1"`, because Stats lists the same fights), the Elo is `tabindex="0"` when it has a peak, because nothing else on the page shows the peak. It gets a `:focus-visible` ring in the accent colour, and a dotted underline hints that there is a tip. Without a peak it is plain text.
- **Tap target:** the first version centred a 44 px `::before` on the label. A probe at 360 px showed it ran 13 px into the Stats toggle below and would steal its taps. The area now runs 44 px *up* from the label's bottom edge, over the name, which is not interactive. The RED test (#11) checked a centred area, so it was rewritten in the GREEN commit to assert the upward area and that the toggle keeps its taps. The rewritten version was not run against the RED code.
- **No mid-label wrap:** at 360 px, `Elo 1690 · #4 P4P` broke after the `·`. `.elo` is now `white-space: nowrap`, so on a narrow corner the label moves to its own line (as for Carla Charlie in the fixtures).
- **Tags when the Elo is null:** hidden. The spec says "null / hidden when the rating is unknown", and a lone `inactive` with no number reads as noise.

## Coverage and known gaps

- `.astro` components are not instrumented by v8. The corner is covered by e2e #6–#11.
- Checked by hand from 360 px screenshots, light and dark, with the tip open: the tags are quiet outlined pills and the tip sits above the label. No test asserts contrast; the tags use `--color-muted` on the page background, the same colour as the existing record text.
- Not tested: a blue-corner fighter with a peak (no such fighter is on the fixture home card; the `.corner-blue` tip rule is shared with the form tiles), tap behaviour on a real touch device, and Safari/Firefox.
- The 50 KB home-page budget and the inline-script limit still pass (`tests/build/build.test.ts`, part of `npm test`).
