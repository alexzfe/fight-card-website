"""fetch_v1.py: download /v1/snapshot.tar.gz, refuse anything unsafe, stale or from another contract, then swap
data/ for it."""

import http.server
import json
import tarfile
import threading
from datetime import UTC, datetime

import pytest

import fetch_v1
from v1_helpers import V1_FIXTURE, dumps, files, member, snapshot, tree_files

NOW = datetime(2026, 10, 26, 12, 0, tzinfo=UTC)


@pytest.fixture
def data(tmp_path):
    """A committed data/ as the pipeline leaves it, with files the API doesn't carry."""
    d = tmp_path / "data"
    (d / "events").mkdir(parents=True)
    (d / "images").mkdir()
    (d / "index.json").write_bytes(dumps({"generated_at": "2026-10-25T06:00:00Z", "upcoming": [], "recent": []}))
    (d / "events" / "old.json").write_text("{}")
    (d / "images" / "misses.json").write_text("{}")
    (d / "stale_fighters.json").write_text("[]")
    (d / ".gitkeep").write_text("")
    return d


def run(data, blob, monkeypatch, *args):
    monkeypatch.setattr(fetch_v1, "download", lambda url, max_bytes: blob)
    return fetch_v1.main(["--base", "https://v1.invalid", "--data", str(data), "--now", NOW.isoformat(), *args])


# --- the happy path -------------------------------------------------------------------------------------------


def test_replaces_data_with_the_snapshot(data, monkeypatch):
    assert run(data, snapshot(files()), monkeypatch) == 0
    assert tree_files(data) == files()


def test_drops_files_the_api_does_not_carry(data, monkeypatch):
    """images/misses.json and stale_fighters.json are pipeline bookkeeping; the site reads neither."""
    run(data, snapshot(files()), monkeypatch)
    assert not (data / "images" / "misses.json").exists()
    assert not (data / "stale_fighters.json").exists()
    assert not (data / "events" / "old.json").exists()


def test_leaves_no_temp_dirs_beside_data(data, monkeypatch):
    run(data, snapshot(files()), monkeypatch)
    assert sorted(p.name for p in data.parent.iterdir()) == ["data"]


def test_creates_data_when_absent(tmp_path, monkeypatch):
    target = tmp_path / "fresh"
    assert run(target, snapshot(files()), monkeypatch) == 0
    assert tree_files(target) == files()


def test_accepts_the_real_publish_fixture(data, monkeypatch):
    """The committed fixture is `fightcard publish` output over the site's data/ (see v1-source.tdd.md)."""
    contents = tree_files(V1_FIXTURE)
    assert run(data, snapshot(contents), monkeypatch, "--max-age-hours", "100000") == 0
    assert tree_files(data) == contents


def test_downloads_the_snapshot_url(data, monkeypatch):
    seen = []
    monkeypatch.setattr(fetch_v1, "download", lambda url, max_bytes: seen.append(url) or snapshot(files()))
    fetch_v1.main(["--base", "https://ufc-data.example/", "--data", str(data), "--now", NOW.isoformat()])
    assert seen == ["https://ufc-data.example/v1/snapshot.tar.gz"]


def test_minor_contract_versions_are_accepted(data, monkeypatch):
    assert run(data, snapshot(files(contract_version="1.3")), monkeypatch) == 0


# --- refusals leave data/ alone -------------------------------------------------------------------------------


def unchanged(data) -> bool:
    return (data / "images" / "misses.json").exists() and (data / "events" / "old.json").exists()


def refused(data, blob, monkeypatch, capsys, *args) -> str:
    assert run(data, blob, monkeypatch, *args) == 1
    assert unchanged(data)
    assert sorted(p.name for p in data.parent.iterdir()) == ["data"]
    return capsys.readouterr().err


def test_stale_snapshot_fails_with_its_age(data, monkeypatch, capsys):
    err = refused(data, snapshot(files(generated_at="2026-10-25T09:00:00Z")), monkeypatch, capsys)
    assert "stale" in err and "27" in err and "2026-10-25T09:00:00Z" in err


def test_staleness_threshold_is_a_flag(data, monkeypatch):
    blob = snapshot(files(generated_at="2026-10-25T09:00:00Z"))
    assert run(data, blob, monkeypatch, "--max-age-hours", "28") == 0


def test_just_under_26_hours_is_fresh(data, monkeypatch):
    assert run(data, snapshot(files(generated_at="2026-10-25T10:01:00Z")), monkeypatch) == 0


@pytest.mark.parametrize("version", ["2", "2.0", "0.9", None, "", "v1", 1])
def test_other_contract_majors_are_refused(data, monkeypatch, capsys, version):
    contents = files()
    idx = json.loads(contents["index.json"])
    if version is None:
        del idx["contract_version"]
    else:
        idx["contract_version"] = version
    contents["index.json"] = dumps(idx)
    assert "contract_version" in refused(data, snapshot(contents), monkeypatch, capsys)


@pytest.mark.parametrize("generated_at", [None, "yesterday", "2026-10-26T06:00:00", 5])
def test_bad_generated_at_is_refused(data, monkeypatch, capsys, generated_at):
    contents = files()
    idx = json.loads(contents["index.json"])
    if generated_at is None:
        del idx["generated_at"]
    else:
        idx["generated_at"] = generated_at
    contents["index.json"] = dumps(idx)
    assert "generated_at" in refused(data, snapshot(contents), monkeypatch, capsys)


@pytest.mark.parametrize("missing", ["index.json", "fighters.json"])
def test_missing_required_files_are_refused(data, monkeypatch, capsys, missing):
    contents = files()
    del contents[missing]
    assert missing in refused(data, snapshot(contents), monkeypatch, capsys)


def test_unreadable_index_is_refused(data, monkeypatch, capsys):
    contents = files() | {"index.json": b"{nope"}
    assert "index.json" in refused(data, snapshot(contents), monkeypatch, capsys)


def test_index_that_is_not_an_object_is_refused(data, monkeypatch, capsys):
    contents = files() | {"index.json": b"[]"}
    assert "index.json" in refused(data, snapshot(contents), monkeypatch, capsys)


def test_not_a_gzip_is_refused(data, monkeypatch, capsys):
    assert "snapshot" in refused(data, b"<html>502 Bad Gateway</html>", monkeypatch, capsys)


def test_download_failure_is_refused(data, monkeypatch, capsys):
    def boom(url, max_bytes):
        raise fetch_v1.FetchError("cannot download https://v1.invalid/v1/snapshot.tar.gz: timed out")

    monkeypatch.setattr(fetch_v1, "download", boom)
    assert fetch_v1.main(["--base", "https://v1.invalid", "--data", str(data), "--now", NOW.isoformat()]) == 1
    assert unchanged(data)
    assert "timed out" in capsys.readouterr().err


# --- unsafe tarballs ------------------------------------------------------------------------------------------

UNSAFE = {
    "absolute path": [member("/etc/passwd")],
    "parent traversal": [member("../evil.json")],
    "nested traversal": [member("events/../../evil.json")],
    "symlink": [member("events/link.json", tarfile.SYMTYPE, "/etc/passwd")],
    "hard link": [member("events/hard.json", tarfile.LNKTYPE, "index.json")],
    "device": [member("events/dev", tarfile.CHRTYPE)],
    "fifo": [member("events/fifo", tarfile.FIFOTYPE)],
    "unexpected top-level file": [member("evil.sh")],
    "unexpected top-level dir": [member("model", tarfile.DIRTYPE)],
    "dotfile at top": [member(".git", tarfile.DIRTYPE)],
    "file where a dir belongs": [],  # built below
    "deep nesting": [member("events/a/b.json")],
    "backslash": [member("events\\..\\x.json")],
    "empty name part": [member("events//x.json")],
}


@pytest.mark.parametrize("case", sorted(UNSAFE))
def test_unsafe_members_are_refused(data, monkeypatch, capsys, case):
    contents, extra, extra_data = files(), UNSAFE[case], {}
    if case == "file where a dir belongs":
        contents = {k: v for k, v in contents.items() if not k.startswith("images/")} | {"images": b"x"}
        extra = []
    for info in extra:
        if info.type == tarfile.REGTYPE:
            extra_data[info.name] = b"{}"
    err = refused(data, snapshot(contents, extra, extra_data), monkeypatch, capsys)
    assert "unsafe" in err


def test_index_json_as_a_directory_is_refused(data, monkeypatch, capsys):
    contents = {k: v for k, v in files().items() if k != "index.json"} | {"index.json/x": b"{}"}
    assert "unsafe" in refused(data, snapshot(contents), monkeypatch, capsys)


def test_duplicate_members_are_refused(data, monkeypatch, capsys):
    blob = snapshot(files(), [member("fighters.json")], {"fighters.json": b"{}"})
    assert "unsafe" in refused(data, blob, monkeypatch, capsys)


def test_oversize_contents_are_refused(data, monkeypatch, capsys):
    monkeypatch.setattr(fetch_v1, "MAX_EXTRACTED_BYTES", 1000)
    contents = files() | {"images/big.webp": b"\0" * 2000}
    assert "unsafe" in refused(data, snapshot(contents), monkeypatch, capsys)


def test_too_many_members_are_refused(data, monkeypatch, capsys):
    monkeypatch.setattr(fetch_v1, "MAX_MEMBERS", 5)
    assert "unsafe" in refused(data, snapshot(files()), monkeypatch, capsys)


# --- the swap -------------------------------------------------------------------------------------------------


def test_failed_swap_restores_the_old_data(data, monkeypatch, capsys):
    real_rename = fetch_v1.os.rename
    calls = []

    def flaky(src, dst):
        calls.append((src, dst))
        if len(calls) == 2:  # moving the new tree into place
            raise OSError("disk on fire")
        return real_rename(src, dst)

    monkeypatch.setattr(fetch_v1.os, "rename", flaky)
    assert "disk on fire" in refused(data, snapshot(files()), monkeypatch, capsys)


# --- download -------------------------------------------------------------------------------------------------


@pytest.fixture
def server():
    """A local HTTP server: /v1/snapshot.tar.gz answers with `body`, anything else 404s."""
    state = {"body": b""}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path != "/v1/snapshot.tar.gz":
                self.send_error(404)
                return
            self.send_response(200)
            self.send_header("Content-Length", str(len(state["body"])))
            self.end_headers()
            self.wfile.write(state["body"])

        def log_message(self, *args):
            pass

    httpd = http.server.ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    state["base"] = f"http://127.0.0.1:{httpd.server_address[1]}"
    yield state
    httpd.shutdown()
    httpd.server_close()


def test_download_reads_the_body(server):
    server["body"] = b"abc" * 10
    assert fetch_v1.download(server["base"] + "/v1/snapshot.tar.gz", 1000) == b"abc" * 10


def test_download_caps_the_size(server):
    server["body"] = b"x" * 2000
    with pytest.raises(fetch_v1.FetchError, match="larger than"):
        fetch_v1.download(server["base"] + "/v1/snapshot.tar.gz", 1000)


def test_download_http_error_is_a_fetch_error(server):
    with pytest.raises(fetch_v1.FetchError, match="404"):
        fetch_v1.download(server["base"] + "/v1/nope", 1000)


def test_download_unreachable_is_a_fetch_error():
    with pytest.raises(fetch_v1.FetchError, match="cannot download"):
        fetch_v1.download("http://127.0.0.1:9/v1/snapshot.tar.gz", 1000)


def test_end_to_end_over_http(server, data):
    server["body"] = snapshot(files())
    assert fetch_v1.main(["--base", server["base"], "--data", str(data), "--now", NOW.isoformat()]) == 0
    assert tree_files(data) == files()


def test_now_defaults_to_the_clock(data, monkeypatch):
    """Without --now, a snapshot generated a minute ago is fresh."""
    fresh = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    monkeypatch.setattr(fetch_v1, "download", lambda url, max_bytes: snapshot(files(generated_at=fresh)))
    assert fetch_v1.main(["--base", "https://v1.invalid", "--data", str(data)]) == 0
