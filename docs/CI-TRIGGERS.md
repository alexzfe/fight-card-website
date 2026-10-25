# CI triggers: why push / tag / pull_request never ran

Investigated 2026-10-25 by the `cidebug` agent. Repo: `alexzfe/fight-card-website`.

## Root cause

GitHub has GitHub Actions marked as **not enabled** on this repo, so automatic event triggers are turned off.
The Actions tab (`https://github.com/alexzfe/fight-card-website/actions`) shows this banner:

> **Workflows aren't being run on this repository**
> GitHub Actions is not currently enabled on this repository. Some GitHub features that depend on Actions may
> still be able to run.
> [Enable Actions on this repository]

This flag is separate from the Actions *permissions policy*. The policy is what the API and Settings → Actions → General
report, and it looks healthy there (`{"enabled":true,"allowed_actions":"all"}`, "Allow all actions" selected).
That's why earlier checks of the Settings page and of `GET /actions/permissions` found nothing wrong. While the
flag is off, push, pull_request and tag events never create an Actions check suite. A manual `workflow_dispatch`
still runs, which is the "some features may still be able to run" in the banner.

We don't know why the flag was set. The likeliest explanation is that GitHub defaulted it off because the repo
was created with `gh repo create --source` and its first push already contained workflows, a state similar to a
fork's "workflows disabled until you enable them". No API exposes this flag, so the cause can't be confirmed from
our side.

## Evidence

| Check | Result |
|---|---|
| Actions tab banner, this repo | Present: "Workflows aren't being run on this repository" |
| Actions tab banner, `alexzfe/settle` (control, triggers fine) | Absent; 15 runs listed |
| `gh api repos/alexzfe/fight-card-website/actions/permissions` | `enabled: true, allowed_actions: all`, same as settle, so it doesn't show the flag |
| Runs (`/actions/runs`) | `total_count: 1`, only the `workflow_dispatch` run 40176715869. No startup-failure runs, so the YAML was never even evaluated for push/PR |
| Check suites per commit | fc4f9af, a9bf129, 042ca5d, b1ecba3 (PR #1), daea8d7: only `vercel` (app 8329). `github-actions` (app 15368) only on 042ca5d, created by the dispatch |
| `[skip ci]`-style markers | None in any commit message (`git log --format=%B --all`) |
| Repo webhooks / rulesets | `[]` / `[]` |
| Token scopes (`gh auth status`) | `gist, read:org, repo, user, workflow`, so `workflow` is present |
| Workflow files on GitHub vs local | Identical; mode 100644, plain ASCII, no `.gitattributes`/LFS |
| Reusable workflow `alexzfe/infra` | Public, so cross-repo `uses:` is allowed, and refresh.yml already ran it successfully |
| `release.yml` `if:` / filters | Job-level `if:`s only, no `paths` filter. A run would still appear with skipped jobs, but none appears |

Ruled out: skip-ci markers, missing `workflow` scope, webhooks, rulesets, path filters, invalid YAML,
private-reusable-workflow access, and interference from the Vercel app (its suites are only `queued` and
don't stop Actions creating its own suite).

## Fix (applied 2026-10-25: clicked the banner button, and the page confirmed "Actions Enabled.")

The next push to `main` (5002a94) started `release` run 40177652341 automatically, so triggers work again.

Exact change: open `https://github.com/alexzfe/fight-card-website/actions` and click
**"Enable Actions on this repository"** in the banner. Signed in as `alexzfe` (repo admin).

That's the whole fix; no workflow or code changes are needed. There's no documented REST endpoint for this flag.
`PUT /repos/{owner}/{repo}/actions/permissions` with `enabled: true` already reports `true` and is probably a
no-op, so use the button.

If the banner is still shown, or triggers still don't fire after you click it, open a GitHub Support ticket with the
table above. The key points are: the banner is present while the API says `enabled: true`, and there are zero runs
or check suites from push/PR/tag events but dispatch works.

## How to verify

1. Reload the Actions tab: the banner should be gone.
2. Push an empty commit to a throwaway branch and open a PR from it:
   ```sh
   git switch -c ci-debug/verify origin/main
   git commit --allow-empty -m "ci: verify pull_request trigger"
   git push -u origin ci-debug/verify
   gh pr create --fill --base main
   gh run list --branch ci-debug/verify   # expect a `release` run, event=pull_request
   ```
   Then close the PR and delete the branch:
   `gh pr close --delete-branch ci-debug/verify` and `git switch main && git branch -D ci-debug/verify`.
3. The next real push to `main` should start `release` (test → build → staging). `gh api
   repos/alexzfe/fight-card-website/commits/<sha>/check-suites` should list a `github-actions` suite.
4. Tag `v0.1.0` was pushed while triggers were off, so it never deployed. Re-pushing the same tag won't create a
   new event. To exercise the tag path, push a new tag (`v0.1.1`) on a commit that main has already built,
   or delete and re-push `v0.1.0`. Each of these is a prod deploy, so decide that separately.
