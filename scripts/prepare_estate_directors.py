#!/usr/bin/env python3
"""Extract director candidates from estate agents marketing list for FullEnrich enrichment."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ESTATE_DIR = ROOT / "data" / "research" / "estate-agents"
DEFAULT_REGION = "essex"


def marketing_csv_for_region(region_id: str) -> Path:
    configs_dir = ESTATE_DIR / "regions"
    cfg_path = configs_dir / f"{region_id}.json"
    if cfg_path.exists():
        data = json.loads(cfg_path.read_text(encoding="utf-8"))
        prefix = data.get("file_prefix") or f"{region_id}-estate"
        return ESTATE_DIR / f"{prefix}-marketing-list.csv"
    return ESTATE_DIR / f"{region_id}-estate-marketing-list.csv"


def norm_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def split_directors(director_str: str) -> list[dict[str, str]]:
    """Parse 'Name (director); Name (secretary)' into list of {name, role}."""
    directors = []
    for part in director_str.split(";"):
        part = part.strip()
        if not part:
            continue
        # Extract name before parenthesis
        match = re.match(r"^([^\(]+)\s*\(([^)]+)\)", part)
        if match:
            name = match.group(1).strip()
            role = match.group(2).strip()
        else:
            name = part
            role = "director"
        directors.append({"name": name, "role": role})
    return directors


def main() -> None:
    import sys

    region_id = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_REGION
    input_csv = marketing_csv_for_region(region_id)
    output_csv = ESTATE_DIR / f"{region_id}-director-candidates.csv"
    output_json = ESTATE_DIR / f"{region_id}-director-candidates.json"

    if not input_csv.exists():
        raise SystemExit(f"Input not found: {input_csv}. Run build script first.")

    rows: list[dict] = []
    with input_csv.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.DictReader(f)
        for row in reader:
            company_name = row.get("company_name", "").strip()
            postcode = row.get("postcode", "").strip()
            website = row.get("website", "").strip()
            director_names = row.get("director_names", "").strip()
            company_number = row.get("company_number", "").strip()
            blast_segment = row.get("blast_segment", "").strip()
            wisecall_tier = row.get("wisecall_tier", "").strip()
            corporate_group = row.get("corporate_group", "").strip()
            corporate_group_name = row.get("corporate_group_name", "").strip()
            area = row.get("area", "").strip()

            if not director_names:
                continue

            directors = split_directors(director_names)
            for i, d in enumerate(directors):
                # Only include directors (not secretaries)
                if "director" not in d["role"].lower():
                    continue
                rows.append({
                    "id": f"{norm_key(company_name)}-{postcode.replace(' ', '')}-{i}",
                    "company_name": company_name,
                    "company_number": company_number,
                    "postcode": postcode,
                    "area": area,
                    "website": website,
                    "director_name": d["name"],
                    "director_role": d["role"],
                    "director_names": director_names,
                    "blast_segment": blast_segment,
                    "wisecall_tier": wisecall_tier,
                    "corporate_group": corporate_group,
                    "corporate_group_name": corporate_group_name,
                    "source": "Companies House + CRM scan",
                })

    # Write CSV
    fields = [
        "id",
        "company_name",
        "company_number",
        "postcode",
        "area",
        "website",
        "director_name",
        "director_role",
        "director_names",
        "blast_segment",
        "wisecall_tier",
        "corporate_group",
        "corporate_group_name",
        "source",
    ]
    with output_csv.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    # Write JSON
    output_json.write_text(json.dumps(rows, indent=2), encoding="utf-8")

    print(f"Extracted {len(rows)} director candidates from {input_csv}")
    print(f"Wrote {output_csv} and {output_json}")


if __name__ == "__main__":
    main()