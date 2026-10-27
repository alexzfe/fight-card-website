# TDD evidence: the Rankings tab (site side of phases 3+4)

**Source plan:** the rankings brief (`rankings-page-plan` in the project notes): a P4P-only `/rankings/` page, men's top
15 and women's top 10 with headshots on those entries only, plus a search over every active fighter's Elo. The engine
writes `data/rankings.json` (contract below); this branch is the site half, built against fixtures.
**Branch:** `feat/rankings` (from `main` at da0d7b5, worktree `fight-card-website-rankings`). Not pushed.
**Shapes:** `docs/CONTRACT.md` ("From the /v1/ API"), `site/src/lib/schema.ts` (`Rankings`).

## User journeys

1. As a visitor, I want a Rankings tab with the men's and women's pound-for-pound top lists, with headshots, so I can
   see who our Elo rates highest. A note says these are our ratings, not the UFC's, and links how Elo works.
2. As a visitor, I want to type a name and see that fighter's Elo, division and P4P rank, ignoring case and accents.
3. As the site owner, I want the page to cost almost nothing: static, no JS beyond one small inline search script that
   the page works without, headshots only for P4P entries and lazy, no prerender, other pages untouched beyond the tab.
4. As the site owner, I want the site to build exactly as before while `/v1/` doesn't serve `rankings.json`: no page,
   no link.

## Fixtures

- `site/tests/fixtures/data/rankings.json`: hand-made. 3 men and 2 women, three of them with the fixture PNGs and two
  with the initials fallback; 8 active fighters, one with an accented name (`Joaquín Juliét`), one with no division,
  two provisional (one of them P4P).
- `site/tests/fixtures/v1/rankings.json`: **hand-made from the snapshot's fighters, not `fightcard publish` output**
  (the engine's rankings aren't published yet). Real ids, names, Elo and webp headshots; the 4 men and 2 women the
  snapshot ranks, renumbered 1..n because the snapshot holds only a slice of the real top 15 / top 10; every fighter
  with an Elo and not inactive is in `active` (121). Divisions come from each fighter's latest fight in the fixture.

## Round 1: `fetch_v1.py` takes `rankings.json` (task 1)

RED (`a64a0e9`): 2 failed, 191 passed, 2 skipped. GREEN (`5fe3af5`): `scripts/tests` 193 passed, 2 skipped.
`rankings.json` joins `TOP_FILES` but not `REQUIRED`.

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A snapshot with `rankings.json` (contract 1.1) is accepted and the file lands in `data/` byte for byte | `test_fetch_v1.py › test_rankings_json_is_optional_and_kept_when_present` | unit | PASS |
| 2 | Every earlier test still passes without the file, so it stays optional | the existing happy-path tests | unit | PASS |
| 3 | A `rankings.json` that isn't JSON is refused as "rankings.json is unreadable", `data/` untouched | `… › test_rankings_json_that_is_not_json_is_refused` | unit | PASS |
| 4 | `rankings.json` as a directory is still "unsafe" | `… › test_rankings_json_as_a_directory_is_refused` | unit | PASS (green already at RED: the check is the existing one) |

## Round 2: schema and loader (task 2)

RED (`da2011c`): 15 failed, 131 passed. GREEN (`7bc66ec`): 146 passed, `astro check` 0 errors. `loadData` returns
`rankings: Rankings | null`.

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 5 | The contract shape parses; empty lists are fine; `division`, `image`, `p4p_rank` may be null; `provisional` defaults false | `schema.test.ts › Rankings` | unit | PASS |
| 6 | `as_of` must be YYYY-MM-DD, Elo an integer, ranks positive integers, both P4P lists and `active` present | `schema.test.ts › Rankings` | unit | PASS |
| 7 | The fixture loads: both lists in rank order, 8 active rows | `data.test.ts › loadData rankings` | unit | PASS |
| 8 | No `rankings.json` → `rankings` is null and everything else loads | `data.test.ts › is null when…` | unit | PASS |
| 9 | Invalid JSON or a bad entry fails with `rankings.json` and the field path in the message | `data.test.ts › fails on invalid JSON…`, `… violates the contract` | unit | PASS |
| 10 | A P4P `image` that isn't in `data/` fails the build, like a fighter's | `data.test.ts › fails when a P4P headshot is missing` | unit | PASS |
| 11 | A P4P list whose ranks aren't 1..n in order, or an `active` list not best-Elo-first, fails | `data.test.ts › fails when a P4P list…`, `… active list…` | unit | PASS |
| 12 | The `/v1/` fixture's rankings load with webp headshots and a full active list | `schema.test.ts › the /v1/ snapshot fixture rankings` | unit | PASS |

Not enforced: the contract says a P4P entry has "the same rank/elo as `fighters.json`'s `p4p_rank`/`elo`". Both come
from one snapshot, so a mismatch would be an engine bug, but failing the whole site build on it seemed harsher than
showing the engine's number. The fixtures don't mirror `fighters.json` either.

## Round 3: the Rankings tab, page, search and budget (tasks 3 and 4)

RED (`10714d8`): `npm test` 6 failed / 149 passed plus `rankings.test.ts` failing to import; `npm run test:e2e`
11 failed / 40 passed. GREEN (`48b8901`): `npm test` 160 passed, e2e 51 passed, `astro check` 0 errors.

Choices:

- **A dynamic route, `src/pages/[rankings].astro`**, not `rankings.astro`: a static page file always builds, and the
  brief wants no page at all when the data is absent. `getStaticPaths` returns one path, or none.
- **Tabs "Fight cards" and "Rankings"** in a `<nav aria-label="Site">` above the rail, only when rankings exist. Fight
  cards carries `aria-current="true"` (a section) and Rankings `"page"`, so `nav [aria-current="page"]` in the existing
  tests still means the rail's one current event.
- **The active list is one JSON block** (`<script type="application/json" id="rank-data">`), rows
  `[name, Elo, division, P4P label, provisional]` without ids, not 600+ rows of markup. A P4P label says "women's" for
  the women's list, because rank 3 exists in both and an active row doesn't say which.
- **The search script** (1.6 KB, no `src`) builds results with `textContent`, never HTML. The form is `hidden` until
  the script runs, so without JS there is no dead search box.
- **P4P provisional flag** comes from the `active` row with the same id; the P4P entry carries none.
- **The rankings CSS is a `<style is:global>` in the page**: only `/rankings/` carries it. The site-wide stylesheet
  gets just the tab rules.
- Headshots go through the existing `Avatar` (avif + webp, fixed size, lazy); its prop type is now
  `Pick<Fighter, 'name' | 'image'>` so a P4P entry can use it.
- Not in the eager speculation rules (which still name only `/events/*`).

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 13 | `searchRows` keeps the active order, labels `#1 P4P` / `#1 women's P4P` / none, writes "" for no division, 1 for provisional | `rankings.test.ts` | unit | PASS |
| 14 | `provisionalIds` lists the fewer-than-3-fights fighters; `scriptJson` can't close its `<script>` | `rankings.test.ts` | unit | PASS |
| 15 | Rankings tab on every page, Fight cards tab back; `aria-current` moves | `site.spec.ts › a Rankings tab on every page…` | e2e | PASS |
| 16 | Men and women ranked apart, best first, with division and Elo | `site.spec.ts › ranks men and women apart…` | e2e | PASS |
| 17 | Headshots where there is one, initials where not; provisional is a quiet word | `site.spec.ts › shows headshots…`, `marks provisional…` | e2e | PASS |
| 18 | The note says "not official UFC rankings", the as-of date, and links `/how-it-works/#elo` | `site.spec.ts › says these are our Elo ratings…` | e2e | PASS |
| 19 | Search ignores case and accents, shows Elo, division, P4P rank and provisional; a typo finds nothing | `site.spec.ts › searches the active fighters…` | e2e | PASS |
| 20 | Results swap with the P4P lists and back; best Elo first; "No active fighter matches"; "1 of 8 active fighters" | `site.spec.ts` (3 tests) | e2e | PASS |
| 21 | JS off: lists show, search hidden | `site.spec.ts › works without JavaScript…` | e2e | PASS |
| 22 | 360 px: no horizontal overflow, input and tabs ≥44 px | `site.spec.ts › fits a 360px phone…` | e2e | PASS |
| 23 | The page is built and linked from every page; speculation rules never name it | `build.test.ts` | build | PASS |
| 24 | Exactly the P4P headshots with a photo are `<img>`, each lazy with width and height; the active list is in the JSON block, not the markup | `build.test.ts`, `v1-build.test.ts` (real webps, avif sources) | build | PASS |
| 25 | At most one extra script on `/rankings/` (the search, <2 KB, no `src`); every other page keeps its one | `build.test.ts › ships no JavaScript beyond…` | build | PASS |
| 26 | Without `rankings.json`: builds, no `/rankings/`, no tab, no link on any page | `rankings-build.test.ts › without rankings.json` | build | PASS (green already at RED: guards the absent case) |
| 27 | **Budget:** with 700 active fighters (more than the ~650 real ones) the page's HTML, inline CSS included, is ≤60 KB gzipped; no `.js` file, `<script src>` or stylesheet link | `rankings-build.test.ts › the rankings page budget` | build | PASS |

Changes to tests that existed before this branch (the new tab broke them; behaviour they check is unchanged):

- `event tiles run in date order…` selected a bare `nav`; it now selects the `Events` navigation.
- `tabbing through the rail…` pressed Tab from the top of the page; the two site tabs now come first, so it starts
  from the last of them.
- `ships no JavaScript beyond…` allowed one script per page; it now ignores `application/json` blocks and allows the
  search script on `/rankings/` only.

Two expectations in the new tests were wrong at RED and were corrected before GREEN: the data uses an ASCII `'` in
"Women's …", and the note links `/how-it-works/#elo` rather than the bare page. A build test that looked for the text
`site-nav` found the tab CSS rule; it now looks for the `<nav>` element.

Sizes (gzip -9 of the built HTML, CSS inlined; fixture data unless noted):

| Page | Before | After |
|---|---|---|
| `/` (fixtures) | 7,516 B | 7,580 B |
| `/` (v1 fixture) | 12,138 B | 12,221 B |
| `/how-it-works/` (fixtures) | 12,840 B | 12,918 B |
| `/rankings/` (fixtures, 8 active) | n/a | 7,945 B |
| `/rankings/` (v1 fixture, 121 active) | n/a | 9,892 B |
| `/rankings/` (700 active, the budget test) | n/a | 13,193 B |
