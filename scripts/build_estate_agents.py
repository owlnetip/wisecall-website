#!/usr/bin/env python3
"""Build estate agents marketing lists for UK postcode regions using Companies House."""

from __future__ import annotations

import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from estate_agents_lib import build_region  # type: ignore


def main() -> None:
    if len(sys.argv) < 2:
        print("Usage: python build_estate_agents.py <region_id> [--skip-officers] [--skip-website-scan]")
        print("\nAvailable regions:")
        regions_dir = ROOT / "data" / "research" / "estate-agents" / "regions"
        for p in sorted(regions_dir.glob("*.json")):
            print(f"  {p.stem}")
        sys.exit(1)

    region_id = sys.argv[1]
    skip_officers = "--skip-officers" in sys.argv
    skip_scan = "--skip-website-scan" in sys.argv
    build_region(region_id, skip_officers=skip_officers, skip_scan=skip_scan)


if __name__ == "__main__":
    main()