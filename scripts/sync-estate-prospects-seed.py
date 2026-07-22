#!/usr/bin/env python3
"""Aggregate estate-agent prospects into portal seed JSON for CRM import.

Birmingham-first by default. Segments:
  property_ready            — has email (or known CRM) and can be emailed
  property_unknown          — active independents awaiting website/email/CRM
  property_corporate_hold   — corporate groups (stored, low priority)

Usage:
  python3 scripts/sync-estate-prospects-seed.py
  python3 scripts/sync-estate-prospects-seed.py --region birmingham
  python3 scripts/sync-estate-prospects-seed.py --all-regions
"""

from __future__ import annotations

import argparse
import csv
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "data" / "research" / "estate-agents"
REGIONS_DIR = RESEARCH / "regions"
OUT = ROOT / "apps/portal" / "src" / "data" / "estate-prospects-seed.json"

ACTIVE_STATUSES = {"active"}
CRM_READY = {
    "street": "Street",
    "reapit": "Reapit",
    "alto": "Alto",
    "jupix": "Jupix",
    "fixflo": "Fixflo",
    "mri": "MRI",
    "agentos": "AgentOS",
}


def load_region_configs() -> dict[str, dict]:
    configs: dict[str, dict] = {}
    for path in sorted(REGIONS_DIR.glob("*.json")):
        data = json.loads(path.read_text(encoding="utf-8"))
        prefix = str(data.get("file_prefix") or "").strip()
        region_id = str(data.get("id") or "").strip()
        if prefix and region_id:
            configs[prefix] = data
            configs[region_id] = data
    return configs


def region_from_stem(stem: str, region_configs: dict[str, dict]) -> str:
    if stem in region_configs:
        return str(region_configs[stem].get("id") or stem)
    for prefix, data in region_configs.items():
        if stem.startswith(prefix) and data.get("file_prefix") == prefix:
            return str(data.get("id") or prefix)
    return stem.split("-")[0] if "-" in stem else stem


def postcode_matches_region(postcode: str, region_cfg: dict | None) -> bool:
    if not region_cfg:
        return True
    compact = (postcode or "").upper().replace(" ", "")
    if not compact:
        return False
    pattern = str(region_cfg.get("postcode_regex") or "").strip()
    if pattern:
        return bool(re.match(pattern, compact))
    prefixes = region_cfg.get("postcode_prefixes") or []
    if prefixes:
        return any(compact.startswith(str(p).upper()) for p in prefixes)
    return True


def prospect_key(name: str, postcode: str, region: str) -> str:
    return re.sub(r"[^a-z0-9]", "", name.lower()) + postcode.upper().replace(" ", "") + region


def first_director(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return ""
    # Common separators in CH exports
    for sep in ("|", ";", "\n"):
        if sep in text:
            return text.split(sep)[0].strip()
    if "," in text and text.count(",") >= 1:
        # "SMITH, John" style — keep as-is; multi-director "A, B" take first token pair
        parts = [p.strip() for p in text.split(",") if p.strip()]
        if len(parts) >= 2 and parts[0].isupper() and not parts[1].isupper():
            return f"{parts[1]} {parts[0]}".strip()
        return parts[0]
    return text


def normalize_crm(raw: str) -> str:
    text = (raw or "").strip()
    if not text:
        return ""
    lower = text.lower()
    for key, label in CRM_READY.items():
        if key in lower:
            return label
    return text


def classify_segment(row: dict[str, str]) -> str | None:
    status = (row.get("company_status") or "").strip().lower()
    if status not in ACTIVE_STATUSES:
        return None

    corporate = (row.get("corporate_group") or "").strip().lower()
    if corporate == "yes":
        return "property_corporate_hold"

    email = (row.get("email") or row.get("owner_email") or "").strip()
    crm = normalize_crm(row.get("crm_detected") or "")
    if email or crm:
        return "property_ready"
    return "property_unknown"


def enrichment_path(region_id: str) -> Path:
    return RESEARCH / f"{region_id}-estate-enrichment.csv"


def load_region_enrichment(region_id: str) -> dict[str, dict[str, str]]:
    path = enrichment_path(region_id)
    if not path.exists():
        return {}
    out: dict[str, dict[str, str]] = {}
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            branch_id = (row.get("branch_id") or "").strip()
            number = (row.get("company_number") or "").strip()
            if branch_id:
                out[f"branch:{branch_id}"] = row
            if number:
                out[f"number:{number}"] = row
    return out


def find_enrichment(row: dict[str, str], region: str, enrichment: dict[str, dict[str, str]]) -> dict[str, str] | None:
    branch_id = (row.get("branch_id") or "").strip()
    number = (row.get("company_number") or "").strip()
    if branch_id and f"branch:{branch_id}" in enrichment:
        return enrichment[f"branch:{branch_id}"]
    if number and f"number:{number}" in enrichment:
        return enrichment[f"number:{number}"]
    return None


def apply_enrichment(row: dict[str, str], enrichment: dict[str, str] | None) -> dict[str, str]:
    if not enrichment:
        return row
    merged = dict(row)
    for field in (
        "website",
        "phone",
        "email",
        "contact_name",
        "director_names",
        "crm_detected",
        "blast_segment",
        "wisecall_tier",
    ):
        val = (enrichment.get(field) or "").strip()
        if val:
            merged[field] = val
    # Prefer first director as contact when enrichment has one
    contact = (enrichment.get("contact_name") or "").strip()
    if contact:
        merged["contact_name"] = contact
    return merged


def prospect_from_row(row: dict[str, str], region: str) -> dict[str, str]:
    name = (row.get("company_name") or row.get("practice_name") or "").strip()
    crm = normalize_crm(row.get("crm_detected") or "")
    director = first_director(row.get("director_names") or "")
    email = (row.get("email") or row.get("owner_email") or "").strip()
    # notes may carry email:x@y from older enrichment writes
    if not email:
        notes = row.get("notes") or ""
        m = re.search(r"email:([^\s;]+)", notes, flags=re.I)
        if m:
            email = m.group(1).strip()
    contact = (row.get("contact_name") or director).strip()
    segment = classify_segment({**row, "email": email, "owner_email": email}) or "property_unknown"

    return {
        "practice_name": name,
        "company_name": name,
        "contact_name": contact,
        "email": email,
        "phone": (row.get("phone") or "").strip(),
        "postcode": (row.get("postcode") or "").strip().upper(),
        "region": region,
        "area": (row.get("area") or "").strip(),
        "pms": crm or "Unknown",
        "crm": crm or "your agency CRM",
        "tier": (row.get("wisecall_tier") or "").strip(),
        "website": (row.get("website") or "").strip(),
        "notes": (row.get("notes") or "").strip(),
        "outreach_segment": segment,
        "vertical": "property",
        "blast_segment": (row.get("blast_segment") or "").strip(),
        "company_number": (row.get("company_number") or "").strip(),
        "company_status": (row.get("company_status") or "").strip(),
        "director_names": (row.get("director_names") or "").strip(),
        "registered_office_address": (row.get("registered_office_address") or "").strip(),
        "source": (row.get("source") or "Companies House").strip(),
    }


def load_prospects(regions: set[str] | None) -> list[dict[str, str]]:
    region_configs = load_region_configs()
    enrichment_by_region = {
        rid: load_region_enrichment(rid)
        for rid in (regions if regions is not None else {cfg.get("id") for cfg in region_configs.values() if cfg.get("id")})
    }
    prospects: list[dict[str, str]] = []
    seen: set[str] = set()

    for path in sorted(RESEARCH.glob("*-estate-marketing-list.csv")):
        stem = path.name.replace("-marketing-list.csv", "")
        region = region_from_stem(stem, region_configs)
        if regions is not None and region not in regions:
            continue
        region_cfg = region_configs.get(region) or region_configs.get(stem)
        enrichment = enrichment_by_region.get(region) or load_region_enrichment(region)

        with path.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                enr = find_enrichment(row, region, enrichment)
                if enr:
                    row = apply_enrichment(row, enr)
                segment = classify_segment(row)
                if not segment:
                    continue
                name = (row.get("company_name") or "").strip()
                postcode = (row.get("postcode") or "").strip().upper()
                if not name:
                    continue
                if not postcode_matches_region(postcode, region_cfg):
                    continue
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
    parser = argparse.ArgumentParser(description="Sync estate prospects seed JSON")
    parser.add_argument(
        "--region",
        action="append",
        dest="regions",
        help="Region id to include (repeatable). Default: birmingham",
    )
    parser.add_argument(
        "--all-regions",
        action="store_true",
        help="Include every estate marketing list",
    )
    args = parser.parse_args()

    if args.all_regions:
        regions = None
    else:
        regions = set(args.regions or ["birmingham"])

    prospects = load_prospects(regions)
    OUT.parent.mkdir(parents=True, exist_ok=True)

    by_segment: dict[str, int] = {}
    by_region: dict[str, int] = {}
    for p in prospects:
        by_segment[p["outreach_segment"]] = by_segment.get(p["outreach_segment"], 0) + 1
        by_region[p["region"]] = by_region.get(p["region"], 0) + 1

    generated_from = (
        "*-estate-marketing-list.csv"
        if regions is None
        else ",".join(sorted(regions))
    )

    OUT.write_text(
        json.dumps(
            {
                "prospects": prospects,
                "vertical": "property",
                "generated_from": generated_from,
                "counts": {"by_segment": by_segment, "by_region": by_region},
            },
            indent=2,
        ),
        encoding="utf-8",
    )
    print(f"Wrote {len(prospects)} estate prospects -> {OUT}")
    print("By segment:", by_segment)
    print("By region:", by_region)


if __name__ == "__main__":
    main()
