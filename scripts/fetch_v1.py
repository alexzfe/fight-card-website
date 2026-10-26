"""Replace data/ with the fightcard-engine's /v1/ snapshot (refresh.yml with DATA_SOURCE=v1).

Downloads <base>/v1/snapshot.tar.gz (one generation, see the engine's docs/CONTRACT.md) and refuses it, leaving
data/ untouched and exiting 1, when it is unsafe to extract (absolute paths, `..`, links or other non-regular
files, names outside the /v1/ layout, too big) or from another contract major. A stale one (`generated_at` older
than --max-age-hours, 26 by default) exits 3 instead, so refresh.yml can tell it apart: hourly runs then keep
data/ quietly and keep the "Data API stale" issue (body from --stale-issue) open, the daily and manual runs fail.

A snapshot no newer than the committed data/index.json is skipped with exit 0: data/ never goes backwards.
Otherwise the snapshot is extracted beside data/ and swapped in with two renames. data/ then holds exactly the
snapshot: the pipeline's bookkeeping (images/misses.json, stale_fighters.json) goes, since the site reads neither.

Writes stale=true|false, generated_at and age_hours to $GITHUB_OUTPUT, except on other failures.

Stdlib only, so the job doesn't have to install the pipeline.

    python3 scripts/fetch_v1.py --base https://ufc-data.xlobax.com --data data
"""

from __future__ import annotations

import argparse
import io
import json
import os
import re
import shutil
import sys
import tarfile
import tempfile
import urllib.error
import urllib.request
import zlib
from datetime import UTC, datetime, timedelta
from pathlib import Path

from gh_output import emit

MAX_AGE_HOURS = 26.0  # the daily run plus slack; the engine refreshes more often than that
CLOCK_SKEW = timedelta(minutes=10)  # a generated_at further ahead than this is wrong, not early
MAX_DOWNLOAD_BYTES = 100 * 2**20  # the snapshot is ~1.5 MB today
MAX_EXTRACTED_BYTES = 200 * 2**20
MAX_MEMBERS = 20_000
TIMEOUT = 60
TOP_FILES = {"index.json", "fighters.json", "schema.json"}
TOP_DIRS = {"events", "images"}  # each holds files only, one level deep
REQUIRED = ("index.json", "fighters.json")
_UTC_Z = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z")
_VERSION = re.compile(r"\d+(\.\d+)*")
EXIT_STALE = 3  # not 1 (any other refusal) or 2 (argparse's usage error)
STALE_TITLE = "Data API stale"
# Lets a human recognise the bot's issue regardless of edits to the title.
STALE_MARKER = "<!-- fightcard:v1-stale -->"


class FetchError(Exception):
    """The snapshot can't be downloaded or isn't fit to replace data/."""


class StaleError(FetchError):
    """The snapshot is fine but older than --max-age-hours."""

    def __init__(self, index: dict, hours: float, max_age_hours: float):
        super().__init__(f"/v1/ is stale: generated_at {index['generated_at']} is {hours:.1f} h old "
                         f"(limit {max_age_hours:g} h); keeping the committed data/")
        self.index, self.hours, self.max_age_hours = index, hours, max_age_hours


def snapshot_url(base: str) -> str:
    return base.rstrip("/") + "/v1/snapshot.tar.gz"


def download(url: str, max_bytes: int) -> bytes:
    if not url.startswith(("https://", "http://")):
        raise FetchError(f"cannot download {url}: not an http(s) URL")
    request = urllib.request.Request(url, headers={"User-Agent": "fight-card-website refresh"})
    try:
        with urllib.request.urlopen(request, timeout=TIMEOUT) as response:
            body = response.read(max_bytes + 1)
    except OSError as e:  # URLError, HTTPError and timeouts are all OSErrors
        raise FetchError(f"cannot download {url}: {e}") from e
    if len(body) > max_bytes:
        raise FetchError(f"{url} is larger than {max_bytes} bytes")
    return body


def _unsafe(info: tarfile.TarInfo, why: str) -> FetchError:
    return FetchError(f"unsafe snapshot member {info.name!r}: {why}")


def _check_member(info: tarfile.TarInfo) -> None:
    parts = info.name.split("/")
    if info.name.startswith("/") or "\\" in info.name or any(p in ("", ".", "..") for p in parts):
        raise _unsafe(info, "not a plain relative path")
    if not (info.isfile() or info.isdir()):
        raise _unsafe(info, "not a regular file or directory")
    top = parts[0]
    if len(parts) == 1:
        if (top in TOP_FILES and info.isfile()) or (top in TOP_DIRS and info.isdir()):
            return
    elif top in TOP_DIRS and len(parts) == 2 and info.isfile():
        return
    raise _unsafe(info, "not part of the /v1/ layout")


def extract(blob: bytes, dest: Path) -> None:
    """Check every member of the .tar.gz `blob`, then write the files under dest (created if missing)."""
    try:
        with tarfile.open(fileobj=io.BytesIO(blob), mode="r:gz") as tar:
            members, seen, total = [], set(), 0
            for info in tar:
                if len(members) >= MAX_MEMBERS:
                    raise _unsafe(info, f"more than {MAX_MEMBERS} members")
                _check_member(info)
                if info.name in seen:
                    raise _unsafe(info, "listed twice")
                seen.add(info.name)
                total += info.size
                if total > MAX_EXTRACTED_BYTES:
                    raise _unsafe(info, f"contents larger than {MAX_EXTRACTED_BYTES} bytes")
                members.append(info)
            dest.mkdir(parents=True, exist_ok=True)
            for info in members:  # directories come before their files, so parents exist
                target = dest / info.name
                if info.isdir():
                    target.mkdir(exist_ok=True)
                else:
                    target.parent.mkdir(exist_ok=True)
                    target.write_bytes(tar.extractfile(info).read())
    except (tarfile.TarError, EOFError, zlib.error) as e:
        raise FetchError(f"snapshot is not a readable .tar.gz: {e}") from e


def read_index(root: Path) -> dict:
    """index.json of an extracted snapshot, checked for what the site relies on: contract 1.x, generated_at."""
    for name in REQUIRED:
        if not (root / name).is_file():
            raise FetchError(f"snapshot has no {name}")
    try:
        index = json.loads((root / "index.json").read_text(encoding="utf-8"))
    except (OSError, ValueError) as e:
        raise FetchError(f"snapshot index.json is unreadable: {e}") from e
    if not isinstance(index, dict):
        raise FetchError("snapshot index.json is not an object")
    version = index.get("contract_version")
    if not (isinstance(version, str) and _VERSION.fullmatch(version) and version.split(".")[0] == "1"):
        raise FetchError(f"snapshot contract_version {version!r} is not 1.x; this site reads /v1/ only")
    generated_at = index.get("generated_at")
    if not (isinstance(generated_at, str) and _UTC_Z.fullmatch(generated_at)):
        raise FetchError(f"snapshot generated_at {generated_at!r} is not ISO 8601 UTC with Z")
    return index


def age_hours(index: dict, now: datetime) -> float:
    return (now - datetime.fromisoformat(index["generated_at"])) / timedelta(hours=1)


def check_not_future(index: dict, now: datetime) -> None:
    """A future generated_at would make every later real snapshot look older than data/ and freeze the site."""
    if datetime.fromisoformat(index["generated_at"]) > now + CLOCK_SKEW:
        raise FetchError(f"snapshot generated_at {index['generated_at']} is in the future "
                         f"(now {now:%Y-%m-%dT%H:%M:%SZ}, allowing {CLOCK_SKEW} of clock skew)")


def check_fresh(index: dict, now: datetime, max_age_hours: float) -> None:
    hours = age_hours(index, now)
    if hours > max_age_hours:
        raise StaleError(index, hours, max_age_hours)


def committed_at(data: Path, now: datetime) -> str | None:
    """generated_at of the committed data/index.json, or None when it can't be told (then nothing blocks the swap).
    A future one counts as unknown, so a bad snapshot that got committed can't block every later one."""
    try:
        index = json.loads((data / "index.json").read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None
    generated_at = index.get("generated_at") if isinstance(index, dict) else None
    if not (isinstance(generated_at, str) and _UTC_Z.fullmatch(generated_at)):
        return None
    return None if datetime.fromisoformat(generated_at) > now + CLOCK_SKEW else generated_at


def stale_issue_body(error: StaleError, url: str) -> str:
    return "\n".join([
        STALE_MARKER,
        f"The data API's `/v1/` snapshot is stale: `generated_at` is {error.index['generated_at']}, "
        f"{error.hours:.1f} h old (the limit is {error.max_age_hours:g} h).",
        "",
        "The site keeps serving the last committed `data/`. Hourly refresh runs keep checking without failing; the "
        "daily 06:00 UTC run and manual runs fail until `/v1/` is fresh again. The first fresh fetch closes this issue.",
        "",
        f"API: {url}",
        "",
        "What to check on the engine host:",
        "",
        "- the fightcard-engine's container logs: did the last refresh or publish fail?",
        "- `fightcard-service health --staleness`",
        "",
        "If the engine stays down, roll back to the pipeline (docs/DEPLOY.md):",
        "`gh variable set DATA_SOURCE --body pipeline --repo alexzfe/fight-card-website`.",
        "",
    ])


def swap(new: Path, data: Path) -> None:
    """Move new to data, replacing it. Two renames; if the second fails, the old data/ is put back."""
    if not data.exists():
        os.rename(new, data)
        return
    graveyard = Path(tempfile.mkdtemp(dir=data.parent, prefix=f".{data.name}.old-"))
    try:
        old = graveyard / data.name
        os.rename(data, old)
        try:
            os.rename(new, data)
        except OSError:
            os.rename(old, data)
            raise
    finally:
        shutil.rmtree(graveyard, ignore_errors=True)


def fetch(blob: bytes, data: Path, now: datetime, max_age_hours: float) -> tuple[dict, str | None]:
    """Replace data with the snapshot in blob, or raise and leave it alone. Returns the snapshot's index and, when
    data was kept because the snapshot is no newer than it, the committed generated_at (else None)."""
    data = data.absolute()
    data.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(dir=data.parent, prefix=f".{data.name}.v1-"))
    try:
        new = staging / data.name
        extract(blob, new)
        index = read_index(new)
        check_not_future(index, now)
        check_fresh(index, now, max_age_hours)
        ours = committed_at(data, now)
        if ours and datetime.fromisoformat(index["generated_at"]) <= datetime.fromisoformat(ours):
            return index, ours
        swap(new, data)
        return index, None
    finally:
        shutil.rmtree(staging, ignore_errors=True)


def parse_now(text: str | None) -> datetime:
    if text is None:
        return datetime.now(UTC)
    now = datetime.fromisoformat(text)
    return now if now.tzinfo else now.replace(tzinfo=UTC)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--base", required=True, help="API origin, e.g. https://ufc-data.xlobax.com")
    parser.add_argument("--data", type=Path, default=Path("data"), help="the data dir to replace")
    parser.add_argument("--max-age-hours", type=float, default=MAX_AGE_HOURS,
                        help=f"refuse a snapshot generated longer ago than this (default {MAX_AGE_HOURS:g})")
    parser.add_argument("--now", help="ISO 8601 time to judge staleness against (default: the clock)")
    parser.add_argument("--stale-issue", type=Path, help="when stale, write the issue body here")
    args = parser.parse_args(argv)

    url = snapshot_url(args.base)
    now = parse_now(args.now)
    try:
        index, kept = fetch(download(url, MAX_DOWNLOAD_BYTES), args.data, now, args.max_age_hours)
    except StaleError as e:
        print(f"fetch_v1: {e}", file=sys.stderr)
        emit(stale=True, generated_at=e.index["generated_at"], age_hours=f"{e.hours:.1f}")
        if args.stale_issue:
            args.stale_issue.write_text(stale_issue_body(e, url))
        return EXIT_STALE
    except (FetchError, OSError) as e:
        print(f"fetch_v1: {e}", file=sys.stderr)
        return 1
    emit(stale=False, generated_at=index["generated_at"], age_hours=f"{age_hours(index, now):.1f}")
    theirs = index["generated_at"]
    if kept and datetime.fromisoformat(kept) == datetime.fromisoformat(theirs):
        print(f"fetch_v1: {args.data} already holds /v1/ generated_at {theirs}; nothing to do")
    elif kept:
        print(f"fetch_v1: kept {args.data}: /v1/ generated_at {theirs} is older than the committed {kept}; "
              "not going backwards")
    else:
        print(f"fetch_v1: {args.data} is now {url} (generated_at {theirs}, contract {index['contract_version']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
