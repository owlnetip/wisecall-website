#!/usr/bin/env python3
"""Print region build status from manifest + marketing list CSVs."""

from __future__ import annotations

import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "data" / "research"
REGIONS_DIR = RESEARCH / "regions"
MANIFEST = REGIONS_DIR / "manifest.json"


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    print(f"{'Phase':>5}  {'Region':<14} {'Practices':>9}  {'Dentally T1':>11}  {'Status':<8}  Master CSV")
    print("-" * 90)
    total = dentally = 0
    for entry in manifest["regions"]:
        rid = entry["id"]
        cfg_path = REGIONS_DIR / f"{rid}.json"
        if not cfg_path.exists():
            print(f"{entry.get('phase', '?'):>5}  {rid:<14} {'—':>9}  {'—':>11}  {'no cfg':<8}")
            continue
        cfg = json.loads(cfg_path.read_text(encoding="utf-8"))
        master = RESEARCH / f"{cfg['file_prefix']}-marketing-list.csv"
        tier1 = RESEARCH / f"{cfg['file_prefix']}-dentally-tier1-independents-outbound.csv"
        if master.exists():
            with master.open(newline="", encoding="utf-8") as f:
                n = sum(1 for _ in csv.DictReader(f))
            t1 = 0
            if tier1.exists():
                with tier1.open(newline="", encoding="utf-8") as f:
                    t1 = sum(1 for _ in csv.DictReader(f))
            status = "built"
            total += n
            dentally += t1
        else:
            n = t1 = 0
            status = "pending"
        print(
            f"{entry.get('phase', '?'):>5}  {entry['name']:<14} {n:>9}  {t1:>11}  {status:<8}  {master.name if master.exists() else '—'}"
        )
    print("-" * 90)
    print(f"Total practices: {total} | Tier 1 Dentally independents: {dentally}")


if __name__ == "__main__":
    main()
