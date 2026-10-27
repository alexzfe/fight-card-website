# TDD evidence: UI glanceability pass

**Source:** the 2026-10-27 UI audit and the plan the user approved after the nav mockups (option A: the rail is the
only top bar, with a pinned Rankings tile). There is one stacked PR per phase: `ui/1-nav` → `ui/2-links` →
`ui/3-trims` → `ui/4-polish`.

## Phase 1: navigation (`ui/1-nav`)

### User journeys

1. As a phone visitor, I want the card to start right under the event rail, so more fights fit on the first screen.
2. As a visitor on any page, I want Rankings one tap away in the rail, and the events one tap away from Rankings.
3. As a visitor, I want the current tile marked only when it really is the page I'm on.

### Design

- `.site-nav` (the pill tabs) is gone. `.toc` on how-it-works has its own rules.
- `EventRail.astro` adds `a.tile.tile-pin` after `ul.rail` inside `.rail-nav`, only when `site.rankings` exists. It holds an inline podium SVG and the
  `RANKINGS_LABEL` word, and it is `aria-current="page"` on `/rankings/`.
- `.rail-nav` is a flex row: the rail scrolls (`flex: 1; min-width: 0`) and the pin stays put (`flex: none`) after the rail's
  edge fade.
- On wide screens the rail spans the window: the events centre while they fit, and the pin sits at the window's right end.
  (Round 1 lined the tiles up with the 44rem card column; review found that hid events that fit on the window, see Round 2.)
- The rail script is unchanged. The pin is outside `.rail`, so the saved position, centring and focus handling don't see it.
- Speculation rules add `/` and `/rankings/` at `moderate` (only `/` when there's no rankings page). Events stay `eager`.

### Round 1

RED (3fe9c0c): build 1 failed, 198 passed; e2e 6 failed, 55 passed. GREEN (6dfc37e): site 199 passed; astro check 0 errors;
e2e 61 passed; build ok.

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | On `/`, an event page, `/rankings/`, how-it-works and the 404, the rail is the body's first child and sits at y=0. Exactly one tile is current on cards and rankings, and none on how-it-works and the 404 | e2e `the event rail is the topmost thing on every page…` | e2e | PASS |
| 2 | The pinned tile is a link named Rankings that leads to `/rankings/`. It is current there, with the selected tile's background and `current-event` view-transition name, and event tiles lead back | e2e `a Rankings tile pinned to the rail…` | e2e | PASS |
| 3 | At 360px the pin is in view, is ≥44px tall, has the same top and height as the event tiles, holds still while the rail scrolls, and the last tile scrolls clear of it | e2e `the Rankings tile holds still…` | e2e | PASS |
| 4 | At 1280px (round 2) the pin sits at the window's right end, every event tile is fully in view left of it, and the rail has nothing to scroll | e2e `on a wide screen every event is in view…` | e2e | PASS |
| 5 | The first Tab lands on the first event tile (no tabs before the rail) | e2e `tabbing through the rail…` (updated) | e2e | PASS |
| 6 | The 404 page's link reaches the card | e2e `the 404 page leads back…` | e2e | PASS (already true; pinned) |
| 7 | Every page's speculation rules: events eager, `/` + `/rankings/` moderate | build `prerenders the home and rankings pages on intent…` | build | PASS |
| 8 | No Rankings link anywhere without `rankings.json` | rankings-build `shows no Rankings link on any page` | build | PASS |

Measured on the fixture build at 390x844 (home): the h1 moved from 126px to 74px, and 3 fights are fully visible
instead of 2.

### Round 2 (review of PR #13)

The review found that lining the rail up with the 44rem card column cut events off on desktop: the pin took ~140px of the
column, leaving room for about 2½ event tiles with ~450px of empty bar on each side. The rail now spans the window, which is
the other layout the brief allowed.

RED (38562ba): e2e 1 failed, 60 passed. GREEN (95b3587): site 199 passed; astro check 0 errors; e2e 61 passed.

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 4 (replaced) | At 1280px the pin sits within 32px of the window's right edge, every event tile is in view left of it, and the rail has nothing left to scroll | e2e `on a wide screen every event is in view…` | e2e | PASS |
