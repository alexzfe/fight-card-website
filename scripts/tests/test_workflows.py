"""Structural checks on the workflow files. No YAML parser is available in the pipeline env, so these
read the text; actionlint covers the syntax and expression types."""

import os
import re
import shutil
import subprocess

import pytest

import fetch_v1
from ops_helpers import REPO
from should_run import DAILY_CRON
from stale_issue import TITLE

WORKFLOWS = REPO / ".github" / "workflows"
IMAGE = "ghcr.io/alexzfe/fight-card-website"
DEPLOY_APP = "alexzfe/infra/.github/workflows/deploy-app.yml@main"


def read(name: str) -> str:
    return (WORKFLOWS / name).read_text()


def crons(text: str) -> list[str]:
    return re.findall(r"cron:\s*['\"]([^'\"]+)['\"]", text)


def test_refresh_has_daily_cron_matching_should_run():
    assert DAILY_CRON in crons(read("refresh.yml"))


def test_refresh_hourly_cron_avoids_the_daily_slot():
    hourly = [c for c in crons(read("refresh.yml")) if c != DAILY_CRON]
    assert len(hourly) == 1
    minute, hour, *rest = hourly[0].split()
    assert hour == "*" and rest == ["*", "*", "*"]
    assert minute != "0"


def test_refresh_gates_on_should_run():
    text = read("refresh.yml")
    assert "scripts/should_run.py" in text
    assert "github.event.schedule" in text
    assert "github.event_name" in text


def test_refresh_runs_stages_in_order():
    text = read("refresh.yml")
    positions = [text.index(f"fightcard --data data {stage}") for stage in ("scrape", "images", "score")]
    assert positions == sorted(positions)


def test_refresh_caches_the_ufcstats_cookie():
    text = read("refresh.yml")
    assert "actions/cache" in text
    assert ".cache/ufcstats" in text


def test_refresh_maintains_the_stale_model_issue():
    text = read("refresh.yml")
    assert "scripts/stale_issue.py" in text
    assert "gh issue" in text
    assert f"TITLE: {TITLE}\n" in text


def test_release_runs_only_for_main_pull_requests_and_tags():
    """The model-export branch is gone: the finish model is published by research CI and read from /v1/."""
    text = read("release.yml")
    assert re.search(r"^    branches: \[main\]$", text, re.M)
    assert "model-export" not in text
    assert "if: github.ref == 'refs/heads/main'" in text


def test_model_export_workflow_is_gone():
    assert not (WORKFLOWS / "model-export.yml").exists()
    for workflow in WORKFLOWS.glob("*.yml"):
        assert "model-export" not in workflow.read_text(), workflow.name


def test_refresh_no_longer_dispatches_to_the_research_repo():
    """The research workflow reads data/stale_fighters.json from this public repo instead: no token needed."""
    assert "dispatches" not in read("refresh.yml")


def test_refresh_deploys_prod_through_the_reusable_workflow():
    text = read("refresh.yml")
    assert DEPLOY_APP in text
    assert "env: prod" in text
    assert "url: https://ufc.xlobax.com" in text
    # A tag pushed with GITHUB_TOKEN would not trigger release.yml, so refresh must not rely on one.
    assert "git push --tags" not in text and "git tag" not in text


def test_refresh_does_not_overlap_itself():
    assert re.search(r"^concurrency:", read("refresh.yml"), re.M)


def test_release_targets_ufc_hosts():
    text = read("release.yml")
    assert "app: ufc" in text
    assert "url: https://ufc-staging.xlobax.com" in text
    assert DEPLOY_APP in text
    assert 'tags: ["v*"]' in text
    # The tag's prod deploy goes through prod.yml (tag's code + main's latest data/).
    prod = read("prod.yml")
    assert "app: ufc" in prod
    assert "url: https://ufc.xlobax.com" in prod
    assert DEPLOY_APP in prod


def test_every_deploy_purges_the_edge_cache():
    # infra caches ufc's HTML at Cloudflare's edge (sites.yml edge_cache), so each deploy must purge it.
    for name in ("release.yml", "refresh.yml", "prod.yml"):
        jobs = read(name).split(f"uses: {DEPLOY_APP}")[1:]
        assert jobs, name
        for job in jobs:
            body = job.split("\n\n", 1)[0]  # this job only
            assert "purge_cache: true" in body, name


def test_both_flows_build_through_the_shared_build_workflow():
    assert "./.github/workflows/build.yml" in read("release.yml")
    assert "./.github/workflows/build.yml" in read("refresh.yml")
    assert "./.github/workflows/build.yml" in read("prod.yml")
    assert IMAGE in read("build.yml")
    assert "workflow_call" in read("build.yml")


def test_third_party_actions_are_pinned_to_commit_shas():
    for path in WORKFLOWS.glob("*.yml"):
        for ref in re.findall(r"uses:\s*(\S+)", path.read_text()):
            if ref.startswith("./") or ref == DEPLOY_APP:
                continue
            assert re.fullmatch(r"[\w.-]+/[\w./-]+@[0-9a-f]{40}", ref), f"{path.name}: {ref}"


def actionlint() -> str | None:
    exe = os.environ.get("ACTIONLINT") or shutil.which("actionlint")
    if exe and subprocess.run([exe, "--version"], capture_output=True).returncode == 0:
        return exe
    return None


@pytest.mark.skipif(actionlint() is None, reason="actionlint not available (set ACTIONLINT=/path)")
def test_actionlint_passes():
    files = sorted(str(p) for p in WORKFLOWS.glob("*.yml"))
    result = subprocess.run([actionlint(), *files], capture_output=True, text=True)
    assert result.returncode == 0, result.stdout + result.stderr


def test_release_runs_site_e2e_with_cached_chromium():
    text = read("release.yml")
    assert "npm run test:e2e" in text
    assert "playwright install --with-deps chromium" in text
    # On a cache hit the browser is restored, but the OS packages still have to be installed.
    assert "playwright install-deps chromium" in text
    assert "~/.cache/ms-playwright" in text
    assert text.index("npm ci") < text.index("npm run test:e2e")


# --- DATA_SOURCE: pipeline (default) | v1 ---------------------------------------------------------------------


def jobs(name: str) -> dict[str, str]:
    """Top-level jobs of a workflow: {job id: its text, header line included}."""
    text = read(name).split("\njobs:\n", 1)[1]
    parts = re.split(r"^  ([\w-]+):\n", text, flags=re.M)
    return {parts[i]: f"  {parts[i]}:\n{parts[i + 1]}" for i in range(1, len(parts), 2)}


def job_if(body: str) -> str:
    """The job's `if:`, a folded `>-` block joined into one line."""
    m = re.search(r"^    if: (.+)$((?:\n      .*)*)", body, re.M)
    if not m:
        return ""
    if m.group(1) != ">-":
        return m.group(1)
    return " ".join(line.strip() for line in m.group(2).splitlines() if line.strip())


def test_refresh_pipeline_jobs_run_unless_data_source_is_v1():
    """Unset DATA_SOURCE means pipeline, so the variable only has to exist to switch to v1."""
    refresh = jobs("refresh.yml")
    assert "vars.DATA_SOURCE != 'v1'" in job_if(refresh["gate"])
    assert "needs: gate" in refresh["pipeline"]  # skipped with the gate


def test_refresh_v1_job_runs_only_when_data_source_is_v1():
    v1 = jobs("refresh.yml")["v1"]
    assert job_if(v1) == "vars.DATA_SOURCE == 'v1'"
    assert "needs:" not in v1  # no gate: the fetch is cheap, and every run checks /v1/ for staleness


def test_refresh_v1_fetches_commits_and_skips_the_pipeline():
    v1 = jobs("refresh.yml")["v1"]
    assert "python3 scripts/fetch_v1.py" in v1
    assert "https://ufc-data.xlobax.com" in v1
    assert "git add data" in v1 and "git push origin HEAD:main" in v1
    assert v1.index("scripts/fetch_v1.py") < v1.index("git add data")
    for absent in ("fightcard --data data", "actions/cache", ".cache/ufcstats", "should_run", "setup-uv"):
        assert absent not in v1, absent


def test_refresh_stale_model_issue_is_pipeline_only():
    refresh = jobs("refresh.yml")
    assert "scripts/stale_issue.py" in refresh["pipeline"]
    for job, body in refresh.items():
        if job != "pipeline":
            assert "stale_issue" not in body and f"TITLE: {TITLE}" not in body, job
        if job not in ("pipeline", "v1"):
            assert "gh issue" not in body, job


def test_refresh_v1_job_permissions_are_minimal():
    v1 = jobs("refresh.yml")["v1"]
    perms = re.search(r"^    permissions:\n((?:      .+\n)+)", v1, re.M).group(1)
    assert perms.split() == ["contents:", "write", "issues:", "write"]  # issues: the "Data API stale" issue


def test_refresh_shadow_job_reports_v1_without_blocking():
    refresh = jobs("refresh.yml")
    shadow = refresh["shadow"]
    assert "needs: pipeline" in shadow
    assert "needs.pipeline.result == 'success'" in job_if(shadow)
    assert "continue-on-error: true" in shadow
    assert "python3 scripts/v1_shadow.py" in shadow and "$GITHUB_STEP_SUMMARY" in shadow
    perms = re.search(r"^    permissions:\n((?:      .+\n)+)", shadow, re.M).group(1)
    assert perms.split() == ["contents:", "read"]
    for job in ("build", "prod"):
        assert "shadow" not in refresh[job], f"{job} must not wait for the shadow job"


def test_refresh_build_and_deploy_follow_either_source():
    refresh = jobs("refresh.yml")
    build, prod = refresh["build"], refresh["prod"]
    for body in (build, prod):
        assert "needs.pipeline.outputs.sha || needs.v1.outputs.sha" in body
    cond = job_if(build)
    assert cond.startswith("always() && ")  # one of pipeline/v1 is always skipped
    assert "needs.pipeline.result == 'success'" in cond and "needs.v1.result == 'success'" in cond
    assert "needs.v1.outputs.changed == 'true'" in cond
    assert "needs.build.result == 'success'" in job_if(prod)


def test_refresh_v1_outputs_changed_and_sha():
    v1 = jobs("refresh.yml")["v1"]
    assert "changed: ${{ steps.commit.outputs.changed }}" in v1
    assert "sha: ${{ steps.commit.outputs.sha }}" in v1


@pytest.mark.parametrize("name", sorted(p.name for p in WORKFLOWS.glob("*.yml")))
def test_workflows_interpolate_no_expressions_into_run_scripts(name):
    """Values reach shell through env:, never ${{ }} inside run: (script injection)."""
    lines = read(name).splitlines()
    in_run, indent = False, 0
    for line in lines:
        stripped = line.strip()
        if in_run:
            if stripped and len(line) - len(line.lstrip()) <= indent:
                in_run = False
            else:
                assert "${{" not in line, line
                continue
        indent = len(line) - len(line.lstrip())
        # A step's run: ("- run:", or "run:" under a "- name:"); a job output named `run` sits at 6 spaces.
        if stripped.startswith("- run:") or (stripped.startswith("run:") and indent >= 8):
            # Only a block scalar (`run: |`) goes on past this line; a one-line run may be followed by its env:.
            in_run = stripped.endswith(("|", ">"))
            assert "${{" not in stripped, line


# --- v1: stale /v1/ alerts through one issue; only the daily and manual runs fail -------------------------------


def step(job: str, name: str, workflow: str = "refresh.yml") -> str:
    """The text of the step `- name: <name>` in the workflow's job, up to the next step."""
    body = jobs(workflow)[job]
    start = body.index(f"      - name: {name}\n")
    end = body.find("\n      - ", start + 1)
    return body[start:] if end < 0 else body[start:end + 1]


def step_script(job: str, name: str, workflow: str = "refresh.yml") -> str:
    """The `run: |` block of that step, dedented."""
    lines = step(job, name, workflow).splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == "run: |") + 1
    indent = len(lines[start]) - len(lines[start].lstrip())
    body = []
    for line in lines[start:]:
        if line.strip() and len(line) - len(line.lstrip()) < indent:
            break
        body.append(line[indent:])
    return "\n".join(body) + "\n"


def run_step(tmp_path, script: str, fakes: dict[str, str], env: dict[str, str],
             cwd=None) -> subprocess.CompletedProcess:
    """Run a step script as Actions does (bash -eo pipefail) with fake commands first on PATH."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir(exist_ok=True)
    for name, text in fakes.items():
        (bin_dir / name).write_text(text)
        (bin_dir / name).chmod(0o755)
    path = tmp_path / "step.sh"
    path.write_text(script)
    full_env = os.environ | {"PATH": f"{bin_dir}:{os.environ['PATH']}", "RUNNER_TEMP": str(tmp_path),
                             "GITHUB_REPOSITORY": "alexzfe/fight-card-website"} | env
    return subprocess.run(["bash", "--noprofile", "--norc", "-eo", "pipefail", str(path)], env=full_env,
                          capture_output=True, text=True, cwd=cwd)


FETCH = "Fetch /v1/ snapshot"
DATA_ISSUE = 'Open, update or close the "Data API stale" issue'
HOURLY = next(c for c in crons(read("refresh.yml")) if c != DAILY_CRON)
STALE = 3  # fetch_v1.EXIT_STALE (test_fetch_v1.py checks it)

FAKE_PYTHON = """#!/usr/bin/env bash
echo "$*" >> "$PY_LOG"
exit "$FAKE_STATUS"
"""


def run_fetch(tmp_path, status: int, event: str, schedule: str = "") -> subprocess.CompletedProcess:
    env = dict(env_block(step("v1", FETCH)))
    for key in ("EVENT_NAME", "SCHEDULE"):
        env.pop(key, None)
    return run_step(tmp_path, step_script("v1", FETCH), {"python3": FAKE_PYTHON},
                    env | {"FAKE_STATUS": str(status), "PY_LOG": str(tmp_path / "py.log"),
                           "EVENT_NAME": event, "SCHEDULE": schedule})


def env_block(text: str) -> dict[str, str]:
    """A step's `env:` entries with literal values ("${{ ... }}" values kept as text)."""
    m = re.search(r"^        env:\n((?:          .+\n)+)", text, re.M)
    pairs = (line.strip().split(": ", 1) for line in m.group(1).splitlines()) if m else ()
    return {k: v.strip('"') for k, v in pairs}


def test_refresh_v1_fetch_step_knows_the_schedule_through_env():
    env = env_block(step("v1", FETCH))
    assert env["EVENT_NAME"] == "${{ github.event_name }}"
    assert env["SCHEDULE"] == "${{ github.event.schedule }}"
    assert env["DAILY_CRON"] == DAILY_CRON
    assert "id: fetch" in step("v1", FETCH)
    assert "--stale-issue" in step_script("v1", FETCH)


@pytest.mark.parametrize(("status", "event", "schedule", "expected"), [
    (0, "schedule", HOURLY, 0),
    (0, "schedule", DAILY_CRON, 0),
    (STALE, "schedule", HOURLY, 0),  # quiet: the issue carries the alert
    (STALE, "schedule", DAILY_CRON, STALE),
    (STALE, "workflow_dispatch", "", STALE),
    (1, "schedule", HOURLY, 1),  # unsafe, unreachable, wrong contract: always fail
    (1, "schedule", DAILY_CRON, 1),
])
def test_refresh_v1_stale_fails_only_daily_and_manual_runs(tmp_path, status, event, schedule, expected):
    result = run_fetch(tmp_path, status, event, schedule)
    assert result.returncode == expected, result.stderr
    assert "scripts/fetch_v1.py" in (tmp_path / "py.log").read_text()


# `issue list` answers like a fuzzy title search: every issue in OPEN_ISSUES (JSON), plus OPEN_ISSUE (a number)
# titled exactly $TITLE, filtered through the step's own --jq. Each --body is also kept whole in $GH_LOG.body.
FAKE_GH_ISSUES = """#!/usr/bin/env bash
args="$*"
echo "${args//$'\\n'/ }" >> "$GH_LOG"
prev=
for arg; do
  [ "$prev" = --body ] && printf '%s\\0' "$arg" >> "$GH_LOG.body"
  prev=$arg
done
case "$1 $2" in
  "issue list")
    issues=${OPEN_ISSUES:-[]}
    [ -n "$OPEN_ISSUE" ] && issues=$(jq -c --arg t "$TITLE" --argjson n "$OPEN_ISSUE" '. + [{number: $n, title: $t}]' <<<"$issues")
    filter=.
    while [ $# -gt 0 ]; do [ "$1" = --jq ] && filter=$2; shift; done
    jq -r "$filter" <<<"$issues" ;;
esac
exit 0
"""


def run_issue(tmp_path, stale: str, open_issue: str = "") -> list[str]:
    log = tmp_path / "gh.log"
    log.touch()
    env = {k: v for k, v in env_block(step("v1", DATA_ISSUE)).items() if "${{" not in v}
    result = run_step(tmp_path, step_script("v1", DATA_ISSUE), {"gh": FAKE_GH_ISSUES},
                      env | {"GH_LOG": str(log), "OPEN_ISSUE": open_issue, "STALE": stale,
                             "GENERATED_AT": "2026-10-26T06:00:00Z", "GH_TOKEN": "x"})
    assert result.returncode == 0, result.stderr
    return log.read_text().splitlines()


def test_refresh_v1_issue_step_title_and_condition():
    text = step("v1", DATA_ISSUE)
    assert f"TITLE: {fetch_v1.STALE_TITLE}\n" in text
    cond = re.search(r"^        if: (.+)$", text, re.M).group(1)
    assert "!cancelled()" in cond and "steps.fetch.outputs.stale" in cond  # also after a failed daily run
    v1 = jobs("refresh.yml")["v1"]
    assert v1.index(FETCH) < v1.index(DATA_ISSUE)


def test_refresh_v1_opens_the_issue_when_stale(tmp_path):
    calls = run_issue(tmp_path, "true")
    created = [c for c in calls if c.startswith("issue create")]
    assert len(created) == 1 and "Data API stale" in created[0] and "--body-file" in created[0]


def test_refresh_v1_updates_an_open_issue_when_still_stale(tmp_path):
    calls = run_issue(tmp_path, "true", open_issue="7")
    assert any(c.startswith("issue edit 7") and "--body-file" in c for c in calls)
    assert not any(c.startswith("issue create") for c in calls)


def test_refresh_v1_closes_the_issue_when_fresh(tmp_path):
    calls = run_issue(tmp_path, "false", open_issue="7")
    closed = [c for c in calls if c.startswith("issue close 7")]
    assert len(closed) == 1 and "--comment" in closed[0] and "2026-10-26T06:00:00Z" in closed[0]


def test_refresh_v1_does_nothing_when_fresh_and_no_issue(tmp_path):
    calls = run_issue(tmp_path, "false")
    assert [c for c in calls if not c.startswith("issue list")] == []


# --- review fix 2: v1 validates data/ with the site's own schema before committing -----------------------------


def test_refresh_v1_validates_data_with_the_site_schema_before_committing():
    v1 = jobs("refresh.yml")["v1"]
    assert "node-version-file: site/.nvmrc" in v1
    assert "npm ci" in v1 and "npm run validate-data" in v1
    assert v1.index("scripts/fetch_v1.py") < v1.index("npm run validate-data") < v1.index("git add data")


def test_refresh_v1_validate_step_runs_in_site():
    v1 = jobs("refresh.yml")["v1"]
    validate = v1[v1.rindex("      - ", 0, v1.index("npm run validate-data")):]
    validate = validate[:validate.find("\n      - ", 1) + 1 or None]
    assert "working-directory: site" in validate


# --- tag deploys: the tag's code with main's latest data/, never an older data/ -------------------------------
#
# 2026-10-27: refresh deployed data/ with rankings.json; 22 s later tag v0.4.0 deployed the image built for its
# (older) commit, and /rankings/ went 404. A tag now rebuilds its code with main's data/, under a lock that every
# prod deploy holds, so no deploy can land older data/ after newer.

PROD_LOCK = "prod-deploy"
DATA_STEP = "Pick data/ and the image tag"


def job_concurrency(body: str) -> tuple[str, str] | None:
    """A job's (group, cancel-in-progress), or None."""
    m = re.search(r"^    concurrency:\n      group: (\S+)\n      cancel-in-progress: (\S+)$", body, re.M)
    return (m.group(1), m.group(2)) if m else None


def job_permissions(body: str) -> list[str]:
    m = re.search(r"^    permissions:(?: \{\})?\n((?:      .+\n)*)", body, re.M)
    assert m, body
    return m.group(1).split()


def test_release_tag_no_longer_deploys_the_prebuilt_image():
    prod = jobs("release.yml")["prod"]
    assert job_if(prod) == "github.ref_type == 'tag'"
    assert DEPLOY_APP not in prod  # deploy-app with `tag: github.sha` shipped that commit's data/
    assert "uses: ./.github/workflows/prod.yml" in prod
    assert "ref: ${{ github.sha }}" in prod
    assert "secrets: inherit" in prod
    assert "needs: prod" in jobs("release.yml")["release"]  # the GitHub Release still waits for the deploy


def test_release_prod_job_permissions_are_minimal():
    assert job_permissions(jobs("release.yml")["prod"]) == ["contents:", "read", "packages:", "write"]


def test_prod_workflow_builds_the_code_with_mains_data_then_deploys_that_image():
    text = read("prod.yml")
    assert "workflow_call" in text
    assert re.search(r"^permissions: \{\}$", text, re.M)
    prod = jobs("prod.yml")
    build, deploy = prod["build"], prod["deploy"]
    assert "uses: ./.github/workflows/build.yml" in build
    assert "ref: ${{ inputs.ref }}" in build
    assert "data_ref: main" in build
    assert job_permissions(build) == ["contents:", "read", "packages:", "write"]
    assert "needs: build" in deploy
    assert f"uses: {DEPLOY_APP}" in deploy
    assert "env: prod" in deploy
    assert "tag: ${{ needs.build.outputs.tag }}" in deploy
    assert "secrets: inherit" in deploy


def test_every_prod_deploy_holds_the_same_lock():
    """The tag path reads main's data/ inside the lock, and refresh deploys inside it, so a tag deploy that read
    older data/ always lands before a refresh deploy of newer data/, never after. cancel-in-progress would kill a
    deploy halfway."""
    assert job_concurrency(jobs("release.yml")["prod"]) == (PROD_LOCK, "false")
    assert job_concurrency(jobs("refresh.yml")["prod"]) == (PROD_LOCK, "false")
    for name in ("release.yml", "refresh.yml", "prod.yml"):
        for job, body in jobs(name).items():
            if "env: prod" in body:
                assert name == "prod.yml" or job_concurrency(body) == (PROD_LOCK, "false"), f"{name}: {job}"


# --- a tag deploy replaced while pending says so ---------------------------------------------------------------
# GitHub keeps one pending run per concurrency group: a newer prod deploy (tag or refresh) cancels a pending one.
# The tag's run then just shows "cancelled" and cuts no Release, so a job opens an issue naming the tag and fails.

NOT_DEPLOYED = 'Open or update the "Tag not deployed" issue'
CLOSE_NOT_DEPLOYED = 'Close the "Tag not deployed" issue'
TAG = "v0.6.0"
RUN_URL = "https://github.com/alexzfe/fight-card-website/actions/runs/42"


def run_tag_step(tmp_path, job: str, name: str, open_issue: str = "", open_issues: str = "[]",
                 tag: str = TAG) -> tuple[subprocess.CompletedProcess, list[str]]:
    log = tmp_path / "gh.log"
    log.touch()
    env = {k: v for k, v in env_block(step(job, name, "release.yml")).items() if "${{" not in v}
    result = run_step(tmp_path, step_script(job, name, "release.yml"), {"gh": FAKE_GH_ISSUES},
                      env | {"GH_LOG": str(log), "OPEN_ISSUE": open_issue, "OPEN_ISSUES": open_issues,
                             "GH_TOKEN": "x", "TITLE": f"Tag {tag} not deployed", "GITHUB_REF_NAME": tag,
                             "GITHUB_SERVER_URL": "https://github.com", "GITHUB_RUN_ID": "42"})
    return result, log.read_text().splitlines()


def issue_bodies(tmp_path) -> list[str]:
    path = tmp_path / "gh.log.body"
    return path.read_text().split("\0")[:-1] if path.exists() else []


# The search is fuzzy: "Tag v0.6 not deployed" also finds v0.6.0's issue. Only the exact title counts.
SIMILAR_ISSUE = '[{"number": 5, "title": "Tag v0.6.0 not deployed"}]'


def test_release_is_cut_only_for_a_tag_that_deployed():
    release = jobs("release.yml")["release"]
    assert "needs: prod" in release
    assert job_if(release) == ""  # the default success(): a cancelled or failed prod cuts no Release


def test_a_cancelled_tag_deploy_runs_the_not_deployed_job():
    job = jobs("release.yml")["not-deployed"]
    assert "needs: prod" in job
    cond = job_if(job)
    # always(): the replacement may leave the run cancelled, and a cancelled run skips plain jobs.
    assert "always()" in cond and "needs.prod.result == 'cancelled'" in cond
    assert job_permissions(job) == ["issues:", "write"]
    text = step("not-deployed", NOT_DEPLOYED, "release.yml")
    assert "TITLE: Tag ${{ github.ref_name }} not deployed\n" in text
    assert "GH_TOKEN: ${{ github.token }}" in text


def test_not_deployed_opens_an_issue_naming_the_tag_and_the_rerun_and_fails(tmp_path):
    result, calls = run_tag_step(tmp_path, "not-deployed", NOT_DEPLOYED)
    assert result.returncode != 0  # the run shows a failure, not only "cancelled"
    assert "::error::" in result.stdout and TAG in result.stdout and "Re-run all jobs" in result.stdout
    created = [c for c in calls if c.startswith("issue create")]
    assert len(created) == 1
    assert f"Tag {TAG} not deployed" in created[0]
    assert RUN_URL in created[0] and "Re-run all jobs" in created[0]
    assert "newer tag" in created[0]  # re-running an older tag after a newer one deployed would roll code back


def test_not_deployed_comments_on_the_open_issue_instead_of_opening_another(tmp_path):
    result, calls = run_tag_step(tmp_path, "not-deployed", NOT_DEPLOYED, open_issue="9")
    assert result.returncode != 0
    assert any(c.startswith("issue comment 9") and RUN_URL in c for c in calls)
    assert not any(c.startswith("issue create") for c in calls)


def test_not_deployed_says_only_what_is_true_for_every_cancel(tmp_path):
    # Cancelled while pending, by hand mid-deploy, or at timeout-minutes: all read `cancelled`, so prod's state is
    # unknown and the text must not claim the deploy never started.
    result, _ = run_tag_step(tmp_path, "not-deployed", NOT_DEPLOYED)
    (body,) = issue_bodies(tmp_path)
    error = next(line for line in result.stdout.splitlines() if line.startswith("::error::"))
    for text in (body, error):
        assert "before it started" not in text and "doesn't run" not in text and "pending prod deploy" not in text
        assert "was not deployed" not in text
    assert "may not run this tag's code" in body
    assert "by hand" in body and "timed out" in body
    assert "may not run this tag's code" in error


def test_not_deployed_body_breaks_lines_only_between_paragraphs(tmp_path):
    # GitHub renders every single newline in an issue or comment as a line break.
    run_tag_step(tmp_path, "not-deployed", NOT_DEPLOYED)
    run_tag_step(tmp_path, "not-deployed", NOT_DEPLOYED, open_issue="9")
    bodies = issue_bodies(tmp_path)
    assert len(bodies) == 2
    for body in bodies:
        assert re.search(r"[^\n]\n[^\n]", body.strip()) is None, body
        assert len(body.strip().split("\n\n")) == 2


def test_not_deployed_opens_a_new_issue_when_only_a_similar_title_is_open(tmp_path):
    result, calls = run_tag_step(tmp_path, "not-deployed", NOT_DEPLOYED, open_issues=SIMILAR_ISSUE, tag="v0.6")
    assert result.returncode != 0
    assert not any(c.startswith("issue comment") for c in calls)
    created = [c for c in calls if c.startswith("issue create")]
    assert len(created) == 1 and "Tag v0.6 not deployed" in created[0]


def test_release_leaves_a_similarly_titled_issue_open(tmp_path):
    result, calls = run_tag_step(tmp_path, "release", CLOSE_NOT_DEPLOYED, open_issues=SIMILAR_ISSUE, tag="v0.6")
    assert result.returncode == 0, result.stderr
    assert [c for c in calls if not c.startswith("issue list")] == []


CUT_RELEASE = "Cut the GitHub Release"

FAKE_GH_RELEASE = """#!/usr/bin/env bash
echo "$*" >> "$GH_LOG"
case "$1 $2" in
  "release view") [ "$RELEASE_EXISTS" = true ] || { echo "release not found" >&2; exit 1; } ;;
esac
exit 0
"""


def run_cut_release(tmp_path, exists: bool) -> tuple[subprocess.CompletedProcess, list[str]]:
    log = tmp_path / "gh.log"
    log.touch()
    env = {k: v for k, v in env_block(step("release", CUT_RELEASE, "release.yml")).items() if "${{" not in v}
    result = run_step(tmp_path, step_script("release", CUT_RELEASE, "release.yml"), {"gh": FAKE_GH_RELEASE},
                      env | {"GH_LOG": str(log), "RELEASE_EXISTS": str(exists).lower(), "GH_TOKEN": "x",
                             "GITHUB_REF_NAME": TAG})
    return result, log.read_text().splitlines()


def test_release_cuts_the_release_when_it_does_not_exist(tmp_path):
    result, calls = run_cut_release(tmp_path, exists=False)
    assert result.returncode == 0, result.stderr
    created = [c for c in calls if c.startswith("release create")]
    assert len(created) == 1 and TAG in created[0] and "--generate-notes" in created[0]


def test_release_rerun_skips_an_existing_release_and_reaches_the_close_step(tmp_path):
    # "Re-run failed jobs" after the close step failed: the Release is already there, so creating it again must
    # not fail the job before the issue is closed.
    result, calls = run_cut_release(tmp_path, exists=True)
    assert result.returncode == 0, result.stderr
    assert not any(c.startswith("release create") for c in calls)
    assert "GH_TOKEN: ${{ github.token }}" in step("release", CUT_RELEASE, "release.yml")


def test_release_closes_the_tags_not_deployed_issue_after_cutting_the_release():
    release = jobs("release.yml")["release"]
    assert job_permissions(release) == ["contents:", "write", "issues:", "write"]
    assert release.index("gh release create") < release.index(CLOSE_NOT_DEPLOYED)
    assert "TITLE: Tag ${{ github.ref_name }} not deployed\n" in step("release", CLOSE_NOT_DEPLOYED, "release.yml")


def test_release_closes_an_open_not_deployed_issue(tmp_path):
    result, calls = run_tag_step(tmp_path, "release", CLOSE_NOT_DEPLOYED, open_issue="9")
    assert result.returncode == 0, result.stderr
    closed = [c for c in calls if c.startswith("issue close 9")]
    assert len(closed) == 1 and RUN_URL in closed[0]


def test_release_leaves_issues_alone_when_none_is_open(tmp_path):
    result, calls = run_tag_step(tmp_path, "release", CLOSE_NOT_DEPLOYED)
    assert result.returncode == 0, result.stderr
    assert [c for c in calls if not c.startswith("issue list")] == []


def test_build_takes_an_optional_data_ref_and_outputs_the_image_tag():
    text = read("build.yml")
    data_ref = text[text.index("      data_ref:\n"):]
    data_ref = data_ref[:data_ref.index("\n    outputs:") if "\n    outputs:" in data_ref else None]
    assert "required: false" in data_ref and 'default: ""' in data_ref
    assert re.search(r"^    outputs:\n      tag:\n.*\n        value: \$\{\{ jobs\.build\.outputs\.tag \}\}$", text, re.M)
    build = jobs("build.yml")["build"]
    assert "tag: ${{ steps.data.outputs.tag }}" in build
    assert "tags: ${{ env.IMAGE }}:${{ steps.data.outputs.tag }}" in build
    assert build.index(DATA_STEP) < build.index("docker/build-push-action")
    env = env_block(step("build", DATA_STEP, "build.yml"))
    assert env == {"REF": "${{ inputs.ref }}", "DATA_REF": "${{ inputs.data_ref }}"}


def git(cwd, *args) -> str:
    env = os.environ | {"GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t",
                        "GIT_COMMITTER_EMAIL": "t@t"}
    return subprocess.run(["git", *args], cwd=cwd, env=env, check=True, capture_output=True,
                          text=True).stdout.strip()


@pytest.fixture
def tag_checkout(tmp_path):
    """origin/main has newer data/ than the tagged commit; the work tree is the tag, as actions/checkout leaves it."""
    origin = tmp_path / "origin"
    (origin / "data").mkdir(parents=True)
    git(origin, "init", "-q", "-b", "main")
    (origin / "data" / "index.json").write_text("old")
    (origin / "data" / "gone.json").write_text("gone")
    (origin / "site.txt").write_text("tag code")
    git(origin, "add", ".")
    git(origin, "commit", "-q", "-m", "tag")
    tag = git(origin, "rev-parse", "HEAD")
    (origin / "data" / "index.json").write_text("new")
    (origin / "data" / "gone.json").unlink()
    (origin / "data" / "rankings.json").write_text("ranks")
    (origin / "site.txt").write_text("unreleased code")
    git(origin, "add", "-A")
    git(origin, "commit", "-q", "-m", "data: refresh")
    work = tmp_path / "work"
    git(tmp_path, "clone", "-q", str(origin), str(work))
    git(work, "checkout", "-q", "--detach", tag)
    (work / "data" / "stray.json").write_text("untracked")
    return work, tag, git(origin, "rev-parse", "main")


def run_data_step(tmp_path, work, env):
    out = tmp_path / "github_output"
    out.touch()
    result = run_step(tmp_path, step_script("build", DATA_STEP, "build.yml"), {}, env | {"GITHUB_OUTPUT": str(out)},
                      cwd=work)
    assert result.returncode == 0, result.stderr
    return dict(line.split("=", 1) for line in out.read_text().splitlines())


def test_build_without_data_ref_keeps_the_commits_data_and_tags_the_sha(tmp_path, tag_checkout):
    work, tag, _ = tag_checkout
    outputs = run_data_step(tmp_path, work, {"REF": tag, "DATA_REF": ""})
    assert outputs == {"tag": tag}
    assert (work / "data" / "index.json").read_text() == "old"
    assert (work / "data" / "gone.json").exists()


def test_build_with_data_ref_swaps_in_mains_data_and_only_data(tmp_path, tag_checkout):
    work, tag, main = tag_checkout
    outputs = run_data_step(tmp_path, work, {"REF": tag, "DATA_REF": "main"})
    assert outputs == {"tag": f"{tag}-data-{main}"}
    assert sorted(p.name for p in (work / "data").iterdir()) == ["index.json", "rankings.json"]
    assert (work / "data" / "index.json").read_text() == "new"
    assert (work / "site.txt").read_text() == "tag code"  # the tag's code, not main's
    assert git(work, "rev-parse", "HEAD") == tag
    assert re.fullmatch(r"[A-Za-z0-9_.-]{1,128}", outputs["tag"])  # infra's deploy-app and Docker accept it


def test_build_refuses_a_data_ref_that_git_would_read_as_an_option(tmp_path, tag_checkout):
    work, tag, _ = tag_checkout
    out = tmp_path / "github_output"
    out.touch()
    result = run_step(tmp_path, step_script("build", DATA_STEP, "build.yml"), {},
                      {"REF": tag, "DATA_REF": f"--upload-pack=touch {tmp_path}/ran", "GITHUB_OUTPUT": str(out)},
                      cwd=work)
    assert result.returncode != 0
    assert "data_ref" in result.stderr
    assert not (tmp_path / "ran").exists()
    assert out.read_text() == ""
    assert (work / "data" / "index.json").read_text() == "old"


RANKINGS_CHECK = "Check /rankings/ is served"


@pytest.mark.parametrize(("workflow", "deploy_job"), [("prod.yml", "deploy"), ("refresh.yml", "prod")])
def test_every_prod_deploy_is_followed_by_a_rankings_check(workflow, deploy_job):
    """infra's deploy-app curls / only; /rankings/ is the page a deploy with older data/ lost (2026-10-27)."""
    smoke = jobs(workflow)["smoke"]
    assert f"needs: {deploy_job}" in smoke
    assert job_permissions(smoke) == []
    assert env_block(step("smoke", RANKINGS_CHECK, workflow)) == {"URL": "https://ufc.xlobax.com/rankings/"}
    script = step_script("smoke", RANKINGS_CHECK, workflow)
    assert script.strip() == ('curl --fail --silent --show-error --retry 5 --retry-all-errors --retry-delay 3 '
                              '-o /dev/null "$URL"')
