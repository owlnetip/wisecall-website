#!/usr/bin/env python3
"""Aggregate Dentally Tier 1 independent prospects into portal seed JSON."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "data" / "research"
OUT = ROOT / "apps" / "portal" / "src" / "data" / "dental-prospects-seed.json"


def region_from_prefix(prefix: str) -> str:
    mapping = {
        "york-yo": "york",
        "leeds-ls": "leeds",
        "harrogate-hg": "harrogate",
        "bradford-bd": "bradford",
        "hull-hu": "hull",
        "sheffield-s": "sheffield",
    }
    if prefix in mapping:
        return mapping[prefix]
    # file_prefix form e.g. leeds-ls-dental -> leeds
    for key, val in mapping.items():
        if prefix.startswith(key.split("-")[0]):
            return val
    return prefix.split("-")[0] if "-" in prefix else prefix


def load_prospects() -> list[dict[str, str]]:
    prospects: list[dict[str, str]] = []
    seen: set[str] = set()

    for path in sorted(RESEARCH.glob("*-dentally-tier1-independents-outbound.csv")):
        stem = path.name.replace("-dentally-tier1-independents-outbound.csv", "")
        region = region_from_prefix(stem)
        area_col = "yo_area" if region == "york" else "ls_area" if region == "leeds" else "area"

        with path.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                name = (row.get("name") or row.get("company") or "").strip()
                postcode = (row.get("postcode") or "").strip().upper()
                if not name:
                    continue
                key = re.sub(r"[^a-z0-9]", "", name.lower()) + postcode.replace(" ", "")
                if key in seen:
                    continue
                seen.add(key)
                prospects.append(
                    {
                        "practice_name": name,
                        "contact_name": "",
                        "email": (row.get("email") or "").strip(),
                        "phone": (row.get("phone") or "").strip(),
                        "postcode": postcode,
                        "region": region,
                        "area": (row.get(area_col) or row.get("area") or "").strip(),
                        "pms": (row.get("pms") or "Dentally").strip(),
                        "tier": (row.get("tier") or "").strip(),
                        "website": (row.get("website") or "").strip(),
                        "notes": (row.get("notes") or "").strip(),
                    }
                )
    return prospects


def main() -> None:
    prospects = load_prospects()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"prospects": prospects, "generated_from": "tier1-independents-outbound.csv"}, indent=2), encoding="utf-8")
    by_region: dict[str, int] = {}
    for p in prospects:
        by_region[p["region"]] = by_region.get(p["region"], 0) + 1
    print(f"Wrote {len(prospects)} prospects -> {OUT}")
    print("By region:", by_region)


if __name__ == "__main__":
    main()
