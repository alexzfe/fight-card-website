"""The Dockerfile against a stub site: proves the build stage gets data/ and DATA_DIR, and that the
image answers the health path the way infra's compose healthcheck probes it (wget inside the container).

Slow (pulls node and nginx images): run with `pytest scripts/tests -m docker`."""

import http.client
import json
import shutil
import subprocess
import time
import urllib.error
import urllib.request
import uuid

import pytest

from ops_helpers import REPO

pytestmark = pytest.mark.docker

STUB_BUILD = """
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
const index = readFileSync(`${process.env.DATA_DIR}/index.json`, "utf8");
mkdirSync("dist/events/x", { recursive: true });
writeFileSync("dist/index.html", `<p>${JSON.parse(index).generated_at}</p>`);
writeFileSync("dist/events/x/index.html", "<p>event</p>");
writeFileSync("dist/healthz", "ok\\n");
writeFileSync("dist/404.html", "<p>stub not found</p>");
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
    docker("run", "-d", "--name", name, "-p", "127.0.0.1::8080", image)
    try:
        for _ in range(30):
            if docker("exec", name, "wget", "-qO", "/dev/null", "http://127.0.0.1:8080/healthz", check=False).returncode == 0:
                break
            time.sleep(0.5)
        yield name
    finally:
        docker("rm", "-f", name, check=False)


def get(container: str, path: str) -> tuple[int, str]:
    host_port = docker("port", container, "8080/tcp").stdout.split()[0]
    try:
        with urllib.request.urlopen(f"http://{host_port}{path}", timeout=5) as resp:
            return resp.status, resp.read().decode()
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()


def test_health_path_answers_like_infra_probes_it(container):
    # Same probe as infra's compose healthcheck: wget inside the container.
    probe = docker("exec", container, "wget", "-qO", "/dev/null", "http://127.0.0.1:8080/healthz", check=False)
    assert probe.returncode == 0


def test_build_saw_data_dir(container):
    assert get(container, "/") == (200, "<p>STUB-DATA-OK</p>")


def test_directory_urls_serve_index(container):
    assert get(container, "/events/x/") == (200, "<p>event</p>")


def test_slashless_directory_redirect_stays_relative(container):
    # Behind Cloudflare the container sees plain http on :8080; an absolute redirect leaks that origin
    # (http://host:8080/events/x/), which visitors and crawlers can't reach. A relative Location keeps them on https.
    host_port = docker("port", container, "8080/tcp").stdout.split()[0]
    conn = http.client.HTTPConnection(host_port, timeout=5)
    conn.request("GET", "/events/x", headers={"Host": "ufc.example"})
    resp = conn.getresponse()
    assert resp.status == 301
    assert resp.getheader("Location") == "/events/x/"


def test_html_tells_browsers_to_revalidate(container):
    # Cloudflare holds the HTML at the edge (infra edge_cache) and passes this header on, so browsers check back
    # with the edge each visit instead of guessing a freshness from Last-Modified.
    host_port = docker("port", container, "8080/tcp").stdout.split()[0]
    for path in ("/", "/events/x/"):
        with urllib.request.urlopen(f"http://{host_port}{path}", timeout=5) as resp:
            assert resp.headers.get("Cache-Control") == "no-cache", path


def test_unknown_path_serves_site_404_page(container):
    assert get(container, "/no-such-page/") == (404, "<p>stub not found</p>")


def test_exposes_8080_and_runs_unprivileged(image):
    config = json.loads(docker("image", "inspect", image).stdout)[0]["Config"]
    assert "8080/tcp" in config["ExposedPorts"]
    assert config["User"] not in ("", "0", "root")


def test_dockerignore_keeps_host_artifacts_out(image):
    ls = docker("run", "--rm", "--entrypoint", "ls", image, "-R", "/usr/share/nginx/html").stdout
    assert "poison" not in ls

