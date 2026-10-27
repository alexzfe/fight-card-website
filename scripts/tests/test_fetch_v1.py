"""fetch_v1.py: download /v1/snapshot.tar.gz, refuse anything unsafe, stale or from another contract, then swap
data/ for it."""

import http.server
import io
import json
import tarfile
import threading
from datetime import UTC, datetime

import pytest

import fetch_v1
from v1_helpers import V1_FIXTURE, dumps, files, member, snapshot, tree_files

NOW = datetime(2026, 10, 26, 12, 0, tzinfo=UTC)


# Pipeline bookkeeping the API doesn't publish; carried over so a rollback to DATA_SOURCE=pipeline keeps it.
BOOKKEEPING = {"images/misses.json": b'{"f9": "2026-10-20"}\n', "stale_fighters.json": b'["f9"]\n'}


@pytest.fixture
def data(tmp_path):
    """A committed data/ as the pipeline leaves it, with files the API doesn't carry."""
    d = tmp_path / "data"
    (d / "events").mkdir(parents=True)
    (d / "images").mkdir()
    (d / "index.json").write_bytes(dumps({"generated_at": "2026-10-25T06:00:00Z", "upcoming": [], "recent": []}))
    (d / "events" / "old.json").write_text("{}")
    for rel, body in BOOKKEEPING.items():
        (d / rel).write_bytes(body)
    (d / ".gitkeep").write_text("")
    return d


def run(data, blob, monkeypatch, *args):
    monkeypatch.setattr(fetch_v1, "download", lambda url, max_bytes: blob)
    return fetch_v1.main(["--base", "https://v1.invalid", "--data", str(data), "--now", NOW.isoformat(), *args])


# --- the happy path -------------------------------------------------------------------------------------------


def test_replaces_data_with_the_snapshot(data, monkeypatch):
    assert run(data, snapshot(files()), monkeypatch) == 0
    assert tree_files(data) == files() | BOOKKEEPING


def test_keeps_the_pipeline_bookkeeping(data, monkeypatch):
    """images/misses.json and stale_fighters.json: the API doesn't publish them, the site reads neither, and a
    rollback to the pipeline wants them back. Everything else the snapshot lacks goes."""
    run(data, snapshot(files()), monkeypatch)
    for rel, body in BOOKKEEPING.items():
        assert (data / rel).read_bytes() == body, rel
    assert not (data / "events" / "old.json").exists()
    assert not (data / ".gitkeep").exists()


def test_bookkeeping_is_optional(data, monkeypatch):
    for rel in BOOKKEEPING:
        (data / rel).unlink()
    assert run(data, snapshot(files()), monkeypatch) == 0
    assert tree_files(data) == files()


def test_snapshot_copy_of_a_bookkeeping_file_wins(data, monkeypatch):
    contents = files() | {"images/misses.json": b"{}\n"}
    assert run(data, snapshot(contents), monkeypatch) == 0
    assert (data / "images" / "misses.json").read_bytes() == b"{}\n"


def test_bookkeeping_survives_a_snapshot_without_images(data, monkeypatch):
    contents = {k: v for k, v in files().items() if not k.startswith("images/")}
    contents["fighters.json"] = dumps({"f1": {"id": "f1", "name": "One", "image": None}})
    assert run(data, snapshot(contents), monkeypatch) == 0
    assert (data / "images" / "misses.json").read_bytes() == BOOKKEEPING["images/misses.json"]


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
    now = json.loads(contents["index.json"])["generated_at"]  # the fixture is newer than NOW
    assert run(data, snapshot(contents), monkeypatch, "--now", now.replace("Z", "+00:00")) == 0
    assert tree_files(data) == contents | BOOKKEEPING


RANKINGS = dumps({"as_of": "2026-10-26", "p4p": {"men": [], "women": []}, "active": []})


def test_rankings_json_is_optional_and_kept_when_present(data, monkeypatch):
    """The engine serves /v1/rankings.json from contract 1.2 on; a snapshot without it is still fine (the other
    tests), and one with it lands in data/ for the Rankings page."""
    contents = files(contract_version="1.2") | {"rankings.json": RANKINGS}
    assert run(data, snapshot(contents), monkeypatch) == 0
    assert (data / "rankings.json").read_bytes() == RANKINGS
    assert tree_files(data) == contents | BOOKKEEPING


def test_rankings_json_that_is_not_json_is_refused(data, monkeypatch, capsys):
    contents = files() | {"rankings.json": b"{nope"}
    assert "rankings.json is unreadable" in refused(data, snapshot(contents), monkeypatch, capsys)


def test_rankings_json_as_a_directory_is_refused(data, monkeypatch, capsys):
    contents = files() | {"rankings.json/x": b"{}"}
    assert "unsafe" in refused(data, snapshot(contents), monkeypatch, capsys)


# The engine may add files within /v1/ (docs/CONTRACT.md, Versioning: consumers ignore files they don't know), so a
# safe member outside the layout is skipped, not written, and the rest of the snapshot is taken.
UNKNOWN = {"future.json": b'{"new": true}\n', "extras/a.json": b"{}\n", "extras/deep/b.bin": b"xx", ".hidden": b"x"}


def test_unknown_files_are_skipped_not_refused(data, monkeypatch, capsys):
    contents = files(contract_version="1.3")
    assert run(data, snapshot(contents | UNKNOWN), monkeypatch) == 0
    assert tree_files(data) == contents | BOOKKEEPING
    assert not (data / "extras").exists()
    err = capsys.readouterr().err
    assert "skipped" in err and "'future.json'" in err and "'extras/a.json'" in err


def test_skipped_names_cannot_inject_workflow_commands(data, monkeypatch, capsys):
    """Skipped names are printed with repr: a newline in one can't start a GitHub Actions `::error::` line."""
    contents = files(contract_version="1.3")
    assert run(data, snapshot(contents | {"x\n::error::pwned": b"x"}), monkeypatch) == 0
    err = capsys.readouterr().err
    assert "skipped" in err and "pwned" in err
    assert not any(line.startswith("::") for line in err.splitlines())


def test_no_skip_note_without_unknown_files(data, monkeypatch, capsys):
    assert run(data, snapshot(files()), monkeypatch) == 0
    assert "skipped" not in capsys.readouterr().err


def test_unknown_files_count_towards_the_size_cap(data, monkeypatch, capsys):
    monkeypatch.setattr(fetch_v1, "MAX_EXTRACTED_BYTES", 1000)
    contents = files() | {"future.bin": b"x" * 2000}
    assert "unsafe" in refused(data, snapshot(contents), monkeypatch, capsys)


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


def refused(data, blob, monkeypatch, capsys, *args, code=1) -> str:
    assert run(data, blob, monkeypatch, *args) == code
    assert unchanged(data)
    assert sorted(p.name for p in data.parent.iterdir()) == ["data"]
    return capsys.readouterr().err


def test_stale_snapshot_fails_with_its_age(data, monkeypatch, capsys):
    blob = snapshot(files(generated_at="2026-10-25T09:00:00Z"))
    err = refused(data, blob, monkeypatch, capsys, code=fetch_v1.EXIT_STALE)
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
    "symlink outside the layout": [member("future", tarfile.SYMTYPE, "/etc/passwd")],
    "hard link outside the layout": [member("future.json", tarfile.LNKTYPE, "index.json")],
    "device outside the layout": [member("future/dev", tarfile.CHRTYPE)],
    "traversal outside the layout": [member("future/../../evil.json")],
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
    state = {"body": b"", "redirects": {}}

    class Handler(http.server.BaseHTTPRequestHandler):
        def do_GET(self):  # noqa: N802
            if self.path in state["redirects"]:
                self.send_response(302)
                self.send_header("Location", state["redirects"][self.path])
                self.send_header("Content-Length", "0")
                self.end_headers()
                return
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
    state["port"] = httpd.server_address[1]
    state["base"] = f"http://127.0.0.1:{state['port']}"
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
    assert tree_files(data) == files() | BOOKKEEPING


def test_now_defaults_to_the_clock(data, monkeypatch):
    """Without --now, a snapshot generated a minute ago is fresh."""
    fresh = datetime.now(UTC).strftime("%Y-%m-%dT%H:%M:%SZ")
    monkeypatch.setattr(fetch_v1, "download", lambda url, max_bytes: snapshot(files(generated_at=fresh)))
    assert fetch_v1.main(["--base", "https://v1.invalid", "--data", str(data)]) == 0


# --- stale: its own exit code, outputs and issue body, so refresh.yml can stay quiet on hourly runs -------------

STALE_AT = "2026-10-25T09:00:00Z"  # 27 h before NOW


def outputs(path) -> dict[str, str]:
    return dict(line.split("=", 1) for line in path.read_text().splitlines()) if path.exists() else {}


def test_stale_has_its_own_exit_code():
    assert fetch_v1.EXIT_STALE == 3  # not 0/1, not argparse's 2; refresh.yml's tests use 3 too


def test_stale_writes_outputs_for_the_workflow(data, monkeypatch, tmp_path):
    out = tmp_path / "gh_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    assert run(data, snapshot(files(generated_at=STALE_AT)), monkeypatch) == fetch_v1.EXIT_STALE
    assert outputs(out) == {"stale": "true", "generated_at": STALE_AT, "age_hours": "27.0"}


def test_fresh_writes_stale_false(data, monkeypatch, tmp_path):
    out = tmp_path / "gh_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    assert run(data, snapshot(files()), monkeypatch) == 0
    assert outputs(out) == {"stale": "false", "generated_at": "2026-10-26T06:00:00Z", "age_hours": "6.0"}


def test_other_failures_write_no_outputs(data, monkeypatch, tmp_path):
    """No `stale` output means "don't know": the workflow neither opens nor closes the issue."""
    out = tmp_path / "gh_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    assert run(data, b"<html>502</html>", monkeypatch) == 1
    assert outputs(out) == {}


def test_stale_writes_the_issue_body(data, monkeypatch, tmp_path):
    body = tmp_path / "issue.md"
    run(data, snapshot(files(generated_at=STALE_AT)), monkeypatch, "--stale-issue", str(body))
    text = body.read_text()
    assert text.startswith(fetch_v1.STALE_MARKER)
    for expected in (STALE_AT, "27.0 h", "https://v1.invalid/v1/snapshot.tar.gz", "container logs",
                     "fightcard-service health --staleness", "26 h"):
        assert expected in text, expected


@pytest.mark.parametrize("blob", [snapshot(files()), b"garbage"], ids=["fresh", "broken"])
def test_issue_body_only_when_stale(data, monkeypatch, tmp_path, blob):
    body = tmp_path / "issue.md"
    run(data, blob, monkeypatch, "--stale-issue", str(body))
    assert not body.exists()


def test_stale_title_is_data_api_stale():
    assert fetch_v1.STALE_TITLE == "Data API stale"


# --- never backwards: a snapshot older than the committed data/ is skipped -------------------------------------


def commit_index(data, generated_at):
    (data / "index.json").write_bytes(dumps({"generated_at": generated_at, "upcoming": [], "recent": []}))


def test_older_snapshot_keeps_data(data, monkeypatch, capsys, tmp_path):
    commit_index(data, "2026-10-26T08:00:00Z")
    out = tmp_path / "gh_output"
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    assert run(data, snapshot(files(generated_at="2026-10-26T07:59:59Z")), monkeypatch) == 0
    assert unchanged(data)
    assert sorted(p.name for p in data.parent.iterdir()) == ["data", "gh_output"]
    printed = capsys.readouterr().out
    assert "older than" in printed and "2026-10-26T08:00:00Z" in printed and "2026-10-26T07:59:59Z" in printed
    assert outputs(out)["stale"] == "false"  # the API is fresh, just behind; the issue can close


def test_equal_snapshot_is_a_no_op(data, monkeypatch, capsys):
    commit_index(data, "2026-10-26T06:00:00Z")
    before = tree_files(data)
    assert run(data, snapshot(files(generated_at="2026-10-26T06:00:00Z")), monkeypatch) == 0
    assert tree_files(data) == before
    assert "already" in capsys.readouterr().out


def test_newer_snapshot_replaces_data(data, monkeypatch):
    commit_index(data, "2026-10-26T05:59:59Z")
    assert run(data, snapshot(files()), monkeypatch) == 0
    assert tree_files(data) == files() | BOOKKEEPING


@pytest.mark.parametrize("index", [b"{nope", b"[]", dumps({"upcoming": []}), dumps({"generated_at": "soon"})],
                         ids=["unreadable", "not-object", "missing", "malformed"])
def test_unknown_committed_age_does_not_block(data, monkeypatch, index):
    (data / "index.json").write_bytes(index)
    assert run(data, snapshot(files()), monkeypatch) == 0
    assert tree_files(data) == files() | BOOKKEEPING


def test_staleness_wins_over_going_backwards(data, monkeypatch):
    """Stale and older than data/: still the stale alert, not a quiet skip."""
    commit_index(data, "2026-10-26T08:00:00Z")
    assert run(data, snapshot(files(generated_at=STALE_AT)), monkeypatch) == fetch_v1.EXIT_STALE
    assert unchanged(data)


# --- review fix 1: a future generated_at must not freeze the site ---------------------------------------------


def test_snapshot_from_the_future_is_refused(data, monkeypatch, capsys):
    """NOW + 11 min: past the 10 min clock-skew allowance. Accepting it would block every later real snapshot."""
    err = refused(data, snapshot(files(generated_at="2026-10-26T12:11:00Z")), monkeypatch, capsys)
    assert "future" in err and "2026-10-26T12:11:00Z" in err


def test_snapshot_within_clock_skew_is_accepted(data, monkeypatch):
    assert run(data, snapshot(files(generated_at="2026-10-26T12:09:00Z")), monkeypatch) == 0
    assert (data / "index.json").read_bytes() == files(generated_at="2026-10-26T12:09:00Z")["index.json"]


def test_committed_future_generated_at_does_not_block(data, monkeypatch):
    """A data/index.json from the future (an earlier bad snapshot) counts as unknown, so a valid one replaces it."""
    commit_index(data, "2026-10-27T12:00:00Z")
    assert run(data, snapshot(files()), monkeypatch) == 0
    assert (data / "index.json").read_bytes() == files()["index.json"]


def test_committed_within_clock_skew_still_blocks(data, monkeypatch):
    commit_index(data, "2026-10-26T12:05:00Z")
    assert run(data, snapshot(files()), monkeypatch) == 0
    assert unchanged(data)


# --- review fix 2: content is checked before it can be committed ----------------------------------------------


def event(event_id="e1", red="f1", blue="f1") -> bytes:
    return dumps({"id": event_id, "slug": event_id, "name": "E1", "date": "2026-10-31", "status": "upcoming",
                  "fights": [{"id": "b1", "red": red, "blue": blue}]})


INVALID = {
    "garbage fighters.json": {"fighters.json": b"\x00\xffnot json"},
    "fighters.json not an object": {"fighters.json": b"[]"},
    "garbage event file": {"events/e1.json": b"{nope"},
    "garbage schema.json": {"schema.json": b"<html>"},
    "garbage unlisted event": {"events/e2.json": b"{nope"},
    "event id does not match its name": {"events/e1.json": dumps({"id": "e9", "fights": []})},
    "unknown red fighter": {"events/e1.json": event(red="ghost")},
    "unknown blue fighter": {"events/e1.json": event(blue="ghost")},
    "fights not a list": {"events/e1.json": dumps({"id": "e1", "fights": {}})},
}


@pytest.mark.parametrize("case", sorted(INVALID))
def test_invalid_content_is_refused(data, monkeypatch, capsys, case):
    err = refused(data, snapshot(files() | INVALID[case]), monkeypatch, capsys)
    assert "snapshot" in err


def test_listed_event_without_its_file_is_refused(data, monkeypatch, capsys):
    contents = {k: v for k, v in files().items() if k != "events/e1.json"}
    assert "events/e1.json" in refused(data, snapshot(contents), monkeypatch, capsys)


def test_recent_event_without_its_file_is_refused(data, monkeypatch, capsys):
    contents = files()
    idx = json.loads(contents["index.json"])
    idx["recent"] = ["e0"]
    contents["index.json"] = dumps(idx)
    assert "events/e0.json" in refused(data, snapshot(contents), monkeypatch, capsys)


def test_unknown_fighter_is_named(data, monkeypatch, capsys):
    err = refused(data, snapshot(files() | {"events/e1.json": event(blue="ghost")}), monkeypatch, capsys)
    assert "ghost" in err and "events/e1.json" in err


def test_fights_between_known_fighters_are_accepted(data, monkeypatch):
    assert run(data, snapshot(files() | {"events/e1.json": event()}), monkeypatch) == 0


# --- review fix 3: the size cap counts the decompressed stream, headers included ------------------------------


def with_pax_header(contents: dict[str, bytes], pax_bytes: int) -> bytes:
    """contents as a .tar.gz, plus a PAX header on fighters.json carrying pax_bytes of junk (not counted in size)."""
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.PAX_FORMAT) as tar:
        for name in ["events", "images", *sorted(contents)]:
            info = tarfile.TarInfo(name)
            if name in ("events", "images"):
                info.type, info.mode = tarfile.DIRTYPE, 0o755
                tar.addfile(info)
                continue
            info.size, info.mode = len(contents[name]), 0o644
            if name == "fighters.json":
                info.pax_headers = {"comment": "x" * pax_bytes}
            tar.addfile(info, io.BytesIO(contents[name]))
    return buf.getvalue()


def test_oversize_pax_header_is_refused(data, monkeypatch, capsys):
    """A PAX header isn't part of any member's size, so only a cap on the decompressed stream catches it."""
    monkeypatch.setattr(fetch_v1, "MAX_STREAM_BYTES", 200_000, raising=False)
    err = refused(data, with_pax_header(files(), 300_000), monkeypatch, capsys)
    assert "unsafe" in err and "200000" in err


def test_small_pax_header_is_fine(data, monkeypatch):
    monkeypatch.setattr(fetch_v1, "MAX_STREAM_BYTES", 200_000, raising=False)
    assert run(data, with_pax_header(files(), 1000), monkeypatch) == 0


def test_large_member_is_copied_whole(data, monkeypatch):
    """Members are copied in chunks; a file bigger than one chunk still arrives intact."""
    big = bytes(range(256)) * 20_000  # 5 MB
    assert run(data, snapshot(files() | {"images/big.webp": big}), monkeypatch) == 0
    assert (data / "images" / "big.webp").read_bytes() == big


# --- review fix 6: https only (plain http just for local tests), and no redirects off the origin --------------


@pytest.mark.parametrize("url", ["http://ufc-data.invalid/v1/snapshot.tar.gz", "ftp://ufc-data.invalid/x",
                                 "file:///etc/passwd", "http://127.0.0.1.invalid/x", "http://localhost.invalid/x"])
def test_download_refuses_non_https_urls(url):
    with pytest.raises(fetch_v1.FetchError, match="https"):
        fetch_v1.download(url, 1000)


def test_main_refuses_a_plain_http_base(data, capsys):
    assert fetch_v1.main(["--base", "http://ufc-data.invalid", "--data", str(data), "--now", NOW.isoformat()]) == 1
    assert unchanged(data) and "https" in capsys.readouterr().err


def test_download_allows_plain_http_to_localhost(server):
    server["body"] = b"ok"
    assert fetch_v1.download(f"http://localhost:{server['port']}/v1/snapshot.tar.gz", 1000) == b"ok"


def test_download_follows_a_same_origin_redirect(server):
    server["body"] = b"ok"
    server["redirects"]["/v1/latest"] = "/v1/snapshot.tar.gz"
    assert fetch_v1.download(server["base"] + "/v1/latest", 1000) == b"ok"


@pytest.mark.parametrize("target", ["http://localhost:{port}/v1/snapshot.tar.gz",
                                    "https://127.0.0.1:{port}/v1/snapshot.tar.gz",
                                    "http://127.0.0.1:1/v1/snapshot.tar.gz"],
                         ids=["other-host", "other-scheme", "other-port"])
def test_download_refuses_a_redirect_off_the_origin(server, target):
    server["body"] = b"ok"
    server["redirects"]["/v1/latest"] = target.format(port=server["port"])
    with pytest.raises(fetch_v1.FetchError, match="redirect"):
        fetch_v1.download(server["base"] + "/v1/latest", 1000)
