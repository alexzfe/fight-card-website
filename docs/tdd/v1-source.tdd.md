# TDD evidence: the site can take data/ from the engine's /v1/ API (phase 6)

**Source plan:** the phase 6 brief (data API plan, option B: public `ufc-data` service). There is no `*.plan.md` file;
the journeys below come from the brief.
**Branch:** `feat/v1-source` (from `origin/main` at 8d7060c). Not pushed.
**Operational doc:** `docs/DEPLOY.md` ("Data source: pipeline or /v1/"). Shapes: `docs/CONTRACT.md` ("From the /v1/ API").

## User journeys

1. As the site owner, I want the site built from the fightcard-engine's `/v1/` snapshot at build time, never from the
   browser, keeping `data/` committed so I have an audit trail and can roll back.
2. As the site owner, I want a stale, broken, unsafe or wrong-contract snapshot to fail the run and leave the last
   committed `data/` live, so the failure email is my staleness alert.
3. As the site owner, I want to compare `/v1/` with the pipeline for a while before switching, without risking the
   refresh, then switch and roll back with one repo variable.

## Fixture

`site/tests/fixtures/v1/` is real `fightcard publish` output over a copy of the site's `data/` at 8d7060c
(`generated_at` 2026-10-26T11:42:02Z), from the engine repo on `main` at aaaefa7:

```sh
S=$(mktemp -d)
cp -r data "$S/data"
(cd ~/Projects/fightcard-engine && uv run --frozen --no-sync fightcard publish --data "$S/data" --out "$S/out")
#   publish: generation 20261026T203520797381Z-cb59e1e3b54d is live (140 files)
mkdir site/tests/fixtures/v1 && tar xzf "$S/out/current/snapshot.tar.gz" -C site/tests/fixtures/v1
```

The snapshot has 141 entries (2 directories + 139 files: `index.json`, `fighters.json`, `schema.json`, 6 events,
130 headshots). It is committed extracted, not as the `.tar.gz`: the headshots are byte-identical to `data/images/`,
so git stores them once, while the archive would be a new 1.35 MB blob. The tests tar it up again
(`scripts/tests/v1_helpers.py`, same layout as the engine: directory entries, then files).

Compared with `data/`: `index.json` gains `contract_version: "1"`, every `result` in `cc18abc046b382c9.json` gains
`"outcome": null`, `schema.json` is added, and `images/misses.json` and `data/.gitkeep` are left out. `fighters.json`
and the other events are byte-identical. `test_publish_fixture_matches_the_data_it_was_built_from` checks this
(skips once `data/` is refreshed past the fixture).

## Task report

| Task | Summary | RED (9ef6167) | GREEN (d281032) |
|---|---|---|---|
| `scripts/fetch_v1.py` | Downloads `<base>/v1/snapshot.tar.gz` (≤100 MB, 60 s timeout). Checks every member before writing anything: plain relative path (no `/…`, `..`, `.`, empty parts, backslashes), regular file or directory only, `/v1/` layout only (`index.json`/`fighters.json`/`schema.json` files, `events/`/`images/` directories holding files one level deep), no duplicates, ≤20,000 members, ≤200 MB. Writes files itself (never `tar.extract`). Requires `index.json` + `fighters.json`, `contract_version` 1.x, and `generated_at` UTC with `Z`, no older than `--max-age-hours` (26). Extracts beside `data/`, then swaps with two renames, putting the old tree back if the second fails. | `ModuleNotFoundError: No module named 'fetch_v1'` | 52/52 |
| Files the API doesn't carry | Decided: keep none. `images/misses.json` (the `images` stage's retry list) and `stale_fighters.json` (input to the stale-model issue, pipeline mode only) are pipeline bookkeeping, and the site reads neither. After a rollback to `pipeline`, `images` retries the old misses once. | `test_drops_files_the_api_does_not_carry` (same collection error) | pass |
| `scripts/v1_shadow.py` | Downloads and extracts `/v1/` into a temp dir and appends a markdown table to the job summary: events, fights, finish tiers (with examples) and Elo (with the largest gap). Fields only `/v1/` has don't count, at any depth (additive contract), and neither does `generated_at`. Notes "v1 not reachable", "v1 not usable" or any other exception, and always exits 0. Flags a stale `/v1/`. | `ModuleNotFoundError: No module named 'fetch_v1'` | 17/17 |
| `refresh.yml` | `vars.DATA_SOURCE != 'v1'` gates the existing jobs (unset = pipeline). New `shadow` job: needs `pipeline`, `continue-on-error`, `contents: read`, nothing needs it. New `v1` job (`vars.DATA_SOURCE == 'v1'`, `contents: write` only): `fetch_v1.py`, then the same commit step. `build`/`prod` follow whichever source ran (`always()` plus result checks, so a failed source never builds), tagged with `needs.pipeline.outputs.sha \|\| needs.v1.outputs.sha`. The stale-model issue stays in the `pipeline` job. Values reach shell through `env:` only. | 7 failed (KeyError `'v1'`/`'shadow'`, no `vars.DATA_SOURCE`) | 33 passed + actionlint |
| `site/src/lib/schema.ts` | `Index.contract_version` (version string, optional) and `Result.outcome` (`win`/`draw`/`nc`, nullish). Before, zod silently stripped both. | 6 failed (e.g. `expected undefined to be '1.2'`, `'loss'` accepted) | 128/128 |
| Site build from the snapshot | `tests/build/v1-build.test.ts` runs `astro build --outDir dist-v1` with `DATA_DIR=tests/fixtures/v1`: home page plus every indexed event, and `schema.json` is not published. | Passed already: zod's default strips unknown keys, so this is a regression guard, not RED | pass |
| Docs | `DEPLOY.md`: both modes, switch (`gh variable set DATA_SOURCE --body v1`), rollback, what `fetch_v1.py` refuses, and the staleness alert. `CONTRACT.md`: the `/v1/` additions. `pipeline/` and `model/` untouched. | n/a | n/a |

Two test bugs were fixed during GREEN, without weakening what they check: the injection guard matched the gate job's
output named `run` (now only step-level `run:`), and a shadow test "changed" a fight by adding a field, which the
additive rule ignores by design (now it changes `blue`). `job_if()` learned folded `if: >-` blocks.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A valid snapshot becomes exactly `data/`: nothing left over, no temp dirs beside it; works when `data/` doesn't exist yet | `test_fetch_v1.py::test_replaces_*`, `::test_drops_*`, `::test_leaves_no_temp_dirs_*`, `::test_creates_data_when_absent` | unit | PASS |
| 2 | Real publish output is accepted | `::test_accepts_the_real_publish_fixture` | integration | PASS |
| 3 | Stale (> 26 h) fails with the age and `generated_at`; `--max-age-hours` overrides it; 25.98 h passes | `::test_stale_*`, `::test_staleness_threshold_is_a_flag`, `::test_just_under_26_hours_is_fresh` | unit | PASS |
| 4 | Contract `2`, `2.0`, `0.9`, missing, `""`, `v1` or a number is refused; `1.3` is accepted | `::test_other_contract_majors_are_refused`, `::test_minor_contract_versions_are_accepted` | unit | PASS |
| 5 | Bad or missing `generated_at`, missing `index.json`/`fighters.json`, unreadable or non-object index, non-gzip, or a download error: refused, `data/` untouched | `::test_bad_generated_at_*`, `::test_missing_required_*`, `::test_unreadable_index_*`, `::test_index_that_is_not_an_object_*`, `::test_not_a_gzip_*`, `::test_download_failure_*` | unit | PASS |
| 6 | Malicious tarballs are refused (14 cases: absolute, `..`, nested `..`, symlink, hard link, device, FIFO, stray top-level file/dir, `.git`, file where a dir belongs, deep nesting, backslash, empty part), plus `index.json` as a dir, duplicates, oversize and too many members | `::test_unsafe_members_are_refused[*]`, `::test_index_json_as_a_directory_*`, `::test_duplicate_*`, `::test_oversize_*`, `::test_too_many_*` | unit | PASS |
| 7 | A failed swap puts the old `data/` back and leaves no temp dirs | `::test_failed_swap_restores_the_old_data` | unit | PASS |
| 8 | Download over real HTTP (local server): body, size cap, HTTP 404, connection refused, end to end, clock default | `::test_download_*`, `::test_end_to_end_over_http`, `::test_now_defaults_to_the_clock` | integration | PASS |
| 9 | Shadow counts event/fight/tier/Elo differences with examples and the largest Elo gap; `/v1/`-only fields and `generated_at` are ignored; a field `/v1/` drops counts | `test_v1_shadow.py::test_*differences*`, `::test_fields_only_v1_has_*`, `::test_a_field_v1_drops_*`, `::test_generated_at_is_ignored` | unit | PASS |
| 10 | Shadow never fails: unreachable, unusable (garbage or empty), unexpected exception, stale; it appends to the summary and doesn't touch `data/` | `test_v1_shadow.py::test_unreachable_*`, `::test_unusable_*`, `::test_unexpected_*`, `::test_stale_v1_*`, `::test_summary_is_appended_*`, `::test_ours_is_not_touched` | unit | PASS |
| 11 | `refresh.yml`: pipeline jobs unless `DATA_SOURCE == 'v1'`; `v1` job only then, fetch before commit, without pipeline, cookie cache or gate; stale issue in `pipeline` only; minimal permissions; non-blocking shadow; build and prod follow either source; no `${{ }}` in `run:` | `test_workflows.py::test_refresh_*` (8 new) | static | PASS |
| 12 | Workflows lint clean, shellcheck included | `test_workflows.py::test_actionlint_passes` (actionlint 1.7.12, shellcheck 0.11.0) | lint | PASS |
| 13 | Schema keeps `contract_version` and `outcome`, both optional, and rejects malformed values | `site/tests/unit/schema.test.ts` | unit | PASS |
| 14 | The site loads and builds from the real `/v1/` snapshot; the build from today's `data/` still passes | `schema.test.ts > the /v1/ snapshot fixture`, `tests/build/v1-build.test.ts`; `npm run build` | build | PASS |

## Commands and output (GREEN)

```
$ mise x actionlint@1.7.12 shellcheck@0.11.0 -- bash -c \
    'ACTIONLINT=$(command -v actionlint) uv run --project pipeline pytest scripts/tests -q -rs --cov=scripts --cov-report=term-missing'
scripts/fetch_v1.py     150   2   99%   55, 207      (non-http URL guard, __main__)
scripts/v1_shadow.py    115   1   99%   172          (__main__)
135 passed, 7 deselected in 5.23s                    (deselected: live/docker)

$ uv run --project pipeline pytest pipeline/tests scripts/tests -q     # CI's combined run
452 passed, 8 skipped, 1 deselected in 15.62s

$ cd site && npx vitest run          # 10 files, 128 passed
$ cd site && npm run build           # today's data/: 8 page(s) built, Complete!
$ cd site && npx astro check         # 0 errors, 0 warnings, 0 hints
$ actionlint .github/workflows/*.yml # exit 0
```

One-off end to end (not in the suite): the engine's real `snapshot.tar.gz` served by `python3 -m http.server`:
`fetch_v1.py` exits 0 and the result is identical to `site/tests/fixtures/v1/` (`diff -rq`); `v1_shadow.py` against
`data/` gives 0/0/0/0; against a closed port it writes "v1 not reachable: … Connection refused" and exits 0.

## Known gaps

- The workflow changes are checked structurally and with actionlint, not run on GitHub. The first scheduled run on
  main exercises `shadow` (expect "v1 not reachable" until `ufc-data.xlobax.com` is live).
- The `always()` conditions on `build`/`prod` are asserted as text; GitHub's skip propagation is not simulated.
- The fixture ages: `test_publish_fixture_matches_the_data_it_was_built_from` skips once `data/` moves on, and
  `test_accepts_the_real_publish_fixture` passes `--max-age-hours 100000`. Rebuild it with the command above when
  the contract gains fields.
