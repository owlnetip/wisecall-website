#!/usr/bin/env python3
"""Enrich York Dentally contacts via the FullEnrich API.

Reads decision-maker rows from data/research/york-yo-dental-dentally-contacts.csv,
submits a bulk enrichment job, polls for results, and writes an outbound-ready CSV.

Usage:
  export FULLENRICH_API_KEY=your_key_here
  python3 scripts/enrich-dental-contacts.py

Optional:
  FULLENRICH_POLL_SECONDS=30     # poll interval (default 30)
  FULLENRICH_MAX_WAIT_SECONDS=600  # give up after 10 minutes
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
INPUT_CSV = ROOT / "data" / "research" / "york-yo-dental-dentally-contacts.csv"
OUTPUT_CSV = ROOT / "data" / "research" / "york-yo-dental-dentally-enriched.csv"
POLL_STATE = ROOT / "data" / "research" / ".fullenrich-last-job.json"

API_BASE = "https://app.fullenrich.com/api/v2"
ENRICH_FIELDS = ["contact.work_emails", "contact.personal_emails", "contact.phones"]

GENERIC_LOCALS = {
    "info",
    "hello",
    "contact",
    "enquiries",
    "enquiry",
    "reception",
    "appointments",
    "admin",
    "office",
    "mail",
    "support",
    "team",
    "practice",
    "customerservice",
    "customer",
    "booking",
    "bookings",
    "care",
    "membership",
    "noreply",
    "no-reply",
}


def api_key() -> str:
    key = (os.environ.get("FULLENRICH_API_KEY") or "").strip()
    if not key:
        print(
            "Set FULLENRICH_API_KEY first.\n"
            "  export FULLENRICH_API_KEY=your_key_here\n"
            "Get a key at https://app.fullenrich.com/",
            file=sys.stderr,
        )
        sys.exit(1)
    return key


def request_json(method: str, path: str, body: dict | None = None) -> dict:
    url = f"{API_BASE}{path}"
    data = None
    headers = {
        "Authorization": f"Bearer {api_key()}",
        "Accept": "application/json",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "ignore")
        raise RuntimeError(f"FullEnrich {method} {path} failed ({err.code}): {detail}") from err


def parse_name(raw: str) -> tuple[str, str]:
    text = raw.strip()
    text = re.sub(r"^(dr|mr|mrs|ms|miss|prof)\.?\s+", "", text, flags=re.I)
    if "&" in text:
        text = text.split("&", 1)[0].strip()
    parts = [p for p in text.split() if p]
    if len(parts) >= 2:
        return parts[0], parts[-1]
    if parts:
        return parts[0], parts[0]
    return "", ""


def domain_from_website(url: str) -> str:
    host = urlparse(url.strip()).netloc.lower()
    return host[4:] if host.startswith("www.") else host


def company_from_role(role: str, practice_name: str) -> str:
    match = re.search(r"\(([^)]+ Ltd[^)]*)\)", role, re.I)
    if match:
        return match.group(1).strip()
    match = re.search(r"\(([^)]+ Limited[^)]*)\)", role, re.I)
    if match:
        return match.group(1).strip()
    return practice_name


def classify_email(email: str) -> str:
    local = email.split("@", 1)[0].lower()
    if local in GENERIC_LOCALS:
        return "generic"
    if "." in local or len(local) > 8:
        return "named"
    return "unknown"


def load_company_overrides() -> dict[str, dict[str, str]]:
    path = ROOT / "data" / "research" / "york-yo-dental-dentally-fullenrich-input.csv"
    if not path.exists():
        return {}
    out: dict[str, dict[str, str]] = {}
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            name = row.get("practice_name", "").strip()
            if name:
                out[name] = row
    return out


def load_contacts() -> list[dict[str, str]]:
    if not INPUT_CSV.exists():
        raise FileNotFoundError(f"Missing input CSV: {INPUT_CSV}")
    overrides = load_company_overrides()
    rows: list[dict[str, str]] = []
    with INPUT_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            practice = row.get("practice_name", "")
            override = overrides.get(practice, {})
            first = override.get("first_name") or parse_name(row.get("owner_or_decision_maker", ""))[0]
            last = override.get("last_name") or parse_name(row.get("owner_or_decision_maker", ""))[1]
            if not first or not last:
                continue
            rows.append(
                {
                    **row,
                    "first_name": first,
                    "last_name": last,
                    "company_name": override.get("company_name")
                    or company_from_role(row.get("role", ""), practice),
                    "domain": override.get("domain") or domain_from_website(row.get("website", "")),
                }
            )
    return rows


def start_enrichment(contacts: list[dict[str, str]]) -> str:
    payload = {
        "name": "WiseCall York Dentally Tier 1",
        "data": [
            {
                "first_name": c["first_name"],
                "last_name": c["last_name"],
                "domain": c["domain"],
                "company_name": c["company_name"],
                "enrich_fields": ENRICH_FIELDS,
                "custom": {
                    "practice_name": c["practice_name"],
                    "postcode": c["postcode"],
                },
            }
            for c in contacts
        ],
    }
    result = request_json("POST", "/contact/enrich/bulk", payload)
    enrichment_id = result.get("enrichment_id") or result.get("id")
    if not enrichment_id:
        raise RuntimeError(f"Unexpected FullEnrich response: {result}")
    POLL_STATE.write_text(json.dumps({"enrichment_id": enrichment_id}, indent=2), encoding="utf-8")
    print(f"Started enrichment job: {enrichment_id}")
    return enrichment_id


def poll_enrichment(enrichment_id: str) -> dict:
    poll_s = int(os.environ.get("FULLENRICH_POLL_SECONDS", "30"))
    max_wait = int(os.environ.get("FULLENRICH_MAX_WAIT_SECONDS", "600"))
    deadline = time.time() + max_wait
    while time.time() < deadline:
        result = request_json("GET", f"/contact/enrich/bulk/{enrichment_id}")
        status = (result.get("status") or "").upper()
        credits = result.get("cost", {}).get("credits")
        done = len(result.get("data") or [])
        print(f"  status={status or 'UNKNOWN'} results={done} credits={credits}")
        if status in {"FINISHED", "COMPLETED", "DONE"}:
            return result
        if status in {"FAILED", "ERROR", "CANCELLED"}:
            raise RuntimeError(f"Enrichment failed: {result}")
        time.sleep(poll_s)
    raise TimeoutError(f"Enrichment still running after {max_wait}s (job id {enrichment_id})")


def pick_contact_info(item: dict) -> dict[str, str]:
    info = item.get("contact_info") or {}
    work = info.get("most_probable_work_email") or {}
    personal = info.get("most_probable_personal_email") or {}
    phone = info.get("most_probable_phone") or {}

    work_email = (work.get("email") or "").strip()
    personal_email = (personal.get("email") or "").strip()
    mobile = (phone.get("number") or "").strip()
    region = (phone.get("region") or "").strip()

    best_email = work_email or personal_email
    email_type = classify_email(best_email) if best_email else "none"

    return {
        "enriched_work_email": work_email,
        "enriched_work_email_status": (work.get("status") or "").strip(),
        "enriched_personal_email": personal_email,
        "enriched_personal_email_status": (personal.get("status") or "").strip(),
        "enriched_mobile": mobile,
        "enriched_mobile_region": region,
        "best_email": best_email,
        "best_email_type": email_type,
        "recommended_channel": (
            "1:1 email to named address"
            if best_email and email_type == "named"
            else "Phone (AI outbound or direct) — skip SMS for cold outreach"
        ),
    }


def write_output(source: list[dict[str, str]], enrichment: dict) -> None:
    by_practice = {}
    for item in enrichment.get("data") or []:
        custom = item.get("custom") or {}
        practice = custom.get("practice_name") or ""
        by_practice[practice] = item

    fields = [
        "practice_name",
        "postcode",
        "phone",
        "website",
        "owner_or_decision_maker",
        "role",
        "first_name",
        "last_name",
        "company_name",
        "domain",
        "public_email",
        "enriched_work_email",
        "enriched_work_email_status",
        "enriched_personal_email",
        "enriched_personal_email_status",
        "enriched_mobile",
        "enriched_mobile_region",
        "best_email",
        "best_email_type",
        "recommended_channel",
        "enrichment_status",
    ]

    rows: list[dict[str, str]] = []
    for contact in source:
        item = by_practice.get(contact["practice_name"], {})
        picked = pick_contact_info(item)
        status = (enrichment.get("status") or "").upper()
        row = {**contact, **picked, "enrichment_status": status}
        rows.append({k: row.get(k, "") for k in fields})

    with OUTPUT_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows(rows)

    outbound_fields = [
        "name",
        "phone",
        "email",
        "mobile",
        "company",
        "postcode",
        "owner",
        "email_type",
        "channel",
        "website",
    ]
    outbound_path = ROOT / "data" / "research" / "york-yo-dental-dentally-enriched-outbound.csv"
    with outbound_path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=outbound_fields)
        writer.writeheader()
        for row in rows:
            writer.writerow(
                {
                    "name": row["owner_or_decision_maker"],
                    "phone": row["phone"],
                    "email": row["best_email"],
                    "mobile": row["enriched_mobile"],
                    "company": row["practice_name"],
                    "postcode": row["postcode"],
                    "owner": row["owner_or_decision_maker"],
                    "email_type": row["best_email_type"],
                    "channel": row["recommended_channel"],
                    "website": row["website"],
                }
            )

    print(f"Wrote {OUTPUT_CSV}")
    print(f"Wrote {outbound_path}")


def main() -> None:
    contacts = load_contacts()
    if not contacts:
        print("No contacts to enrich.", file=sys.stderr)
        sys.exit(1)

    print(f"Enriching {len(contacts)} decision-makers via FullEnrich...")
    for c in contacts:
        print(f"  - {c['first_name']} {c['last_name']} @ {c['domain']} ({c['practice_name']})")

    credits = request_json("GET", "/account/credits")
    balance = credits.get("balance")
    if balance is not None:
        print(f"Credit balance: {balance}")

    enrichment_id = start_enrichment(contacts)
    result = poll_enrichment(enrichment_id)
    write_output(contacts, result)

    named = sum(1 for _ in result.get("data") or [] if pick_contact_info(_).get("best_email_type") == "named")
    print(f"Done. Named emails found: {named}/{len(contacts)}")


if __name__ == "__main__":
    main()
