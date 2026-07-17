#!/usr/bin/env python3
"""Enrich Birmingham estate prospects: directors, websites, emails, CRM.

Free-path enrichment (no Attio / Instantly / paid search required):
  1. Companies House public officers pages → director names
  2. DuckDuckGo HTML search → agency website
  3. Website scrape → mailto emails, tel phones, CRM fingerprints

Writes:
  data/research/estate-agents/birmingham-estate-enrichment.csv
  updates matching rows in birmingham-b-estate-marketing-list.csv

Then re-run:
  python3 scripts/sync-estate-prospects-seed.py --region birmingham
"""

from __future__ import annotations

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
    detect_crm,
    crm_segment,
    wisecall_tier,
    fetch_page,
    booking_links,
)

ESTATE_DIR = ROOT / "data" / "research" / "estate-agents"
MARKETING_CSV = ESTATE_DIR / "birmingham-b-estate-marketing-list.csv"
SEED_JSON = ROOT / "apps/portal/src/data/estate-prospects-seed.json"
OUT_CSV = ESTATE_DIR / "birmingham-estate-enrichment.csv"
OUT_JSON = ESTATE_DIR / "birmingham-estate-enrichment.json"

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
    "apple.com",
    "play.google.com",
    # Directories / data vendors (false positives)
    "estateagentregister.co.uk",
    "sourceregister.eu",
    "companiesintheuk.co.uk",
    "companycheck.co.uk",
    "endole.co.uk",
    "duedil.com",
    "creditsafe.com",
    "thomsonlocal.com",
    "192.com",
    "cylex-uk.co.uk",
    "getagent.co.uk",
    "findglocal.com",
    "bizdb.co.uk",
    "companieslist.co.uk",
    "gbrbusiness.com",
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
        headers={
            "User-Agent": UA,
            "Accept": "text/html,application/xhtml+xml",
        },
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


def postcode_ok(pc: str) -> bool:
    compact = (pc or "").upper().replace(" ", "")
    return bool(re.match(r"^B[0-9]", compact))


def load_targets() -> list[dict[str, str]]:
    if SEED_JSON.exists():
        data = json.loads(SEED_JSON.read_text(encoding="utf-8"))
        rows = data.get("prospects") or []
        if rows:
            return rows

    out: list[dict[str, str]] = []
    with MARKETING_CSV.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            if (row.get("company_status") or "").lower() != "active":
                continue
            if not postcode_ok(row.get("postcode") or ""):
                continue
            out.append(
                {
                    "practice_name": row.get("company_name") or "",
                    "company_name": row.get("company_name") or "",
                    "company_number": row.get("company_number") or "",
                    "postcode": (row.get("postcode") or "").upper(),
                    "area": row.get("area") or "",
                    "registered_office_address": row.get("registered_office_address") or "",
                }
            )
    return out


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
    url = (
        "https://find-and-update.company-information.service.gov.uk"
        f"/company/{company_number}/officers"
    )
    try:
        html = http_get(url)
    except Exception:
        return []
    names = re.findall(
        r'href="/officers/[^"]+"[^>]*>\s*([^<]+)',
        html,
    )
    # Keep order, drop resignations by only taking first occurrence blocks near Role=Director
    # Simpler: unique names that look like CH "SURNAME, Forenames"
    cleaned: list[str] = []
    seen: set[str] = set()
    for raw in names:
        name = format_director_name(raw)
        key = re.sub(r"[^a-z]", "", name.lower())
        if len(key) < 4 or key in seen:
            continue
        if name.lower() in {"view cookies", "sign in / register", "companies", "officers"}:
            continue
        seen.add(key)
        cleaned.append(name)
    return cleaned[:5]


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
        if url.startswith("//"):
            url = "https:" + url
        if "uddg=" in url:
            parsed = urllib.parse.urlparse(url)
            qs = urllib.parse.parse_qs(parsed.query)
            if qs.get("uddg"):
                url = qs["uddg"][0]
        if url.startswith("http") and not is_blocked(url):
            out.append(url.split("#")[0])
    # Dedupe by domain
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
    stems = [base, f"{base}estates", f"{base}estateagents", f"{base}properties"]
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


def discover_website(company_name: str, postcode: str, area: str) -> tuple[str, str]:
    # 1) Domain guesses
    for url in guess_domains(company_name):
        final = probe_url(url)
        if final:
            return final, "domain_guess"

    # 2) DuckDuckGo
    outward = postcode.replace(" ", "")[:4] if postcode else ""
    queries = [
        f'"{company_name}" estate agents {outward or area or "Birmingham"}',
        f"{company_name} Birmingham estate agents",
    ]
    for q in queries:
        results = ddg_search(q)
        time.sleep(1.2)
        for url in results[:6]:
            # Prefer homepage over deep Rightmove-like paths already blocked
            host = domain_of(url)
            if any(x in host for x in ("rightmove", "zoopla", "onthemarket")):
                continue
            final = probe_url(url if url.startswith("http") else f"https://{url}")
            if final:
                return final, "duckduckgo"
            # Try origin
            origin = f"https://{host}"
            final = probe_url(origin)
            if final:
                return final, "duckduckgo"
    return "", ""


def extract_emails(html: str, website: str) -> list[str]:
    host = domain_of(website)
    found = set(re.findall(r"[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}", html, flags=re.I))
    # Also mailto:
    for m in re.findall(r"mailto:([^?\"'\s>]+)", html, flags=re.I):
        found.add(urllib.parse.unquote(m).strip())

    scored: list[tuple[int, str]] = []
    for email in found:
        email = email.strip().strip(".,;)")
        if "@" not in email:
            continue
        local, _, domain = email.lower().partition("@")
        if domain.endswith(("example.com", "sentry.io", "wixpress.com", "cloudflare.com")):
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
        if domain.endswith(".co.uk") or domain.endswith(".com"):
            score += 1
        scored.append((score, email))
    scored.sort(key=lambda x: (-x[0], x[1]))
    # Unique preserve order
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
    # Follow a few contact-ish links
    paths = ["/contact", "/contact-us", "/about", "/about-us", "/team", "/lettings"]
    for path in paths:
        origin = f"{urllib.parse.urlparse(final)._replace(path='', params='', query='', fragment='').geturl().rstrip('/')}{path}"
        sub, _ = fetch_page(origin, timeout=10)
        if sub:
            combined += "\n" + sub
        time.sleep(0.15)
    for link in booking_links(final, body)[:3]:
        sub, _ = fetch_page(link, timeout=10)
        if sub:
            combined += "\n" + sub
        time.sleep(0.15)

    emails = extract_emails(combined, final)
    phones = extract_phones(combined)
    crm, evidence = detect_crm(combined)
    segment = crm_segment(crm)
    tier = wisecall_tier(segment, crm, False)

    # Prefer generic inbox for cold outreach if present, else first named
    email = ""
    for e in emails:
        local = e.split("@", 1)[0].lower()
        if local in GENERIC_LOCALS:
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


def enrich_one(row: dict[str, str]) -> dict[str, str]:
    name = row.get("practice_name") or row.get("company_name") or ""
    company_number = row.get("company_number") or ""
    postcode = (row.get("postcode") or "").upper()
    area = row.get("area") or ""

    result: dict[str, str] = {
        "company_name": name,
        "company_number": company_number,
        "postcode": postcode,
        "area": area,
        "director_names": "",
        "contact_name": "",
        "website": "",
        "website_source": "",
        "email": "",
        "emails_found": "",
        "phone": "",
        "phones_found": "",
        "crm_detected": "",
        "crm_evidence": "",
        "blast_segment": "Unknown CRM - manual check",
        "wisecall_tier": "Tier 3 - Unknown CRM (qualify on call)",
        "notes": "",
    }

    directors = fetch_directors(company_number)
    time.sleep(0.35)
    if directors:
        result["director_names"] = "; ".join(f"{d} (director)" for d in directors)
        result["contact_name"] = directors[0]

    website, source = discover_website(name, postcode, area)
    result["website"] = website
    result["website_source"] = source
    if not website:
        result["notes"] = "no website found"
        return result

    scraped = scrape_site(website)
    result.update({k: v for k, v in scraped.items() if v or k in result})
    return result


def update_marketing_list(enrichments: list[dict[str, str]]) -> int:
    if not MARKETING_CSV.exists():
        return 0
    by_number = {
        (e.get("company_number") or "").strip(): e
        for e in enrichments
        if (e.get("company_number") or "").strip()
    }
    with MARKETING_CSV.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fields = reader.fieldnames or []
        rows = list(reader)

    updated = 0
    for row in rows:
        enr = by_number.get((row.get("company_number") or "").strip())
        if not enr:
            continue
        changed = False
        for field in (
            "website",
            "phone",
            "director_names",
            "crm_detected",
            "crm_evidence",
            "blast_segment",
            "wisecall_tier",
            "notes",
        ):
            val = (enr.get(field) or "").strip()
            if val and not (row.get(field) or "").strip():
                row[field] = val
                changed = True
            elif val and field in ("crm_detected", "blast_segment", "wisecall_tier", "website", "phone", "director_names"):
                # Prefer enrichment when we found something better
                if field == "website" or field == "phone" or field == "director_names":
                    row[field] = val
                    changed = True
                elif field == "crm_detected" and val:
                    row[field] = val
                    row["crm_confidence"] = (
                        "high"
                        if any(x in val for x in ("Street", "Reapit", "Alto", "Jupix"))
                        else "medium"
                    )
                    changed = True
                elif field in ("blast_segment", "wisecall_tier") and val:
                    row[field] = val
                    changed = True
        # Stash email into notes if CSV has no email column
        if "email" not in fields and enr.get("email"):
            note = (row.get("notes") or "").strip()
            tag = f"email:{enr['email']}"
            if tag not in note:
                row["notes"] = f"{note}; {tag}".strip("; ").strip()
                changed = True
        if enr.get("email") and "email" in fields:
            row["email"] = enr["email"]
            changed = True
        if changed:
            updated += 1

    # Ensure email column exists for future syncs
    if "email" not in fields:
        fields = list(fields) + ["email"]
    for row in rows:
        row.setdefault("email", "")
        enr = by_number.get((row.get("company_number") or "").strip())
        if enr and enr.get("email"):
            row["email"] = enr["email"]

    with MARKETING_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        writer.writerows(rows)
    return updated


def main() -> None:
    targets = load_targets()
    print(f"Enriching {len(targets)} Birmingham estate prospects...")
    enrichments: list[dict[str, str]] = []
    for i, row in enumerate(targets, 1):
        name = row.get("practice_name") or row.get("company_name") or "?"
        print(f"[{i}/{len(targets)}] {name}")
        try:
            enr = enrich_one(row)
        except Exception as exc:
            enr = {
                "company_name": name,
                "company_number": row.get("company_number") or "",
                "postcode": row.get("postcode") or "",
                "area": row.get("area") or "",
                "notes": f"enrich_error:{exc}",
            }
        enrichments.append(enr)
        print(
            f"    web={enr.get('website') or '-'} email={enr.get('email') or '-'} "
            f"crm={enr.get('crm_detected') or '-'} directors={enr.get('contact_name') or '-'}"
        )
        time.sleep(0.4)

    fields = [
        "company_name",
        "company_number",
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
        "notes",
    ]
    with OUT_CSV.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields, extrasaction="ignore")
        writer.writeheader()
        for row in enrichments:
            writer.writerow({k: row.get(k, "") for k in fields})

    OUT_JSON.write_text(json.dumps(enrichments, indent=2), encoding="utf-8")
    updated = update_marketing_list(enrichments)

    with_web = sum(1 for e in enrichments if e.get("website"))
    with_email = sum(1 for e in enrichments if e.get("email"))
    with_dir = sum(1 for e in enrichments if e.get("contact_name"))
    with_crm = sum(1 for e in enrichments if e.get("crm_detected"))
    print("---")
    print(f"Wrote {OUT_CSV}")
    print(f"Updated marketing list rows: {updated}")
    print(f"Websites: {with_web}/{len(enrichments)}")
    print(f"Emails: {with_email}/{len(enrichments)}")
    print(f"Directors: {with_dir}/{len(enrichments)}")
    print(f"CRM detected: {with_crm}/{len(enrichments)}")


if __name__ == "__main__":
    main()
