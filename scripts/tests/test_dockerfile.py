"""The Dockerfile against a stub site: proves the build stage gets data/ and DATA_DIR, and that the
image answers the health path the way infra's compose healthcheck probes it (wget inside the container).

Slow (pulls node and nginx images): run with `pytest scripts/tests -m docker`."""

import json
import shutil
import subprocess
import time
import uuid

import pytest

from conftest import REPO

pytestmark = pytest.mark.docker

STUB_BUILD = """
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const index = readFileSync(`${process.env.DATA_DIR}/index.json`, "utf8");
mkdirSync("dist/events/x", { recursive: true });
writeFileSync("dist/index.html", `<p>${JSON.parse(index).generated_at}</p>`);
writeFileSync("dist/events/x/index.html", "<p>event</p>");
writeFileSync("dist/healthz", "ok\\n");
"""


def docker(*args: str, check: bool = True) -> subprocess.CompletedProcess:
    return subprocess.run(["docker", *args], capture_output=True, text=True, check=check)


@pytest.fixture(scope="module")
def image(tmp_path_factory) -> str:
    if shutil.which("docker") is None:
        pytest.skip("docker not installed")
    ctx = tmp_path_factory.mktemp("ctx")
    shutil.copy(REPO / "Dockerfile", ctx / "Dockerfile")
    shutil.copy(REPO / ".dockerignore", ctx / ".dockerignore")
    site = ctx / "site"
    site.mkdir()
    (site / "package.json").write_text(
        json.dumps({"name": "stub", "private": True, "type": "module", "scripts": {"build": "node build.mjs"}})
    )
    (site / "package-lock.json").write_text(
        json.dumps({"name": "stub", "lockfileVersion": 3, "requires": True, "packages": {"": {"name": "stub"}}})
    )
    (site / "build.mjs").write_text(STUB_BUILD)
    # Must be ignored, or a host node_modules would leak into the build.
    (site / "node_modules").mkdir()
    (site / "node_modules" / "poison").write_text("x")
    data = ctx / "data"
    data.mkdir()
    (data / "index.json").write_text(json.dumps({"generated_at": "STUB-DATA-OK"}))
    (ctx / "pipeline").mkdir()
    (ctx / "pipeline" / "big.bin").write_text("not needed in the image")

    tag = f"fightcard-dockerfile-test:{uuid.uuid4().hex[:8]}"
    result = docker("build", "-t", tag, str(ctx), check=False)
    assert result.returncode == 0, result.stderr[-3000:]
    yield tag
    docker("image", "rm", "-f", tag, check=False)


@pytest.fixture(scope="module")
def container(image: str):
    name = f"fightcard-test-{uuid.uuid4().hex[:8]}"
    docker("run", "-d", "--name", name, image)
    try:
        for _ in range(30):
            if docker("exec", name, "wget", "-qO", "/dev/null", "http://127.0.0.1:8080/healthz", check=False).returncode == 0:
                break
            time.sleep(0.5)
        yield name
    finally:
        docker("rm", "-f", name, check=False)


def fetch(container: str, path: str) -> subprocess.CompletedProcess:
    return docker("exec", container, "wget", "-qO-", f"http://127.0.0.1:8080{path}", check=False)


def test_health_path_answers_like_infra_probes_it(container):
    assert fetch(container, "/healthz").returncode == 0


def test_build_saw_data_dir(container):
    assert "STUB-DATA-OK" in fetch(container, "/").stdout


def test_directory_urls_serve_index(container):
    assert "event" in fetch(container, "/events/x/").stdout


def test_exposes_8080_and_runs_unprivileged(image):
    config = json.loads(docker("image", "inspect", image).stdout)[0]["Config"]
    assert "8080/tcp" in config["ExposedPorts"]
    assert config["User"] not in ("", "0", "root")


def test_dockerignore_keeps_host_artifacts_out(image):
    ls = docker("run", "--rm", "--entrypoint", "ls", image, "-R", "/usr/share/nginx/html").stdout
    assert "poison" not in ls

