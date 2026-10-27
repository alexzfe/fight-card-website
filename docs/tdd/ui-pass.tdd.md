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

### Round 1 (review of PR #14)

The review found the "next bout" links were ~20px tall tap targets (should-fix) and offered three nits worth doing: the
arrow was read aloud, and the fixture's rank on the card (#4) did not match the row it links to (#3).

RED (e2a444b): e2e 2 failed, 62 passed. GREEN (c2ee831): site 206 passed; astro check 0 errors; e2e 64 passed. Fixture fix (019913e):
same counts.

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 9 | At 360px the P4P row's and the search result's next-bout links are ≥44px tall | e2e `fits a 360px phone, with comfortable touch targets` (extended) | e2e | PASS |
| 10 | The next-bout links' accessible name is "Oct 31 vs Delta", with the arrow drawn by `::after` | e2e `a fighter booked on an upcoming card links to it…` (extended) | e2e | PASS |

The arrow is CSS (`content: ' →' / ''`) rather than an `aria-hidden` span: the search script had no room left under its
2048-byte budget for the span, and the CSS arrow adds none. The fixture's Carla Charlie is now #3 on both her card and the
rankings; the three e2e expectations that said "#4 P4P" say "#3 P4P".

## Phase 3: glanceability trims (`ui/3-trims`)

### User journeys

1. As a visitor scanning a card, I want each row to carry only what changes from row to row, not the same label and underlines again.
2. As a visitor checking a fighter's Elo, I want its tip to open without covering the name I am reading.
3. As a visitor at the bottom of any page, I want a short footer that explains what this page shows.

### Design

- `EventCard.astro` passes `finishLabel` to the first fight of each segment group. `FightRow.astro` keeps the "Finish
  chance" span on every row, so every badge is named for screen readers, but adds `.sr-only` below the first row.
- `.elo-line > [data-tip]` draws its dotted underline only on `:hover`/`:focus`. The P4P link keeps its own solid underline.
- Elo and tag tips use `top: calc(100% + 6px)`, so they hang below the line. Red tips still grow rightwards and blue tips
  leftwards. Form tile tips stay above, over the Elo line.
- Stats drops the "Elo" row, which repeated the corner's Elo. "Peak" and "Best win" stay.
- `Base.astro` takes `page: 'card' | 'rankings' | 'method'`:
  - card pages get the tiers + "—" line, and rankings gets the Elo line;
  - the method page gets neither line and no link to itself;
  - 404 keeps the date line and the link.
- The model date and the method link share one line. The lowercase "provisional…" sentence is gone: the tag tips say it,
  and so does the rankings header note.

RED (5120f15): e2e 4 failed, 61 passed. GREEN: site 206 passed; astro check 0 errors; e2e 65 passed; build ok.

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | "Finish chance" shows on the first fight of each segment (home: main, prelims, early prelims; a card without segments: once), and every row carries the text | e2e `the finish meter is labelled once per card segment…` | e2e | PASS |
| 2 | The Elo has no underline at rest, a dotted one on hover; Elo (red) and tag (blue) tips start below their anchor | e2e `the Elo underline shows on hover or focus…` | e2e | PASS |
| 3 | Stats rows are Height, Reach, Stance, Age, Peak, Best win (when present) | e2e `Stats lists each corner's peak and best win…` | e2e | PASS |
| 4 | Card pages and rankings each have their own footer line; every page keeps the model date and attribution; the method link is on all but how-it-works | e2e `the footer explains what the page shows, in one line` | e2e | PASS |

Footer height at 390px: 134px on cards and rankings, 98px on how-it-works (220px before).

## Phase 4: polish (`ui/4-polish`)

### User journeys

1. As a visitor reading any page, I want text drawn crisply and headings that break into even lines, with no lone word at the end of a short paragraph.
2. As a visitor scanning headshots, I want a light-backed photo to keep its edge against the page in either theme.
3. As a visitor on a phone, I want a form tile to show its opponent when my tap lands just beside the tile, not only dead on it.

### Design

- `html` gets `-webkit-font-smoothing: antialiased` and `-moz-osx-font-smoothing: grayscale`.
- `h1`, `h2` and `.headline` get `text-wrap: balance`; `.event-meta`, `.site-footer` and `.lede` get `text-wrap: pretty`.
- `img.avatar` gets `outline: 1px solid rgb(0 0 0 / 0.1); outline-offset: -1px`, and white at the same alpha in dark mode. The initials avatar has none.
- `.form > span::before` (`::after` is the tooltip) is an empty absolute box: `inset: -3px -2.5px -7px` from inside the 1px border. So:
  - it fills half the 3px gap on each side, meeting its neighbour's without overlap;
  - it takes the 2px up to the Elo line and 6px of the Stats toggle's 44px row.
  - Each tile is 19×24px to a tap instead of 16×16, and looks the same.
- `.event-head` → `.page-head` and `.explainer-section` → `.page-section` on every page. The rankings page's `<style is:global>` moved to `src/styles/rankings.css`, which only that page imports, not into `global.css`:
  - `global.css` is inlined into every page (`inlineStylesheets: 'always'`), so the rankings rules would have added 515 bytes gzipped to each card (8270 → 8785 B on the fixture home page).
  - They would also have broken the existing guard "keeps the rankings data, markup and search script off every other page".
- No `transition: all` or `will-change` anywhere (grep).

RED (418e6cc): site 2 failed, 206 passed; e2e 3 failed, 65 passed. GREEN: site 208 passed; astro check 0 errors; e2e 68 passed; build ok.

During GREEN, the build test "keeps the rankings styles in global.css" became "…in a stylesheet beside global.css, which only the rankings page loads", for the reason above.

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | Text is antialiased; h1, .headline and h2 wrap balanced (home, how-it-works); .event-meta, footer and .lede wrap pretty (home, how-it-works, rankings) | e2e `polish › text is antialiased…` | e2e | PASS |
| 2 | Headshots have a 1px inset outline, black at 10% in light and white at 10% in dark | e2e `polish › headshots carry a faint inset edge…` | e2e | PASS |
| 3 | A tap 4px below a tile, or in the gap on its side, focuses that tile (its tip shows); the other half of the gap belongs to its neighbour | e2e `polish › a form tile answers a tap just outside its edge…` | e2e | PASS |
| 4 | Every page heads with `.page-head`; rankings and how-it-works use `.page-section` | build `shared page styles › heads every page…` | build | PASS |
| 5 | The rankings styles live in `src/styles/rankings.css`, with no `<style>` in the page; other pages still carry none of them | build `shared page styles › keeps the rankings styles…`, `keeps the rankings data, markup and search script off every other page` | build | PASS |
