#!/usr/bin/env python3
"""Add Scotland, Wales and Northern Ireland regions to regions/manifest.json."""

from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
MANIFEST = ROOT / "data" / "research" / "regions" / "manifest.json"

SCOTLAND_REGIONS: list[tuple[str, str, str]] = [
    ("glasgow", "Glasgow", "G"),
    ("edinburgh", "Edinburgh & Lothians", "EH"),
    ("aberdeen", "Aberdeen & Grampian", "AB"),
    ("ayrshire", "Ayrshire", "KA"),
    ("lanarkshire", "Lanarkshire", "ML"),
    ("paisley", "Paisley & Renfrewshire", "PA"),
    ("fife", "Fife", "KY"),
    ("dundee", "Dundee & Angus", "DD"),
    ("stirling", "Stirling & Falkirk", "FK"),
    ("inverness", "Inverness & Highlands", "IV"),
    ("dumfries", "Dumfries & Galloway", "DG"),
    ("perth", "Perth & Kinross", "PH"),
    ("scotland-borders", "Scottish Borders", "TD"),
    ("caithness", "Orkney & Caithness", "KW"),
    ("outer-hebrides", "Outer Hebrides", "HS"),
    ("shetland", "Shetland", "ZE"),
]

WALES_REGIONS: list[tuple[str, str, str]] = [
    ("wales-cardiff", "Cardiff & Valleys", "CF"),
    ("wales-swansea", "Swansea & West Wales", "SA"),
    ("wales-north", "North Wales", "LL"),
    ("wales-gwent", "Gwent & Newport", "NP"),
    ("wales-mid", "Mid Wales", "LD"),
    ("wales-border", "Powys border (SY)", "SY"),
]

NI_REGIONS: list[tuple[str, str, str]] = [
    ("northern-ireland", "Northern Ireland", "BT"),
]

# Replace the tiny CQC edge-case region with full Wales HIW coverage.
MANIFEST_UPDATES: dict[str, dict] = {
    "newport-wales": {
        "id": "wales-gwent",
        "name": "Gwent & Newport",
        "postcode_prefix": "NP",
        "postcode_regex": "^NP\\d",
        "phase": 11,
        "country": "wales",
        "data_source": "wales_hiw",
        "status": "pending",
    },
}


def make_entry(
    rid: str,
    name: str,
    prefix: str,
    *,
    phase: int,
    country: str,
    data_source: str,
) -> dict:
    return {
        "id": rid,
        "name": name,
        "postcode_regex": f"^{prefix}\\d",
        "postcode_prefix": prefix,
        "phase": phase,
        "country": country,
        "data_source": data_source,
        "status": "pending",
    }


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    existing = {r["id"] for r in manifest["regions"]}
    added = 0
    updated = 0

    for i, entry in enumerate(manifest["regions"]):
        if entry["id"] not in MANIFEST_UPDATES:
            continue
        new = MANIFEST_UPDATES[entry["id"]]
        manifest["regions"][i] = {**entry, **new}
        if new["id"] != entry["id"]:
            existing.discard(entry["id"])
            existing.add(new["id"])
        updated += 1
        print(f"~ {entry['id']} -> {new['id']} ({new['data_source']})")

    for rid, name, prefix in SCOTLAND_REGIONS:
        if rid in existing:
            continue
        manifest["regions"].append(
            make_entry(rid, name, prefix, phase=10, country="scotland", data_source="scotland_nhs")
        )
        existing.add(rid)
        added += 1
        print(f"+ {rid:20} {prefix:4} phase 10 (scotland_nhs)")

    for rid, name, prefix in WALES_REGIONS:
        if rid in existing:
            continue
        manifest["regions"].append(
            make_entry(rid, name, prefix, phase=11, country="wales", data_source="wales_hiw")
        )
        existing.add(rid)
        added += 1
        print(f"+ {rid:20} {prefix:4} phase 11 (wales_hiw)")

    for rid, name, prefix in NI_REGIONS:
        if rid in existing:
            continue
        manifest["regions"].append(
            make_entry(rid, name, prefix, phase=12, country="northern_ireland", data_source="ni_bso")
        )
        existing.add(rid)
        added += 1
        print(f"+ {rid:20} {prefix:4} phase 12 (ni_bso)")

    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"\nAdded {added}, updated {updated}. Total regions: {len(manifest['regions'])}")


if __name__ == "__main__":
    main()
