#!/usr/bin/env python3
"""Build London estate agents by searching specific high-density postcode areas."""

from __future__ import annotations

import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from estate_agents_lib import (
    search_companies_by_sic_and_postcode,
    norm_key,
    load_existing_data,
    write_csv,
    blast_fields,
    build_region,
    RegionConfig,
)

LONDON_AREAS = [
    # Central/West End - highest density
    "SW1", "W1", "WC1", "WC2", "EC1", "EC2", "EC3", "EC4",
    # North
    "N1", "N4", "N5", "N6", "N7", "N8", "N10", "N11", "N12", "N13", "N14", "N15", "N16",
    # East
    "E1", "E2", "E3", "E4", "E5", "E6", "E7", "E8", "E9", "E10", "E11", "E14", "E15", "E17",
    # South East
    "SE1", "SE3", "SE5", "SE8", "SE10", "SE11", "SE13", "SE15", "SE16", "SE18", "SE19", "SE22", "SE23", "SE24",
    # South West
    "SW3", "SW4", "SW5", "SW6", "SW7", "SW8", "SW10", "SW11", "SW12", "SW14", "SW15", "SW16", "SW17", "SW18", "SW19", "SW20",
    # West
    "W2", "W3", "W4", "W5", "W6", "W7", "W8", "W9", "W10", "W11", "W12", "W13", "W14",
    # North West
    "NW1", "NW2", "NW3", "NW4", "NW5", "NW6", "NW7", "NW8", "NW9", "NW10", "NW11",
]


def build_london():
    print("Building London estate agents via targeted postcode search...")
    print(f"Searching {len(LONDON_AREAS)} high-density London postcode areas\n")

    all_companies = []
    seen = set()

    for i, area in enumerate(LONDON_AREAS, 1):
        print(f"[{i}/{len(LONDON_AREAS)}] Searching {area}...")
        try:
            companies = search_companies_by_sic_and_postcode("68310", area)
            print(f"  {area}: Found {len(companies)} companies")
            
            for c in companies:
                cn = c.get("company_number")
                if cn and cn not in seen:
                    seen.add(cn)
                    all_companies.append(c)
        except Exception as e:
            print(f"  {area}: Error - {e}")
        
        if i % 5 == 0:
            time.sleep(3)  # Rate limit protection

    print(f"\nTotal unique London companies: {len(all_companies)}")

    if not all_companies:
        print("No companies found!")
        return

    # Build master list
    practices = {}
    for item in all_companies:
        cn = item.get("company_number", "")
        name = item.get("title", "").strip()
        addr = item.get("registered_office_address", {})
        address_parts = [
            addr.get("address_line_1", ""),
            addr.get("address_line_2", ""),
            addr.get("locality", ""),
            addr.get("region", ""),
            addr.get("postal_code", ""),
            addr.get("country", ""),
        ]
        address = ", ".join(p for p in address_parts if p)
        postcode = (addr.get("postal_code") or "").strip().upper()
        status = item.get("company_status", "")
        sic_codes = ", ".join(item.get("sic_codes", []))
        date_created = item.get("date_of_creation", "")

        key = norm_key(name) + postcode.replace(" ", "")
        practices[key] = {
            "company_name": name,
            "company_number": cn,
            "registered_office_address": address,
            "postcode": postcode,
            "phone": "",
            "website": "",
            "sic_codes": sic_codes,
            "company_status": status,
            "date_of_creation": date_created,
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
            "area": "",
            "source": "Companies House API",
            "notes": "",
        }

    # Load existing data to preserve any manual entries
    load_existing_data(practices, type('obj', (object,), {
        'master_csv': Path('/Users/luketurner/Desktop/Screenshots/wisecall-website/data/research/estate-agents/london-estate-marketing-list.csv'),
        'overrides_path': Path('/Users/luketurner/Desktop/Screenshots/wisecall-website/data/research/estate-agents/london-estate-manual-overrides.json'),
        'get_search_prefixes': lambda self: [],
    })())

    # Write master list
    all_rows = sorted(practices.values(), key=lambda c: (c["wisecall_tier"], c["postcode"], c["company_name"]))
    write_csv(Path('/Users/luketurner/Desktop/Screenshots/wisecall-website/data/research/estate-agents/london-estate-marketing-list.csv'), blast_fields(type('obj', (object,), {'core_outward_codes': ()})()), all_rows)
    print(f"Saved {len(all_rows)} companies to London master list")


if __name__ == "__main__":
    build_london()