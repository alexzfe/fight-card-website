# TDD evidence: the live card stays current (Astro + refresh.yml)

- **Source:** the 2026-11-08 live fight night plan, phase 1. On fight night 2026-11-07 (UFC Fight Night: Cortes Acosta
  vs. Walker) the home page already said "Next: Gane vs. Hokit" while the card was running: the engine flips an event
  to `completed` on its first result, and `nextEvent()` only picked `upcoming` events.
- **Branch:** `feat/live-current-event` (from `origin/main` at `2c44eab`).

## The rule (picked by the user)

An event is current at `now` if its date is today (UTC), or it has some but not all fight results and `now` is within
`RESULTS_GRACE_DAYS = 2` days after its date (a cancelled bout that never gets a result can't pin the card forever),
or all results are in and `now` is before 12:00 UTC the day after its date. "Live" is read from the fights' `result`,
never from `status`. A card with at least one result also counts from 00:00Z the day *before* its date: cards in
Australia and Asia start their prelims on the previous UTC day (review follow-up). Several qualify: a card with some
but not all results ranks first (it's still running), then the most recent date wins (review follow-up). None: the old behaviour (soonest upcoming, else latest
completed). `currentEvent(events, now)` in `site/src/lib/events.ts` is pure with no Node imports, so phase 4 can run
it in the browser.

## User journeys

1. As a visitor during a fight night, the home page shows tonight's card, with its results so far, not next week's,
   even after the first result and past midnight UTC.
2. As a visitor the morning after, the home page still shows last night's finished card until noon UTC, then the next
   one. The 12:30 UTC refresh run rebuilds and deploys so the static page flips without a data change.
3. As a visitor on the home page, the rail's current tile, the page title and the JSON-LD all name the same card.

## Checkpoint commits (on `feat/live-current-event`)

| Commit | Stage | Evidence |
|---|---|---|
| `789d101` | RED | vitest: 15 failed / 257 passed, plus `build-time.test.ts` failing to load (`currentEvent` / `RESULTS_GRACE_DAYS` / `resolveBuildNow` missing). Playwright: 3 failed / 84 passed (live fixture home page showed `UFC 324: Next vs. Upcoming`; the rail's current tile `Nov 14 · UFC 324`; JSON-LD the same). pytest: `test_should_run.py` and `test_workflows.py` fail to import `NOON_REBUILD_CRON` (compile-time RED). `astro check`: 3 errors (the missing exports). |
| `19edf21` | GREEN | `npm test` 275/275, `npm run test:e2e` 87/87, `uv run --project pipeline pytest scripts/tests` 259 passed / 2 skipped (actionlint not on PATH; a data-freshness skip), `astro check` 0 errors, `actionlint -shellcheck=` clean. No test changed after RED. |
| `61a5a06` | RED (review fixes) | vitest `tests/unit/events.test.ts`: 2 failed / 21 passed. A Sydney card dated 11-08 with 1 result at 11-07T22:30Z gave `next` (want `sydney`); a running 13/14 card dated 11-07 vs a 0-result card dated 11-08 at 03:00Z gave `sunday` (want `running`). The old "picks the most recent" test was replaced (its expectation flipped under the new ranking) and "ignores a future card" moved to a card 2 days out. |
| `bcc24b4` | GREEN (review fixes) | `npm test` 277/277, `npm run test:e2e` 87/87, `uv run --project pipeline pytest scripts/tests` 259 passed / 2 skipped, `astro check` 0 errors. |

Coverage (`npx vitest run --coverage`): all files 97.46% statements, 92.24% branches, over the 80% thresholds.

Also checked by hand: a build of the real `data/` (2026-11-08, card all done) shows `Latest: Cortes Acosta vs.
Walker` with the clock and with `BUILD_NOW=2026-11-08T04:17:00Z`.

## Test specification

| # | What is guaranteed | Test | Type |
|---|---|---|---|
| 1 | No card live: soonest upcoming, else latest completed, else undefined; input not mutated | `tests/unit/events.test.ts › currentEvent: fallback` | unit |
| 2 | `RESULTS_GRACE_DAYS` is 2 | `› keeps the grace at 2 days` | unit |
| 3 | A card dated today (UTC) is current before its first result, from 00:00:00Z to 23:59:59Z | `› is the card dated today (UTC) before its first result` | unit |
| 4 | A card dated today is current with status already `completed` | `› is the card dated today even when its status is already completed` | unit |
| 5 | The real 6/14 at 00:44Z the next day stays current | `› stays on a card with some results after midnight UTC` | unit |
| 6 | 13/14 stays current through day +2, lets go at day +3 00:00Z (cancelled bout) | `› stays on a card with some results for the 2-day grace, then lets go` | unit |
| 7 | 14/14 stays current until 11:59:59Z the next day, not at 12:00Z | `› stays on a finished card until noon…`, `› moves on from a finished card at noon…` | unit |
| 8 | Past noon with nothing upcoming: latest completed | `› falls back to the latest completed card…` | unit |
| 9 | Several qualifying: a card with some but not all results beats one with none (a Saturday card still running at 03:00Z vs a Sunday card), whatever the input order | `› ranks a card with some but not all results above one with none…` | unit |
| 9b | Same rank: the most recent date, whatever the input order (finished vs none; partial vs partial) | `› picks the most recent date among qualifying cards in the same rank` | unit |
| 9c | A card dated tomorrow with a result is current from 00:00:00Z the day before (Sydney prelims at 22:30Z), not at 23:59:59Z two days before | `› is a card dated tomorrow once it has a result, from 00:00Z the day before its date` | unit |
| 10 | A card with results more than a day out, and a fightless card from yesterday, are not live | `› ignores a card with results more than a day in the future`, `› treats a card with no fights as never finished` | unit |
| 11 | `BUILD_NOW` pins the build's now; unset/empty is the clock; a malformed one throws | `tests/unit/build-time.test.ts` | unit |
| 12 | Live fixture built at 2026-11-08T00:44Z: home h1, 4 fights and title are tonight's card, not the next | `tests/e2e/live.spec.ts › the home page keeps the live card, not the next one` | e2e |
| 13 | The rail's `aria-current` tile is the live card | `› the rail marks the live card as current` | e2e |
| 14 | The home JSON-LD SportsEvent is the live card | `› the home page structured data describes the live card` | e2e |
| 15 | The 12:30 UTC cron always runs the gate (`noon rebuild run`), sits at 12:15+ and is distinct from the daily one | `scripts/tests/test_should_run.py › test_noon_rebuild_*` | unit |
| 16 | `refresh.yml` has the noon cron, and `build` runs on it for both the pipeline and v1 sources; a stale `/v1/` on it stays quiet | `scripts/tests/test_workflows.py › test_refresh_has_noon_rebuild_cron…`, `› test_refresh_noon_rebuild_always_builds…`, the stale parametrize | unit |

## Fixture changes

- `site/tests/fixtures/live/` (new): three cards: a finished one (Oct 31), tonight's (Nov 7, status `completed`, 2 of
  4 bouts decided, main card not) and the next (Nov 14, upcoming). Served from `dist-live` by a second Playwright
  project (`live`) on port 4330 through `python3 -m http.server`, since `astro preview` only serves the configured
  outDir.
- Fixture builds (`build:fixtures`, `tests/build/*`) pin `BUILD_NOW=2026-10-24T06:00:00Z` (the fixture's
  `generated_at`), so they don't change behaviour as the real calendar passes the fixture dates.
