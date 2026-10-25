# ufc.xlobax.com — v1 Plan

A simple, fast, mobile-first site showing upcoming UFC fight cards, with a High/Medium/Low finish-chance badge per fight. One tap from landing to the next card.

Decided 2026-10-24 (research + grilling session).

## Product

- **Audience:** public, non-commercial. (Revisit the `ufc` subdomain and image sourcing if ads/affiliate links are ever added.)
- **Scope:** every upcoming UFC event listed on ufcstats.com (PPV, Fight Night, Apex — usually 5–7). Past events remain as results pages.
- **Home page = the next card.** A horizontal row of event chips (`UFC 3xx · Oct 25`, `Fight Night · Nov 1`, …) above the card. Each event has its own shareable URL (`/events/<slug>/`).
- **Per fight (visible):** fighter names, photos, records, weight class, title-fight flag, finish badge.
- **Per fight (tap to expand):** height, reach, stance, age.
- **Not in v1:** odds, percentages, live fight-night updates.
- **Finish badge:** `High` / `Medium` / `Low`, from the research model.
  - `—` if either fighter has zero prior UFC fights, or if the fighter snapshot is stale for that bout (see Model).
  - Sparse-history fighters are otherwise scored normally (LightGBM handles missing features).
- **Results:** after an event, its page shows outcomes (winner, method, round) next to the pre-fight badge, frozen at event start (e.g. `High → KO R1`).
- **Style:** minimalist, snappy, mobile-first. Follows system light/dark. No branding or accent colours yet — keep CSS easy to theme later (custom properties).
- **Footer:** "Finish model as of <export date>", data source attribution.

## Architecture

Fully static site, rebuilt on a schedule. No runtime server, no database.

```
GitHub Actions cron
  └─ pipeline/ (Python, uv)
       scrape ufcstats ──► parse ──► data/events/*.json, data/fighters.json
       fetch headshots (new fighters only) ──► data/images/<fighter_id>.<ext>
       score fights with vendored model ──► finish_tier in event JSON
       validate (non-empty events/fights) ──► commit data
  └─ site/ (Astro 7, output: static, zero JS by default)
       read data/*.json ──► build HTML; astro:assets ──► webp/avif
  └─ docker build (infra static-site template) ──► ghcr.io/alexzfe/fight-card-website:<sha>
  └─ deploy via infra reusable workflow ──► Hetzner VPS (nginx ◄ cloudflared ◄ Cloudflare)
```

### Repo layout

```
pipeline/            Python package (uv)
  scrape/            ufcstats client (scrapling + PoW solver), ESPN client
  parse/             ported finish-finder parsers
  images/            ported finish-finder image scraper (ESPN → Wikipedia)
  score/             load vendored model, build feature rows, assign tiers
  tests/fixtures/    saved ufcstats HTML / ESPN JSON
model/               vendored export from fight-auto-research (model, thresholds, snapshot, manifest)
data/                committed JSON + cached headshots (pipeline output, site input)
site/                Astro project
.github/workflows/   refresh.yml (cron), release.yml (from infra template)
Dockerfile           from infra/templates/static-site.Dockerfile
```

## Data pipeline

### Scraping ufcstats (scrapling)

- `GET http://ufcstats.com/statistics/events/upcoming` with scrapling `Fetcher` (`impersonate="chrome"`).
- **Challenge handling:** if the body contains `Checking your browser` / `"/__c"`:
  1. Parse the nonce and solve `sha256(nonce + ":" + n)` with prefix `00` in Python (~256 iterations).
  2. POST `nonce=…&n=…` to `/__c` and capture the `_fmc` cookie.
  3. Cache `_fmc` (valid 7 days) in the Actions cache.
  - **Not yet verified live:** that the POST returns `_fmc`. Verify first (Milestone 1).
- **Fallback:** if the solver fails, use scrapling `StealthyFetcher` (patchright Chromium) once to obtain `_fmc`, then continue with `Fetcher`. Install the browser in CI only when the fallback is triggered.
- **Politeness:** ≥3 s between requests, one request at a time, 120 s backoff on 403/429/5xx, halt after two in a row. A typical run is the list page, ~7 event pages, and results for recently completed events (~10 requests).
- **Parsers:** port `parse_event_list` / `parse_event_detail` from `~/Work/zephyrus-projects/finish-finder/scraper/ufc_scraper/parsers.py` (lines ~138–420; BeautifulSoup, no scrapy dependency). Selectors were verified against live HTML on 2026-10-24.
- **Fighter details** (height, reach, stance, DOB, record): from fighter pages. Fetch only for fighters not already in `data/fighters.json`, or older than N days.
- **Results:** on event days, and the day after, scrape completed event pages for winner, method and round.

### Fighter images

- Port `~/Work/zephyrus-projects/finish-finder/scraper/ufc_scraper/image_scraper.py`: ESPN search → `a.espncdn.com/i/headshots/mma/players/full/{id}.png`, then Wikipedia fallback, fuzzy name match at 0.85.
- The ESPN scoreboard API (`site.api.espn.com/apis/site/v2/sports/mma/ufc/scoreboard`) gives athlete IDs for the nearest card. Use it to match IDs directly where possible.
- **Download once** into `data/images/`, keyed by ufcstats fighter id. Never hotlink. Record misses so they aren't retried every run (retry weekly).
- No match → initials avatar, rendered in the site.

### Data files

- `data/events/<event_id>.json`: event meta plus ordered fights. Each fight has fighter ids, weight class, title flag, `finish_tier`, `tier_frozen_at`, and `result` once the event completes.
- `data/fighters.json`: id → name, nickname, record, height, reach, stance, dob, image path.
- `data/index.json`: upcoming event ids in date order, plus recent past events.

### Safety

- The pipeline fails (no commit, no deploy) if the upcoming list parses to 0 events, or if any upcoming event parses to 0 fights.
- Pipeline failures surface as a failed Action. GitHub emails on failure.

## Finish model

Source: `~/Projects/fight-auto-research` (LightGBM P(finish), `model.py`, features in `features/grammar.py`, base rate 0.523, log loss ~0.665 vs 0.696 constant).

### Export (new command in fight-auto-research)

`uv run python -m export --out <dir>` produces:

- `model.txt`: the LightGBM booster, trained on all completed bouts.
- `thresholds.json`: Low/Medium/High cut points at the tertiles of out-of-sample predictions on historical bouts. It also records the actual finish rate per tier, which must be monotonic increasing (the export fails otherwise).
- `fighter_snapshot.parquet` (or JSON): per-fighter feature inputs as of the export date, with each fighter's W-L-D-NC record at that time.
- `feature_spec.json`: ordered feature names and how to assemble a bout row from two fighter snapshots (corner order, differences, etc.).
- `manifest.json`: export date, research repo git sha, model and feature version.

Copy the output into `model/` in this repo and commit it. This is manual for v1. Moving it to a homeserver cron is a later option.

### Scoring (this repo)

- For each upcoming fight, assemble the feature row from the two fighter snapshots using `feature_spec.json`, predict P(finish), then map it to a tier via `thresholds.json`.
- Runtime dependencies: `lightgbm`, `pandas` or `pyarrow` only.
- **Staleness guard:** if a fighter's current ufcstats record differs from their snapshot record, they have fought since the export. That bout gets `—`. The workflow then opens (or updates) a single GitHub issue, "Re-export finish model", listing the affected fighters.
- **No-history guard:** a fighter with 0 UFC bouts in the snapshot → `—`.
- **Freezing:** once an event's date has passed, don't recompute its tiers.

## Site (Astro 7)

- `output: 'static'`, plain CSS with custom properties, no UI framework.
- The only JS is the tap-to-expand detail row. Prefer `<details>`/`<summary>` so it needs no JS at all.
- Pages:
  - `/`: next upcoming event's card plus the event chip row.
  - `/events/<slug>/`: any event, upcoming or past.
- Images via `astro:assets` (`<Image>`), producing webp/avif with fixed dimensions to avoid layout shift.
- Performance target: Lighthouse mobile ≥95, home page HTML+CSS < 50 KB excluding images.

## Hosting & deploy

- **Domains:** `ufc.xlobax.com` (prod) and `ufc-staging.xlobax.com` (staging).
- **Infra:** add an entry to `~/Projects/infra/sites.yml`:
  - name `ufc`, image `ghcr.io/alexzfe/fight-card-website`, port 8080, a health path, and both hosts.
  - Default memory cap.
  - Then the manual Pi-hole split-horizon line, per the infra README "Adding an app" checklist.
- **Image:** built from `infra/templates/static-site.Dockerfile`, with Node 22 for the Astro build. Must be public on GHCR.
- **Release:** `infra/templates/app-release.yml` → reusable `deploy-app.yml`.
  - Push to main → staging.
  - `v*` tag → prod.
  - Secrets: `TS_CI_OAUTH_CLIENT_ID`, `TS_CI_OAUTH_SECRET`, `CLOUDFLARE_PURGE_TOKEN` (edge cache purge on deploy).
- **Cron (`refresh.yml`):**
  - Runs daily at 06:00 UTC, plus hourly on event days (the job checks `data/index.json` for an event today and exits early otherwise).
  - Steps: run pipeline → commit data → build image → tag a release → **auto-deploy to prod**.
  - Code changes still go through staging first.
- The daily data commit keeps the public repo's scheduled workflow from being auto-disabled after 60 days of inactivity.

## Testing

- Parser tests use saved fixtures (upcoming list, event detail, completed event, fighter page, ESPN scoreboard). Tests never hit the network.
- PoW solver unit test, using the saved challenge page.
- Scoring tests:
  - Tier mapping at threshold boundaries.
  - Staleness and no-history guards.
  - Freezing of past events.
- Pipeline validation test: an empty parse → non-zero exit.
- Site: build succeeds against fixture data. One Playwright smoke check: home page renders the next event with ≥1 fight.

## Milestones

1. **Scrape spike:**
   - Verify the PoW POST → `_fmc` works without a browser. Fall back to the StealthyFetcher path if not.
   - Port the parsers and save fixtures.
   - Output: `data/events/*.json`, `data/fighters.json`.
2. **Images:** port the image scraper, download and cache headshots, record misses.
3. **Site:** Astro home page, event page, chip nav, expandable rows, placeholder badges. Make it fast and minimal.
4. **Model export:** the `export` command in fight-auto-research, with tertile thresholds plus the monotonicity check. Vendor it into `model/`.
5. **Scoring:** feature assembly, tiers, staleness/no-history guards, freezing, the re-export issue.
6. **Results:** completed-event parsing and result display next to frozen badges.
7. **Ship:**
   - Dockerfile, the `sites.yml` entry and Pi-hole line, `release.yml`, `refresh.yml`.
   - First prod deploy to `ufc.xlobax.com`.

## Later (v2+)

- Track-record footer stat ("High-rated fights finished X% of the time").
- Automate the model export (homeserver cron).
- **Scheduled rounds from ESPN.** v1 guesses: 5 rounds for the main event or a title fight, 3 otherwise. ufcstats doesn't show scheduled rounds for upcoming fights (verified 2026-10-25; only completed fights show "Time format").
  - ESPN's scoreboard has `competitions[].format.regulation.periods` per fight (the UFC 333 fixture: main event and title fight = 5, the rest = 3).
  - Plan: the score stage uses ESPN periods when the fight can be matched, reusing the images stage's ESPN scoreboard client and name matching, and falls back to the guess otherwise.
  - Other events need `?dates=YYYYMMDD` (untested).
  - This fixes the rare non-title 5-round co-main.
- Branding, colours, typography.
- Live fight-night updates (would need a runtime; out of scope for static).

## Reference

- finish-finder: `~/Work/zephyrus-projects/finish-finder`
  - Parsers: `scraper/ufc_scraper/parsers.py`
  - Images: `scraper/ufc_scraper/image_scraper.py`
- fight-auto-research: `~/Projects/fight-auto-research`
  - Crawler: `scrapers/ufcstats/crawl.py`
  - Model: `model.py`
  - Features: `features/grammar.py`
  - Build: `data/build/`
- infra: `~/Projects/infra`
  - Sites: `sites.yml`
  - Templates: `templates/static-site.Dockerfile`, `templates/app-release.yml`
  - Checklist: `README.md` "Adding an app"
- Scrape spike artifacts (temporary): `/tmp/claude-1000/-home-alex-Projects-fight-card-website/67a6dc06-60f0-4db8-aa4b-44356ec434fa/scratchpad`
