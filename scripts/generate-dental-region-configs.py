#!/usr/bin/env python3
"""Generate data/research/regions/<id>.json from manifest + practice registers."""

from __future__ import annotations

import csv
import json
import re
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from dental_marketing_lib import (  # noqa: E402
    RegionConfig,
    ensure_dataset,
    load_practices,
    outward_code,
)

RESEARCH = ROOT / "data" / "research"
REGIONS_DIR = RESEARCH / "regions"
MANIFEST = REGIONS_DIR / "manifest.json"


def manifest_region_config(entry: dict) -> RegionConfig:
    prefix = entry["postcode_prefix"].lower()
    rid = entry["id"]
    return RegionConfig(
        id=rid,
        name=entry["name"],
        postcode_regex=entry["postcode_regex"],
        area_column="area",
        file_prefix=f"{rid}-{prefix}-dental",
        overrides_file=f"{rid}-dental-manual-overrides.json",
        core_outward_codes=(),
        core_segment_prefix=f"{rid}-core",
        area_labels={},
        data_source=entry.get("data_source", "cqc"),
        country=entry.get("country", "england"),
    )


def load_practice_counts() -> dict[str, Counter]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    sources = {entry.get("data_source", "cqc") for entry in manifest["regions"]}
    for source in sources:
        ensure_dataset(source)

    by_region: dict[str, Counter] = {}
    for entry in manifest["regions"]:
        region = manifest_region_config(entry)
        practices = load_practices(region)
        counter: Counter = Counter()
        for practice in practices.values():
            counter[outward_code(practice["postcode"])] += 1
        by_region[entry["id"]] = counter
    return by_region


def core_outwards(counter: Counter, limit: int = 12) -> list[str]:
    ranked = counter.most_common()
    if not ranked:
        return []
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
        "data_source": entry.get("data_source", "cqc"),
        "country": entry.get("country", "england"),
    }


def main() -> None:
    counts = load_practice_counts()
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    generated = 0
    for entry in manifest["regions"]:
        rid = entry["id"]
        counter = counts.get(rid, Counter())
        if not counter and entry.get("status") == "pending":
            print(f"skip {rid}: no practices in register")
            continue
        config = build_config(entry, counter)
        path = REGIONS_DIR / f"{rid}.json"
        path.write_text(json.dumps(config, indent=2) + "\n", encoding="utf-8")
        generated += 1
        print(
            f"{rid}: {sum(counter.values())} practices, "
            f"{len(config['core_outward_codes'])} core outwards -> {path.name}"
        )

        override_path = RESEARCH / config["overrides_file"]
        if not override_path.exists():
            override_path.write_text('{"practices": []}\n', encoding="utf-8")

    print(f"Generated/updated {generated} region configs")


if __name__ == "__main__":
    main()
