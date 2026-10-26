"""Replace data/ with the fightcard-engine's /v1/ snapshot (refresh.yml with DATA_SOURCE=v1).

Downloads <base>/v1/snapshot.tar.gz (one generation, see the engine's docs/CONTRACT.md) and refuses it, leaving
data/ untouched and exiting 1, when it is unsafe to extract (absolute paths, `..`, links or other non-regular
files, names outside the /v1/ layout, too big), from another contract major, or stale: `generated_at` older than
--max-age-hours (26 by default). A failed scheduled run emails the owner, so that is the staleness alert.

Otherwise the snapshot is extracted beside data/ and swapped in with two renames. data/ then holds exactly the
snapshot: the pipeline's bookkeeping (images/misses.json, stale_fighters.json) goes, since the site reads neither.

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

MAX_AGE_HOURS = 26.0  # the daily run plus slack; the engine refreshes more often than that
MAX_DOWNLOAD_BYTES = 100 * 2**20  # the snapshot is ~1.5 MB today
MAX_EXTRACTED_BYTES = 200 * 2**20
MAX_MEMBERS = 20_000
TIMEOUT = 60
TOP_FILES = {"index.json", "fighters.json", "schema.json"}
TOP_DIRS = {"events", "images"}  # each holds files only, one level deep
REQUIRED = ("index.json", "fighters.json")
_UTC_Z = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z")
_VERSION = re.compile(r"\d+(\.\d+)*")


class FetchError(Exception):
    """The snapshot can't be downloaded or isn't fit to replace data/."""


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


def check_fresh(index: dict, now: datetime, max_age_hours: float) -> None:
    hours = age_hours(index, now)
    if hours > max_age_hours:
        raise FetchError(f"/v1/ is stale: generated_at {index['generated_at']} is {hours:.1f} h old "
                         f"(limit {max_age_hours:g} h); keeping the committed data/")


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


def fetch(blob: bytes, data: Path, now: datetime, max_age_hours: float) -> dict:
    """Replace data with the snapshot in blob, or raise and leave it alone. Returns the snapshot's index."""
    data = data.absolute()
    data.parent.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(dir=data.parent, prefix=f".{data.name}.v1-"))
    try:
        new = staging / data.name
        extract(blob, new)
        index = read_index(new)
        check_fresh(index, now, max_age_hours)
        swap(new, data)
        return index
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
    args = parser.parse_args(argv)

    url = snapshot_url(args.base)
    try:
        index = fetch(download(url, MAX_DOWNLOAD_BYTES), args.data, parse_now(args.now), args.max_age_hours)
    except (FetchError, OSError) as e:
        print(f"fetch_v1: {e}", file=sys.stderr)
        return 1
    print(f"fetch_v1: {args.data} is now {url} (generated_at {index['generated_at']}, "
          f"contract {index['contract_version']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
