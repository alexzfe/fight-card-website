# TDD evidence: live results in the browser (Astro + a small client script)

- **Source:** the 2026-11-08 live fight night plan, phase 4. On fight night 2026-11-07 the engine had 14/14 results at
  04:17Z while the site still showed 6/14 from 00:44Z: GitHub's refresh cron runs every 3-5 h, plus a rebuild. Phase 1
  (#25) keeps the live card on the home page; this phase fills in its results in the browser between rebuilds.
- **Branch:** `feat/live-poll`, stacked on `feat/live-current-event` (#25, `74cbbab`).

## User journeys

1. As a visitor watching a fight night, a bout that gets a result switches to the completed look within about a minute,
   with no reload: WIN chip, dimmed loser, method and "R2 · 4:54" in the centre, the Elo change chip.
2. As that visitor, I can see which bout is on now ("Live now") and how fresh the data is ("Live · updated 3 min ago").
3. As a visitor on a running card, the header says "Live" and the rail tile reads live, not "Results"/past; when the
   last result lands they turn to "Results".
4. As a visitor without JS, or while the API is down, the page is exactly the static build: no error, nothing removed.

## Checkpoint commits (on `feat/live-poll`)

| Commit | Stage | Evidence |
|---|---|---|
| `64a62a8` | RED | `npx vitest run`: 12 failed / 277 passed, and `live.test.ts`, `live-card.test.ts` and `live-mock.test.ts` failed to import (`src/lib/live*.ts` missing). `vitest -c vitest.component.config.ts`: the file failed to import `../../src/lib/live`. `npm run test:e2e`: 8 failed / 89 passed (no "Live" header, no marker, rows never flip). The 2 e2e tests that passed check that nothing is added (finished/far-out cards; no JS). |
| `ddb953d` | GREEN | `npx vitest run` (unit + component projects) 351 passed; `npm run test:e2e` 97 passed; `astro check` 0 errors. |
| `8cff0a9` | REFACTOR | prettier on the new files, `applyFight` loop tidied, dev mock pace; the same 351 / 97 / 0. |

**Tests changed after RED**, and why:
- `tests/component/live-row.test.ts`: `canon()` now sorts the tokens in `class` and merges adjacent text nodes
  (`normalize()`). Astro's `class:list` and `classList.add` order classes differently, and Astro writes `{' '}` as its
  own text node. Neither changes what is shown, and every other attribute and the text still have to match exactly.
- `tests/build/build.test.ts` and `rankings-build.test.ts` said "no .js file in dist". Astro always emits the live
  script's module, even when no page uses it. The tests now allow that one file (`LivePoll.astro_*.js`) and still check
  that no page there loads it (no `<script src>`). `live-build.test.ts` checks the pages that do load it.
- `vitest.config.ts` now runs two projects (unit, and component with Astro's Vite setup), so `npm test` and coverage
  cover both.

Coverage (`npx vitest run --coverage`): all files 95.72% statements, 90.35% branches; `live.ts` 96.8%, `live-row.ts`
98.9%. `live-mock.ts` is 46.7%: its middleware only runs under `astro dev` and was checked by hand (below).

Also checked by hand: `DATA_DIR=tests/fixtures/live npx astro dev --port 4341`, opened `/?live-api=/__live-mock` in
headless Chromium at 1100px and 390px. The co-main showed "Live now", the build-time prelims got their Elo chips, and
after the replay the main event and co-main flipped, the header said "Results", and the marker and live line went away.

## How it works

- `src/lib/live.ts` (pure, in the bundle): `parseLiveEvent` checks only the fields the page reads, as strictly as
  `schema.ts`, without bundling zod. `mergeEvent` only adds: a result to a bout without one, an Elo to a
  decided bout without one. `liveNowId` picks the bout in progress (below). `createPoller` runs the loop: fetch at once,
  then every 60 s, backing off 60 s → 2 → 4 → 5 min on errors or bad JSON; it pauses in a hidden tab, waits without
  fetching before the card's date, and stops when the card is complete or no longer live (`isLive` from `events.ts`,
  with the browser clock).
- **Running order:** the card lists the main event first, so the bouts run bottom-up. The bout in progress is the one
  right before (in the list) the first bout with a result. Unresolved bouts after it in the list ran earlier and were
  cancelled. There is no marker before the first result, or once the main event has one.
- `src/lib/live-row.ts` (DOM): `applyFight` adds exactly what `FightRow.astro`/`Corner.astro` render for a completed
  fight, from the same `format.ts` helpers (`resultParts`, `eloAtFight`, `tagTip`). `markLiveNow` and `renderCard`
  handle the marker, the header word, the "updated" line and the rail tile.
- `LivePoll.astro`: the card as built goes in as JSON (`#live-card`: bouts, results, Elo, each corner's Elo tags,
  `since` = `index.generated_at`). The processed script imports the two modules: 7.2 KB minified, 3.1 KB gzipped,
  one cached file.
- **Server side:** `cardPhase(event, buildNow)` gives the header word and the tile style (`tile-live`).
  `carriesLivePoll(event, buildNow)` decides which pages get the script. `FightRow` rows carry `data-fight-id`.
- **"Updated N min ago":** counts from the response's `Last-Modified` when the server sends it (a CORS-safelisted
  header), else from when the page saw a change, else from the build's `generated_at`.
- **API origin:** `LIVE_API` at build time (`resolveLiveApi`, https or localhost only), default
  `https://ufc-data.xlobax.com`. `?live-api=` only works under `astro dev` (`__LIVE_DEV__`, set by the dev-only
  `live-mock` Vite plugin). `import.meta.env.DEV` was not enough: a build run with `NODE_ENV=test` keeps it true.

## Test specification

| # | What is guaranteed | Test | Type |
|---|---|---|---|
| 1 | The engine event file parses; unknown fields are ignored; a wrong id, bad date, bad result/round/winner/method, fractional Elo or rank 0 is rejected | `tests/unit/live.test.ts › parseLiveEvent` | unit |
| 2 | Complete means every bout has a result, never an empty card | `› isComplete` | unit |
| 3 | Live now: none before the first result; the next bout in running order; skips a cancelled bout; none when complete or the main event is decided; the fixture picks the co-main | `› liveNowId` | unit |
| 4 | The merge only adds: new result plus Elo; never removes or rewrites a result; adds a late Elo and never drops one; ignores Elo without a result and unknown bouts; no mutation | `› mergeEvent` | unit |
| 5 | "Live · updated just now / N min ago / N h ago", clock skew reads as just now | `› liveLine` | unit |
| 6 | Poll every 60 s; backoff 60 s → 2 → 4 → 5 min, capped | `› backoffMs`, `› createPoller › backs off…` | unit |
| 7 | Poller: fetch at once; stop when complete; never start on a complete card or past the grace; wait before the date without fetching; pause when hidden and fetch at once on show; no start while hidden; never two fetches at once; `since` from Last-Modified, else the change seen | `› createPoller` | unit |
| 8 | The marker moves and clears; the header reads Live/Results; the line shows/hides; the tile goes live/past; phase null changes nothing | `tests/unit/live-card.test.ts` | unit (happy-dom) |
| 9 | **A row patched live equals the server-built completed row** (real `FightRow` via Astro's container API): red KO main event title fight, blue decision on an unscored bout, draw, winner only, result before Elo, fighters without today's Elo; Elo arriving later; idempotent; a server-completed row is never touched; no result changes nothing | `tests/component/live-row.test.ts` | component |
| 10 | `cardPhase` and `carriesLivePoll` windows | `tests/unit/events.test.ts` | unit |
| 11 | `LIVE_API`: prod default, https/localhost only, no trailing slash | `tests/unit/build-time.test.ts › resolveLiveApi` | unit |
| 12 | The dev mock reveals one more bout per step in running order | `tests/unit/live-mock.test.ts` | unit |
| 13 | Live fixture build: one script only on the live card's pages, under 8 KB, prod origin, no dev override in the bundle; the embedded card; `data-fight-id` rows; hidden line; "· Live" header and `tile-live` | `tests/build/live-build.test.ts` | build |
| 14 | In Chromium, API mocked via `page.route` with `Access-Control-Allow-Origin: *`, clock pinned: header/tile live; marker plus "updated 6 → 8 min ago"; a result flips the row (outcome, WIN chip, lost corner, Elo chips) and the marker moves; the live row has the same parts as a build-time completed row; polling stops when complete and the card reads "Results"; 503 and garbage leave `<main>` unchanged and back off; never removes a result; the event page polls; finished and far-out cards make no request; no JS changes nothing | `tests/e2e/live.spec.ts › live results`, `› without JavaScript` | e2e |
