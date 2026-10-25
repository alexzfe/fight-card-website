# Deploying ufc.xlobax.com

The site is a static Astro build served by nginx in one container, `ghcr.io/alexzfe/fight-card-website:<sha>`, run by
the [infra](https://github.com/alexzfe/infra) repo's `deploy-app` on the Hetzner VPS. Cloudflare sits in front.

| Env | URL | Deployed by |
|---|---|---|
| staging | https://ufc-staging.xlobax.com | every push to `main` (`release.yml`) |
| prod | https://ufc.xlobax.com | a `v*` tag (`release.yml`), and every data refresh that changed `data/` (`refresh.yml`) |

## The pieces

| File | Does |
|---|---|
| `Dockerfile` | From `infra/templates/static-site.Dockerfile`. Node 22 runs `npm ci && npm run build` in `site/` with `DATA_DIR=/src/data`, then `nginx-unprivileged` serves `dist/` on `:8080`. Serves Astro's `404.html` for unknown paths, and marks `/_astro/*` immutable. Health path: `/healthz` (a static file from `site/public/`). |
| `.dockerignore` | Only `site/` and `data/` go into the build context. |
| `.github/workflows/build.yml` | Reusable: builds and pushes the image for one commit, tagged with its SHA. |
| `.github/workflows/release.yml` | From `infra/templates/app-release.yml`. PR → tests. Push to main → tests, build, deploy staging. `v*` tag → deploy that commit's image to prod and cut a GitHub Release. |
| `.github/workflows/refresh.yml` | Cron. Runs the pipeline, commits `data/`, maintains the stale-model issue, then builds and deploys prod. |
| `scripts/should_run.py` | Decides whether a refresh run does any work (see below). |
| `scripts/stale_issue.py` | Builds the "Re-export finish model" issue body from `data/stale_fighters.json`. |
| infra `sites.yml` | The `ufc` entry: image, port 8080, `health_path: /healthz`, both hosts, default memory caps (1g prod, 256m staging). On branch `add-ufc-site` in the infra repo. |

Tests: `uv run --project pipeline pytest scripts/tests`. Add `-m docker` to build the Dockerfile against a stub site and
probe it the way infra's compose healthcheck does. The actionlint test runs when `actionlint` is on `PATH` or
`ACTIONLINT=/path/to/actionlint` is set; CI runs it as its own step too.

## How the refresh works

```
cron 06:00 UTC daily ─┐
cron :17 hourly ──────┼─▶ gate (should_run.py) ─▶ pipeline ─▶ build ─▶ prod
workflow_dispatch ────┘        │                   │           │        │
                         skip unless daily,   scrape → images   only if data/ changed
                         manual, or an event  → score → commit  (or manual run)
                         today/yesterday      data/ → issue
```

- **When it works.** The 06:00 run and manual runs always go ahead. An hourly run goes ahead only if an event in
  `data/index.json` is dated today or yesterday (UTC). US cards finish after midnight UTC, and results are scraped the
  day after. The script matches on `github.event.schedule`, the cron string that fired, not on the clock, because
  GitHub often starts scheduled runs late. The hourly cron uses minute 17 so it never fires in the same slot as the
  daily run.
- **Failure.** `scrape`, `images` and `score` run in order. If any of them exits non-zero, the job fails before
  anything is committed, built or deployed, and GitHub emails the failure.
- **Cookie.** `.cache/ufcstats/` is restored and saved with `actions/cache`, so the `_fmc` cookie (valid 7 days) is
  reused across runs. Each run saves a new cache key (`ufcstats-cookie-<run_id>`) and restores the newest one.
  `scrape` is called with `--cookie-file .cache/ufcstats/cookies.json`.
- **Commit.** `data/` is committed as `github-actions[bot]` and pushed to main. If a code push landed during the run,
  the job rebases and pushes again. Only this job writes `data/`, so the rebase can't conflict.
- **Stale model.** `score` writes `data/stale_fighters.json` when a fighter has fought since the model export.
  The job then opens the single "Re-export finish model" issue, or updates it if it is already open. When nothing is
  stale it closes the issue.
- **Deploy.** If `data/` changed (or the run was manual), `build.yml` builds the new commit and prod is deployed to
  that SHA.

### Why refresh calls deploy-app directly instead of tagging

The plan said "tag a release → auto-deploy". But a tag or commit pushed with the default `GITHUB_TOKEN` does not
trigger other workflows, so a tag pushed by `refresh.yml` would never start `release.yml`. The options were:

1. Push the tag with a PAT or GitHub App token. That adds a long-lived secret with write access, just for this.
2. Have `release.yml` expose `workflow_call` and call it from refresh. That mixes the code-release flow
   (test → staging → tag → prod) with the data flow, and needs fake tag/ref inputs.
3. **Chosen:** refresh calls the same two building blocks that `release.yml` uses: the local reusable `build.yml`
   and infra's `deploy-app.yml`, with `env: prod`. It needs no extra secret. The image is still tagged with the
   commit SHA, so a later `v*` tag on a data commit deploys an image that already exists, and rollback works the
   same way.

Data commits don't trigger `release.yml` either, so they don't rebuild staging. Staging keeps running the last code
push.

**Trade-off to know about:** a refresh deploys main's HEAD to prod. A code change merged to main reaches staging
immediately, and then reaches prod at the next refresh that changes data, usually within a day, without a tag. So
treat a merge to main as "will ship". Check staging after merging, and keep unfinished work on branches. If that
becomes a problem, a later option is for refresh to build prod from the latest `v*` tag's code plus the new `data/`.

## Go-live checklist

The repo has no git remote yet, and none of the steps below have been done. Do them in this order. The infra change
has to be live before the first deploy, or `deploy-app` won't know the app.

### 1. Infra: add the `ufc` site

The change is committed in the worktree `~/Projects/infra-ufc` on branch `add-ufc-site`, one commit on top of
`origin/main`. It has not been pushed.

```sh
cd ~/Projects/infra-ufc
git push -u origin add-ufc-site
gh pr create --repo alexzfe/infra --fill
```

Wait for `lint` and `plan` to pass. The plan should add two proxied DNS records and two tunnel ingress rules, and
Ansible should add nginx routes and `/opt/apps/ufc-{staging,prod}/compose.yml`. Then merge, and CI applies both.
Afterwards, remove the worktree with `git -C ~/Projects/infra worktree remove ../infra-ufc`.

### 2. Home network: Pi-hole split-horizon

On the homeserver, add these lines to `/docker/pihole/etc-dnsmasq.d/02-split-horizon.conf`:

```
server=/ufc.xlobax.com/#
server=/ufc-staging.xlobax.com/#
```

Then run `docker restart pihole`. Without this, the site works everywhere except inside the house.

### 3. Create the GitHub repo

The repo should be public: free Actions minutes, and the image has to be public anyway. The image name is hard-coded
as `ghcr.io/alexzfe/fight-card-website`, so the repo should be `alexzfe/fight-card-website`. If you name it
differently, change `IMAGE` in `build.yml` and `image` in infra's `sites.yml`.

```sh
cd ~/Projects/fight-card-website
gh repo create alexzfe/fight-card-website --public --source . --remote origin
git switch main && git merge --ff-only feat/v1   # or open a PR from feat/v1 once main is pushed
git push -u origin main
```

### 4. Repo settings and secrets

- **Secrets:** add `TS_CI_OAUTH_CLIENT_ID` and `TS_CI_OAUTH_SECRET`. These are the Tailscale OAuth client **ci**
  (scope `auth_keys`, tag `tag:ci`) from the infra README, the same values the other app repos use.
  ```sh
  gh secret set TS_CI_OAUTH_CLIENT_ID --repo alexzfe/fight-card-website
  gh secret set TS_CI_OAUTH_SECRET --repo alexzfe/fight-card-website
  ```
- **Branch protection (optional):** if you protect `main`, the refresh job still has to push data commits. Either
  leave `main` unprotected against pushes, or add `github-actions[bot]` as a bypass actor in the ruleset.
- **Environments:** the `staging` and `prod` environments are created by the first deploy. Leave them without
  required reviewers. Prod deploys from refresh run unattended.

### 5. First build, then make the image public

The push in step 3 starts `release.yml`. The build job pushes the image. The staging deploy will probably fail at
the pull, because a new GHCR package starts private.

- Go to GitHub → your profile → Packages → `fight-card-website` → Package settings → Change visibility → **Public**.
  While you're there, check that "Manage Actions access" links the repo with write access.
- Re-run the failed staging job (`gh run rerun --failed`). Then check https://ufc-staging.xlobax.com and
  https://ufc-staging.xlobax.com/healthz.

### 6. Prod

```sh
git tag v0.1.0 && git push origin v0.1.0
```

This deploys the image staging already ran and cuts a GitHub Release. Check https://ufc.xlobax.com.

### 7. Start the data refresh

- Run it once by hand: `gh workflow run refresh.yml`. A manual run always builds and deploys prod.
- Before the `score` stage can do anything useful, the vendored model has to be in `model/` (see PLAN, milestone 4).
- Scheduled workflows only run from the default branch. The daily data commit keeps GitHub from disabling the
  schedule after 60 days of repo inactivity.
- If the hourly runs get noisy in the Actions list, that's expected: most of them exit after the 5-second gate job.

## Operating

- **Roll back prod:** re-run the prod deploy of an earlier tag (Actions → release → that tag's run → Re-run).
  On the box: `sudo deploy-app ufc prod <old-sha>`.
- **Redeploy without new data:** `gh workflow run refresh.yml` (a manual run always rebuilds and deploys).
- **Refresh failed:** nothing was committed or deployed, and the site keeps serving the previous data. Read the
  failing step's log. A ufcstats challenge failure or a 0-events parse fails the `scrape` step on purpose.
- **"Re-export finish model" issue:** follow the steps in its body. The next refresh rescores and closes it.
