"""Structural checks on the workflow files. No YAML parser is available in the pipeline env, so these
read the text; actionlint covers the syntax and expression types."""

import os
import re
import shutil
import subprocess

import pytest

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


def test_release_tests_pushes_to_the_model_export_branch():
    """fight-auto-research pushes model-export with a deploy key; its tests gate the merge (build stays main-only)."""
    text = read("release.yml")
    assert re.search(r"branches: \[main, model-export\]", text)
    assert "if: github.ref == 'refs/heads/main'" in text


def test_model_export_merges_only_tested_unchanged_threshold_exports():
    text = read("model-export.yml")
    assert "workflow_run:" in text and "workflows: [release]" in text and "branches: [model-export]" in text
    assert "github.event.workflow_run.conclusion == 'success'" in text
    assert "--match-head-commit" in text  # never merges a newer push than the one that was tested
    assert "model/thresholds.json" in text  # moved thresholds wait for review
    assert "gh workflow run refresh.yml" in text  # re-score and deploy with the new model right away


FAKE_GH = """#!/usr/bin/env bash
# Stands in for gh: logs each call, answers the reads model-export.yml makes.
args="$*"
echo "${args//$'\\n'/ }" >> "$GH_LOG"  # one line per call, even with a multi-line --body
case "$*" in
  *contents/model/manifest.json*) echo '{"as_of": "2026-11-02"}' | base64 ;;
  *compare/*) printf '%s\\n' $CHANGED ;;
  "pr list"*) echo 0 ;;
esac
"""


def land_script() -> str:
    """The `run: |` block of model-export.yml's land step, dedented."""
    lines = read("model-export.yml").splitlines()
    start = next(i for i, line in enumerate(lines) if line.strip() == "run: |") + 1
    indent = len(lines[start]) - len(lines[start].lstrip())
    body = []
    for line in lines[start:]:
        if line.strip() and len(line) - len(line.lstrip()) < indent:
            break
        body.append(line[indent:])
    return "\n".join(body) + "\n"


def run_land(tmp_path, changed: list[str], passed: bool = True) -> list[str]:
    """Run the land step as Actions does (bash -eo pipefail) with a fake gh; returns the gh calls."""
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    gh = bin_dir / "gh"
    gh.write_text(FAKE_GH)
    gh.chmod(0o755)
    script = tmp_path / "land.sh"
    script.write_text(land_script())
    log = tmp_path / "gh.log"
    log.touch()
    env = os.environ | {
        "PATH": f"{bin_dir}:{os.environ['PATH']}", "GH_LOG": str(log), "CHANGED": " ".join(changed),
        "GH_REPO": "alexzfe/fight-card-website", "SHA": "abc1234def", "PASSED": "true" if passed else "false",
        "RUN_URL": "https://example.invalid/run",
    }
    subprocess.run(["bash", "--noprofile", "--norc", "-eo", "pipefail", str(script)], env=env, check=True,
                   capture_output=True, text=True)
    return log.read_text().splitlines()


def merged(calls: list[str]) -> bool:
    return any(c.startswith("pr merge") for c in calls)


def test_model_export_lands_a_model_only_export(tmp_path):
    calls = run_land(tmp_path, ["model/model.txt", "model/manifest.json", "model/fighter_snapshot.parquet"])
    assert merged(calls)
    assert "workflow run refresh.yml --ref main" in calls


@pytest.mark.parametrize("outside", [
    "pipeline/src/fightcard/score/stage.py",
    "site/src/pages/index.astro",
    "pipeline/tests/score/test_elo.py",
    "data/index.json",
    "modelx/notes.txt",  # model/ is the prefix, not model*
])
def test_model_export_leaves_anything_outside_model_for_review(tmp_path, outside):
    """The branch's pusher also controls the tests release.yml runs on it, so passing tests can't vouch for code:
    only a change confined to model/ lands by itself."""
    calls = run_land(tmp_path, ["model/model.txt", outside])
    assert not merged(calls)
    assert not any("refresh.yml" in c for c in calls)
    body = next(c for c in calls if c.startswith(("pr create", "pr edit")))
    assert outside in body  # the PR says what needs a look


def test_model_export_leaves_moved_thresholds_for_review(tmp_path):
    calls = run_land(tmp_path, ["model/model.txt", "model/thresholds.json"])
    assert not merged(calls)


def test_model_export_does_not_merge_failed_tests(tmp_path):
    calls = run_land(tmp_path, ["model/model.txt"], passed=False)
    assert not merged(calls)
    assert any(c.startswith("pr comment") for c in calls)


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
    m = re.search(r"^    if: (.+)$", body, re.M)
    return m.group(1) if m else ""


def test_refresh_pipeline_jobs_run_unless_data_source_is_v1():
    """Unset DATA_SOURCE means pipeline, so the variable only has to exist to switch to v1."""
    refresh = jobs("refresh.yml")
    assert "vars.DATA_SOURCE != 'v1'" in job_if(refresh["gate"])
    assert "needs: gate" in refresh["pipeline"]  # skipped with the gate


def test_refresh_v1_job_runs_only_when_data_source_is_v1():
    v1 = jobs("refresh.yml")["v1"]
    assert job_if(v1) == "vars.DATA_SOURCE == 'v1'"
    assert "needs:" not in v1  # no gate: the fetch is cheap and a stale API must alert every run


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
            assert "stale_issue" not in body and "gh issue" not in body, job


def test_refresh_v1_job_permissions_are_minimal():
    v1 = jobs("refresh.yml")["v1"]
    perms = re.search(r"^    permissions:\n((?:      .+\n)+)", v1, re.M).group(1)
    assert perms.split() == ["contents:", "write"]


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
