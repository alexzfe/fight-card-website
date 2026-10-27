# Deploying ufc.xlobax.com

The site is a static Astro build served by nginx in one container, `ghcr.io/alexzfe/fight-card-website:<sha>`, run by
the [infra](https://github.com/alexzfe/infra) repo's `deploy-app` on the Hetzner VPS. Cloudflare sits in front.

| Env | URL | Deployed by |
|---|---|---|
| staging | https://ufc-staging.xlobax.com | every push to `main` (`release.yml`) |
| prod | https://ufc.xlobax.com | a `v*` tag (`release.yml` → `prod.yml`), and every data refresh that changed `data/` (`refresh.yml`) |

## The pieces

| File | Does |
|---|---|
| `Dockerfile` | From `infra/templates/static-site.Dockerfile`. Node 22 runs `npm ci && npm run build` in `site/` with `DATA_DIR=/src/data`, then `nginx-unprivileged` serves `dist/` on `:8080`. Serves Astro's `404.html` for unknown paths, and marks `/_astro/*` immutable. Health path: `/healthz` (a static file from `site/public/`). |
| `.dockerignore` | Only `site/` and `data/` go into the build context. |
| `.github/workflows/build.yml` | Reusable: builds and pushes the image for one commit, tagged with its SHA. With `data_ref`, it swaps in that ref's `data/` first and tags the image `<sha>-data-<data sha>`. |
| `.github/workflows/release.yml` | From `infra/templates/app-release.yml`. PR → tests. Push to main → tests, build, deploy staging. `v*` tag → `prod.yml` under the `prod-deploy` lock, then cut a GitHub Release. |
| `.github/workflows/prod.yml` | Reusable, for a tag: builds the tagged code with main's latest `data/` and deploys that image to prod. See [Tag deploys and data](#tag-deploys-and-data). |
| `.github/workflows/refresh.yml` | Cron. Gets `data/` from the pipeline or the engine's `/v1/` API (`DATA_SOURCE`, below), commits it, then builds and deploys prod. In pipeline mode it also maintains the stale-model issue and shadows `/v1/`. |
| `scripts/should_run.py` | Decides whether a pipeline-mode refresh run does any work (see below). |
| `scripts/fetch_v1.py` | `v1` mode: replaces `data/` with `/v1/snapshot.tar.gz`, or refuses it when it is unsafe, broken, from the future or not contract 1.x (exit 1), stale (exit 3, plus the "Data API stale" issue body) or no newer than `data/` (exit 0, nothing changes). Keeps the pipeline's bookkeeping files. |
| `site/scripts/validate-data.mjs` | `npm run validate-data [-- <dir>]`: loads a data dir through the site's `loadData` and zod schema without building. `v1` mode runs it before committing. |
| `scripts/v1_shadow.py` | `pipeline` mode: writes how `/v1/` differs from the pipeline's `data/` to the job summary. Never fails. |
| `scripts/stale_issue.py` | Builds the "Re-export finish model" issue body from `data/stale_fighters.json`. |
| infra `sites.yml` | The `ufc` entry: image, port 8080, `health_path: /healthz`, both hosts, default memory caps (1g prod, 256m staging). On branch `add-ufc-site` in the infra repo. |

Tests: `uv run --project pipeline pytest scripts/tests`. Add `-m docker` to build the Dockerfile against a stub site and
probe it the way infra's compose healthcheck does. The actionlint test runs when `actionlint` is on `PATH` or
`ACTIONLINT=/path/to/actionlint` is set; CI runs it as its own step too.

## Data source: pipeline or /v1/

The repo variable `DATA_SOURCE` picks where `refresh.yml` gets `data/` from. Either way, the site is built from the
committed `data/`, never from the browser, and `data/` stays in git (audit trail, rollback).

| `DATA_SOURCE` | Jobs | What happens |
|---|---|---|
| `pipeline` (default; also when unset) | gate → pipeline → build → prod, plus `shadow` | Today's refresh (below). The `shadow` job then downloads the [fightcard-engine](https://github.com/alexzfe/fightcard-engine)'s `https://ufc-data.xlobax.com/v1/snapshot.tar.gz` and writes a diff summary to its job summary: how many events, fights, finish tiers and fighter Elos differ, with examples and the largest Elo gap. `generated_at` and what only `/v1/` has (`contract_version`, `Result.outcome`, `schema.json`) don't count. It never fails or holds up the refresh: nothing waits for it, it has `continue-on-error`, and when the API is down it notes "v1 not reachable" and succeeds. |
| `v1` | v1 → build → prod | No gate, no pipeline, no cookie cache, no stale-model issue. `scripts/fetch_v1.py` downloads the snapshot and swaps it in for `data/`, `npm run validate-data` checks it with the site's schema, then `data/` is committed, built and deployed exactly as in pipeline mode. It runs on every cron tick (the download is ~1.5 MB) and maintains the "Data API stale" issue (below). |

**Switch to `/v1/`** once the shadow summaries have shown no unexplained differences for a while:

```sh
gh variable set DATA_SOURCE --body v1 --repo alexzfe/fight-card-website
gh workflow run refresh.yml --repo alexzfe/fight-card-website   # optional: refresh and deploy now
```

**Roll back** to the pipeline by setting it back (or deleting the variable). The next run scrapes again from the
committed `data/`:

```sh
gh variable set DATA_SOURCE --body pipeline --repo alexzfe/fight-card-website
```

The first `/v1/` commit adds `schema.json` and `contract_version` to `data/`. The pipeline's bookkeeping,
`images/misses.json` and `stale_fighters.json`, isn't in the snapshot (and the site reads neither), so `fetch_v1.py`
copies both from the old `data/` into the new one on every swap. They stay in git as the pipeline last wrote them,
and a rollback carries on from there.

`data/rankings.json` (the Rankings tab) is not in the pipeline's output, so under `DATA_SOURCE=pipeline` it freezes at
the last `/v1/` swap: the Rankings tab keeps serving that `as_of` indefinitely, and the build stays green. On a
rollback either delete it (`git rm data/rankings.json`, commit and push: the tab and its link then disappear) or
accept the frozen list. Its P4P headshots are `data/images/*.webp`, which the pipeline's image step leaves alone.

**What `fetch_v1.py` refuses.** Each refusal prints one line saying why and leaves `data/` alone, so nothing is
committed and the site keeps serving the last committed `data/`. The first two have their own handling;
the rest fail the run (exit 1):

- **Stale:** `generated_at` older than 26 hours (`--max-age-hours` to change it). Exit 3, so the workflow can tell it
  apart. The alert is a single issue titled **"Data API stale"**, opened on the first stale run and updated on each
  one after (body: `generated_at`, its age, the API URL, what to check: the engine's container logs and
  `fightcard-service health --staleness`). Hourly runs then succeed with the committed `data/` (a warning in the
  log, no failure email); the daily 06:00 UTC run and manual runs still fail, so at most one failure email a day.
  The first fresh fetch closes the issue with a comment. If the engine is down for long, roll back to `pipeline`.
  Hourly stale runs staying green is deliberate (accepted in the PR #7 review): the alert is the issue plus the
  daily run's failure, not an hourly failure email.
- **Older than `data/`:** a snapshot whose `generated_at` is older than the committed `data/index.json`'s is skipped
  (exit 0, "not going backwards"); an equal one is a no-op. Either way there is no data commit, so nothing is built
  on a scheduled run. This can happen right after switching from `pipeline`, while the engine is a few minutes
  behind; the next run catches up. If `data/index.json` has no readable `generated_at`, or one more than 10 minutes
  in the future, nothing blocks the swap.
- **From the future:** `generated_at` more than 10 minutes ahead of the runner's clock. Taking it would make every
  later real snapshot look older than `data/` and freeze the site.
- **Another contract:** `index.json`'s `contract_version` isn't `1` or `1.x`.
- **Broken content:** a JSON file that doesn't parse, `fighters.json` that isn't an object, an event in
  `index.json`'s `upcoming` or `recent` without its `events/<id>.json`, an event file whose `id` isn't its file
  name, or a fight whose `red` or `blue` isn't in `fighters.json`.
- **Unsafe archive:** absolute paths, `..`, links, devices or anything but regular files and directories, a
  `/v1/` layout name of the wrong shape (`index.json` as a directory, `events/a/b.json`, …), duplicate entries, over 100 MB downloaded, 200 MB of member contents, or 250 MB decompressed (headers included, so an
  oversized PAX header can't get round the caps).
- Not a refusal: a safe file outside the `/v1/` layout (`index.json`, `fighters.json`, `schema.json`,
  `rankings.json`, `events/*`, `images/*`) is skipped and named on stderr ("skipped files outside the /v1/ layout").
  `/v1/` may add files (consumers ignore those they don't know), so a new engine file doesn't need a site release
  first; it lands in `data/` once `fetch_v1.py` lists it. Skipped files still count towards the size caps.
- **Unreachable or broken:** a download error, or a file that isn't a `.tar.gz` with `index.json` and `fighters.json`.
  The base URL must be `https://` (plain `http://` only to `127.0.0.1` or `localhost`, for tests), and a redirect to
  another scheme, host or port is refused.

After `fetch_v1.py`, the job runs `npm run validate-data` in `site/` on the new `data/`: the site's own loader and
zod schema (`site/src/lib/data.ts`, `schema.ts`), the same checks a build runs, then the site's schema against the
snapshot's `schema.json` (`site/src/lib/contract.ts`; docs/CONTRACT.md, "Checking the contract"). If either fails,
the job fails before the commit step, so nothing reaches `main`. Run it locally with `cd site && npm run validate-data -- ../data`.

The swap extracts into a temp dir beside `data/` and renames it into place; if the second rename fails, the old
`data/` is put back.

## How the refresh works (pipeline mode)

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
   commit SHA, and `deploy-app ufc prod <sha>` on the box rolls back to any of them.

Data commits don't trigger `release.yml` either, so they don't rebuild staging. Staging keeps running the last code
push.

**Trade-off to know about:** a refresh deploys main's HEAD to prod. A code change merged to main reaches staging
immediately, and then reaches prod at the next refresh that changes data, usually within a day, without a tag. So
treat a merge to main as "will ship". Check staging after merging, and keep unfinished work on branches. If that
becomes a problem, a later option is for refresh to build prod from the latest `v*` tag's code plus the new `data/`,
the way a tag deploy already does (below).

## Tag deploys and data

A `v*` tag deploys **the tag's code with main's latest `data/`**, never the image main built for the tagged commit.

**Why.** Data reaches main from `refresh.yml`, pushed with `GITHUB_TOKEN`, so it never triggers a build of its own:
the image built for a code commit keeps that commit's `data/` forever. On 2026-10-27 refresh deployed `data/` with
`rankings.json` at 19:06:14, and 22 s later tag `v0.4.0`, on a commit built at 18:53, deployed its prebuilt image:
`/rankings/` went 404 and its nav link vanished until refresh was dispatched again.

**How.** `release.yml`'s `prod` job calls `prod.yml`, which runs `build.yml` with `ref: <tagged sha>` and
`data_ref: main` (it checks out the tag, fetches main, replaces `data/` wholesale with main's) and then infra's
`deploy-app.yml` with that image, tagged `<tagged sha>-data-<main sha>`. The code is still exactly what staging ran;
only `data/` differs, and data commits go to prod without staging anyway. So the old rule "prod never rebuilds"
becomes "prod never runs code staging hasn't run".

**The `prod-deploy` lock.** Rebuilding alone still leaves a race: the tag build reads main's `data/`, a refresh
commits and deploys newer `data/` while the tag image builds, then the tag deploys the older `data/` after it.
So release's `prod` job (around the whole of `prod.yml`) and refresh's `prod` job both hold the concurrency group
`prod-deploy` with `cancel-in-progress: false`. The tag reads main's `data/` inside the lock, so either it reads
`data/` from before a refresh commit and deploys before that refresh deploys, or it waits and reads the refresh's
`data/` too. Refresh runs are already serialized by their own `refresh` group, and only refresh writes `data/`.

Trade-offs:
- **Every tag rebuilds** (a few minutes), even when the tagged commit already has main's `data/`. Simpler than
  comparing trees, and the image tag says which data it carries.
- **Older code with newer data.** A tag on an older commit gets main's current `data/`. If main changed the data
  contract since, the site build in the image fails and nothing is deployed: prod keeps what it ran.
- **Pending deploys are replaced, not queued.** GitHub keeps one pending run per concurrency group. Two tags pushed
  while a deploy runs, or a tag and a refresh both waiting, can replace each other; whatever runs next still carries
  main's latest `data/`. A replaced tag deploy also skips its GitHub Release: re-run it.
- **A refresh still ships main's HEAD code** (above); this change doesn't alter that.

Tests and evidence: `docs/tdd/tag-deploy.tdd.md`.

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
- **Edge cache purge:** infra caches the HTML at Cloudflare's edge (`edge_cache: true` in its `sites.yml`), and
  every deploy passes `purge_cache: true`, so deploys fail without `CLOUDFLARE_PURGE_TOKEN`: a Cloudflare API
  token with only Zone › Cache Purge › Purge on xlobax.com.
  ```sh
  gh secret set CLOUDFLARE_PURGE_TOKEN --repo alexzfe/fight-card-website
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

This deploys the code staging already ran, with main's latest `data/`, and cuts a GitHub Release. Check
https://ufc.xlobax.com.

### 7. Start the data refresh

- Run it once by hand: `gh workflow run refresh.yml`. A manual run always builds and deploys prod.
- Before the `score` stage can do anything useful, the vendored model has to be in `model/` (see PLAN, milestone 4).
- Scheduled workflows only run from the default branch. The daily data commit keeps GitHub from disabling the
  schedule after 60 days of repo inactivity.
- If the hourly runs get noisy in the Actions list, that's expected: most of them exit after the 5-second gate job.

## Operating

- **Roll back prod:** re-run the prod deploy of an earlier tag (Actions → release → that tag's run → Re-run). That
  ships the earlier tag's code with main's **current** `data/`. To roll data back too, on the box:
  `sudo deploy-app ufc prod <old image tag>` (a SHA, or `<sha>-data-<sha>` from an earlier tag deploy); the next
  refresh deploy moves prod forward again.
- **Redeploy without new data:** `gh workflow run refresh.yml` (a manual run always rebuilds and deploys). In `v1`
  mode it fails like any other refusal when `/v1/` is stale.
- **Refresh failed:** nothing was committed or deployed, and the site keeps serving the previous data. Read the
  failing step's log. A ufcstats challenge failure or a 0-events parse fails the `scrape` step on purpose. In `v1`
  mode, the "Fetch /v1/ snapshot" step says why it refused (stale, future, contract, content, unsafe, unreachable),
  and "Validate data/ with the site schema" lists the schema violations: see above.
- **Which source is live:** `gh variable get DATA_SOURCE --repo alexzfe/fight-card-website` (unset means
  `pipeline`). Data commits from `/v1/` read "data: refresh from /v1/ …".
- **"Re-export finish model" issue:** follow the steps in its body. The next refresh rescores and closes it.
- **"Data API stale" issue** (`v1` mode): the engine hasn't published for over 26 hours. Check what its body lists on
  the engine host. The next fresh fetch closes it; until then hourly runs stay green and the daily run fails.
