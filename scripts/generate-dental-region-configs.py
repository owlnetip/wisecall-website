#!/usr/bin/env python3
"""Generate data/research/regions/<id>.json from manifest + CQC counts."""

from __future__ import annotations

import csv
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "data" / "research"
REGIONS_DIR = RESEARCH / "regions"
MANIFEST = REGIONS_DIR / "manifest.json"
CQC_CSV = RESEARCH / "01_July_2026_CQC_directory.csv"


def outward(postcode: str) -> str:
    pc = postcode.upper().replace(" ", "")
    return pc[:-3] if len(pc) >= 5 else ""


def load_practice_counts() -> dict[str, Counter]:
    by_region: dict[str, Counter] = {}
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    region_re = {r["id"]: re.compile(r["postcode_regex"]) for r in manifest["regions"]}

    with CQC_CSV.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for _ in range(4):
            next(reader)
        header = next(reader)
        idx = {h: i for i, h in enumerate(header)}
        for row in reader:
            service = row[idx["Service types"]]
            if "Dentist" not in service and "Orthodont" not in service:
                continue
            pc = row[idx["Postcode"]].strip().upper().replace(" ", "")
            ow = outward(row[idx["Postcode"]].strip())
            for rid, rx in region_re.items():
                if rx.match(pc):
                    by_region.setdefault(rid, Counter())[ow] += 1
                    break
    return by_region


def core_outwards(counter: Counter, limit: int = 12) -> list[str]:
    ranked = counter.most_common()
    if not ranked:
        return []
    # Prefer city-centre style outwards (shorter numeric suffix) among top counts
    top = [ow for ow, _ in ranked[: max(limit * 2, limit)]]
    top.sort(key=lambda ow: (counter[ow] * -1, len(ow), ow))
    return top[:limit]


def area_labels(outwards: list[str], name: str) -> dict[str, str]:
    return {ow: f"{name} ({ow})" for ow in outwards}


def build_config(entry: dict, counter: Counter) -> dict:
    rid = entry["id"]
    prefix = entry["postcode_prefix"].lower()
    outwards = sorted(counter.keys())
    core = core_outwards(counter)
    if not core and outwards:
        core = outwards[:8]

    return {
        "id": rid,
        "name": entry["name"],
        "postcode_regex": entry["postcode_regex"],
        "area_column": "area",
        "file_prefix": f"{rid}-{prefix}-dental",
        "overrides_file": f"{rid}-dental-manual-overrides.json",
        "core_outward_codes": core,
        "core_segment_prefix": f"{rid}-core",
        "area_labels": area_labels(outwards, entry["name"]),
    }


def main() -> None:
    counts = load_practice_counts()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    generated = 0
    for entry in manifest["regions"]:
        rid = entry["id"]
        counter = counts.get(rid, Counter())
        if not counter and entry.get("status") == "pending":
            print(f"skip {rid}: no CQC practices")
            continue
        config = build_config(entry, counter)
        path = REGIONS_DIR / f"{rid}.json"
        path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        generated += 1
        print(f"{rid}: {sum(counter.values())} practices, {len(config['core_outward_codes'])} core outwards -> {path.name}")

        override_path = RESEARCH / config["overrides_file"]
        if not override_path.exists():
            override_path.write_text('{"practices": []}\n', encoding="utf-8")

    print(f"Generated/updated {generated} region configs")


if __name__ == "__main__":
    main()
