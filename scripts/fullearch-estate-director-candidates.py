#!/usr/bin/env python3
"""Prepare estate agent director candidates for FullEnrich work-email enrichment.

Reads the marketing list CSV, extracts directors, and writes a clean CSV
ready for FullEnrich API (work email only, so 50-credit trial isn't wasted).
"""

from __future__ import annotations

import csv
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ESTATE_DIR = ROOT / "data" / "research" / "estate-agents"
INPUT_CSV = ESTATE_DIR / "estate-director-candidates.csv"
OUTPUT_CSV = ESTATE_DIR / "estate-director-candidates-fullenrich.csv"
JOB_STATE = ESTATE_DIR / ".fullenrich-estate-director-job.json"
API_BASE = "https://app.fullenrich.com/api/v2"

DEFAULT_LIMIT = int(os.environ.get("FULLENRICH_LIMIT", "50"))
POLL_SECONDS = int(os.environ.get("FULLENRICH_POLL_SECONDS", "20"))
MAX_WAIT_SECONDS = int(os.environ.get("FULLENRICH_MAX_WAIT_SECONDS", "900"))


def api_key() -> str:
    key = (os.environ.get("FULLENRICH_API_KEY") or "").strip()
    if not key:
        raise SystemExit("Set FULLENRICH_API_KEY first.")
    return key


def request_json(method: str, path: str, body: dict | None = None) -> dict:
    data = None
    headers = {
        "Authorization": f"Bearer {api_key()}",
        "Accept": "application/json",
    }
    if body is not None:
        data = json.dumps(body).encode("utf-8")
        headers["Content-Type"] = "application/json"
    req = urllib.request.Request(f"{API_BASE}{path}", data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as resp:
            raw = resp.read().decode("utf-8")
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as err:
        detail = err.read().decode("utf-8", "ignore")
        raise RuntimeError(f"FullEnrich {method} {path} failed ({err.code}): {detail}") from err


def domain_from_url(url: str) -> str:
    host = urllib.parse.urlparse((url or "").strip()).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def split_name(name: str) -> tuple[str, str]:
    cleaned = re.sub(r"^(Mr|Mrs|Ms|Miss|Dr|Prof)\.?\s+", "", name.strip(), flags=re.I)
    parts = [p for p in cleaned.split() if p]
    if len(parts) < 2:
        return "", ""
    return parts[0], parts[-1]


def load_candidates(limit: int) -> list[dict[str, str]]:
    if not INPUT_CSV.exists():
        raise SystemExit(f"Missing input CSV: {INPUT_CSV}. Run prepare_estate_directors.py first.")

    previously_submitted: set[str] = set()
    if OUTPUT_CSV.exists():
        with OUTPUT_CSV.open(newline="", encoding="utf-8") as f:
            for row in csv.DictReader(f):
                if row.get("id"):
                    previously_submitted.add(row["id"])

    rows: list[dict[str, str]] = []
    with INPUT_CSV.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            if row.get("id") in previously_submitted:
                continue
            # Only process companies with directors
            if not row.get("director_names"):
                continue
            first, last = split_name(row.get("director_names", "").split(";")[0].split("(")[0].strip())
            domain = domain_from_url(row.get("website", ""))
            if not first or not last or not domain:
                continue
            row["first_name"] = first
            row["last_name"] = last
            row["domain"] = domain
            row["_sort_score"] = "100"
            rows.append(row)

    rows.sort(key=lambda r: int(r["_sort_score"]), reverse=True)
    return rows[:limit]


def start_job(candidates: list[dict[str, str]]) -> str:
    payload = {
        "name": f"WiseCall Estate Agent directors work-email x{len(candidates)}",
        "data": [
            {
                "first_name": row["first_name"],
                "last_name": row["last_name"],
                "domain": row["domain"],
                "company_name": row["company_name"],
                "enrich_fields": ["contact.work_emails"],
                "custom": {
                    "id": row["id"],
                    "company_name": row["company_name"],
                    "director_name": row["director_names"].split(";")[0],
                    "website": row["website"],
                    "postcode": row["postcode"],
                },
            }
            for row in candidates
        ],
    }
    result = request_json("POST", "/contact/enrich/bulk", payload)
    enrichment_id = result.get("enrichment_id") or result.get("id")
    if not enrichment_id:
        raise RuntimeError(f"Unexpected FullEnrich start response: {result}")
    JOB_STATE.write_text(
        json.dumps({"enrichment_id": enrichment_id, "submitted": len(candidates)}, indent=2),
        encoding="utf-8",
    )
    return enrichment_id


def poll_job(enrichment_id: str) -> dict:
    deadline = time.time() + MAX_WAIT_SECONDS
    while time.time() < deadline:
        result = request_json("GET", f"/contact/enrich/bulk/{enrichment_id}")
        status = str(result.get("status") or "").upper()
        count = len(result.get("data") or [])
        print(f"status={status or 'UNKNOWN'} results={count}")
        if status in {"FINISHED", "COMPLETED", "DONE"}:
            return result
        if status in {"FAILED", "ERROR", "CANCELLED"}:
            raise RuntimeError(f"FullEnrich job failed: {result}")
        time.sleep(POLL_SECONDS)
    raise TimeoutError(f"FullEnrich job still running after {MAX_WAIT_SECONDS}s: {enrichment_id}")


def pick_work_email(item: dict) -> tuple[str, str, str]:
    info = item.get("contact_info") or {}
    work = info.get("most_probable_work_email") or {}
    email = (work.get("email") or "").strip()
    status = (work.get("status") or "").strip()
    source = (work.get("source") or work.get("provider") or "").strip()
    return email, status, source


def write_output(candidates: list[dict[str, str]], result: dict) -> None:
    existing_rows: list[dict[str, str]] = []
    if OUTPUT_CSV.exists():
        with OUTPUT_CSV.open(newline="", encoding="utf-8-sig") as f:
            existing_rows = list(csv.DictReader(f))

    by_id: dict[str, dict] = {}
    for item in result.get("data") or []:
        custom = item.get("custom") or {}
        if custom.get("id"):
            by_id[str(custom["id"])] = item

    fields = [
        "id",
        "company_name",
        "postcode",
        "website",
        "director_names",
        "fullenrich_work_email",
        "fullenrich_work_email_status",
        "fullenrich_source",
        "recommended_next_step",
    ]
    rows: list[dict[str, str]] = []
    for row in candidates:
        email, status, source = pick_work_email(by_id.get(row["id"], {}))
        out = {k: row.get(k, "") for k in fields}
        out["fullenrich_work_email"] = email
        out["fullenrich_work_email_status"] = status
        out["fullenrich_source"] = source
        out["recommended_next_step"] = "use_fullenrich_email" if email else "manual_research"
        rows.append(out)

    combined = [*existing_rows, *rows]
    seen: set[str] = set()
    deduped: list[dict[str, str]] = []
    for row in combined:
        row_id = row.get("id", "")
        if row_id and row_id in seen:
            continue
        if row_id:
            seen.add(row_id)
        deduped.append(row)

    with OUTPUT_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        writer.writerows([{k: row.get(k, "") for k in fields} for row in deduped])
    found = sum(1 for row in rows if row["fullenrich_work_email"])
    print(f"Wrote {OUTPUT_CSV}")
    print(json.dumps({"submitted": len(rows), "work_emails_found": found, "total_rows": len(deduped)}, indent=2))


def main() -> None:
    limit = int(sys.argv[1]) if len(sys.argv) > 1 else DEFAULT_LIMIT
    candidates = load_candidates(limit)
    if not candidates:
        raise SystemExit("No director candidates found ready for FullEnrich.")
    print(f"Submitting {len(candidates)} director candidates for work-email enrichment")
    enrichment_id = start_job(candidates)
    print(f"FullEnrich job: {enrichment_id}")
    result = poll_job(enrichment_id)
    write_output(candidates, result)


if __name__ == "__main__":
    main()