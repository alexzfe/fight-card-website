# TDD evidence: the v1 refresh probes /v1/index.json before downloading the snapshot

**Source:** the "what is fetch being used for?" discussion (2026-10-27): `fetch_v1.py` downloaded the full
`/v1/snapshot.tar.gz` (~1.5 MB) on every refresh.yml tick while the engine publishes about daily. Decided: a
stateless probe of `/v1/index.json`, chosen over a conditional GET with a stored ETag (no state to keep between
runs). No `*.plan.md` file.
**Branch:** `feat/fetch-probe` (from `origin/main`).
**Docs:** `docs/DEPLOY.md` ("The probe", the `v1` mode row, "Stale"), the `refresh.yml` header and fetch step comments.

## User journeys

1. As the site owner, I want an hourly tick with nothing new to fetch ~1.5 KB, not the whole snapshot.
2. As the site owner, I want a stale API told from the probe alone, with the same exit code, outputs and issue body.
3. As the site owner, I want a broken or odd `index.json` never to block a refresh nor let through a snapshot the
   full checks would refuse.
4. As a maintainer, I want to force the old always-download behaviour for a manual run or when debugging.

## Task report

| Task | Summary | RED (b8596ac) | GREEN (e2d9b1c) |
|---|---|---|---|
| `scripts/fetch_v1.py` | `probe()` downloads `<base>/v1/index.json` with the existing `download()` (https-only, same-origin redirects) under `MAX_PROBE_BYTES` (1 MB) and checks it with `check_index()` (factored out of `read_index()`, same messages for the snapshot) and `check_not_future()`. Stale: raises the existing `StaleError`, so `main()` takes the stale path unchanged. No newer than `committed_at(data)`: returns `(index, ours)`, which `main()` reports exactly like `fetch()`'s no-op. Else, or on any probe failure (`FetchError`, bad JSON/UTF-8, too deep), returns `None` and the snapshot goes through `fetch()` unchanged. A failure logs one stderr line. `--no-probe` skips it. `no_newer()` is shared by the probe and `fetch()`. | 22 failed: the snapshot was downloaded first or only; `--no-probe` was an argparse error | 231 passed, 1 skipped |
| docs | `DEPLOY.md`: "The probe" paragraph, the `v1` mode row (no longer ~1.5 MB every tick), "Stale" told from the probe. `refresh.yml` comments. | – | – |

Existing tests whose fake `download` returns the tarball for every URL now exercise the fallback (the probe can't
parse a tarball): their assertions hold unchanged except `test_downloads_the_snapshot_url`, which now expects
`index.json` then `snapshot.tar.gz`. The local HTTP `server` fixture also serves `/v1/index.json` and logs the paths
asked for.

## Test specification

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A probe older than `data/` ends with exit 0, "not going backwards", `stale=false` outputs; only `index.json` is fetched | `test_probe_older_than_data_skips_the_snapshot` | unit | PASS |
| 2 | A probe equal to `data/` is a no-op ("already holds"); only `index.json` is fetched | `test_probe_equal_to_data_skips_the_snapshot` | unit | PASS |
| 3 | The probe's size cap is at most 1 MB | `test_probe_uses_a_small_size_cap` | unit | PASS |
| 4 | A stale probe exits 3 with `stale=true` outputs and the issue body, without the snapshot; stale wins over older-than-data/ | `test_stale_probe_exits_3_without_the_snapshot`, `test_stale_probe_wins_over_going_backwards` | unit | PASS |
| 5 | A newer probe, or an unknown committed age, downloads the snapshot (100 MB cap) and swaps it in | `test_newer_probe_downloads_and_swaps_the_snapshot`, `test_unknown_committed_age_downloads_the_snapshot` | unit | PASS |
| 6 | A snapshot not newer than `data/` after a newer probe (CDN cache) is the existing no-op | `test_snapshot_not_newer_after_a_newer_probe_is_a_no_op` | unit | PASS |
| 7 | The snapshot's own checks still refuse after a newer probe | `test_snapshot_checks_stay_authoritative_after_a_newer_probe` | unit | PASS |
| 8 | A failed probe (404, junk, bad UTF-8, not an object, too deep, contract 2, future, no `generated_at`, no `contract_version`, not UTC `Z`) logs one line and falls back to the snapshot, even when it claims to be older than `data/` | `test_a_failed_probe_falls_back_to_the_snapshot` (10 cases) | unit | PASS |
| 9 | After a failed probe the snapshot's staleness still exits 3 | `test_a_failed_probe_still_gets_the_snapshot_refusals` | unit | PASS |
| 10 | `--no-probe` never fetches `index.json` | `test_no_probe_always_downloads_the_snapshot` | unit | PASS |
| 11 | Over real HTTP: an unchanged API costs one `index.json` request; a newer one adds the snapshot request and swaps | `test_probe_end_to_end_over_http` | integration | PASS |

## Verification

- `uv run --project pipeline pytest -q scripts/tests`: RED 22 failed, 209 passed, 1 skipped; GREEN 231 passed,
  1 skipped (includes `test_v1_shadow.py` and `test_workflows.py`; `v1_shadow.py` reuses `download`,
  `snapshot_url`, `extract` and `read_index`, all with unchanged signatures).
- `refresh.yml`: comments only; its invocation of `fetch_v1.py` is unchanged.
- Against the live API (`/v1/index.json`: 200, 1559 bytes, contract 1.2, `generated_at` 2026-10-27T19:02:19Z) into
  a scratch dir: the first run downloaded and swapped in the snapshot; the second probed only and printed "already
  holds /v1/ generated_at 2026-10-27T19:02:19Z; nothing to do" (0.26 s).

## Review fixes

From the PR #17 review (1 should-fix, 5 nits).

| # | Finding | Fix | Tests |
|---|---|---|---|
| 1 | `download()` let `http.client.HTTPException` (BadStatusLine, IncompleteRead) escape: a malformed probe response crashed the run instead of falling back | Caught next to `OSError`, raised as `FetchError`; fixes the probe and the snapshot download | `test_download_malformed_response_is_a_fetch_error`, `test_a_malformed_probe_response_falls_back_to_the_snapshot`, `test_a_malformed_snapshot_response_is_refused` (2 cases each, over a real socket: the `server` fixture gained `raw` responses) |
| 2 | The stale issue's `API:` line named the snapshot URL when the probe found the staleness | `main()` names the URL that was checked: `/v1/index.json` from the probe, else the snapshot | `test_stale_probe_exits_3_without_the_snapshot` (index URL, not the snapshot's), `test_stale_snapshot_after_a_fresh_probe_exits_3` (the reverse); `test_stale_writes_the_issue_body` unchanged |
| 3 | DEPLOY.md overstated the probe | A CDN-cached `index.json` can delay a refresh by one tick; a malformed HTTP response is a probe failure | – |
| 4 | `--no-probe` read as wired into manual runs | For running `fetch_v1.py` by hand and debugging; `refresh.yml` has no input, manual runs probe too | – |
| 5 | This doc said ~1.6 MB | ~1.5 MB, as DEPLOY.md and the code | – |
| 6 | The main path (valid newer probe) was thin | `run()` serves a valid probe newer than `data/` (`PROBE`, NOW's `generated_at`; the publish-fixture test passes its own index, since its `--now` is later), so the old tests take the real path; the fallback stays covered by `test_a_failed_probe_falls_back_to_the_snapshot`. Added a fresh probe then a stale snapshot (exit 3 via the snapshot) and a fresh probe then a snapshot download error (exit 1, no outputs, no issue body) | `test_stale_snapshot_after_a_fresh_probe_exits_3`, `test_snapshot_download_error_after_a_fresh_probe` |

Fix 1's tests use a real socket rather than a fake `download` raising `IncompleteRead`, which would bypass
`download()` and test only `probe()`. `test_committed_within_clock_skew_still_blocks` is now kept by the probe (its
`generated_at` is no newer than `data/`) rather than by the snapshot; same outcome.

- RED 4ccb74d: scripts 7 failed, 232 passed, 1 skipped (the 6 malformed-response cases and the stale probe's URL).
  The two main-path tests passed on RED: they pin behaviour the GREEN commit had to keep, not a bug.
- GREEN 6d3f3fb: scripts 239 passed, 1 skipped.
