# TDD evidence: a replaced pending tag deploy is impossible to miss

**Source:** the PR #11 post-merge review: a tag deploy waiting on the `prod-deploy` lock can be replaced by a newer
pending deploy (tag or refresh); its run just shows "cancelled" and its `release` job never cuts the GitHub Release.
**Branch:** `fix/replaced-tag-deploy` (from `origin/main` at f1b5448, worktree `fight-card-website-tagrelease`).
**Operational doc:** `docs/DEPLOY.md` ("Tag deploys and data", trade-off "Pending deploys are replaced, not queued").

## What GitHub documents

- Concurrency, `queue: single` (the default): "any existing `pending` job or workflow run in the same group is
  canceled and replaced" ([Control the concurrency of workflows and jobs](https://docs.github.com/en/actions/writing-workflows/choosing-what-your-workflow-does/control-the-concurrency-of-workflows-and-jobs)).
  So the replaced tag's `prod` job is cancelled, not failed.
- `needs.<job_id>.result`: "Possible values are `success`, `failure`, `cancelled`, or `skipped`"
  ([Contexts](https://docs.github.com/en/actions/reference/workflows-and-actions/contexts)).
- `jobs.<job_id>.needs`: "If a job fails or is skipped, all jobs that need it are skipped unless the jobs use a
  conditional expression that causes the job to continue"; use `always()` in `jobs.<job_id>.if` to run anyway
  ([Workflow syntax](https://docs.github.com/en/actions/reference/workflows-and-actions/workflow-syntax)). The page
  says nothing specific about a cancelled need; `release`'s default `success()` skips it either way.
- `always()`: "Causes the step to always execute, and returns `true`, even when canceled"; `cancelled()`: "Returns
  `true` if the workflow was canceled" ([Expressions](https://docs.github.com/en/actions/reference/workflows-and-actions/expressions)).
  The docs don't say whether a job-level cancellation marks the whole run cancelled, so the new job uses
  `always()` (runs either way) rather than `!cancelled()` (would not run if it does).
- Not used, worth knowing: `concurrency.queue: max` keeps up to 100 pending runs instead of replacing them
  (not with `cancel-in-progress: true`). The docs' only example is workflow-level and don't confirm it on
  `jobs.<job_id>.concurrency`, so it stays a follow-up (see Known gaps).

## Design

`release.yml` gains a `not-deployed` job: `needs: prod`, `if: always() && needs.prod.result == 'cancelled'`,
`permissions: issues: write`. It opens a "Tag `<tag>` not deployed" issue (or comments on the open one), naming the
run URL, the cause, **Re-run all jobs**, and not to re-run once a newer tag has deployed (that would put older code
back). Then it prints an `::error::` naming the tag and exits 1, so the run also shows a failure. The `release` job
keeps its default `success()` condition (no Release for an undeployed tag), gains `issues: write`, and after
`gh release create` closes that tag's open issue, so a successful re-run cleans up. Inputs reach the scripts through
`env:` (`TITLE: Tag ${{ github.ref_name }} not deployed`) and the runner's default variables; the issue lookup is
the same exact-title `gh issue list` as refresh's stale issues.

One issue per tag rather than a shared one: two replaced tags need separate decisions (usually: re-run only the
newest), and the re-run closes exactly its own.

## Round 1

RED (ace8511): `scripts/tests` 6 failed, 241 passed. GREEN (75f7b12): 247 passed. actionlint 1.7.12 with
shellcheck 0.11.0 on `PATH`: `test_actionlint_passes` PASSED, and a direct run reports nothing.

| # | What is guaranteed | Test (`scripts/tests/test_workflows.py`) | Type | Result |
|---|---|---|---|---|
| 1 | The `release` job needs `prod` and keeps the default `success()`: a cancelled or failed deploy cuts no Release | `test_release_is_cut_only_for_a_tag_that_deployed` | static | PASS |
| 2 | `not-deployed` needs `prod`, runs on `always() && needs.prod.result == 'cancelled'`, has only `issues: write`, takes its title and token through `env:` | `test_a_cancelled_tag_deploy_runs_the_not_deployed_job` | static | PASS |
| 3 | With no open issue it creates "Tag v0.6.0 not deployed" with the run URL, "Re-run all jobs" and the newer-tag warning, prints an `::error::` naming the tag and the re-run, and exits non-zero | `test_not_deployed_opens_an_issue_naming_the_tag_and_the_rerun_and_fails` | behaviour (step script, fake `gh`) | PASS |
| 4 | With the issue open it comments there (with the run URL) and opens no second one, still failing | `test_not_deployed_comments_on_the_open_issue_instead_of_opening_another` | behaviour | PASS |
| 5 | `release` has `contents: write`, `issues: write`; its close step runs after `gh release create` and uses the same title | `test_release_closes_the_tags_not_deployed_issue_after_cutting_the_release` | static | PASS |
| 6 | After a successful deploy it closes the tag's open issue with a comment naming the run | `test_release_closes_an_open_not_deployed_issue` | behaviour | PASS |
| 7 | With no such issue it only lists, and touches nothing | `test_release_leaves_issues_alone_when_none_is_open` | behaviour | PASS |
| 8 | No `${{ }}` in the new `run:` scripts | `test_workflows_interpolate_no_expressions_into_run_scripts[release.yml]` (existing) | static | PASS |

## Review fixes

From the branch review (no blocking defects; one medium, three low). RED (702be75): `scripts/tests` 4 failed,
249 passed. GREEN (2cef323): 253 passed. actionlint 1.7.12 with shellcheck 0.11.0 on `PATH`: clean.

1. **The text claimed the deploy never started (medium).** A cancel by hand mid-deploy, or a deploy hitting
   `timeout-minutes`, also leaves `needs.prod.result == 'cancelled'`, so "cancelled before it started" and "Prod
   doesn't run this tag's code" could be false. The issue body, the `::error::`, the job comment and DEPLOY.md now
   say the deploy was cancelled (usually replaced while pending; maybe by hand or timed out mid-deploy), no Release
   was cut, and prod *may not* run the tag's code.
2. **`release` wasn't re-runnable (low).** If the close step failed, "Re-run failed jobs" hit "release already
   exists" and never reached it. The step is now `Cut the GitHub Release`: `gh release view … || gh release create …`.
3. **The fake `gh` ignored `--jq` (low).** `FAKE_GH_ISSUES` now answers `issue list` with JSON (`OPEN_ISSUES`, plus
   `OPEN_ISSUE` titled exactly `$TITLE`) and applies the step's own `--jq` with `jq`, as a fuzzy search would return
   a similar title. Mutation check: dropping `select(.title == env.TITLE)` from release.yml fails both
   similar-title tests. They pass at RED because the filter was already correct. refresh.yml's issue tests use the
   same fake and still pass.
4. **Hard line breaks mid-sentence (low).** GitHub renders each newline in an issue as a line break; the body is
   now `printf '%s\n\n%s\n'` of two one-line paragraphs.

| # | What is guaranteed | Test (`scripts/tests/test_workflows.py`) | Type | RED | GREEN |
|---|---|---|---|---|---|
| 9 | Body and `::error::` don't say "before it started", "doesn't run", "its pending" or "was not deployed"; they say prod "may not run this tag's code", and the body names a cancel by hand and a timeout | `test_not_deployed_says_only_what_is_true_for_every_cancel` | behaviour | FAIL | PASS |
| 10 | Issue and comment bodies have exactly two paragraphs and no single newlines | `test_not_deployed_body_breaks_lines_only_between_paragraphs` | behaviour | FAIL | PASS |
| 11 | With only "Tag v0.6.0 not deployed" open, tag v0.6 creates its own issue, not a comment | `test_not_deployed_opens_a_new_issue_when_only_a_similar_title_is_open` | behaviour (fake applies `--jq`) | PASS | PASS |
| 12 | `release` closes nothing when only a similar title is open | `test_release_leaves_a_similarly_titled_issue_open` | behaviour | PASS | PASS |
| 13 | With no Release, the step creates it with `--generate-notes` | `test_release_cuts_the_release_when_it_does_not_exist` | behaviour | FAIL | PASS |
| 14 | With the Release already there, the step succeeds without creating it, so the close step runs | `test_release_rerun_skips_an_existing_release_and_reaches_the_close_step` | behaviour | FAIL | PASS |

At GREEN, test 9's "pending prod deploy" check was narrowed to "its pending". The new text keeps the review's
"a newer pending prod deploy", which is true; only the old "its pending prod deploy was cancelled" overclaimed.

## Known gaps

- Only a real replaced tag run shows that `needs.prod.result` is `cancelled` for a cancelled reusable-workflow caller
  job and that `not-deployed` then runs. It also runs when a tag deploy is cancelled by hand or times out (the
  issue's text covers every cause).
- If the run counts as cancelled overall, its final status may stay "cancelled" despite the failing job; the issue
  is the signal that doesn't depend on that.
- `concurrency.queue: max` on both `prod-deploy` jobs would remove the replacement itself. Untried: it needs
  confirmation that GitHub accepts it at job level on a reusable-workflow caller, and an actionlint that knows the
  key: 1.7.12 (the version CI pins) rejects it (`unexpected key "queue" for "concurrency" section`).
