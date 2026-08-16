#!/usr/bin/env python3
"""Download and checksum the pinned EffortCast race-data sources."""

from __future__ import annotations

import argparse
import hashlib
import json
import shutil
import sys
import urllib.request
import zipfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SOURCE_MANIFEST = ROOT / "data" / "sources.json"


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def download(url: str, destination: Path, force: bool = False) -> None:
    if destination.exists() and not force:
        return
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_suffix(destination.suffix + ".part")
    request = urllib.request.Request(url, headers={"User-Agent": "EffortCast-data-pipeline/1.0"})
    with urllib.request.urlopen(request, timeout=120) as response, temporary.open("wb") as output:
        shutil.copyfileobj(response, output)
    temporary.replace(destination)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--force", action="store_true", help="download even when a local file exists")
    args = parser.parse_args()

    manifest = json.loads(SOURCE_MANIFEST.read_text(encoding="utf-8"))
    for source in manifest["sources"]:
        destination = ROOT / source["raw_file"]
        print(f"fetch  {source['id']}")
        download(source["download_url"], destination, args.force)
        actual = sha256(destination)
        if actual != source["sha256"]:
            print(f"checksum mismatch for {destination}:\nexpected {source['sha256']}\nactual   {actual}", file=sys.stderr)
            return 2
        print(f"verify {actual[:16]}...  {destination.relative_to(ROOT)}")

        if destination.suffix.lower() == ".zip":
            extract_to = ROOT / "data" / "raw" / "marathon-2023"
            extract_to.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(destination) as archive:
                expected = {"Races.csv", "Results.csv"}
                if set(archive.namelist()) != expected:
                    print(f"unexpected archive members: {archive.namelist()}", file=sys.stderr)
                    return 3
                archive.extractall(extract_to)
            print(f"unpack {extract_to.relative_to(ROOT)}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
