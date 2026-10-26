"""v1_shadow.py: in `pipeline` mode, fetch /v1/ beside the pipeline's data/ and summarise how they differ. It
reports, it never fails the refresh."""

import json
from datetime import UTC, datetime

import pytest

import fetch_v1
import v1_shadow
from v1_helpers import V1_FIXTURE, dumps, snapshot, tree_files

NOW = datetime(2026, 10, 26, 12, 0, tzinfo=UTC)
FIGHTERS = {
    "a": {"id": "a", "name": "Ann", "elo": 1500},
    "b": {"id": "b", "name": "Bea", "elo": 1600},
    "c": {"id": "c", "name": "Cat", "elo": None},
}
FIGHT = {"id": "x1", "red": "a", "blue": "b", "finish_tier": "high", "result": {"winner": "a", "method": "KO"}}


def write_tree(root, *, generated_at="2026-10-26T06:00:00Z", events=None, fighters=None, v1=False):
    events = {"e1": [FIGHT]} if events is None else events
    idx = {"generated_at": generated_at, "upcoming": sorted(events), "recent": []}
    if v1:
        idx["contract_version"] = "1"
    (root / "events").mkdir(parents=True)
    (root / "index.json").write_bytes(dumps(idx))
    (root / "fighters.json").write_bytes(dumps(FIGHTERS if fighters is None else fighters))
    for eid, fights in events.items():
        ev = {"id": eid, "slug": eid, "name": eid, "date": "2026-10-31", "status": "upcoming", "fights": fights}
        (root / "events" / f"{eid}.json").write_bytes(dumps(ev))
    return root


@pytest.fixture
def ours(tmp_path):
    return write_tree(tmp_path / "ours")


def theirs(tmp_path, **kw):
    return write_tree(tmp_path / "theirs", v1=True, **kw)


# --- diff -----------------------------------------------------------------------------------------------------


def test_identical_data_has_no_differences(tmp_path, ours):
    d = v1_shadow.diff(ours, theirs(tmp_path, generated_at="2026-10-26T07:30:00Z"))
    assert (d.events, d.fights, d.tiers, d.elo) == (0, 0, 0, 0)


def test_fields_only_v1_has_are_additions_not_differences(tmp_path, ours):
    """/v1/ is additive: contract_version, schema.json and Result.outcome aren't in the pipeline's data/."""
    fight = json.loads(json.dumps(FIGHT))
    fight["result"]["outcome"] = "win"
    t = theirs(tmp_path, events={"e1": [fight]})
    (t / "schema.json").write_text("{}")
    d = v1_shadow.diff(ours, t)
    assert (d.events, d.fights, d.tiers, d.elo) == (0, 0, 0, 0)


def test_counts_event_and_fight_differences(tmp_path, ours):
    changed = FIGHT | {"blue": "c"}
    extra = FIGHT | {"id": "x2"}
    d = v1_shadow.diff(ours, theirs(tmp_path, events={"e1": [changed, extra], "e2": []}))
    assert d.events == 2  # e1 differs, e2 only in v1
    assert d.fights == 2  # x1 differs, x2 only in v1
    assert "e2" in " ".join(d.event_examples)


def test_a_field_v1_drops_is_a_difference(tmp_path, ours):
    dropped = {k: v for k, v in FIGHT.items() if k != "result"}
    assert v1_shadow.diff(ours, theirs(tmp_path, events={"e1": [dropped]})).fights == 1


def test_counts_tier_differences_with_examples(tmp_path, ours):
    d = v1_shadow.diff(ours, theirs(tmp_path, events={"e1": [FIGHT | {"finish_tier": "low"}]}))
    assert d.tiers == 1
    assert d.tier_examples == ["e1/x1: high → low"]


def test_elo_differences_report_the_largest(tmp_path, ours):
    fighters = json.loads(json.dumps(FIGHTERS))
    fighters["a"]["elo"] = 1490
    fighters["b"]["elo"] = 1640
    fighters["c"]["elo"] = 1450  # unknown → known counts, but has no size
    d = v1_shadow.diff(ours, theirs(tmp_path, fighters=fighters))
    assert d.elo == 3
    assert d.elo_largest == ("Bea", 1600, 1640)


def test_fighters_on_one_side_only_count_as_elo_differences(tmp_path, ours):
    fighters = {k: v for k, v in FIGHTERS.items() if k != "c"}
    assert v1_shadow.diff(ours, theirs(tmp_path, fighters=fighters)).elo == 1


def test_generated_at_is_ignored(tmp_path, ours):
    d = v1_shadow.diff(ours, theirs(tmp_path, generated_at="2020-01-01T00:00:00Z"))
    assert (d.events, d.fights, d.tiers, d.elo) == (0, 0, 0, 0)


def test_publish_fixture_matches_the_data_it_was_built_from(tmp_path):
    """The fixture is `fightcard publish` over data/ at the time: only additive fields differ."""
    from ops_helpers import REPO

    data = REPO / "data"
    fixture_index = json.loads((V1_FIXTURE / "index.json").read_text())
    if json.loads((data / "index.json").read_text())["generated_at"] != fixture_index["generated_at"]:
        pytest.skip("data/ has been refreshed since the fixture was built")
    d = v1_shadow.diff(data, V1_FIXTURE)
    assert (d.events, d.fights, d.tiers, d.elo) == (0, 0, 0, 0)


# --- render ---------------------------------------------------------------------------------------------------


def test_render_lists_each_count_and_the_largest_elo_gap(tmp_path, ours):
    fighters = json.loads(json.dumps(FIGHTERS))
    fighters["b"]["elo"] = 1640
    t = theirs(tmp_path, fighters=fighters, events={"e1": [FIGHT | {"finish_tier": "low"}]})
    md = v1_shadow.render(v1_shadow.diff(ours, t), json.loads((t / "index.json").read_text()), NOW)
    assert "| Events | 1 |" in md
    assert "| Fights | 1 |" in md
    assert "| Finish tiers | 1 | e1/x1: high → low |" in md
    assert "| Elo | 1 | Bea 1600 → 1640 (+40) |" in md
    assert "2026-10-26T06:00:00Z" in md and "6.0 h" in md


# --- main: never fails ----------------------------------------------------------------------------------------


def shadow(ours, summary, monkeypatch, blob=None, error=None):
    def download(url, max_bytes):
        if error:
            raise error
        return blob

    monkeypatch.setattr(fetch_v1, "download", download)
    return v1_shadow.main(["--base", "https://v1.invalid", "--ours", str(ours), "--summary", str(summary),
                           "--now", NOW.isoformat()])


def test_unreachable_v1_is_noted_and_succeeds(tmp_path, ours, monkeypatch):
    summary = tmp_path / "summary.md"
    err = fetch_v1.FetchError("cannot download https://v1.invalid/v1/snapshot.tar.gz: Name or service not known")
    assert shadow(ours, summary, monkeypatch, error=err) == 0
    text = summary.read_text()
    assert "v1 not reachable" in text and "Name or service not known" in text


@pytest.mark.parametrize("blob", [b"not a tarball", b""])
def test_unusable_snapshot_is_noted_and_succeeds(tmp_path, ours, monkeypatch, blob):
    summary = tmp_path / "summary.md"
    assert shadow(ours, summary, monkeypatch, blob=blob) == 0
    assert "v1 not usable" in summary.read_text()


def test_unexpected_errors_are_noted_and_succeed(tmp_path, ours, monkeypatch):
    summary = tmp_path / "summary.md"
    assert shadow(ours, summary, monkeypatch, error=RuntimeError("surprise")) == 0
    assert "surprise" in summary.read_text()


def test_stale_v1_is_still_diffed_and_flagged(tmp_path, ours, monkeypatch):
    summary = tmp_path / "summary.md"
    t = theirs(tmp_path, generated_at="2026-10-24T06:00:00Z")
    assert shadow(ours, summary, monkeypatch, blob=snapshot(tree_files(t))) == 0
    text = summary.read_text()
    assert "stale" in text and "| Events | 0 |" in text


def test_summary_is_appended_not_overwritten(tmp_path, ours, monkeypatch):
    summary = tmp_path / "summary.md"
    summary.write_text("# earlier step\n")
    t = theirs(tmp_path)
    shadow(ours, summary, monkeypatch, blob=snapshot(tree_files(t)))
    text = summary.read_text()
    assert text.startswith("# earlier step\n") and "| Elo | 0 |" in text


def test_ours_is_not_touched(tmp_path, ours, monkeypatch):
    before = tree_files(ours)
    t = theirs(tmp_path, events={"e9": []})
    shadow(ours, tmp_path / "summary.md", monkeypatch, blob=snapshot(tree_files(t)))
    assert tree_files(ours) == before
