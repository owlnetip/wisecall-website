"""Scrape UK estate agent directories from Rightmove __NEXT_DATA__ JSON."""

from __future__ import annotations

import json
import re
import ssl
import time
import urllib.error
import urllib.parse
import urllib.request
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ESTATE_DIR = ROOT / "data" / "research" / "estate-agents"

RIGHTMOVE = "https://www.rightmove.co.uk"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


def http_get(url: str, timeout: int = 30) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"},
    )
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as resp:
        return resp.read().decode("utf-8", "ignore")


def fetch_next_data(url: str) -> dict:
    html = http_get(url)
    match = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', html, re.S)
    if not match:
        raise RuntimeError(f"No __NEXT_DATA__ found at {url}")
    return json.loads(match.group(1))


def extract_postcode(address: str) -> str:
    text = (address or "").upper().replace("\r", "\n")
    match = re.search(r"\b([A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2})\b", text)
    return match.group(1).strip() if match else ""


def extract_emails(text: str) -> list[str]:
    found = set(re.findall(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", text or "", flags=re.I))
    out: list[str] = []
    for email in found:
        email = email.strip().strip(".,;)")
        local = email.split("@", 1)[0].lower()
        if any(x in local for x in ("noreply", "no-reply", "rightmove")):
            continue
        if email.lower() not in {e.lower() for e in out}:
            out.append(email)
    return out


def extract_websites(text: str) -> list[str]:
    raw = unescape(text or "")
    urls: list[str] = []
    for match in re.finditer(r"(?:https?://)?(?:www\.)?([a-z0-9][a-z0-9.-]+\.(?:co\.uk|com|uk|net|org)(?:/[^\s<\"']*)?)", raw, re.I):
        host = match.group(1).split("/")[0].lower()
        if any(x in host for x in ("rightmove", "zoopla", "onthemarket", "facebook", "instagram", "linkedin")):
            continue
        url = match.group(0)
        if not url.startswith("http"):
            url = "https://" + url.lstrip("/")
        if url not in urls:
            urls.append(url.split("#")[0])
    return urls


def parse_listing_agents(next_data: dict) -> tuple[int, list[dict]]:
    agents_data = (
        next_data.get("props", {})
        .get("pageProps", {})
        .get("data", {})
        .get("results", {})
        .get("agentsData", {})
    )
    total = int(agents_data.get("total") or 0)
    agents = agents_data.get("agents") or []
    rows: list[dict] = []
    for agent in agents:
        branch_id = str(agent.get("id") or "").strip()
        if not branch_id:
            continue
        phones = [
            (t.get("number") or "").strip()
            for t in (agent.get("telephoneNumbers") or [])
            if (t.get("number") or "").strip()
        ]
        description = " ".join(
            filter(
                None,
                [
                    agent.get("description") or "",
                    agent.get("branchSummary") or "",
                    agent.get("primaryDescription") or "",
                ],
            )
        )
        href = ((agent.get("branchLink") or {}).get("href") or "").strip()
        profile_url = f"{RIGHTMOVE}{href}" if href.startswith("/") else href
        rows.append(
            {
                "branch_id": branch_id,
                "company_name": (agent.get("brandName") or agent.get("branchDisplayName") or "").strip(),
                "branch_display_name": (agent.get("branchDisplayName") or "").strip(),
                "branch_town": (agent.get("name") or "").strip(),
                "registered_office_address": (agent.get("branchAddress") or "").replace("\r", ", ").strip(),
                "postcode": extract_postcode(agent.get("branchAddress") or ""),
                "phone": phones[0] if phones else "",
                "phones_found": "; ".join(dict.fromkeys(phones)),
                "sales": "Yes" if agent.get("sales") else "No",
                "lettings": "Yes" if agent.get("lettings") else "No",
                "profile_url": profile_url,
                "rightmove_company_id": str(agent.get("companyId") or ""),
                "description": description,
                "emails_found": "; ".join(extract_emails(description)),
                "website": extract_websites(description)[0] if extract_websites(description) else "",
            }
        )
    return total, rows


def scrape_directory(location_slug: str, sleep_s: float = 0.35) -> list[dict]:
    """Scrape all pages of a Rightmove county directory, dedupe by branch_id."""
    location_slug = location_slug.strip("/")
    if not location_slug.endswith(".html"):
        location_slug = f"{location_slug}.html"
    base_url = f"{RIGHTMOVE}/estate-agents/{location_slug}"

    first = fetch_next_data(base_url)
    total, first_rows = parse_listing_agents(first)
    per_page = max(len(first_rows), 1)
    pages = max(1, (total + per_page - 1) // per_page)
    print(f"Rightmove {location_slug}: {total} listings, ~{pages} pages")

    by_branch: dict[str, dict] = {}
    for row in first_rows:
        by_branch[row["branch_id"]] = row

    for page in range(2, pages + 1):
        url = f"{base_url}?page={page}"
        try:
            data = fetch_next_data(url)
            _, rows = parse_listing_agents(data)
        except Exception as exc:
            print(f"  page {page}: error {exc}")
            break
        added = 0
        for row in rows:
            bid = row["branch_id"]
            if bid not in by_branch:
                by_branch[bid] = row
                added += 1
                continue
            existing = by_branch[bid]
            phones = set(filter(None, (existing.get("phones_found") or "").split("; ")))
            phones.update(filter(None, (row.get("phones_found") or "").split("; ")))
            existing["phones_found"] = "; ".join(sorted(phones))
            if not existing.get("phone") and row.get("phone"):
                existing["phone"] = row["phone"]
            if not existing.get("email") and row.get("emails_found"):
                existing["emails_found"] = row["emails_found"]
            if not existing.get("website") and row.get("website"):
                existing["website"] = row["website"]
            if row.get("sales") == "Yes":
                existing["sales"] = "Yes"
            if row.get("lettings") == "Yes":
                existing["lettings"] = "Yes"
        print(f"  page {page}/{pages}: {len(rows)} cards, {added} new branches (total {len(by_branch)})")
        time.sleep(sleep_s)

    return sorted(by_branch.values(), key=lambda r: (r.get("company_name", ""), r.get("branch_town", "")))


def fetch_branch_profile(profile_url: str) -> dict[str, str]:
    data = fetch_next_data(profile_url)
    profile = (
        data.get("props", {})
        .get("pageProps", {})
        .get("data", {})
        .get("branchProfileResponse", {})
        .get("agentProfileResponse", {})
    )
    if not profile:
        return {}

    text_parts = [
        profile.get("branchDescription") or "",
        profile.get("primaryDescription") or "",
        profile.get("salesPrimaryDescription") or "",
        profile.get("lettingsPrimaryDescription") or "",
        profile.get("branchSummary") or "",
    ]
    combined = " ".join(text_parts)
    emails = extract_emails(combined)
    websites = extract_websites(combined)
    phones = [
        (profile.get("branchSalesTelephone") or "").strip(),
        (profile.get("branchLettingsTelephone") or "").strip(),
        (profile.get("branchMainTelephone") or "").strip(),
    ]
    phones = [p for p in phones if p]

    return {
        "company_name": (profile.get("companyName") or profile.get("brandTradingName") or "").strip(),
        "branch_display_name": (profile.get("branchDisplayName") or "").strip(),
        "registered_office_address": (profile.get("branchAddress") or "").replace("\r", ", ").strip(),
        "postcode": (profile.get("branchPostcode") or extract_postcode(profile.get("branchAddress") or "")).strip(),
        "phone": phones[0] if phones else "",
        "phones_found": "; ".join(dict.fromkeys(phones)),
        "emails_found": "; ".join(emails),
        "email": emails[0] if emails else "",
        "website": websites[0] if websites else "",
        "profile_url": profile_url,
        "rightmove_company_id": str(profile.get("companyId") or ""),
        "branch_id": str(profile.get("branchId") or ""),
    }
