# TDD evidence: review quick wins

**Source:** open nits from the PR #11 post-merge review (prod smoke test curls `/` only; `build.yml`'s
`git fetch "$DATA_REF"` lacks a `-*` guard) and the UI pass follow-up (the rail's aria-label still "Events").
**Branch:** `fix/review-quick-wins` (from `main` at f1b5448).

## Changes

- `prod.yml` and `refresh.yml` end with a `smoke` job (`needs:` the prod deploy, `permissions: {}`) that curls
  `https://ufc.xlobax.com/rankings/` with deploy-app's retry flags. It runs after the deploy, outside the
  `prod-deploy` lock: it only reads.
- `build.yml`'s data step exits 1 with a message when `data_ref` starts with `-`, before `git fetch`.
- The rail's `<nav>` is named "Events and rankings" when the Rankings tile is shown, "Events" otherwise.

## Round 1

RED (6ff2775): `scripts/tests` 3 failed, 239 passed, 1 skipped; e2e 1 failed. The guard test failed because git ran
the `--upload-pack` value ("Could not read from remote repository"), not on a missing message alone.
GREEN: `scripts/tests` 242 passed, 1 skipped (`test_v1_shadow`'s fixture-freshness check, unrelated; actionlint on
`PATH`, `test_actionlint_passes` passed); site unit 233 passed; `astro check` 0 errors; e2e 70 passed.

| # | What is guaranteed | Test | Type | Result |
|---|---|---|---|---|
| 1 | A `data_ref` starting with `-` exits non-zero naming `data_ref`, runs nothing, writes no output and leaves `data/` alone | `scripts/tests/test_workflows.py::test_build_refuses_a_data_ref_that_git_would_read_as_an_option` | behaviour (step script against a real git origin) | PASS |
| 2 | `prod.yml` and `refresh.yml` each have a `smoke` job after their prod deploy, with no permissions, curling `/rankings/` via `env:` | `test_every_prod_deploy_is_followed_by_a_rankings_check` (2 cases) | static | PASS |
| 3 | The rail is named exactly "Events and rankings" on `/` and `/rankings/` | `site/tests/e2e/site.spec.ts` "the rail is named for both the events and the rankings it leads to" | e2e | PASS |

Not covered by a test: the "Events" fallback when there is no rankings page (no fixture without `rankings.json`;
the same gap as the off-season footer follow-up).
