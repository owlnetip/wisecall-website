#!/usr/bin/env python3
"""Aggregate solicitor/conveyancing prospects into portal seed JSON for CRM import.

Manchester pilot first (conveyancing scrape). Segments:
  law_ready            — has email and can be emailed
  law_unknown          — no email yet, needs enrichment before outreach
  law_corporate_hold   — corporate/national chains (stored, low priority)

Usage:
  python3 scripts/sync-law-prospects-seed.py
  python3 scripts/sync-law-prospects-seed.py --region manchester
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "data" / "research" / "law-firms"
OUT = ROOT / "apps/portal" / "src" / "data" / "law-prospects-seed.json"


def prospect_key(name: str, postcode: str, region: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower()) + postcode.upper().replace(" ", "") + region


def classify_segment(email: str) -> str:
    return "law_ready" if email.strip() else "law_unknown"


def prospect_from_row(row: dict[str, str], region: str) -> dict[str, str]:
    name = (row.get("company_name") or row.get("firm_name") or "").strip()
    email = (row.get("email") or "").strip()
    first_name = (row.get("first_name") or "").strip()
    areas = (row.get("areas_of_law") or "").strip()

    return {
        "practice_name": name,
        "company_name": name,
        "contact_name": first_name,
        "email": email,
        "phone": (row.get("phone") or "").strip(),
        "postcode": (row.get("postcode") or "").strip().upper(),
        "region": region,
        "area": (row.get("city") or "").strip(),
        "pms": (row.get("crm_system") or "").strip() or "Unknown",
        "crm": (row.get("crm_system") or "").strip() or "your case management system",
        "tier": "",
        "website": (row.get("website") or "").strip(),
        "notes": f"Areas of law: {areas}" if areas else "",
        "outreach_segment": classify_segment(email),
        "vertical": "law",
        "areas_of_law": areas,
        "lead_score": (row.get("lead_score") or "").strip(),
        "source": "Solicitor scrape (conveyancing)",
    }


def load_prospects(regions: set[str] | None) -> list[dict[str, str]]:
    prospects: list[dict[str, str]] = []
    seen: set[str] = set()

    for path in sorted(RESEARCH.glob("*-marketing-list.csv")):
        stem = path.name.replace("-conveyancing-marketing-list.csv", "").replace("-marketing-list.csv", "")
        region = stem
        if regions is not None and region not in regions:
            continue

        with path.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                name = (row.get("company_name") or "").strip()
                if not name:
                    continue
                postcode = (row.get("postcode") or "").strip().upper()
                key = prospect_key(name, postcode, region)
                if key in seen:
                    continue
                seen.add(key)
                prospects.append(prospect_from_row(row, region))

    return sorted(
        prospects,
        key=lambda p: (p["outreach_segment"], p["region"], p["practice_name"]),
    )


def main() -> None:
    parser = argparse.ArgumentParser(description="Sync law/conveyancing prospects seed JSON")
    parser.add_argument(
        "--region",
        action="append",
        dest="regions",
        help="Region id to include (repeatable). Default: all",
    )
    args = parser.parse_args()

    regions = set(args.regions) if args.regions else None

    prospects = load_prospects(regions)
    OUT.parent.mkdir(parents=True, exist_ok=True)

    by_segment: dict[str, int] = {}
    by_region: dict[str, int] = {}
    for p in prospects:
        by_segment[p["outreach_segment"]] = by_segment.get(p["outreach_segment"], 0) + 1
        by_region[p["region"]] = by_region.get(p["region"], 0) + 1

    generated_from = ",".join(sorted(regions)) if regions else "*-marketing-list.csv"

    OUT.write_text(
        json.dumps(
            {
                "prospects": prospects,
                "vertical": "law",
                "generated_from": generated_from,
                "counts": {"by_segment": by_segment, "by_region": by_region},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {len(prospects)} law prospects -> {OUT}")
    print("By segment:", by_segment)
    print("By region:", by_region)


if __name__ == "__main__":
    main()
