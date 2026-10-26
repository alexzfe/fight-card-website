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

---

# Follow-up: stale-API alerts and no going backwards (2026-10-26)

Source: orchestrator decisions on the open questions above (brief `p6-fixes.md`). RED `23e734a`, GREEN `1cd1a76`.

## Journeys

- As the owner, I want a stale `/v1/` to raise one issue rather than a failure email every hour, so that I notice it
  without getting spammed. The daily run should still fail so there's a hard signal once a day.
- As the owner, I want `data/` never to move back to an older generation, so that a lagging engine can't roll the
  site backwards.

## Task report

| Behaviour | RED | GREEN |
|---|---|---|
| `fetch_v1.py`: stale exits `EXIT_STALE = 3` (other refusals stay 1). Writes `stale`, `generated_at` and `age_hours` to `$GITHUB_OUTPUT` when stale or fresh, nothing on other failures. `--stale-issue PATH` writes the issue body (marker, `generated_at`, age, limit, API URL, container logs, `fightcard-service health --staleness`, rollback) only when stale. | `AttributeError: EXIT_STALE`/`STALE_TITLE`, `SystemExit: 2` (unknown `--stale-issue`), `{} == {'stale': 'false', …}` | pass |
| `fetch_v1.py`: a snapshot older than the committed `data/index.json` is skipped (exit 0, "older than … not going backwards", `stale=false`). An equal one is a no-op ("already holds"). An unknown committed age (unreadable, not an object, missing or malformed) doesn't block. Staleness is checked first, so stale and older still gives exit 3. | `unchanged(data)` False; data replaced by the equal snapshot | pass |
| `refresh.yml` v1 fetch step (`id: fetch`): `EVENT_NAME`, `SCHEDULE` (`github.event.schedule`) and `DAILY_CRON` reach it through `env:`. Exit 3 on an hourly scheduled run becomes 0 with a `::warning::`; daily and manual stale runs keep 3; exit 1 always fails. The test runs the real step script under `bash -eo pipefail` with a fake `python3`. | `ValueError: substring not found` (no step) | 7/7 cases |
| `refresh.yml` "Data API stale" issue step, mirroring the stale-model one. `if: ${{ !cancelled() && steps.fetch.outputs.stale != '' }}` makes it run after a failed daily stale fetch too, and never after other failures. Stale: create, or edit the open one. Fresh: close with a comment naming `generated_at`. Fresh with no issue: nothing. `issues: write` added to the v1 job only. The test runs the real script with a fake `gh`. | `StopIteration`/`ValueError` (no step); permissions `['contents:', 'write']` | pass |
| Docs: `DEPLOY.md` (scripts table, mode table, both refusals, manual redeploy in v1 mode, the issue in Operating). | n/a | n/a |

Tests adjusted, not weakened: `test_stale_snapshot_fails_with_its_age` now expects exit 3. The stale-model check now
allows `gh issue` in `v1`, but still forbids `stale_issue` and the "Re-export finish model" title outside `pipeline`.
During GREEN, the test's `env:` reader didn't understand an inline YAML comment, so the comment moved to the step's
comment block.

## Test specification (additions)

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 15 | Stale has its own exit code (3), outputs and issue body; other failures emit nothing; fresh emits `stale=false` | `test_fetch_v1.py::test_stale_*`, `::test_fresh_writes_stale_false`, `::test_other_failures_write_no_outputs`, `::test_issue_body_only_when_stale[*]` | unit | PASS |
| 16 | Never backwards: older is skipped, equal is a no-op, newer replaces, unknown committed age doesn't block, staleness wins | `::test_older_*`, `::test_equal_*`, `::test_newer_*`, `::test_unknown_committed_age_does_not_block[*]`, `::test_staleness_wins_over_going_backwards` | unit | PASS |
| 17 | Hourly stale passes; daily/manual stale and any exit 1 fail | `test_workflows.py::test_refresh_v1_stale_fails_only_daily_and_manual_runs[*]` (step script executed) | integration | PASS |
| 18 | One issue: open, update, close with comment, or nothing; runs after a failed daily fetch; `issues: write` on v1 only | `test_workflows.py::test_refresh_v1_*issue*`, `::test_refresh_v1_job_permissions_are_minimal` | integration | PASS |

## Commands and output

```
# RED (23e734a)
$ mise x actionlint@1.7.12 shellcheck@0.11.0 -- bash -c 'ACTIONLINT=$(command -v actionlint) uv run --project pipeline pytest scripts/tests -q'
25 failed, 139 passed, 7 deselected in 3.53s

# GREEN (1cd1a76)
$ (same, with --cov=scripts --cov-report=term-missing)
scripts/fetch_v1.py   184   2   99%   74, 276        (non-http URL guard, __main__)
164 passed, 7 deselected in 3.57s
$ actionlint .github/workflows/*.yml                  # exit 0
$ uv run --project pipeline pytest pipeline/tests scripts/tests -q
481 passed, 8 skipped, 1 deselected in 15.72s
$ cd site && npx vitest run                           # 128 passed (128)
$ cd site && npx astro check                          # 0 errors, 0 warnings, 0 hints
```

## Known gaps

- `DAILY_CRON` is now in two places in `refresh.yml` (the cron and the fetch step's env). A test pins both to
  `should_run.DAILY_CRON`.
- On an hourly stale run, the `gh issue edit` refreshes the body (and its age) every hour. That's one API call and
  sends no notification. The job only fails on the daily run.
- As before, nothing here has run on GitHub. `!cancelled()` and the skip behaviour are asserted as text and with
  actionlint.

# Review fixes (PR #7 code review)

Source: the code-review findings on PR #7 and the fixes decided for them (brief `p6-review-fixes.md`). One RED → GREEN
pair per finding. Finding 5 is documentation only.

## Journeys

- As the owner, I want a snapshot with a wrong clock to be refused, so that one bad `generated_at` can't freeze the
  site behind "not going backwards".
- As the owner, I want a broken snapshot to fail the run before anything is committed to `main`, rather than failing
  the build after the commit.
- As the owner, I want rolling back to `pipeline` to find its bookkeeping where it left it.
- As the owner, I want the fetch to stay on https and on the API's origin.

## Task report

| # | Finding | Fix | RED | GREEN |
|---|---|---|---|---|
| 1 | HIGH: a future `generated_at` freezes the site | `check_not_future`: `generated_at > now + 10 min` → exit 1, "in the future". `committed_at(data, now)` treats a committed future value as unknown, so a valid snapshot replaces it. | `a3b5bc9`: 2 failed (future snapshot swapped in; committed future kept data/), 2 passed (the within-skew guards) | `e124026`: 168 passed |
| 2 | HIGH: content not validated before the commit | `check_content` before the swap: every `*.json` parses, `fighters.json` is an object, every `upcoming`/`recent` id has `events/<id>.json`, every event file's `id` is its name, `fights` is a list of objects, every `red`/`blue` is a key in `fighters.json`. Site: `npm run validate-data [-- dir]` (`site/scripts/validate-data.mjs` loads `src/lib/data.ts` and so `schema.ts` with Vite's `runnerImport`, then `loadData`). `refresh.yml` v1: `setup-node` (`site/.nvmrc`) and "Validate data/ with the site schema" (`npm ci && npm run validate-data`, `working-directory: site`) between the fetch and "Commit data". | `9a9561f`: scripts 14 failed (all the content cases plus 2 workflow tests); site 3 failed (no `validate-data` script) | `22cd35c`: scripts 183 passed, site 131 passed |
| 3 | MEDIUM: PAX headers bypass the size cap | `extract` gunzips through `_Capped` (raises past `MAX_STREAM_BYTES` = 250 MiB, headers included) and reads the tar in stream mode (`r|`), checking and writing each member as it comes (into the staging dir, which is thrown away on refusal). Members are copied with `shutil.copyfileobj` in 1 MiB chunks. | `93946b9`: 1 failed (a 300 kB PAX header under a 200 kB cap was swapped in) | `1bdd450`: 186 passed |
| 4 | MEDIUM: rollback loses bookkeeping | `carry_over` copies `images/misses.json` and `stale_fighters.json` from the old `data/` into the new tree before the swap, when present and the snapshot has none. DEPLOY.md updated. | `ee3dac0`: 10 failed (the files were dropped) | `c0c1c43`: 189 passed |
| 5 | Accepted: hourly stale runs stay green | DEPLOY.md says so: the alert is the issue plus the daily failure. | n/a | `880b485` (docs) |
| 6 | LOW: redirects / http | `download` accepts `https://` only (plain `http://` only to `127.0.0.1`/`localhost`). `_SameOriginRedirects` refuses a redirect whose scheme or host:port differs. | `2f65e16`: 9 failed (http/.invalid hosts tried, off-origin redirects followed; `ftp://`/`file://` were already refused, but the message didn't say "https") | `785de24`: 200 passed |

Tests changed, not weakened: the `data` fixture's bookkeeping files now come from `BOOKKEEPING`.
`test_drops_files_the_api_does_not_carry` became `test_keeps_the_pipeline_bookkeeping` (it still asserts that
`events/old.json` and `.gitkeep` go), and the whole-tree comparisons now expect `files() | BOOKKEEPING`.

## Test specification (additions)

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 19 | A snapshot more than 10 min ahead is refused; within 10 min it's accepted; a committed future `generated_at` doesn't block, a committed one within skew still does | `test_fetch_v1.py::test_snapshot_from_the_future_is_refused`, `::test_snapshot_within_clock_skew_is_accepted`, `::test_committed_future_generated_at_does_not_block`, `::test_committed_within_clock_skew_still_blocks` | unit | PASS |
| 20 | Broken content is refused with data/ untouched: garbage or non-object `fighters.json`, garbage event/schema/unlisted event file, id ≠ file name, `fights` not a list, unknown red/blue (named), indexed upcoming/recent event without its file | `::test_invalid_content_is_refused[*]` (9), `::test_listed_event_without_its_file_is_refused`, `::test_recent_event_without_its_file_is_refused`, `::test_unknown_fighter_is_named`, `::test_fights_between_known_fighters_are_accepted` | unit | PASS |
| 21 | `npm run validate-data` passes the `/v1/` fixture and fails, naming the file, on a schema violation and on a missing dir | `site/tests/build/validate-data.test.ts` (runs the real script) | integration | PASS |
| 22 | v1 runs setup-node from `site/.nvmrc` and `npm run validate-data` in `site/` after the fetch, before `git add data` | `test_workflows.py::test_refresh_v1_validates_data_with_the_site_schema_before_committing`, `::test_refresh_v1_validate_step_runs_in_site` | structural | PASS |
| 23 | An oversized PAX header is refused by the decompressed-stream cap; a small one is fine; a 5 MB member arrives intact | `::test_oversize_pax_header_is_refused`, `::test_small_pax_header_is_fine`, `::test_large_member_is_copied_whole` | unit | PASS |
| 24 | Bookkeeping files are carried over, optional, overridden by a snapshot copy, and survive a snapshot without `images/` | `::test_keeps_the_pipeline_bookkeeping`, `::test_bookkeeping_is_optional`, `::test_snapshot_copy_of_a_bookkeeping_file_wins`, `::test_bookkeeping_survives_a_snapshot_without_images` | unit | PASS |
| 25 | https only (http to 127.0.0.1/localhost allowed); same-origin redirects followed; other host, scheme or port refused | `::test_download_refuses_non_https_urls[*]`, `::test_main_refuses_a_plain_http_base`, `::test_download_allows_plain_http_to_localhost`, `::test_download_follows_a_same_origin_redirect`, `::test_download_refuses_a_redirect_off_the_origin[*]` | integration (local HTTP server) | PASS |

## Commands and output

```
$ mise x actionlint@1.7.12 shellcheck@0.11.0 -- bash -c 'ACTIONLINT=$(command -v actionlint) uv run --project pipeline pytest scripts/tests -q'
# RED a3b5bc9 (fix 1 tests only):  2 failed, 2 passed
# RED 9a9561f:                     14 failed, 169 passed
# RED 93946b9 (test_fetch_v1.py):  1 failed, 87 passed
# RED ee3dac0 (test_fetch_v1.py):  10 failed, 81 passed
# RED 2f65e16 (test_fetch_v1.py):  9 failed, 93 passed
# GREEN 785de24, with --cov=scripts --cov-report=term-missing:
scripts/fetch_v1.py   263   3   99%   139, 219, 386
200 passed, 7 deselected in 6.27s
$ mise x actionlint@1.7.12 shellcheck@0.11.0 -- actionlint .github/workflows/*.yml   # exit 0
$ uv run --project pipeline pytest pipeline/tests scripts/tests -q
517 passed, 8 skipped, 1 deselected in 18.22s
$ cd site && npx vitest run tests/build/validate-data.test.ts   # RED 9a9561f: 3 failed (3)
$ cd site && npx vitest run                                     # GREEN: 131 passed (131)
$ cd site && npx astro check                                    # 0 errors, 0 warnings, 0 hints
```

## Known gaps

- Uncovered in `fetch_v1.py`: `_Capped.readable()` (tarfile never asks), the "`upcoming`/`recent` is not a list of
  event ids" refusal (the zod check in validate-data also covers it), and `__main__`.
- `fetch_v1.py`'s content check covers the cross-references only. The full schema is the site's, in `validate-data`,
  so a schema-invalid snapshot is in `data/` on the runner for a moment but never committed. The step and its
  `npm ci` run on every v1 run, including no-op ones (about 20–30 s).
- `extract` now writes members as it reads them, so a refusal can leave a partial tree. It's always inside the
  staging dir (or v1_shadow's temp dir), which is removed either way.
- Same-origin means scheme plus host:port. A redirect from `https://ufc-data.xlobax.com` to a CDN host would be
  refused; the engine serves `/v1/` from its own origin today.
- As before, nothing here has run on GitHub: the new steps are checked as text and with actionlint.
