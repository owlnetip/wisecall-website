#!/usr/bin/env python3
"""Append all remaining UK (CQC England) postcode areas to regions/manifest.json."""

from __future__ import annotations

import csv
import json
import re
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "data" / "research"
REGIONS_DIR = RESEARCH / "regions"
MANIFEST = REGIONS_DIR / "manifest.json"
CQC_CSV = RESEARCH / "01_July_2026_CQC_directory.csv"

# Human-readable names for postcode areas
PREFIX_META: dict[str, tuple[str, str, int]] = {
    # id, name, phase
    "W": ("london-west", "West London", 5),
    "SW": ("london-south-west", "South West London", 5),
    "SE": ("london-south-east", "South East London", 5),
    "NW": ("london-north-west", "North West London", 5),
    "N": ("london-north", "North London", 5),
    "E": ("london-east", "East London", 5),
    "EC": ("london-city", "City of London", 5),
    "WC": ("london-west-end", "West End London", 5),
    "BR": ("bromley", "Bromley", 5),
    "CR": ("croydon", "Croydon", 5),
    "DA": ("dartford", "Dartford & Gravesend", 5),
    "EN": ("enfield", "Enfield", 5),
    "HA": ("harrow", "Harrow & Uxbridge", 5),
    "IG": ("ilford", "Ilford & Romford", 5),
    "KT": ("kingston", "Kingston & Surrey", 5),
    "RM": ("romford", "Romford & Essex east", 5),
    "SM": ("sutton", "Sutton & Morden", 5),
    "TW": ("twickenham", "Twickenham & Heathrow", 5),
    "UB": ("southall", "Southall & Ealing west", 5),
    "WD": ("watford", "Watford & Hertfordshire south", 5),
    "AL": ("st-albans", "St Albans & Hatfield", 5),
    "LU": ("luton", "Luton & Dunstable", 5),
    "HP": ("hemel-hempstead", "Hemel Hempstead & Amersham", 5),
    "SL": ("slough", "Slough & Windsor", 5),
    "RG": ("reading", "Reading & Berkshire", 5),
    "MK": ("milton-keynes", "Milton Keynes & Bedford", 5),
    "BN": ("brighton", "Brighton & Hove", 6),
    "TN": ("tunbridge-wells", "Tunbridge Wells & Kent", 6),
    "GU": ("guildford", "Guildford & Woking", 6),
    "RH": ("redhill", "Redhill & Crawley", 6),
    "PO": ("portsmouth", "Portsmouth & Hampshire south", 6),
    "SO": ("southampton", "Southampton & Eastleigh", 6),
    "BH": ("bournemouth", "Bournemouth & Poole", 6),
    "DT": ("dorchester", "Dorchester & Weymouth", 6),
    "EX": ("exeter", "Exeter & Devon", 6),
    "PL": ("plymouth", "Plymouth & Cornwall east", 6),
    "TQ": ("torquay", "Torquay & South Devon", 6),
    "TR": ("truro", "Truro & Cornwall", 6),
    "BA": ("bath", "Bath & Somerset", 6),
    "BS": ("bristol", "Bristol", 6),
    "GL": ("gloucester", "Gloucester & Cheltenham", 6),
    "TA": ("taunton", "Taunton & Somerset west", 6),
    "SN": ("swindon", "Swindon & Wiltshire", 6),
    "SP": ("salisbury", "Salisbury & Wiltshire south", 6),
    "CM": ("chelmsford", "Chelmsford & Essex", 7),
    "CO": ("colchester", "Colchester & Clacton", 7),
    "IP": ("ipswich", "Ipswich & Suffolk", 7),
    "NR": ("norwich", "Norwich & Norfolk", 7),
    "PE": ("peterborough", "Peterborough & Cambridgeshire", 7),
    "CB": ("cambridge", "Cambridge & Ely", 7),
    "SG": ("stevenage", "Stevenage & Hertfordshire north", 7),
    "SS": ("southend", "Southend & Basildon", 7),
    "ME": ("medway", "Medway & Kent north", 7),
    "CT": ("canterbury", "Canterbury & Kent east", 7),
    "OX": ("oxford", "Oxford & Banbury", 7),
    "NN": ("northampton", "Northampton & Kettering", 8),
    "DY": ("dudley", "Dudley & Black Country", 8),
    "WS": ("walsall", "Walsall & Cannock", 8),
    "WV": ("wolverhampton", "Wolverhampton", 8),
    "WR": ("worcester", "Worcester & Herefordshire", 8),
    "HR": ("hereford", "Hereford & Leominster", 8),
    "TF": ("telford", "Telford & Shrewsbury east", 8),
    "CW": ("crewe", "Crewe & Nantwich", 8),
    "SY": ("shrewsbury", "Shrewsbury & Mid Wales border", 8),
    "TD": ("galashiels", "Scottish Borders (TD)", 9),
    "NP": ("newport-wales", "Newport area (NP)", 9),
}


def outward(postcode: str) -> str:
    pc = postcode.upper().replace(" ", "")
    return pc[:-3] if len(pc) >= 5 else ""


def prefix_of(postcode: str) -> str:
    ow = outward(postcode)
    m = re.match(r"^([A-Z]{1,2})", ow or postcode.upper().replace(" ", ""))
    return m.group(1) if m else "??"


def load_existing_ids() -> set[str]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    return {r["id"] for r in manifest["regions"]}


def load_existing_regexes() -> list[re.Pattern[str]]:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    return [re.compile(r["postcode_regex"]) for r in manifest["regions"]]


def unmatched_prefix_counts() -> Counter:
    regexes = load_existing_regexes()
    counts: Counter = Counter()
    with CQC_CSV.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for _ in range(4):
            next(reader)
        header = next(reader)
        idx = {h: i for i, h in enumerate(header)}
        for row in reader:
            service = row[idx["Service types"]]
            if "Dentist" not in service and "Orthodont" not in service:
                continue
            pc = row[idx["Postcode"]].strip().upper().replace(" ", "")
            if any(rx.match(pc) for rx in regexes):
                continue
            counts[prefix_of(row[idx["Postcode"]].strip())] += 1
    return counts


def make_entry(prefix: str, count: int, existing_ids: set[str]) -> dict:
    if prefix in PREFIX_META:
        rid, name, phase = PREFIX_META[prefix]
    else:
        rid = prefix.lower().replace(" ", "-")
        name = f"{prefix} postcode area"
        phase = 9
    if rid in existing_ids:
        rid = f"{rid}-{prefix.lower()}"
    regex = f"^{re.escape(prefix)}\\d"
    return {
        "id": rid,
        "name": name,
        "postcode_regex": regex,
        "postcode_prefix": prefix,
        "phase": phase,
        "status": "pending",
        "cqc_practices": count,
    }


def main() -> None:
    manifest = json.loads(MANIFEST.read_text(encoding="utf-8"))
    existing_ids = {r["id"] for r in manifest["regions"]}
    unmatched = unmatched_prefix_counts()
    added = 0
    for prefix, count in sorted(unmatched.items(), key=lambda x: (-x[1], x[0])):
        if count <= 0 or prefix == "??":
            continue
        entry = make_entry(prefix, count, existing_ids)
        manifest["regions"].append(entry)
        existing_ids.add(entry["id"])
        added += 1
        print(f"+ {entry['id']:22} {prefix:4} {count:4} practices (phase {entry['phase']})")

    MANIFEST.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    print(f"\nAdded {added} regions. Total: {len(manifest['regions'])}")


if __name__ == "__main__":
    main()
