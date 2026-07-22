#!/usr/bin/env python3
"""Extract director candidates from all estate agents marketing lists for FullEnrich enrichment."""

from __future__ import annotations

import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ESTATE_DIR = ROOT / "data" / "research" / "estate-agents"
OUTPUT_CSV = ESTATE_DIR / "estate-director-candidates.csv"
OUTPUT_JSON = ESTATE_DIR / "estate-director-candidates.json"


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
    marketing_files = sorted(ESTATE_DIR.glob("*estate-marketing-list.csv"))
    if not marketing_files:
        raise SystemExit(f"No marketing lists found in {ESTATE_DIR}. Run build_estate_agents.py first.")

    rows: list[dict] = []
    for input_csv in marketing_files:
        print(f"Reading {input_csv.name}...")
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
    with OUTPUT_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    # Write JSON
    OUTPUT_JSON.write_text(json.dumps(rows, indent=2), encoding="utf-8")

    print(f"Extracted {len(rows)} director candidates from {len(marketing_files)} regions")
    print(f"Wrote {OUTPUT_CSV} and {OUTPUT_JSON}")


if __name__ == "__main__":
    main()