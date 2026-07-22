#!/usr/bin/env python3
"""Build Essex estate agents marketing list from Rightmove directory.

Source: https://www.rightmove.co.uk/estate-agents/Essex.html
Parses embedded __NEXT_DATA__ JSON (925 branch listings -> ~450 unique branches).

Usage:
  python3 scripts/build-essex-estate-agents-rightmove.py
  python3 scripts/build-essex-estate-agents-rightmove.py --location Essex
"""

from __future__ import annotations

import argparse
import csv
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from estate_agents_lib import (  # noqa: E402
    ESTATE_DIR,
    blast_fields,
    load_region,
    match_corporate_group,
    write_csv,
)
from rightmove_estate_agents_lib import scrape_directory  # noqa: E402

REGION_ID = "essex"
OUT_RAW = ESTATE_DIR / "essex-rightmove-branches-raw.csv"


def branch_to_marketing_row(branch: dict, region_id: str) -> dict[str, str]:
    company_name = branch.get("company_name") or branch.get("branch_display_name") or ""
    email = ""
    emails = (branch.get("emails_found") or "").split("; ")
    for candidate in emails:
        if "@" in candidate:
            email = candidate.strip()
            break

    row = {
        "company_name": company_name,
        "company_number": "",
        "registered_office_address": branch.get("registered_office_address") or "",
        "postcode": (branch.get("postcode") or "").upper(),
        "phone": branch.get("phone") or "",
        "website": branch.get("website") or "",
        "email": email,
        "sic_codes": "68310",
        "company_status": "active",
        "date_of_creation": "",
        "director_names": "",
        "director_roles": "",
        "officer_count": "0",
        "crm_detected": "",
        "crm_confidence": "",
        "crm_evidence": "",
        "blast_segment": "Unknown CRM - manual check",
        "wisecall_tier": "Tier 3 - Unknown CRM (qualify on call)",
        "corporate_group": "No",
        "corporate_group_name": "",
        "area": branch.get("branch_town") or "Essex",
        "source": "Rightmove Essex directory",
        "notes": "; ".join(
            filter(
                None,
                [
                    f"branch_id:{branch.get('branch_id')}" if branch.get("branch_id") else "",
                    f"profile:{branch.get('profile_url')}" if branch.get("profile_url") else "",
                    f"sales:{branch.get('sales')}" if branch.get("sales") else "",
                    f"lettings:{branch.get('lettings')}" if branch.get("lettings") else "",
                    f"phones:{branch.get('phones_found')}" if branch.get("phones_found") else "",
                    f"emails:{branch.get('emails_found')}" if branch.get("emails_found") else "",
                ],
            )
        ),
        "branch_id": branch.get("branch_id") or "",
        "profile_url": branch.get("profile_url") or "",
        "rightmove_company_id": branch.get("rightmove_company_id") or "",
    }
    is_corp, group_name = match_corporate_group(row)
    if is_corp:
        row["corporate_group"] = "Yes"
        row["corporate_group_name"] = group_name
    return row


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Essex estate list from Rightmove")
    parser.add_argument("--location", default="Essex", help="Rightmove location slug (default: Essex)")
    parser.add_argument("--region", default=REGION_ID, help="Region config id")
    args = parser.parse_args()

    region = load_region(args.region)
    branches = scrape_directory(args.location)
    print(f"Unique branches: {len(branches)}")

    # Save raw branch scrape for debugging
    raw_fields = [
        "branch_id",
        "company_name",
        "branch_display_name",
        "branch_town",
        "postcode",
        "phone",
        "phones_found",
        "website",
        "emails_found",
        "sales",
        "lettings",
        "profile_url",
        "rightmove_company_id",
        "registered_office_address",
    ]
    write_csv(OUT_RAW, raw_fields, branches)

    rows = [branch_to_marketing_row(b, args.region) for b in branches if b.get("phone")]
    write_csv(region.master_csv, blast_fields(region) + ["email", "branch_id", "profile_url", "rightmove_company_id"], rows)

    with_phone = sum(1 for r in rows if r.get("phone"))
    with_email = sum(1 for r in rows if r.get("email"))
    with_web = sum(1 for r in rows if r.get("website"))
    corporate = sum(1 for r in rows if r.get("corporate_group") == "Yes")

    print("---")
    print(f"Wrote {len(rows)} rows -> {region.master_csv}")
    print(f"Raw branches -> {OUT_RAW}")
    print(f"With phone: {with_phone}")
    print(f"With email (from descriptions): {with_email}")
    print(f"With website (from descriptions): {with_web}")
    print(f"Corporate groups: {corporate}")


if __name__ == "__main__":
    main()
