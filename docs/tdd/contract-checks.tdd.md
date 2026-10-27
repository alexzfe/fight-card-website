# TDD evidence: the site checks itself against the engine's /v1/ contract

**Source:** the api-design / contract-first review of the site and fightcard-engine (2026-10-27). Decided: enum
values are closed within `/v1/` (a new value is `/v2/`). No `*.plan.md` file.
**Branch:** `feat/contract-checks` (from `origin/main` at 24cc631).
**Docs:** `docs/CONTRACT.md` ("From the /v1/ API", "Checking the contract"), `docs/DEPLOY.md` (what `fetch_v1.py`
refuses, validate-data).

## User journeys

1. As the site owner, I want a change to `schema.ts` that drifts from the engine's contract to fail CI, not a
   refresh in production.
2. As the site owner, I want a snapshot whose `schema.json` breaks what the site relies on (a new enum value, a
   field gone, a field made optional or nullable) refused before it is committed, even before data uses it.
3. As the site owner, I want the engine to be able to add a file to `/v1/` without a site release first.
4. As a maintainer, I want the v1 fixture to be real contract 1.2 output, not hand-made.

## Task report

| Task | Summary | RED (cddec3e) | GREEN (35b6e01) |
|---|---|---|---|
| `site/src/lib/contract.ts` | `checkContract(schema)`: `z.toJSONSchema(…, {io: 'input'})` of `Index`, `Event`, `Fighters`, `Rankings`, walked against the contract's `$defs` (refs, `anyOf` null branches, maps with `propertyNames`). Errors: field read but undefined, enum value or `null` allowed but rejected, required here but optional there, missing `$defs` entry. Notes: contract fields the site doesn't read. On the real 1.2 schema: no errors, one note (`ModelInfo.stale_fighters`). | `Cannot find module '../../src/lib/contract'` | 9/9 |
| validate-data | Runs `checkContract` when the dir has `schema.json`: errors to stderr and exit 1, notes to stdout. Pipeline data/ (no `schema.json`) is unaffected. | 2 failed (exit 0 on a breaking schema; no note) | 7/7 |
| v1 fixture | `site/tests/fixtures/v1/` replaced with the committed `data/` at 24cc631 (`/v1/` generation `generated_at` 2026-10-27T19:02:19Z, contract 1.2, 7 events, 151 headshots, real `rankings.json` with 644 active rows) minus the pipeline bookkeeping. Every file validates against its `schema.json` with ajv (now an explicit devDependency). `schema.test.ts` expects `'1.2'`. | contract 1.2 assertions failed against the old fixture | pass |
| `scripts/fetch_v1.py` | A safe member outside the `/v1/` layout is skipped (not written) and named on stderr; links, devices, traversal and known names of the wrong shape are still refused anywhere, and skipped members count towards the caps. Removes the "site before engine" release order for new files. | `unsafe snapshot member '.hidden': not part of the /v1/ layout` | 208 passed, 1 skipped |

`test_accepts_the_real_publish_fixture` now takes `--now` from the fixture's `generated_at`: the new fixture is newer
than the test clock, so it was refused as "from the future". That is a fixture change, not a behaviour change.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | `schema.ts` has no breaking difference from the pinned `/v1/schema.json` | `contract.test.ts` "finds no errors against the pinned /v1/ schema" | unit | PASS |
| 2 | A new enum value, a removed field, a field made optional, a null allowed, a missing file shape are each errors | `contract.test.ts` "flags …" (5) | unit | PASS |
| 3 | An added field is a note only | `contract.test.ts` "only notes an added field" | unit | PASS |
| 4 | The v1 fixture is contract 1.2 with `rankings.json` and validates against its `schema.json` file by file | `contract.test.ts` "the /v1/ snapshot fixture" (2) | unit | PASS |
| 5 | validate-data fails on a breaking `schema.json`, notes an additive one, ignores its absence | `validate-data.test.ts` (3 new) | build | PASS |
| 6 | Unknown files are skipped and named, not written; none named when there are none | `test_fetch_v1.py::test_unknown_files_are_skipped_not_refused`, `::test_no_skip_note_without_unknown_files` | unit | PASS |
| 7 | Links, devices and traversal outside the layout are still refused; skipped files count towards the size cap | `test_fetch_v1.py::test_unsafe_members_are_refused` (4 new cases), `::test_unknown_files_count_towards_the_size_cap` | unit | PASS |

## Verification

- `cd site && npx vitest run`: 211 passed. `npx astro check`: 0 errors. `npm run build`: ok.
- `uv run --project pipeline pytest scripts/tests`: 208 passed, 1 skipped.
- `npm run validate-data -- ../data` on the committed 1.2 `data/`: ok, one note (`ModelInfo.stale_fighters`).
- e2e not run: no page changes, and the e2e build uses `tests/fixtures/data`, not the v1 fixture.
