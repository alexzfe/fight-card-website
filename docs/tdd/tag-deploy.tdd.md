# TDD evidence: a tag deploy never rolls prod's data back

**Source:** the tag-deploy brief, after the 2026-10-27 incident. Refresh deployed `data/` with `rankings.json` at
19:06:14. 22 s later tag `v0.4.0` (commit 92e6e32, built 18:53) deployed its prebuilt image, so `/rankings/` went 404.
**Branch:** `fix/tag-deploy-data` (from `origin/main` at 4bbb53d, worktree `fight-card-website-tagfix`).
**Operational doc:** `docs/DEPLOY.md` ("Tag deploys and data").

## User journeys

1. As the site owner, I want a `v*` tag to put the tag's code on prod together with the latest committed `data/`, so
   a release never hides data the refresh already shipped.
2. As the site owner, I want no deploy, tag or refresh, to replace newer `data/` on prod with older `data/`, however
   the two workflows interleave.
3. As the site owner, I want prod still to run only code that main built and staging ran, with no new secrets or
   wider token permissions.

## Design

`release.yml`'s `prod` job now calls the new reusable `prod.yml` instead of deploying `ghcr…:<tagged sha>`. `prod.yml`
runs `build.yml` with `ref: <tagged sha>` and `data_ref: main`. It checks out the tag, fetches main, replaces `data/`
wholesale and builds `ghcr…:<sha>-data-<main sha>`. Then it runs infra's `deploy-app.yml` with that tag. Release's
`prod` job (around all of `prod.yml`) and refresh's `prod` job share the concurrency group `prod-deploy`
(`cancel-in-progress: false`). The tag therefore reads main's `data/` and deploys it with no refresh deploy in
between.

## Round 1

RED (7395a4e): `scripts/tests` 10 failed, 193 passed, 1 skipped. GREEN (4c55a2e): 204 passed, 1 skipped (the
skip is `test_v1_shadow`'s fixture-freshness check, unrelated). actionlint 1.7.12 with shellcheck 0.11.0:
`test_actionlint_passes` PASSED, and a direct run reports nothing.

| # | What is guaranteed | Test (`scripts/tests/test_workflows.py`) | Type | Result |
|---|---|---|---|---|
| 1 | The tag's `prod` job no longer calls deploy-app with the prebuilt image; it calls `prod.yml` with `ref: github.sha` and `secrets: inherit`, and the GitHub Release still waits for it | `test_release_tag_no_longer_deploys_the_prebuilt_image` | static | PASS |
| 2 | That job grants only `contents: read`, `packages: write` | `test_release_prod_job_permissions_are_minimal` | static | PASS |
| 3 | `prod.yml`: top-level `permissions: {}`; `build` calls `build.yml` with the input ref and `data_ref: main`; `deploy` needs it and deploys `needs.build.outputs.tag` to prod | `test_prod_workflow_builds_the_code_with_mains_data_then_deploys_that_image` | static | PASS |
| 4 | Release's and refresh's prod jobs hold `prod-deploy` without cancel-in-progress, and no other job in them deploys prod outside it | `test_every_prod_deploy_holds_the_same_lock` | static | PASS |
| 5 | `build.yml`: `data_ref` optional (default `""`), a `tag` output, the data step before build-push, the image pushed as `steps.data.outputs.tag`, inputs through `env:` | `test_build_takes_an_optional_data_ref_and_outputs_the_image_tag` | static | PASS |
| 6 | Without `data_ref` the step leaves `data/` alone and the tag is the SHA (release's staging and refresh are unchanged) | `test_build_without_data_ref_keeps_the_commits_data_and_tags_the_sha` | behaviour (the step's script run against a real git origin) | PASS |
| 7 | With `data_ref: main` it swaps in main's `data/` exactly (new file added, deleted file and untracked stray gone, changed file updated), keeps the tag's code and HEAD, and the tag is `<sha>-data-<main sha>`, valid for Docker and infra's `deploy-app` (`^[A-Za-z0-9_.-]+$`) | `test_build_with_data_ref_swaps_in_mains_data_and_only_data` | behaviour | PASS |
| 8 | The tag deploy still purges the edge cache, still targets `app: ufc` and the prod URL, and still builds through `build.yml` | `test_every_deploy_purges_the_edge_cache`, `test_release_targets_ufc_hosts`, `test_both_flows_build_through_the_shared_build_workflow` (now also read `prod.yml`) | static | PASS |
| 9 | No workflow, not only refresh.yml, interpolates `${{ }}` into a `run:` script | `test_workflows_interpolate_no_expressions_into_run_scripts[*]` (was refresh-only; the scanner now ends a one-line `run:` at its line, which had flagged release.yml's `env: GH_TOKEN`) | static | PASS |

## Known gaps

- The workflows are checked structurally, by running the data step's script and by actionlint, but not on GitHub.
  Two points only a real run shows: that `concurrency` on a reusable-workflow caller job holds the group for the
  whole called workflow (GitHub documents it as a supported key, and actionlint accepts it), and the nested
  `secrets: inherit` (release → prod → deploy-app). The first tag after the merge exercises both; watch it.
- GitHub keeps one pending run per concurrency group, so a pending deploy can be replaced by a newer one (see
  DEPLOY.md). Whatever runs next carries main's latest `data/`, so data never goes backwards, but a replaced tag
  deploy skips its GitHub Release.
