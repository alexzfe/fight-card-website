# TDD evidence: past-event redesign (Astro)

- **Source:** the 2026-10-28 design discussion. Past events "don't look great": the ` W` glued to the winner's name
  read like a typo, the middle column showed `FINISH CHANCE —` then `→ KO/TKO R2 4:54` (no prediction is stored for
  past fights on prod, so the arrow pointed from a dash), the at-time Elo change `(+41)` read like a footnote with a
  tip that repeated the line, the form tiles showed today's form next to an old result, and the rail gave six past
  tiles the same weight as the upcoming ones.
- **Branch:** `feat/past-event-ui` (from `main`). Restyles `elo-at-fight.tdd.md`'s display. Step 1 of 3: the engine's
  form at fight time (contract 1.4) and the site's use of it follow.

## User journeys

1. As a visitor on a completed card, the middle column leads with how the fight ended: `KO/TKO` in bold over
   `R2 · 4:54`, then weight class and Title. The pre-fight badge, frozen at the start, stays below only when there
   was one; no dash, no arrow.
2. As a visitor, the winner's record line starts with an ember **WIN** chip and the loser's corner steps back (grey
   photo, muted name and Elo). A draw or no contest marks neither.
3. As a visitor, the at-time Elo change is a small chip: filled for a gain, outlined for a loss, so the direction
   reads without colour; nothing shows when nothing changed, and screen readers still hear "up 41" / "no change".
   The at-time Elo has no tooltip.
4. As a visitor, a completed fight shows no form tiles (today's form would count the fights after it) until the
   engine publishes form at fight time.
5. As a visitor, the rail reads forwards: past tiles drop `Results` and are borderless, smaller and muted. With no
   saved position it opens on what's next (on a wide screen the latest past tile stays in view beside the today
   marker); the selected tile is never left under an edge fade, the last one included. The list keeps growing
   leftwards.

## Checkpoint commits (on `feat/past-event-ui`)

| Commit | Stage | Evidence |
|---|---|---|
| `145cfc8` | RED | vitest: 8 failed / 246 passed (`resultParts` missing ×4; `eloAtFight` has no `change` and keeps `±0` ×3; `eventTile` still says `Results`). Playwright: 10 failed / 71 passed (`Results` on the past tile; past tiles look like upcoming ones; the rail opens on the oldest event; the selected tile sits under a fade; `High → KO/TKO R1 4:12`; no WIN chip or dimmed loser; form tiles on a completed fight; `(+26)` / `(±0)` and the tip; the delta is muted text, not a chip ×2). |
| `941fd5f` | GREEN | `npm test` 254/254, `npm run test:e2e` 81/81, `astro check` 0 errors. Tests changed after RED, each a fault in the test, not a weaker check: `clearOfFades` passed the rail's handle unawaited; the result test looked for `Lightweight` on a Heavyweight bout; the per-segment label test now expects no label on the fight with no frozen badge (journey 1); `eventTile` calls drop the unused `status`. |

## Test specification

| # | What is guaranteed | Test | Type |
|---|---|---|---|
| 1 | `resultParts`: `KO/TKO` / `R1 · 4:12`; missing parts skipped; null without a result or with an empty one | `tests/unit/format.test.ts › resultParts` | unit |
| 2 | `eloAtFight` gives `change: 'gain' / 'loss'`, and `delta: null, change: null, spoken: 'no change'` at 0 | `tests/unit/format.test.ts › eloAtFight` | unit |
| 3 | `eventTile` on a completed event: `Oct 18` over `Golf vs. Hotel`, no `Results` | `tests/unit/format.test.ts › eventTile` | unit |
| 4 | Result first: method larger than round/time and weight class; no `→`; the frozen `High` badge stays; no badge or label without one | `site.spec.ts › a completed fight leads with the result…` | e2e |
| 5 | WIN chip on the winner only; no `::after` on the name; the loser's photo greyscale and name muted; a draw marks neither | `site.spec.ts › the winner gets a WIN chip…` | e2e |
| 6 | No form tiles on a completed fight (Gus Golf has one recent fight in the fixtures) | `site.spec.ts › a completed fight shows no form tiles…` | e2e |
| 7 | At-time line `Elo 1548 +26 · #4 P4P`, `Elo 1502` at a no contest, no `data-tip`; screen readers still hear `(up 26)` / `(no change)` | `site.spec.ts › a completed fight shows each corner's Elo at the time…`, `› screen readers hear the at-time change in words…` | e2e |
| 8 | Gain chip filled, loss chip outlined, rounded, in light and dark | `site.spec.ts › the at-time change is a small chip… (light)`, `(dark)` | e2e |
| 9 | Past tiles: transparent border, smaller and differently coloured headline | `site.spec.ts › past tiles are quieter and smaller than upcoming ones` | e2e |
| 10 | With no event selected the rail opens with the first upcoming tile clear of the fades, and at 900px the latest past tile too | `site.spec.ts › with no event selected, the rail opens on what is next…` | e2e |
| 11 | The selected tile is clear of both fades on `/`, a past event and the last event, at 360px | `site.spec.ts › the selected tile is never left under an edge fade` | e2e |
| 12 | The inline rail script stays under 1500 characters | `tests/build/build.test.ts › ships no JavaScript beyond…` | build |

## Fixture changes

- `events/0000dddd0000dddd.json`: the no contest has no frozen tier (`finish_tier` and `tier_frozen_at` null), as
  every past fight on prod has today.
- `fighters.json`: Gus Golf has one recent fight, so the completed card has form to hide.
