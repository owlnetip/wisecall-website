#!/usr/bin/env python3
"""Build dental marketing lists for configured UK postcode regions.

Sources:
  - CQC public directory CSV (downloaded on first run)
  - Practice website scanning for Dentally / Exact-SOE fingerprints
  - Manual overrides in data/research/<region>-dental-manual-overrides.json
  - ADG corporate + BDA Good Practice flags

Usage:
  python3 scripts/build-dental-marketing-list.py --region leeds
  python3 scripts/build-dental-marketing-list.py --region york
  python3 scripts/build-dental-marketing-list.py --region leeds --skip-website-scan
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from dental_marketing_lib import REGIONS_DIR, build_region


def main() -> None:
    available = sorted(p.stem for p in REGIONS_DIR.glob("*.json"))
    parser = argparse.ArgumentParser(description="Build dental marketing lists by region")
    parser.add_argument(
        "--region",
        required=True,
        choices=available,
        help=f"Region to build ({', '.join(available)})",
    )
    parser.add_argument(
        "--skip-website-scan",
        action="store_true",
        help="Reuse PMS columns from existing master CSV instead of scanning websites",
    )
    args = parser.parse_args()
    build_region(args.region, skip_scan=args.skip_website_scan)


if __name__ == "__main__":
    main()
