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
    assert "url: https://ufc.xlobax.com" in text
    assert DEPLOY_APP in text
    assert 'tags: ["v*"]' in text


def test_every_deploy_purges_the_edge_cache():
    # infra caches ufc's HTML at Cloudflare's edge (sites.yml edge_cache), so each deploy must purge it.
    for name in ("release.yml", "refresh.yml"):
        jobs = read(name).split(f"uses: {DEPLOY_APP}")[1:]
        assert jobs, name
        for job in jobs:
            body = job.split("\n\n", 1)[0]  # this job only
            assert "purge_cache: true" in body, name


def test_both_flows_build_through_the_shared_build_workflow():
    assert "./.github/workflows/build.yml" in read("release.yml")
    assert "./.github/workflows/build.yml" in read("refresh.yml")
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


def test_refresh_interpolates_no_expressions_into_run_scripts():
    """Values reach shell through env:, never ${{ }} inside run: (script injection)."""
    lines = read("refresh.yml").splitlines()
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
            in_run = True
            assert "${{" not in stripped, line


# --- v1: stale /v1/ alerts through one issue; only the daily and manual runs fail -------------------------------


def step(job: str, name: str) -> str:
    """The text of the step `- name: <name>` in refresh.yml's job, up to the next step."""
    body = jobs("refresh.yml")[job]
    start = body.index(f"      - name: {name}\n")
    end = body.find("\n      - ", start + 1)
    return body[start:] if end < 0 else body[start:end + 1]


def step_script(job: str, name: str) -> str:
    """The `run: |` block of that step, dedented."""
    lines = step(job, name).splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == "run: |") + 1
    indent = len(lines[start]) - len(lines[start].lstrip())
    body = []
    for line in lines[start:]:
        if line.strip() and len(line) - len(line.lstrip()) < indent:
            break
        body.append(line[indent:])
    return "\n".join(body) + "\n"


def run_step(tmp_path, script: str, fakes: dict[str, str], env: dict[str, str]) -> subprocess.CompletedProcess:
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
                          capture_output=True, text=True)


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


FAKE_GH_ISSUES = """#!/usr/bin/env bash
args="$*"
echo "${args//$'\\n'/ }" >> "$GH_LOG"
case "$1 $2" in
  "issue list") [ -n "$OPEN_ISSUE" ] && echo "$OPEN_ISSUE" ;;
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
