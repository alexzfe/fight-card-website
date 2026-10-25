"""CI runs the pipeline and scripts suites in one pytest call; both have a conftest.py, so test modules must not
import helpers `from conftest` (which one wins depends on sys.path order)."""

import subprocess
import sys

from ops_helpers import REPO


def test_pipeline_and_scripts_suites_collect_together():
    result = subprocess.run(
        [sys.executable, "-m", "pytest", "--collect-only", "-q", "pipeline/tests", "scripts/tests"],
        cwd=REPO,
        capture_output=True,
        text=True,
    )
    assert result.returncode == 0, result.stdout[-3000:] + result.stderr[-2000:]
