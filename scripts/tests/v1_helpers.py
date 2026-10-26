"""Builds /v1/ snapshot tarballs for the fetch_v1 and v1_shadow tests, laid out like the engine's
`fightcard publish` writes them: directory entries, then files, at their /v1/ paths."""

import io
import json
import tarfile
from pathlib import Path

from ops_helpers import REPO

V1_FIXTURE = REPO / "site" / "tests" / "fixtures" / "v1"  # `fightcard publish` over data/; see docs/tdd/v1-source.tdd.md


def dumps(obj) -> bytes:
    return (json.dumps(obj, indent=2, sort_keys=True) + "\n").encode()


def index(generated_at="2026-10-26T06:00:00Z", contract_version="1", upcoming=("e1",), recent=()) -> dict:
    out = {"generated_at": generated_at, "upcoming": list(upcoming), "recent": list(recent), "model": None}
    if contract_version is not None:
        out["contract_version"] = contract_version
    return out


def files(generated_at="2026-10-26T06:00:00Z", contract_version="1") -> dict[str, bytes]:
    """A minimal valid generation: one upcoming event, one fighter, one headshot."""
    return {
        "index.json": dumps(index(generated_at, contract_version)),
        "events/e1.json": dumps({"id": "e1", "slug": "e1", "name": "E1", "date": "2026-10-31",
                                 "status": "upcoming", "fights": []}),
        "fighters.json": dumps({"f1": {"id": "f1", "name": "One", "image": "images/f1.webp"}}),
        "images/f1.webp": b"RIFF....WEBP",
        "schema.json": dumps({"$id": "https://ufc-data.xlobax.com/v1/schema.json"}),
    }


def tree_files(root: Path) -> dict[str, bytes]:
    return {p.relative_to(root).as_posix(): p.read_bytes() for p in sorted(root.rglob("*")) if p.is_file()}


def snapshot(contents: dict[str, bytes], extra=(), extra_data: dict[str, bytes] | None = None) -> bytes:
    """contents as a .tar.gz with directory entries, plus raw `extra` members (links, devices, odd names)."""
    extra_data = extra_data or {}
    dirs = {"/".join(n.split("/")[:i]) for n in contents for i in range(1, n.count("/") + 1)}
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w:gz", format=tarfile.PAX_FORMAT) as tar:
        for name in sorted(dirs | set(contents)):
            info = tarfile.TarInfo(name)
            if name in dirs:
                info.type, info.mode = tarfile.DIRTYPE, 0o755
                tar.addfile(info)
            else:
                info.size, info.mode = len(contents[name]), 0o644
                tar.addfile(info, io.BytesIO(contents[name]))
        for info in extra:
            data = extra_data.get(info.name)
            if data is not None:
                info.size = len(data)
            tar.addfile(info, io.BytesIO(data) if data is not None else None)
    return buf.getvalue()


def member(name: str, type_=tarfile.REGTYPE, linkname: str = "") -> tarfile.TarInfo:
    info = tarfile.TarInfo(name)
    info.type, info.linkname, info.mode = type_, linkname, 0o644
    return info
