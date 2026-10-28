# Shared contract

Source of truth for types: `pipeline/src/fightcard/models.py` (pydantic). This doc explains layout and ownership. Read `PLAN.md` for the why.

## data/ layout (pipeline output, site input; committed)

```
data/
  index.json                 Index
  events/<event_id>.json     Event (fights in card order, main event first)
  fighters.json              { "<fighter_id>": Fighter, ... }
  images/<fighter_id>.<ext>  headshots (png/jpg as downloaded; site converts to webp/avif)
  images/misses.json         { "<fighter_id>": "<ISO last tried>" }  — retry after 7 days
```

- All JSON is UTF-8, 2-space indent, keys sorted, trailing newline (stable diffs).
- `finish_tier`: `"high" | "medium" | "low" | null`. `null` renders as "—".
- `segment`: `"main" | "prelims" | "early_prelims" | null`, from ESPN's fightcenter (`main`, `prelims1`, `prelims2`). `null` means unknown; the site shows no segment header for it. Scrape keeps it for fights still on the card.
- Once `tier_frozen_at` is set, nothing may change `finish_tier` again.
- `index.model`: the vendored export's `as_of` and `version`, plus the summary the how-it-works page quotes (`train_rows`, `trees`, `low_max`, `medium_max`, `oos`, `tiers`, `importance` by theme). Written by `score`; the summary fields are null in data written before it.
- Fighter rating (`docs/ELO.md`), all written by `score`; the site shows it next to the record. When the rating is unknown (no `model/fighter_rating.parquet`, not in it and no newer bouts, or results since the export are missing) every field is `null` / `false`.
  - `Fighter.elo`: integer displayed current rating (decayed to now, anchored so active established fighters average 1500), or `null`.
  - `Fighter.elo_peak`: integer career peak on the same displayed scale (from the 5th UFC bout on, undecayed), or `null`.
  - `Fighter.p4p_rank`: `1`–`15` for men, `1`–`10` for women (≥5 UFC bouts and a bout in the last 365 days), or `null`.
  - `Fighter.elo_provisional`: `true` with fewer than 3 UFC bouts. `Fighter.elo_inactive`: `true` with no bout in the last 365 days.
  - `Fighter.best_win`: `{"opponent_id", "opponent", "elo", "date"}` or `null` (no win, or an export without the best-win columns). The beaten opponent rated highest going into the bout (split/majority wins count; draws, NC, CNC and Overturned don't; a tie goes to the most recent). `elo` is that pre-bout rating on the displayed scale. The site shows it under Stats.
- Dates are `YYYY-MM-DD`; timestamps are ISO 8601 UTC with `Z`.

### From the /v1/ API (`DATA_SOURCE=v1`, docs/DEPLOY.md)

`scripts/fetch_v1.py` replaces `data/` with the fightcard-engine's `/v1/snapshot.tar.gz` (its `docs/CONTRACT.md`
is then the source of truth). It's the layout above, additively:

- `index.json` has `contract_version` (`"1"`, `"1.1"`, …); `fetch_v1.py` refuses any other major.
- `Fight.result.outcome`: `"win" | "draw" | "nc" | null`. `winner` is `null` for both a draw and a no contest;
  `outcome` tells them apart. The site validates it but doesn't show it yet.
- `schema.json` is the JSON Schema of the API. The site ignores it.
- `rankings.json` (optional, contract 1.2+): `{as_of, p4p: {men, women}, active}` for the site's Rankings tab. Each P4P
  entry is `{rank, id, name, elo, division, image}` (men up to 15, women up to 10, ranks 1..n in order; `image` is a path
  under `data/` or `null`); each `active` row is `{id, name, elo, division, p4p_rank, provisional}`, best Elo first.
  Without the file the site builds with no Rankings page and no link. The site checks the ranks, the headshot files and
  the Elo order; `schema.ts` is `Rankings`. Not in the pipeline's output.
- No `images/misses.json` or `stale_fighters.json`: they are pipeline bookkeeping.

- Enum values are closed within `/v1/` (`finish_tier`, `segment`, `status`, `outcome`, `PastFight.result`): a new
  value is a breaking change and ships as `/v2/`, so the site keeps strict zod enums. New fields and files are
  additive: zod drops fields the site doesn't read, and `fetch_v1.py` skips files outside the layout above.

`site/src/lib/schema.ts` accepts both shapes; `site/tests/fixtures/v1/` is a real contract 1.2 snapshot (the
committed `data/` from `/v1/` minus `images/misses.json` and `stale_fighters.json`) and the site tests build it.

#### Checking the contract

The engine's `/v1/schema.json` (from its pydantic `models.py`) is the authoritative shape; `schema.ts` is the site's
reading of it, and `site/src/lib/contract.ts` (`checkContract`) keeps the two honest. It turns the zod schemas into
JSON Schema and walks them against `$defs` `Index`, `Event`, `Fighters` and `Rankings` (`$ref`s, a one-schema
`allOf`, `const` as a one-value enum). Errors: a field the site reads that the contract doesn't define, a type change
(a type, enum value or `null` the contract allows and the site rejects; a site `number` takes an `integer`, not the
other way round), a field the site requires that the contract makes optional, a `$ref` that doesn't resolve, or a
missing `Index`, `Event` or `Fighters`. A contract field the site doesn't read is only a note, and so is a missing
`Rankings` (a 1.0/1.1 contract, e.g. after an engine rollback: `rankings.json` is optional), and so is a field the
site reads ahead of the engine (`NEWER_FIELDS`, keyed by the version that adds it: `Fight.elo` at 1.3, `Fight.form` at 1.4) while
`schema.json`'s title, `fightcard /v1 (contract X.Y)`, names an older version. From that version on, or when the title
has no readable version, the field missing is an error. It runs in two places:

- `site/tests/unit/contract.test.ts`, against the fixture's pinned `schema.json` (which also validates every fixture
  file with ajv), so a `schema.ts` change that drifts from the contract fails CI.
  It also checks the engine's 1.3 schema, `site/tests/fixtures/schema-1.3.json` (`fightcard.publish.build.schema()`
  at fightcard-engine 580d8d8, PR #11) and 1.4 schema, `site/tests/fixtures/schema-1.4.json` (at 62eecd6, PR #12),
  until a newer snapshot replaces the pinned 1.2 one.
- `npm run validate-data` whenever the data dir has a `schema.json`, so a snapshot whose contract breaks the site
  fails the refresh before anything is committed, even if no current data uses the new value yet.

To refresh the fixture from a newer contract: copy a `data/` committed by a v1 refresh into
`site/tests/fixtures/v1/` without `images/misses.json` and `stale_fighters.json`, then run the site tests.

## model/ layout (vendored export from fight-auto-research)

```
model/
  model.txt               LightGBM booster
  thresholds.json         { "low_max": float, "medium_max": float, "tier_finish_rates": {...} }
  fighter_snapshot.parquet  one row per fighter id; includes record w/l/d/nc as of export
  feature_spec.json       ordered features + how to assemble a bout row
  manifest.json           { "as_of": "YYYY-MM-DD", "version": str, "research_sha": str, "rating"?: {...} }
  fighter_rating.parquet  optional; one row per rated fighter as of export (see model/README.md)
```

The exact `feature_spec.json` and snapshot columns are defined by the model owner. Document them in `model/README.md` when they are set.

## Pipeline CLI

Run from the repo root: `uv run --project pipeline fightcard --data data <stage>`.

| Stage | Package | Reads | Writes |
|---|---|---|---|
| `scrape` | `fightcard.ufcstats` | ufcstats.com, data/ | events/, fighters.json, index.json |
| `images` | `fightcard.images` | index.json, events/, fighters.json, ESPN, Wikipedia | images/, `Fighter.image` (cards in `index.upcoming` then `index.recent`) |
| `segments` | `fightcard.segments` | events/, fighters.json, ESPN | `Fight.segment` (upcoming events only) |
| `score` | `fightcard.score` | model/, events/, fighters.json | `Fight.finish_tier`, `tier_frozen_at`, `index.model`, `data/stale_fighters.json`, `Fighter.elo`, `elo_peak`, `p4p_rank`, `elo_provisional`, `elo_inactive`, `best_win` |

- Each stage package exposes `stage.py` with `add_arguments(parser)` and `run(args) -> int` (see `fightcard/cli.py`).
- Non-zero exit means: do not commit, do not deploy.
- `scrape` must exit non-zero if it finds 0 upcoming events, if the soonest upcoming event has 0 fights, or if all upcoming events together have 0 fights. Far-out events with no bouts announced yet are not written and stay out of `index.upcoming` until fights appear.
- `segments` exits 0 when ESPN is down or an event can't be matched, and keeps the segments it already has. It exits 1 only if data/ is unreadable.
- `score` writes `data/stale_fighters.json` (list of `{fighter_id, name, event_id}`), or removes it when nothing is stale. CI uses that file to open or update the "Re-export finish model" issue.

## Ownership (parallel build)

Each owner edits only their paths. Contract changes (`models.py`, this doc, `pyproject.toml` deps, `cli.py`) go through the orchestrator.

| Owner | Paths |
|---|---|
| scraper | `pipeline/src/fightcard/ufcstats/`, `pipeline/src/fightcard/store.py`, `pipeline/tests/ufcstats/`, `pipeline/tests/fixtures/ufcstats/` |
| images | `pipeline/src/fightcard/images/`, `pipeline/tests/images/`, `pipeline/tests/fixtures/espn/`, `pipeline/tests/fixtures/wikipedia/` |
| segments | `pipeline/src/fightcard/segments/`, `pipeline/tests/segments/`, `pipeline/tests/fixtures/espn/fightcenter_*.json`, `pipeline/tests/fixtures/espn/scoreboard_calendar.json` |
| model | `~/Projects/fight-auto-research` (`export/` + tests, on branch `feat/export`), `model/`, `pipeline/src/fightcard/score/`, `pipeline/tests/score/` |
| site | `site/` |
| ops | `Dockerfile`, `.dockerignore`, `.github/`, `scripts/`, `~/Projects/infra` (branch `add-ufc-site`, no push) |

`store.py` (reading/writing data/ with the formatting rules above) is owned by scraper. Other stages may import it once it lands. Until then, read and write via `models.py` with the same formatting rules.

### Form on completed cards (contract 1.4)

A completed fight's tiles and its Stats "last fights" come from `Fight.form` (each corner's last results going into
that fight), never from `Fighter.recent_fights`, which is today's and would count the fights after the card. Without
`Fight.form` (data before 1.4) a completed fight shows none. Upcoming fights keep `recent_fights`.
