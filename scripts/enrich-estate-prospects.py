#!/usr/bin/env python3
"""Enrich estate prospects: directors, websites, emails, CRM.

Works with marketing lists built from Companies House or Rightmove.

Usage:
  python3 scripts/enrich-estate-prospects.py --region essex
  python3 scripts/enrich-estate-prospects.py --region birmingham
  python3 scripts/enrich-estate-prospects.py --region essex --limit 50
"""

from __future__ import annotations

import argparse
import csv
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from html import unescape
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from estate_agents_lib import (  # noqa: E402
    ESTATE_DIR,
    detect_crm,
    crm_segment,
    wisecall_tier,
    fetch_page,
    booking_links,
    load_region,
    public_http_get,
    search_companies_public,
    parse_public_company_profile,
    get_company_officers_public,
)
from rightmove_estate_agents_lib import (  # noqa: E402
    extract_emails,
    extract_websites,
    fetch_branch_profile,
)

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE

UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)

BLOCKLIST = {
    "facebook.com",
    "instagram.com",
    "linkedin.com",
    "twitter.com",
    "x.com",
    "youtube.com",
    "rightmove.co.uk",
    "zoopla.co.uk",
    "onthemarket.com",
    "yell.com",
    "tripadvisor.com",
    "companieshouse.gov.uk",
    "find-and-update.company-information.service.gov.uk",
    "gov.uk",
    "wikipedia.org",
    "duckduckgo.com",
    "google.com",
    "google.co.uk",
    "bing.com",
    "estateagentregister.co.uk",
    "companycheck.co.uk",
    "endole.co.uk",
    "192.com",
    "getagent.co.uk",
}

GENERIC_LOCALS = {
    "info",
    "hello",
    "contact",
    "enquiries",
    "enquiry",
    "admin",
    "office",
    "mail",
    "sales",
    "lettings",
    "rentals",
    "reception",
    "team",
    "support",
}


def http_get(url: str, timeout: int = 20, data: bytes | None = None) -> str:
    req = urllib.request.Request(
        url,
        data=data,
        headers={"User-Agent": UA, "Accept": "text/html,application/xhtml+xml"},
    )
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as resp:
        return resp.read().decode("utf-8", "ignore")


def domain_of(url: str) -> str:
    host = urllib.parse.urlparse(url).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def is_blocked(url: str) -> bool:
    host = domain_of(url)
    if not host:
        return True
    return any(host == d or host.endswith("." + d) for d in BLOCKLIST)


def format_director_name(raw: str) -> str:
    text = unescape(raw).strip()
    text = re.sub(r"\s+", " ", text)
    if "," in text:
        last, first = [p.strip() for p in text.split(",", 1)]
        if first and last:
            return f"{first.title()} {last.title()}"
    return text.title()


def fetch_directors(company_number: str) -> list[str]:
    if not company_number:
        return []
    officers = get_company_officers_public(company_number)
    cleaned: list[str] = []
    seen: set[str] = set()
    for officer in officers:
        name = format_director_name(officer.get("name") or "")
        key = re.sub(r"[^a-z]", "", name.lower())
        if len(key) < 4 or key in seen:
            continue
        seen.add(key)
        cleaned.append(name)
    return cleaned[:5]


def lookup_company_number(company_name: str, postcode: str) -> tuple[str, str]:
    """Return (company_number, registered_address) via public Companies House search."""
    outward = postcode.replace(" ", "")[:4] if postcode else ""
    queries = [
        f"{company_name} {outward}".strip(),
        company_name,
    ]
    for query in queries:
        if not query:
            continue
        numbers = search_companies_public(query)
        time.sleep(0.4)
        for number in numbers[:8]:
            try:
                html = public_http_get(
                    f"https://find-and-update.company-information.service.gov.uk/company/{number}"
                )
                profile = parse_public_company_profile(html)
                status = (profile.get("company_status") or "").lower()
                if status and status != "active":
                    continue
                sic = profile.get("sic_codes") or []
                name = (profile.get("company_name") or "").lower()
                if "68310" not in sic and "estate" not in name and "letting" not in name:
                    continue
                pc = (profile.get("postcode") or "").upper().replace(" ", "")
                if outward and pc and not pc.startswith(outward[:2]):
                    # Loose postcode area check when we have one
                    if outward[:2] not in pc[:4]:
                        continue
                return number, str(profile.get("registered_office_address") or "")
            except Exception:
                continue
            time.sleep(0.25)
    return "", ""


def ddg_search(query: str) -> list[str]:
    endpoint = "https://html.duckduckgo.com/html/"
    data = urllib.parse.urlencode({"q": query, "b": ""}).encode()
    try:
        html = http_get(endpoint, data=data)
    except Exception:
        return []
    hrefs = re.findall(r'class="result__a"[^>]+href="([^"]+)"', html)
    out: list[str] = []
    for href in hrefs:
        url = unescape(href)
        if "uddg=" in url:
            parsed = urllib.parse.urlparse(url)
            qs = urllib.parse.parse_qs(parsed.query)
            if qs.get("uddg"):
                url = qs["uddg"][0]
        if url.startswith("http") and not is_blocked(url):
            out.append(url.split("#")[0])
    seen: set[str] = set()
    deduped: list[str] = []
    for url in out:
        host = domain_of(url)
        if host in seen:
            continue
        seen.add(host)
        deduped.append(url)
    return deduped


def guess_domains(company_name: str) -> list[str]:
    base = company_name.lower()
    base = re.sub(r"\b(limited|ltd|llp|plc)\b", "", base)
    base = re.sub(r"\b(estate agents?|lettings?|property|properties|homes?)\b", "", base)
    base = re.sub(r"[^a-z0-9]+", "", base).strip()
    if len(base) < 4:
        return []
    stems = [base, f"{base}estates", f"{base}properties"]
    urls: list[str] = []
    for stem in stems:
        urls.append(f"https://www.{stem}.co.uk")
        urls.append(f"https://{stem}.co.uk")
    return urls


def probe_url(url: str) -> str | None:
    try:
        body, final = fetch_page(url, timeout=10)
        if body and len(body) > 500 and not is_blocked(final):
            return final
    except Exception:
        return None
    return None


def discover_website(company_name: str, postcode: str, area: str, hint: str = "") -> tuple[str, str]:
    if hint and not is_blocked(hint):
        final = probe_url(hint)
        if final:
            return final, "rightmove_description"

    for url in guess_domains(company_name):
        final = probe_url(url)
        if final:
            return final, "domain_guess"

    outward = postcode.replace(" ", "")[:4] if postcode else ""
    queries = [
        f'"{company_name}" estate agents {outward or area or "Essex"}',
        f"{company_name} Essex estate agents",
    ]
    for q in queries:
        results = ddg_search(q)
        time.sleep(1.0)
        for url in results[:6]:
            final = probe_url(url)
            if final:
                return final, "duckduckgo"
    return "", ""


def extract_emails_from_html(html: str, website: str) -> list[str]:
    host = domain_of(website)
    found = set(re.findall(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", html, flags=re.I))
    for m in re.findall(r"mailto:([^?\"'\s>]+)", html, flags=re.I):
        found.add(urllib.parse.unquote(m).strip())

    scored: list[tuple[int, str]] = []
    for email in found:
        email = email.strip().strip(".,;)")
        if "@" not in email:
            continue
        local, _, domain = email.lower().partition("@")
        if domain.endswith(("example.com", "sentry.io", "wixpress.com")):
            continue
        if any(x in local for x in ("noreply", "no-reply", "donotreply")):
            continue
        score = 0
        if host and (domain == host or domain.endswith("." + host) or host.endswith("." + domain)):
            score += 5
        if local in GENERIC_LOCALS:
            score += 3
        if "." in local or local not in GENERIC_LOCALS:
            score += 2
        scored.append((score, email))
    scored.sort(key=lambda x: (-x[0], x[1]))
    out: list[str] = []
    seen: set[str] = set()
    for _, email in scored:
        key = email.lower()
        if key in seen:
            continue
        seen.add(key)
        out.append(email)
    return out[:5]


def extract_phones(html: str) -> list[str]:
    phones = set()
    for m in re.findall(r"tel:([+\d\s()-]{8,})", html, flags=re.I):
        phones.add(re.sub(r"[^\d+]", "", m))
    for m in re.findall(r"(?:\+44|0)\s*\d[\d\s()-]{8,}\d", html):
        compact = re.sub(r"[^\d+]", "", m)
        if len(re.sub(r"\D", "", compact)) >= 10:
            phones.add(compact)
    return list(phones)[:3]


def scrape_site(website: str) -> dict[str, str]:
    body, final = fetch_page(website)
    if not body:
        return {"website": website, "notes": "website unreachable"}

    combined = body
    paths = ["/contact", "/contact-us", "/about", "/about-us", "/team"]
    origin_base = urllib.parse.urlparse(final)._replace(path="", params="", query="", fragment="").geturl().rstrip("/")
    for path in paths:
        sub, _ = fetch_page(f"{origin_base}{path}", timeout=10)
        if sub:
            combined += "\n" + sub
        time.sleep(0.12)

    emails = extract_emails_from_html(combined, final)
    phones = extract_phones(combined)
    crm, evidence = detect_crm(combined)
    segment = crm_segment(crm)
    tier = wisecall_tier(segment, crm, False)

    email = ""
    for e in emails:
        if e.split("@", 1)[0].lower() in GENERIC_LOCALS:
            email = e
            break
    if not email and emails:
        email = emails[0]

    return {
        "website": final,
        "email": email,
        "emails_found": "; ".join(emails),
        "phone": phones[0] if phones else "",
        "phones_found": "; ".join(phones),
        "crm_detected": "; ".join(crm),
        "crm_evidence": "; ".join(evidence)[:400],
        "blast_segment": segment,
        "wisecall_tier": tier,
        "notes": "",
    }


def load_targets(region_id: str, marketing_csv: Path) -> list[dict[str, str]]:
    rows: list[dict[str, str]] = []
    with marketing_csv.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if (row.get("company_status") or "active").lower() not in {"active"}:
                continue
            if not (row.get("phone") or row.get("company_name")):
                continue
            rows.append(row)
    return rows


def enrich_one(row: dict[str, str], region_name: str) -> dict[str, str]:
    name = row.get("company_name") or ""
    postcode = (row.get("postcode") or "").upper()
    area = row.get("area") or ""
    profile_url = (row.get("profile_url") or "").strip()
    company_number = (row.get("company_number") or "").strip()

    result: dict[str, str] = {
        "company_name": name,
        "company_number": company_number,
        "branch_id": row.get("branch_id") or "",
        "postcode": postcode,
        "area": area,
        "director_names": row.get("director_names") or "",
        "contact_name": "",
        "website": row.get("website") or "",
        "website_source": "marketing_list" if row.get("website") else "",
        "email": row.get("email") or "",
        "emails_found": "",
        "phone": row.get("phone") or "",
        "phones_found": "",
        "crm_detected": row.get("crm_detected") or "",
        "crm_evidence": "",
        "blast_segment": row.get("blast_segment") or "Unknown CRM - manual check",
        "wisecall_tier": row.get("wisecall_tier") or "Tier 3 - Unknown CRM (qualify on call)",
        "notes": "",
        "profile_url": profile_url,
    }

    if profile_url:
        try:
            profile = fetch_branch_profile(profile_url)
            time.sleep(0.25)
            if profile.get("company_name"):
                result["company_name"] = profile["company_name"]
            if profile.get("postcode"):
                result["postcode"] = profile["postcode"].upper()
            if profile.get("registered_office_address"):
                result["registered_office_address"] = profile["registered_office_address"]
            if profile.get("phone") and not result["phone"]:
                result["phone"] = profile["phone"]
            if profile.get("email") and not result["email"]:
                result["email"] = profile["email"]
                result["emails_found"] = profile.get("emails_found") or profile["email"]
            if profile.get("website") and not result["website"]:
                result["website"] = profile["website"]
                result["website_source"] = "rightmove_profile"
            elif profile.get("emails_found"):
                result["emails_found"] = profile["emails_found"]
        except Exception as exc:
            result["notes"] = f"profile_error:{exc}"

    if not company_number:
        number, address = lookup_company_number(result["company_name"], result["postcode"])
        if number:
            result["company_number"] = number
            if address:
                result["registered_office_address"] = address

    directors = fetch_directors(result["company_number"])
    time.sleep(0.3)
    if directors:
        result["director_names"] = "; ".join(f"{d} (director)" for d in directors)
        result["contact_name"] = directors[0]

    website_hint = result.get("website") or ""
    website, source = discover_website(result["company_name"], result["postcode"], area, website_hint)
    if website:
        result["website"] = website
        result["website_source"] = source or result["website_source"]

    if result["website"]:
        scraped = scrape_site(result["website"])
        if scraped.get("email") and not result["email"]:
            result["email"] = scraped["email"]
        if scraped.get("emails_found"):
            existing = [e.strip() for e in (result.get("emails_found") or "").split(";") if e.strip()]
            merged = existing + [e for e in scraped["emails_found"].split("; ") if e]
            result["emails_found"] = "; ".join(dict.fromkeys(merged))
        if scraped.get("phone") and not result["phone"]:
            result["phone"] = scraped["phone"]
        if scraped.get("crm_detected"):
            result["crm_detected"] = scraped["crm_detected"]
            result["crm_evidence"] = scraped.get("crm_evidence") or ""
            result["blast_segment"] = scraped.get("blast_segment") or result["blast_segment"]
            result["wisecall_tier"] = scraped.get("wisecall_tier") or result["wisecall_tier"]
        result["website"] = scraped.get("website") or result["website"]
    elif not result["email"]:
        result["notes"] = "no website found"

    return result


def update_marketing_list(enrichments: list[dict[str, str]], marketing_csv: Path) -> int:
    if not marketing_csv.exists():
        return 0
    with marketing_csv.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fields = list(reader.fieldnames or [])
        rows = list(reader)

    by_branch = {(e.get("branch_id") or "").strip(): e for e in enrichments if (e.get("branch_id") or "").strip()}
    by_number = {(e.get("company_number") or "").strip(): e for e in enrichments if (e.get("company_number") or "").strip()}

    updated = 0
    for row in rows:
        enr = by_branch.get((row.get("branch_id") or "").strip()) or by_number.get((row.get("company_number") or "").strip())
        if not enr:
            continue
        changed = False
        for field in (
            "website",
            "phone",
            "email",
            "company_number",
            "director_names",
            "crm_detected",
            "blast_segment",
            "wisecall_tier",
            "registered_office_address",
        ):
            val = (enr.get(field) or "").strip()
            if val and (row.get(field) or "").strip() != val:
                row[field] = val
                changed = True
        if changed:
            updated += 1

    extra = ["email", "branch_id", "profile_url"]
    for col in extra:
        if col not in fields:
            fields.append(col)
    with marketing_csv.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    return updated


def main() -> None:
    parser = argparse.ArgumentParser(description="Enrich estate agent prospects")
    parser.add_argument("--region", default="essex", help="Region id (default: essex)")
    parser.add_argument("--limit", type=int, default=0, help="Max prospects to enrich (0 = all)")
    args = parser.parse_args()

    region = load_region(args.region)
    marketing_csv = region.master_csv
    out_csv = ESTATE_DIR / f"{args.region}-estate-enrichment.csv"
    out_json = ESTATE_DIR / f"{args.region}-estate-enrichment.json"

    targets = load_targets(args.region, marketing_csv)
    if args.limit > 0:
        targets = targets[: args.limit]

    print(f"Enriching {len(targets)} {region.name} estate prospects...")
    enrichments: list[dict[str, str]] = []
    for i, row in enumerate(targets, 1):
        name = row.get("company_name") or "?"
        print(f"[{i}/{len(targets)}] {name}")
        try:
            enr = enrich_one(row, region.name)
        except Exception as exc:
            enr = {
                "company_name": name,
                "branch_id": row.get("branch_id") or "",
                "company_number": row.get("company_number") or "",
                "postcode": row.get("postcode") or "",
                "notes": f"enrich_error:{exc}",
            }
        enrichments.append(enr)
        print(
            f"    web={enr.get('website') or '-'} email={enr.get('email') or '-'} "
            f"crm={enr.get('crm_detected') or '-'} directors={enr.get('contact_name') or '-'}"
        )
        time.sleep(0.35)

    fields = [
        "company_name",
        "company_number",
        "branch_id",
        "postcode",
        "area",
        "contact_name",
        "director_names",
        "website",
        "website_source",
        "email",
        "emails_found",
        "phone",
        "phones_found",
        "crm_detected",
        "crm_evidence",
        "blast_segment",
        "wisecall_tier",
        "profile_url",
        "notes",
    ]
    with out_csv.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in enrichments:
            writer.writerow({k: row.get(k, "") for k in fields})

    out_json.write_text(json.dumps(enrichments, indent=2), encoding="utf-8")
    updated = update_marketing_list(enrichments, marketing_csv)

    with_web = sum(1 for e in enrichments if e.get("website"))
    with_email = sum(1 for e in enrichments if e.get("email"))
    with_dir = sum(1 for e in enrichments if e.get("contact_name"))
    with_crm = sum(1 for e in enrichments if e.get("crm_detected"))
    print("---")
    print(f"Wrote {out_csv}")
    print(f"Updated marketing list rows: {updated}")
    print(f"Websites: {with_web}/{len(enrichments)}")
    print(f"Emails: {with_email}/{len(enrichments)}")
    print(f"Directors: {with_dir}/{len(enrichments)}")
    print(f"CRM detected: {with_crm}/{len(enrichments)}")


if __name__ == "__main__":
    main()
