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

## Phase 2: rankings ↔ card links (`ui/2-links`)

### User journeys

1. As a visitor on a card, I want to tap a fighter's "#3 P4P" and land on their row in the rankings.
2. As a visitor on the rankings, I want to see which ranked fighters are booked next, and jump to that card.
3. As a visitor searching the rankings, I want the same "next bout" link on each result, and a clear button that fits the page.

### Design

- `Corner.astro` splits the P4P rank out of `formatElo` and wraps it in `a.elo-rank` (href from `rankingsHref` in
  `lib/rankings.ts`) only when `site.rankings` exists and the fighter has a P4P row there. The link sits inside the
  `.elo` span, so hovering or focusing it still shows the Elo tip.
- `/rankings/`: each P4P row is `id="<fighter-id>"`. Fighter ids are 16 hex characters, so no prefix is needed. Rows have
  `scroll-margin-top` (clear of the sticky rail) and a soft `--color-surface` band on `:target`.
- `nextBouts(events, fighters)` maps each fighter booked on an upcoming card to their soonest bout,
  `{ slug, label: "Oct 31 vs Bravo" }` (the opponent goes by surname, as event names do). It is computed at build time.
- `searchRows(rankings, bouts)` appends `[slug, label]` only for booked fighters. The search script renders it as
  `a.result-next`. The script moved to `components/RankSearch.astro` so it sits at the top level, like the rail's.
- The search box's `::-webkit-search-cancel-button` is a masked cross in `--color-muted` (`--color-text` on hover).

RED (851a518): the unit file failed to load (`nextBouts`/`rankingsHref` missing); build 2 failed, 193 passed; e2e 3
failed, 61 passed. GREEN: site 206 passed; astro check 0 errors; e2e 64 passed; build ok.

During GREEN, the clear-button e2e test was changed to read the pixels at the box's right end. Chrome returns no
computed style for `::-webkit-search-cancel-button`, so the RED version could never pass.

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A card's "#4 P4P" (men's) and "#1 P4P" (women's) link to `/rankings/#<id>`; the Elo tip still shows; following the link lands the row in view below the rail with a different background from the other rows | e2e `a P4P rank on a card links to the fighter's row…` | e2e | PASS |
| 2 | Each P4P row carries its fighter id, and the event page links to it | build `gives each P4P row its fighter id…` | build | PASS |
| 3 | No `/rankings/#` link on any page without `rankings.json` | rankings-build `shows no Rankings link on any page` | build | PASS |
| 4 | `nextBouts` picks the soonest upcoming bout whatever the event order and skips completed cards; `rankingsHref` is null without a row or a page | unit `nextBouts`, `rankingsHref` | unit | PASS |
| 5 | Search rows carry `[slug, label]` only for booked fighters | unit `searchRows`, build `rank-data` | unit/build | PASS |
| 6 | P4P rows and search results show "Oct 31 vs X →" linking to the event, in the muted colour | e2e `a fighter booked on an upcoming card links to it…` | e2e | PASS |
| 7 | The clear button is drawn in the muted grey | e2e `the search box's clear button…` | e2e | PASS |
| 8 | Rankings page stays under 24 KB gz with 700 fighters (fixture page: 8.7 KB gz) | rankings-build budget | build | PASS |
