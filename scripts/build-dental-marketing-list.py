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

from dental_marketing_lib import RESEARCH, REGIONS_DIR, build_region


def main() -> None:
    available = sorted(p.stem for p in REGIONS_DIR.glob("*.json") if p.stem != "manifest")
    parser = argparse.ArgumentParser(description="Build dental marketing lists by region")
    parser.add_argument(
        "--region",
        choices=available,
        help=f"Single region to build ({', '.join(available)})",
    )
    parser.add_argument(
        "--all",
        action="store_true",
        help="Build every region config (skips website scan if master CSV exists unless --scan)",
    )
    parser.add_argument(
        "--phase",
        type=int,
        help="Build all regions in manifest with this phase number",
    )
    parser.add_argument(
        "--skip-website-scan",
        action="store_true",
        help="Reuse PMS columns from existing master CSV instead of scanning websites",
    )
    args = parser.parse_args()

    if args.all or args.phase:
        import json

        manifest_path = REGIONS_DIR / "manifest.json"
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
        ids = [r["id"] for r in manifest["regions"]]
        if args.phase:
            ids = [r["id"] for r in manifest["regions"] if r.get("phase") == args.phase]
        skip = args.skip_website_scan
        for i, rid in enumerate(ids, start=1):
            if rid not in available:
                print(f"[{i}/{len(ids)}] skip {rid}: no config")
                continue
            cfg = json.loads((REGIONS_DIR / f"{rid}.json").read_text(encoding="utf-8"))
            master = RESEARCH / f"{cfg['file_prefix']}-marketing-list.csv"
            use_skip = skip or master.exists()
            print(f"[{i}/{len(ids)}] === {rid} === (skip_scan={use_skip})")
            build_region(rid, skip_scan=use_skip)
        return

    if not args.region:
        parser.error("Specify --region <id>, --all, or --phase N")

    build_region(args.region, skip_scan=args.skip_website_scan)


if __name__ == "__main__":
    main()
