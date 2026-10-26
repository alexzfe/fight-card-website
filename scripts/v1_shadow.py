"""Compare the pipeline's data/ with the engine's /v1/ snapshot, for the job summary (refresh.yml's shadow job
while DATA_SOURCE=pipeline).

Counts the differences in events, fights, finish tiers and Elo, with the largest Elo gap. Fields only /v1/ has
(contract_version, Result.outcome, schema.json: the API is additive) and generated_at don't count. It reports and
never fails: an unreachable or unusable /v1/ is one line in the summary, and the exit code is always 0.

Stdlib only, like fetch_v1.py.

    python3 scripts/v1_shadow.py --base https://ufc-data.xlobax.com --ours data --summary "$GITHUB_STEP_SUMMARY"
"""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path

import fetch_v1

EXAMPLES = 5


@dataclass
class Diff:
    events: int = 0
    event_examples: list[str] = field(default_factory=list)
    fights: int = 0
    fight_examples: list[str] = field(default_factory=list)
    tiers: int = 0
    tier_examples: list[str] = field(default_factory=list)
    elo: int = 0
    elo_largest: tuple[str, int, int] | None = None  # (name, ours, v1)


def _project(theirs, ours):
    """theirs without the keys ours lacks (at any depth): what /v1/ added isn't a difference."""
    if isinstance(theirs, dict) and isinstance(ours, dict):
        return {k: _project(v, ours[k]) for k, v in theirs.items() if k in ours}
    if isinstance(theirs, list) and isinstance(ours, list) and len(theirs) == len(ours):
        return [_project(t, o) for t, o in zip(theirs, ours, strict=True)]
    return theirs


def _same(ours, theirs) -> bool:
    return _project(theirs, ours) == ours


def _events(root: Path) -> dict[str, dict]:
    return {p.stem: json.loads(p.read_text()) for p in sorted((root / "events").glob("*.json"))}


def _side(key, ours: dict, theirs: dict) -> str:
    return " (only in /v1/)" if key not in ours else " (only in data/)" if key not in theirs else ""


def _tier(value) -> str:
    return value or "—"


def diff(ours_dir: Path, theirs_dir: Path) -> Diff:
    d = Diff()
    ours, theirs = _events(ours_dir), _events(theirs_dir)
    for eid in sorted(ours.keys() | theirs.keys()):
        if eid in ours and eid in theirs and _same(ours[eid], theirs[eid]):
            continue
        d.events += 1
        d.event_examples.append(eid + _side(eid, ours, theirs))

    our_fights = {(eid, f["id"]): f for eid, e in ours.items() for f in e.get("fights", [])}
    their_fights = {(eid, f["id"]): f for eid, e in theirs.items() for f in e.get("fights", [])}
    for key in sorted(our_fights.keys() | their_fights.keys()):
        a, b = our_fights.get(key), their_fights.get(key)
        label = "/".join(key)
        if a is None or b is None or not _same(a, b):
            d.fights += 1
            d.fight_examples.append(label + _side(key, our_fights, their_fights))
        if a is not None and b is not None and a.get("finish_tier") != b.get("finish_tier"):
            d.tiers += 1
            d.tier_examples.append(f"{label}: {_tier(a.get('finish_tier'))} → {_tier(b.get('finish_tier'))}")

    our_fighters = json.loads((ours_dir / "fighters.json").read_text())
    their_fighters = json.loads((theirs_dir / "fighters.json").read_text())
    largest = 0
    for fid in sorted(our_fighters.keys() | their_fighters.keys()):
        a, b = our_fighters.get(fid), their_fighters.get(fid)
        if a is None or b is None:
            d.elo += 1
            continue
        if a.get("elo") == b.get("elo"):
            continue
        d.elo += 1
        if isinstance(a.get("elo"), int) and isinstance(b.get("elo"), int) and abs(b["elo"] - a["elo"]) > largest:
            largest = abs(b["elo"] - a["elo"])
            d.elo_largest = (a.get("name") or fid, a["elo"], b["elo"])
    return d


def _cell(text: str) -> str:
    return text.replace("|", "\\|")


def _examples(items: list[str]) -> str:
    if not items:
        return "—"
    more = f", … {len(items) - EXAMPLES} more" if len(items) > EXAMPLES else ""
    return _cell(", ".join(items[:EXAMPLES]) + more)


def render(d: Diff, index: dict, now: datetime, max_age_hours: float = fetch_v1.MAX_AGE_HOURS) -> str:
    hours = fetch_v1.age_hours(index, now)
    stale = f" **stale**: over {max_age_hours:g} h; `DATA_SOURCE=v1` would fail this run." if hours > max_age_hours else ""
    if d.elo_largest:
        name, a, b = d.elo_largest
        elo = _cell(f"{name} {a} → {b} ({b - a:+d})")
    else:
        elo = "—"
    return "\n".join([
        f"/v1/ generated_at `{index['generated_at']}` ({hours:.1f} h old), contract `{index['contract_version']}`.{stale}",
        "",
        "| | Differences | Largest / examples |",
        "|---|---|---|",
        f"| Events | {d.events} | {_examples(d.event_examples)} |",
        f"| Fights | {d.fights} | {_examples(d.fight_examples)} |",
        f"| Finish tiers | {d.tiers} | {_examples(d.tier_examples)} |",
        f"| Elo | {d.elo} | {elo} |",
        "",
        "Ignored: generated_at, and what only /v1/ has (contract_version, Result.outcome, schema.json).",
    ])


def report(base: str, ours: Path, now: datetime) -> str:
    url = fetch_v1.snapshot_url(base)
    try:
        blob = fetch_v1.download(url, fetch_v1.MAX_DOWNLOAD_BYTES)
    except fetch_v1.FetchError as e:
        return f"v1 not reachable: {e}"
    with tempfile.TemporaryDirectory() as tmp:
        theirs = Path(tmp) / "v1"
        try:
            fetch_v1.extract(blob, theirs)
            index = fetch_v1.read_index(theirs)
        except fetch_v1.FetchError as e:
            return f"v1 not usable: {e}"
        return render(diff(ours, theirs), index, now)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base", required=True, help="API origin, e.g. https://ufc-data.xlobax.com")
    parser.add_argument("--ours", type=Path, default=Path("data"), help="the pipeline's data dir")
    parser.add_argument("--summary", type=Path, required=True, help="markdown file to append to")
    parser.add_argument("--now", help="ISO 8601 time to judge staleness against (default: the clock)")
    args = parser.parse_args(argv)

    try:
        body = report(args.base, args.ours, fetch_v1.parse_now(args.now))
    except Exception as e:  # noqa: BLE001 - the shadow reports; it must never fail the refresh
        body = f"shadow failed: {type(e).__name__}: {e}"
    text = f"## /v1/ shadow\n\n{body}\n"
    print(text)
    with args.summary.open("a", encoding="utf-8") as f:
        f.write(text)
    return 0


if __name__ == "__main__":
    sys.exit(main())
