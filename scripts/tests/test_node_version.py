"""One Node version for CI, the Docker build, and local dev: site/.nvmrc.

Regression: release.yml pinned `node-version: 22`, setup-node resolved 22.23.3, and astro (engines
>=22.23.4) refused to build, so the first push-triggered release failed in `test`."""

import json
import re

from ops_helpers import REPO

NVMRC = REPO / "site" / ".nvmrc"


def nvmrc_major() -> int:
    return int(NVMRC.read_text().strip().lstrip("v").split(".")[0])


def astro_min_version() -> tuple[int, ...]:
    lock = json.loads((REPO / "site" / "package-lock.json").read_text())
    spec = lock["packages"]["node_modules/astro"]["engines"]["node"]
    return tuple(int(p) for p in re.match(r">=\s*([\d.]+)$", spec).group(1).split("."))


def test_nvmrc_major_is_above_astros_minimum_major():
    # A bare major (e.g. "24") resolves to that line's newest release, so it must be a newer major than the
    # minimum's, or else the runner can resolve an older patch on the same line (as 22 -> 22.23.3 did).
    assert nvmrc_major() > astro_min_version()[0]


def test_release_workflow_reads_node_version_from_nvmrc():
    text = (REPO / ".github" / "workflows" / "release.yml").read_text()
    assert "node-version-file: site/.nvmrc" in text
    assert not re.search(r"^\s*node-version:", text, re.M)


def test_dockerfile_build_stage_uses_nvmrc_major():
    text = (REPO / "Dockerfile").read_text()
    assert re.search(rf"^FROM node:{nvmrc_major()}-alpine AS build$", text, re.M)
