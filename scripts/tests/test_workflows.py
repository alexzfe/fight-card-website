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


def test_refresh_asks_the_research_repo_to_re_export_when_stale():
    """A new stale episode, then at most once a day: hourly event-day runs mustn't queue an export each hour."""
    text = read("refresh.yml")
    assert "repos/alexzfe/fight-auto-research/dispatches" in text
    assert "event_type=site-stale" in text
    assert "secrets.RESEARCH_DISPATCH_TOKEN" in text
    assert f'"$SCHEDULE" = "{DAILY_CRON}"' in text


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
