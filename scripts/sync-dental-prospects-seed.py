#!/usr/bin/env python3
"""Aggregate dental prospects into portal seed JSON for CRM import.

Segments:
  dentally_active  — Tier 1 independents on Dentally (email now)
  exact_queued     — Exact/SOE confirmed, non-ADG (hold until Exact integration)
  unknown_queued   — Unknown PMS, non-ADG with phone (qualify / future)
  corporate_hold   — ADG corporate (stored, low priority)
"""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "data" / "research"
OUT = ROOT / "apps" / "portal" / "src" / "data" / "dental-prospects-seed.json"
REGIONS_DIR = RESEARCH / "regions"


def load_region_map() -> dict[str, str]:
    mapping: dict[str, str] = {}
    for path in sorted(REGIONS_DIR.glob("*.json")):
        if path.name == "manifest.json":
            continue
        data = json.loads(path.read_text(encoding="utf-8"))
        mapping[data["file_prefix"]] = data["id"]
    return mapping


def region_from_stem(stem: str) -> str:
    region_map = load_region_map()
    if stem in region_map:
        return region_map[stem]
    for prefix, val in region_map.items():
        if stem.startswith(prefix):
            return val
    return stem.split("-")[0] if "-" in stem else stem


def area_column(region: str) -> str:
    if region == "york":
        return "yo_area"
    if region == "leeds":
        return "ls_area"
    return "area"


def classify_segment(row: dict[str, str]) -> str | None:
    adg = (row.get("adg_corporate") or "").strip().lower()
    if adg == "yes":
        return "corporate_hold"

    tier = (row.get("wisecall_tier") or row.get("tier") or "").strip()
    blast = (row.get("blast_segment") or row.get("segment") or "").strip()
    pms = (row.get("pms_detected") or row.get("pms") or "").strip()

    if tier.startswith("Tier 1") or blast in ("Dentally confirmed", "Dentally likely"):
        if "Dentally" in pms or "Dentally" in blast:
            return "dentally_active"
    if blast == "Exact/SOE confirmed" or "Exact/SOE" in pms:
        return "exact_queued"
    if blast == "Unknown PMS - manual check" or tier.startswith("Tier 3"):
        phone = (row.get("phone") or "").strip()
        if phone:
            return "unknown_queued"
    return None


def prospect_from_row(row: dict[str, str], region: str, area_col: str, segment: str) -> dict[str, str]:
    name = (row.get("practice_name") or row.get("name") or row.get("company") or "").strip()
    return {
        "practice_name": name,
        "contact_name": "",
        "email": (row.get("email") or "").strip(),
        "phone": (row.get("phone") or "").strip(),
        "postcode": (row.get("postcode") or "").strip().upper(),
        "region": region,
        "area": (row.get(area_col) or row.get("area") or "").strip(),
        "pms": (row.get("pms_detected") or row.get("pms") or "").strip() or "Unknown",
        "tier": (row.get("wisecall_tier") or row.get("tier") or "").strip(),
        "website": (row.get("website") or "").strip(),
        "notes": (row.get("notes") or "").strip(),
        "outreach_segment": segment,
        "blast_segment": (row.get("blast_segment") or row.get("segment") or "").strip(),
    }


def load_all_prospects() -> list[dict[str, str]]:
    prospects: list[dict[str, str]] = []
    seen: set[str] = set()

    for path in sorted(RESEARCH.glob("*-marketing-list.csv")):
        stem = path.name.replace("-marketing-list.csv", "")
        region = region_from_stem(stem)
        area_col = area_column(region)

        with path.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                segment = classify_segment(row)
                if not segment:
                    continue
                name = (row.get("practice_name") or "").strip()
                postcode = (row.get("postcode") or "").strip().upper()
                if not name:
                    continue
                key = re.sub(r"[^a-z0-9]", "", name.lower()) + postcode.replace(" ", "") + region
                if key in seen:
                    continue
                seen.add(key)
                prospects.append(prospect_from_row(row, region, area_col, segment))

    return sorted(prospects, key=lambda p: (p["outreach_segment"], p["region"], p["practice_name"]))


def main() -> None:
    prospects = load_all_prospects()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    by_segment: dict[str, int] = {}
    by_region: dict[str, int] = {}
    for p in prospects:
        by_segment[p["outreach_segment"]] = by_segment.get(p["outreach_segment"], 0) + 1
        by_region[p["region"]] = by_region.get(p["region"], 0) + 1

    OUT.write_text(
        json.dumps(
            {
                "prospects": prospects,
                "generated_from": "*-marketing-list.csv",
                "counts": {"by_segment": by_segment, "by_region": by_region},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {len(prospects)} prospects -> {OUT}")
    print("By segment:", by_segment)
    print("By region:", by_region)


if __name__ == "__main__":
    main()
