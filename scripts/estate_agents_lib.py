"""Shared estate agents marketing list builder for UK postcode regions using Companies House."""

from __future__ import annotations

import csv
import html
import json
import os
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import Counter
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "data" / "research"
ESTATE_DIR = RESEARCH / "estate-agents"
REGIONS_DIR = ESTATE_DIR / "regions"

ESTATE_DIR.mkdir(parents=True, exist_ok=True)
REGIONS_DIR.mkdir(parents=True, exist_ok=True)

COMPANIES_HOUSE_API = "https://api.company-information.service.gov.uk"
SIC_CODE_ESTATE_AGENCY = "68310"

# CRM detection patterns for estate agents
CRM_PATTERNS: list[tuple[str, list[str], str]] = [
    ("Street.co.uk", [r"street\.co\.uk", r"street\.co\.uk/embed", r"street-embed"], "high"),
    ("Reapit", [r"reapit\.com", r"reapit\.co\.uk", r"reapit-crm", r"reapitare"], "high"),
    ("Alto", [r"alto\.co\.uk", r"altosoftware", r"alto-crm"], "high"),
    ("Jupix", [r"jupix\.co\.uk", r"jupix\.com", r"jupix-crm"], "high"),
    ("Qube", [r"qube\.crm", r"qubesoftware", r"qube-crm"], "medium"),
    ("Rex CRM", [r"rex\.crm", r"rexcrm"], "medium"),
    ("PropCo", [r"propco\.co\.uk", r"propco-crm"], "medium"),
    ("AgentHub", [r"agenthub\.co\.uk", r"agent-hub"], "medium"),
    ("Spectre", [r"spectre\.co\.uk", r"spectre-crm"], "medium"),
    ("Veco", [r"veco\.co\.uk", r"veco-crm"], "medium"),
    ("PropertyLive", [r"propertylive\.co\.uk", r"property-live"], "medium"),
    ("Pebble", [r"pebble\.crm", r"pebblecrm"], "medium"),
    ("Noggin", [r"noggin\.crm", r"noggincrm"], "low"),
    ("Kerrison", [r"kerrison\.co\.uk"], "low"),
    ("Lifesycle", [r"lifesycle\.com", r"lifesycle-crm"], "medium"),
    ("AgentPlus", [r"agentplus\.co\.uk"], "low"),
    ("TrackMySale", [r"trackmysale\.co\.uk"], "low"),
    ("Viewber", [r"viewber\.co\.uk"], "low"),
]

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


@dataclass(frozen=True)
class RegionConfig:
    id: str
    name: str
    postcode_regex: str
    area_column: str
    file_prefix: str
    overrides_file: str
    core_outward_codes: tuple[str, ...]
    core_segment_prefix: str
    area_labels: dict[str, str]
    data_source: str = "companies_house"
    country: str = "england"
    postcode_prefixes: tuple[str, ...] = ()
    search_city: str = ""
    search_cities: tuple[str, ...] = ()

    @property
    def overrides_path(self) -> Path:
        return ESTATE_DIR / self.overrides_file

    @property
    def master_csv(self) -> Path:
        return ESTATE_DIR / f"{self.file_prefix}-marketing-list.csv"

    @property
    def core_outward_set(self) -> set[str]:
        return set(self.core_outward_codes)

    def get_search_prefixes(self) -> list[str]:
        """Get postcode prefixes for Companies House advanced search."""
        if self.postcode_prefixes:
            return list(self.postcode_prefixes)
        # Fallback: extract from regex
        import re
        match = re.match(r'^\^?([A-Z]{1,2})', self.postcode_regex)
        return [match.group(1)] if match else [self.postcode_regex[0]]


class LinkExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[tuple[str, str]] = []
        self._href: str | None = None
        self._text: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        href = dict(attrs).get("href")
        if href:
            self._href = href
            self._text = []

    def handle_data(self, data: str) -> None:
        if self._href is not None:
            self._text.append(data)

    def handle_endtag(self, tag: str) -> None:
        if tag.lower() == "a" and self._href is not None:
            self.links.append((self._href, " ".join(self._text)))
            self._href = None
            self._text = []


def load_region(region_id: str) -> RegionConfig:
    path = REGIONS_DIR / f"{region_id}.json"
    if not path.exists():
        available = ", ".join(sorted(p.stem for p in REGIONS_DIR.glob("*.json")))
        raise SystemExit(f"Unknown region '{region_id}'. Available: {available}")
    data = json.loads(path.read_text(encoding="utf-8"))
    return RegionConfig(
        id=data["id"],
        name=data["name"],
        postcode_regex=data["postcode_regex"],
        area_column=data["area_column"],
        file_prefix=data["file_prefix"],
        overrides_file=data["overrides_file"],
        core_outward_codes=tuple(data["core_outward_codes"]),
        core_segment_prefix=data["core_segment_prefix"],
        area_labels=data["area_labels"],
        data_source=data.get("data_source", "companies_house"),
        country=data.get("country", "england"),
        postcode_prefixes=tuple(data.get("postcode_prefixes", [])),
        search_city=str(data.get("search_city") or "").strip(),
        search_cities=tuple(data.get("search_cities") or []),
    )


def blast_fields(region: RegionConfig) -> list[str]:
    return [
        "company_name",
        "company_number",
        "registered_office_address",
        "postcode",
        "phone",
        "website",
        "sic_codes",
        "company_status",
        "date_of_creation",
        "director_names",
        "director_roles",
        "officer_count",
        "crm_detected",
        "crm_confidence",
        "crm_evidence",
        "blast_segment",
        "wisecall_tier",
        "corporate_group",
        "corporate_group_name",
        "area",
        "source",
        "notes",
    ]


def outbound_fields(region: RegionConfig) -> list[str]:
    return [
        "name",
        "phone",
        "company",
        "postcode",
        region.area_column,
        "segment",
        "tier",
        "corporate_group",
        "corporate_group_name",
        "website",
        "director_names",
        "notes",
    ]


# --- CRM Detection & Website Scanning ---

def html_to_text(raw: str) -> str:
    raw = re.sub(r"(?is)<(script|style|noscript|svg).*?</\1>", " ", raw)
    raw = re.sub(r"(?i)<br\s*/?>", "\n", raw)
    raw = re.sub(r"(?i)</(p|div|li|h[1-6]|tr|section|article)>", "\n", raw)
    raw = re.sub(r"(?s)<[^>]+>", " ", raw)
    return html.unescape(raw).replace("\xa0", " ")


def fetch_page(url: str, timeout: int = 15) -> tuple[str, str]:
    if not url:
        return "", url
    url = url.strip()
    if not re.match(r"^https?://", url, re.I):
        url = "https://" + url
    headers = {"User-Agent": "WiseCallResearch/1.0 (+https://wisecall.io)"}
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as resp:
                ctype = resp.headers.get("content-type", "")
                if "text/html" not in ctype and "application/xhtml" not in ctype:
                    return "", resp.geturl()
                raw = resp.read(350_000).decode("utf-8", "ignore")
                return raw, resp.geturl()
        except Exception:
            if attempt == 0 and url.startswith("https://"):
                url = "http://" + url[8:]
            else:
                return "", url
    return "", url


def booking_links(base_url: str, html: str) -> list[str]:
    parser = LinkExtractor()
    try:
        parser.feed(html)
    except Exception:
        return []
    out: set[str] = set()
    base_host = urlparse(base_url).netloc
    for href, text in parser.links:
        if href.startswith(("mailto:", "tel:", "#", "javascript:")):
            continue
        full = urljoin(base_url, href)
        host = urlparse(full).netloc
        if host and base_host and host != base_host:
            if re.search(r"street|reapit|alto|jupix|qube|booking|valuation", full, re.I):
                out.add(full)
            continue
        if re.search(r"book|valuation|appointment|portal|online", full, re.I):
            out.add(full)
    return list(out)[:8]


def detect_crm(html: str) -> tuple[list[str], list[str]]:
    found: list[str] = []
    evidence: list[str] = []
    for name, patterns, _conf in CRM_PATTERNS:
        for pat in patterns:
            match = re.search(pat, html, re.I)
            if match:
                found.append(name)
                evidence.append(f"{name}:{match.group(0)[:100]}")
                break
    return list(dict.fromkeys(found)), evidence


def crm_segment(crm_list: list[str], override: str | None = None) -> str:
    if override:
        return override
    if "Street.co.uk" in crm_list:
        return "Street.co.uk confirmed"
    if "Reapit" in crm_list:
        return "Reapit confirmed"
    if "Alto" in crm_list:
        return "Alto confirmed"
    if "Jupix" in crm_list:
        return "Jupix confirmed"
    if any(x in crm_list for x in ("Qube", "Rex CRM", "PropCo", "AgentHub", "Spectre", "Veco", "PropertyLive", "Pebble", "Lifesycle")):
        return "Other CRM detected"
    return "Unknown CRM - manual check"


def wisecall_tier(segment: str, crm_list: list[str], corporate_group: bool = False) -> str:
    if corporate_group:
        return "Tier 4 - Corporate group (lower priority)"
    if segment in ("Street.co.uk confirmed", "Reapit confirmed", "Alto confirmed", "Jupix confirmed"):
        return "Tier 1 - CRM integration ready"
    if "Other CRM detected" in segment:
        return "Tier 2 - CRM workflow (no live booking integration yet)"
    return "Tier 3 - Unknown CRM (qualify on call)"


def norm_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def outward_code(postcode: str) -> str:
    pc = postcode.upper().replace(" ", "")
    if len(pc) < 5:
        return ""
    return pc[:-3]


def area_label(postcode: str, labels: dict[str, str]) -> str:
    outward = outward_code(postcode)
    return labels.get(outward, outward or "Unknown")


def is_core(postcode: str, core_outwards: set[str]) -> bool:
    return outward_code(postcode) in core_outwards


# --- Corporate Group Detection ---

MAJOR_CORPORATE_GROUPS: list[tuple[str, list[str]]] = [
    ("Savills", ["savills"]),
    ("Knight Frank", ["knight frank"]),
    ("Foxtons", ["foxtons"]),
    ("Hamptons", ["hamptons"]),
    ("Chestertons", ["chestertons"]),
    ("Strutt & Parker", ["strutt", "parker"]),
    ("Cluttons", ["cluttons"]),
    ("Carter Jonas", ["carter jonas"]),
    ("Jackson Stops", ["jackson stops"]),
    ("Dexters", ["dexters"]),
    ("Winkworth", ["winkworth"]),
    ("Douglas & Gordon", ["douglas gordon"]),
    ("Marsden", ["marsden"]),
    ("Haart", ["haart"]),
    ("Your Move", ["your move"]),
    ("Reilly & Co", ["reilly"]),
    ("Barnes", ["barnes"]),
    ("Benham & Reeves", ["benham", "reeves"]),
    ("KFH", ["kfh"]),
    ("London Residential", ["london residential"]),
    ("Rightmove", ["rightmove"]),
    ("Zoopla", ["zoopla"]),
    ("OnTheMarket", ["onthemarket"]),
    ("Countrywide", ["countrywide"]),
    ("Connells", ["connells"]),
    ("Leaders", ["leaders"]),
    ("Martin & Co", ["martin co", "martin & co"]),
    ("Belvoir", ["belvoir"]),
    ("Ludlow Thompson", ["ludlow thompson"]),
    ("Foxtons", ["foxtons"]),
]


def match_corporate_group(company: dict[str, str]) -> tuple[bool, str]:
    haystack = " ".join([
        company.get("company_name", ""),
        company.get("website", ""),
        company.get("director_names", ""),
    ]).lower()
    for group_name, patterns in MAJOR_CORPORATE_GROUPS:
        for pattern in patterns:
            if pattern.lower() in haystack:
                return True, group_name
    return False, ""


PUBLIC_CH = "https://find-and-update.company-information.service.gov.uk"
PUBLIC_UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
    "AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36"
)


def ensure_ch_api_key() -> str:
    key = os.environ.get("COMPANIES_HOUSE_API_KEY", "").strip()
    if not key:
        raise SystemExit("Set COMPANIES_HOUSE_API_KEY environment variable")
    return key


def public_http_get(url: str, timeout: int = 25) -> str:
    req = urllib.request.Request(
        url,
        headers={"User-Agent": PUBLIC_UA, "Accept": "text/html"},
    )
    with urllib.request.urlopen(req, timeout=timeout, context=CTX) as resp:
        return resp.read().decode("utf-8", "ignore")


def search_companies_public(query: str, page: int = 1) -> list[str]:
    params = urllib.parse.urlencode({"q": query, "page": str(page)})
    html = public_http_get(f"{PUBLIC_CH}/search/companies?{params}")
    numbers = re.findall(r"/company/([0-9]{8})", html)
    seen: set[str] = set()
    out: list[str] = []
    for number in numbers:
        if number in seen:
            continue
        seen.add(number)
        out.append(number)
    return out


def parse_public_company_profile(page_html: str) -> dict[str, str | list[str]]:
    status_match = re.search(
        r"Company status[\s\S]*?<dd[^>]*>\s*([^<]+)",
        page_html,
        flags=re.I,
    )
    address_match = re.search(
        r"Registered office address[\s\S]*?<dd[^>]*>([\s\S]*?)</dd>",
        page_html,
        flags=re.I,
    )
    address_html = address_match.group(1) if address_match else ""
    address_text = re.sub(r"<[^>]+>", " ", html.unescape(address_html))
    address_text = re.sub(r"\s+", " ", address_text).strip()
    postcode_match = re.search(r"\b([A-Z]{1,2}\d[\dA-Z]?\s*\d[A-Z]{2})\b", address_text.upper())
    postcode = postcode_match.group(1).strip() if postcode_match else ""
    sic_codes = re.findall(r"id=\"sic\d+\">\s*(\d{5})\s*-", page_html)
    title_match = re.search(r"<title>([^<-]+)", page_html)
    name = title_match.group(1).strip() if title_match else ""
    return {
        "company_name": name,
        "company_status": (status_match.group(1).strip() if status_match else ""),
        "registered_office_address": address_text,
        "postcode": postcode,
        "sic_codes": sic_codes,
    }


def get_company_profile_public(company_number: str) -> dict:
    page_html = public_http_get(f"{PUBLIC_CH}/company/{company_number}")
    profile = parse_public_company_profile(page_html)
    profile["company_number"] = company_number
    return profile


def get_company_officers_public(company_number: str) -> list[dict]:
    page_html = public_http_get(f"{PUBLIC_CH}/company/{company_number}/officers")
    names = re.findall(r'href="/officers/[^"]+"[^>]*>\s*([^<]+)', page_html)
    officers: list[dict] = []
    seen: set[str] = set()
    for raw in names:
        name = html.unescape(raw).strip()
        key = re.sub(r"[^a-z]", "", name.lower())
        if len(key) < 4 or key in seen:
            continue
        if name.lower() in {"view cookies", "sign in / register", "companies", "officers"}:
            continue
        seen.add(key)
        officers.append({"name": name, "officer_role": "director", "resigned_on": None})
    return officers


def region_search_cities(region: RegionConfig) -> list[str]:
    if region.search_cities:
        return list(region.search_cities)
    if region.search_city:
        return [region.search_city]
    return [region.name.split()[0]]


def ch_request(path: str, params: dict | None = None) -> dict:
    api_key = ensure_ch_api_key()
    import base64
    auth = base64.b64encode(f"{api_key}:".encode()).decode()
    url = f"{COMPANIES_HOUSE_API}{path}"
    if params:
        url += "?" + urllib.parse.urlencode(params)
    req = urllib.request.Request(
        url,
        headers={
            "Authorization": f"Basic {auth}",
            "Accept": "application/json",
        },
    )
    for attempt in range(5):
        try:
            with urllib.request.urlopen(req, timeout=30, context=CTX) as resp:
                return json.loads(resp.read().decode("utf-8"))
        except urllib.error.HTTPError as err:
            detail = err.read().decode("utf-8", "ignore")
            if err.code == 429:
                wait = 2 ** attempt + (attempt * 0.5)
                print(f"Rate limited, waiting {wait:.1f}s...")
                time.sleep(wait)
                continue
            if err.code == 416:
                # Range not satisfiable - past end of results
                return {"items": [], "total_results": 0}
            raise RuntimeError(f"Companies House API error {err.code}: {detail}") from err
    raise RuntimeError(f"Companies House API failed after retries: {path}")


def search_companies_by_sic_and_postcode(
    sic_code: str, postcode_prefix: str, items_per_page: int = 100
) -> list[dict]:
    """Search Companies House for 'estate agents London', paginate, filter by SIC and actual postcode prefix.
    Conservative: max 5 pages, 5 profiles/page, 5s delay between profiles.
    """
    companies: list[dict] = []
    
    estate_keywords = [
        "estate agent", "estate agents", "property", "letting", "lettings",
        "residential", "sales", "property management", "chartered surveyor",
        "surveyor", "estate ag", "property consultant", "real estate",
        "property services", "homes", "property lettings"
    ]
    
    max_pages = 5
    total_candidates = 0
    
    for page in range(max_pages):
        start_index = page * items_per_page
        params = {
            "q": "estate agents London",
            "items_per_page": str(items_per_page),
            "start_index": str(start_index),
        }
        result = ch_request("/search/companies", params)
        items = result.get("items", [])
        if not items:
            break
        
        candidates = []
        for item in items:
            title = (item.get("title") or "").lower()
            if any(kw in title for kw in estate_keywords):
                candidates.append(item)
        
        total_candidates += len(candidates)
        print(f"  {postcode_prefix} page {page+1}: {len(items)} results, {len(candidates)} candidates")
        
        found_this_page = 0
        for item in candidates[:5]:
            company_number = item.get("company_number")
            if not company_number:
                continue
            try:
                profile = get_company_profile(company_number)
                if sic_code not in profile.get("sic_codes", []):
                    continue
                addr = profile.get("registered_office_address", {})
                pc = (addr.get("postal_code") or "").upper().replace(" ", "")
                if not pc.startswith(postcode_prefix.upper()):
                    continue
                item["registered_office_address"] = addr
                item["sic_codes"] = profile.get("sic_codes", [])
                item["company_status"] = profile.get("company_status", "")
                item["date_of_creation"] = profile.get("date_of_creation", "")
                companies.append(item)
                found_this_page += 1
            except RuntimeError as e:
                if "429" in str(e):
                    print(f"    Rate limited on {company_number}, stopping...")
                    return companies
                print(f"    Error fetching {company_number}: {e}")
            time.sleep(5.0)
        
        if found_this_page == 0 and page > 0:
            break
        
        total_results = result.get("total_results", 0)
        if start_index + items_per_page >= total_results:
            break
        time.sleep(2.0)
    
    print(f"  {postcode_prefix}: {total_candidates} total candidates, {len(companies)} matched")
    return companies


def get_company_officers(company_number: str) -> list[dict]:
    result = ch_request(f"/company/{company_number}/officers", {"items_per_page": "100"})
    return result.get("items", [])


def get_company_profile(company_number: str) -> dict:
    return ch_request(f"/company/{company_number}", None)


def outward_code(postcode: str) -> str:
    pc = postcode.upper().replace(" ", "")
    if len(pc) < 5:
        return ""
    return pc[:-3]


def area_label(postcode: str, labels: dict[str, str]) -> str:
    outward = outward_code(postcode)
    return labels.get(outward, outward or "Unknown")


def is_core(postcode: str, core_outwards: set[str]) -> bool:
    return outward_code(postcode) in core_outwards


def norm_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def load_existing_data(practices: dict[str, dict[str, str]], region: RegionConfig) -> None:
    path = region.master_csv
    if not path.exists():
        return
    with path.open(newline="", encoding="utf-8-sig") as f:
        for row in csv.DictReader(f):
            key = norm_key(row.get("company_name", "")) + row.get("postcode", "").upper().replace(" ", "")
            for practice in practices.values():
                pk = norm_key(practice["company_name"]) + practice["postcode"].upper().replace(" ", "")
                if pk != key:
                    continue
                for field in ("website", "phone", "blast_segment", "wisecall_tier", "notes", "director_names"):
                    if row.get(field):
                        practice[field] = row[field]
                break


def write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fields})


def to_outbound_row(company: dict[str, str], region: RegionConfig) -> dict[str, str]:
    return {
        "name": company["company_name"],
        "phone": company.get("phone", ""),
        "company": company["company_name"],
        "postcode": company["postcode"],
        region.area_column: company.get("area", ""),
        "segment": company.get("blast_segment", "Unknown"),
        "tier": company.get("wisecall_tier", "Tier 3 - Unknown (qualify on call)"),
        "corporate_group": company.get("corporate_group", "No"),
        "corporate_group_name": company.get("corporate_group_name", ""),
        "website": company.get("website", ""),
        "director_names": company.get("director_names", ""),
        "notes": company.get("notes", ""),
    }


def segment_definitions(region: RegionConfig) -> list[tuple[str, Callable[[dict[str, str]], bool]]]:
    core = region.core_segment_prefix
    core_outwards = region.core_outward_set

    def in_core(c: dict[str, str]) -> bool:
        return is_core(c["postcode"], core_outwards) and bool(c.get("phone"))

    return [
        ("independents", lambda c: c.get("corporate_group") != "Yes" and c.get("phone")),
        ("corporate_groups", lambda c: c.get("corporate_group") == "Yes" and c.get("phone")),
        (f"{core}-all", in_core),
        (f"{core}-independents", lambda c: in_core(c) and c.get("corporate_group") != "Yes"),
        (f"{core}-corporate", lambda c: in_core(c) and c.get("corporate_group") == "Yes"),
    ]


def build_region(region_id: str, skip_officers: bool = False, skip_scan: bool = False) -> None:
    region = load_region(region_id)
    print(f"Building region: {region.name} ({region.id})")

    # Use search_city from config, fallback to first word of name
    search_city = getattr(region, 'search_city', '') or region.name.split()[0]
    search_prefixes = region.get_search_prefixes()
    prefix_set = {p.upper() for p in search_prefixes}
    
    print(f"Searching Companies House for SIC {SIC_CODE_ESTATE_AGENCY} in {search_city}...")
    
    all_companies = []
    seen = set()
    max_pages = 50  # 5,000 results max
    
    for page in range(max_pages):
        start_index = page * 100
        params = {
            "q": f"estate agents {search_city}",
            "items_per_page": "100",
            "start_index": str(start_index),
        }
        result = ch_request("/search/companies", params)
        items = result.get("items", [])
        if not items:
            break
        
        print(f"  Page {page+1}: {len(items)} results")
        
        for item in items:
            company_number = item.get("company_number")
            if not company_number or company_number in seen:
                continue
            seen.add(company_number)
            
            try:
                profile = get_company_profile(company_number)
                if SIC_CODE_ESTATE_AGENCY not in profile.get("sic_codes", []):
                    continue
                addr = profile.get("registered_office_address", {})
                pc = (addr.get("postal_code") or "").upper().replace(" ", "")
                # Check if postcode matches any of this region's prefixes
                matched_prefix = None
                for pfx in search_prefixes:
                    if pc.startswith(pfx.upper()):
                        matched_prefix = pfx.upper()
                        break
                if not matched_prefix:
                    continue
                
                item["registered_office_address"] = addr
                item["sic_codes"] = profile.get("sic_codes", [])
                item["company_status"] = profile.get("company_status", "")
                item["date_of_creation"] = profile.get("date_of_creation", "")
                all_companies.append(item)
            except RuntimeError as e:
                if "429" in str(e):
                    print(f"    Rate limited on {company_number}, stopping...")
                    break
                print(f"    Error fetching {company_number}: {e}")
            time.sleep(3.0)
        
        if len(items) < 100:
            break
        time.sleep(2.0)
    
    print(f"Found {len(all_companies)} unique estate agency companies in {search_city}")
    companies = all_companies

    practices: dict[str, dict[str, str]] = {}
    for item in companies:
        company_number = item.get("company_number", "")
        name = item.get("title", "").strip()
        addr = item.get("registered_office_address", {})
        address_parts = [
            addr.get("address_line_1", ""),
            addr.get("address_line_2", ""),
            addr.get("locality", ""),
            addr.get("region", ""),
            addr.get("postal_code", ""),
            addr.get("country", ""),
        ]
        address = ", ".join(p for p in address_parts if p)
        postcode = (addr.get("postal_code") or "").strip().upper()
        status = item.get("company_status", "")
        sic_codes = ", ".join(item.get("sic_codes", []))
        date_created = item.get("date_of_creation", "")

        key = norm_key(name) + postcode.replace(" ", "")
        practices[key] = {
            "company_name": name,
            "company_number": company_number,
            "registered_office_address": address,
            "postcode": postcode,
            "phone": "",
            "website": "",
            "sic_codes": sic_codes,
            "company_status": status,
            "date_of_creation": date_created,
            "director_names": "",
            "director_roles": "",
            "officer_count": "0",
            "crm_detected": "",
            "crm_confidence": "",
            "crm_evidence": "",
            "blast_segment": "Unknown CRM - manual check",
            "wisecall_tier": "Tier 3 - Unknown CRM (qualify on call)",
            "corporate_group": "No",
            "corporate_group_name": "",
            "area": area_label(postcode, region.area_labels),
            "source": "Companies House API",
            "notes": "",
        }

    if not skip_officers:
        print("Fetching officers for each company...")
        for i, practice in enumerate(practices.values(), 1):
            if i % 25 == 0 or i == len(practices):
                print(f"  Officers: {i}/{len(practices)}")
            officers = get_company_officers(practice["company_number"])
            active_officers = [
                o for o in officers
                if not o.get("resigned_on") and o.get("officer_role") in ("director", "secretary", "llp-member")
            ]
            practice["officer_count"] = str(len(active_officers))
            directors = [o for o in active_officers if o.get("officer_role") == "director"]
            practice["director_names"] = "; ".join(
                f"{o.get('name', '')} ({o.get('officer_role', '')})" for o in directors
            )
            practice["director_roles"] = "; ".join(
                o.get("officer_role", "") for o in active_officers
            )
            time.sleep(0.1)

    # Detect corporate groups from company names/directors/websites
    print("Detecting corporate groups...")
    for practice in practices.values():
        is_corp, group_name = match_corporate_group(practice)
        if is_corp:
            practice["corporate_group"] = "Yes"
            practice["corporate_group_name"] = group_name

    load_existing_data(practices, region)

    if not skip_scan:
        print(f"Scanning {len(practices)} practice websites for CRM fingerprints...")
        scan_websites(practices)
    else:
        print("Skipping website CRM scan (--skip-website-scan); reusing existing CRM columns if present")
        recompute_tiers(practices)

    all_rows = sorted(
        practices.values(),
        key=lambda c: (c["wisecall_tier"], c["postcode"], c["company_name"]),
    )
    write_csv(region.master_csv, blast_fields(region), all_rows)

    for slug, predicate in segment_definitions(region):
        rows = [to_outbound_row(c, region) for c in all_rows if predicate(c)]
        write_csv(ESTATE_DIR / f"{region.file_prefix}-{slug}-outbound.csv", outbound_fields(region), rows)
        print(f"{slug}: {len(rows)} rows")

    print("---")
    print(f"Region: {region.name} ({region.id})")
    print(f"Total companies: {len(all_rows)}")
    print(f"With phone: {sum(1 for c in all_rows if c.get('phone'))}")
    print(f"With website: {sum(1 for c in all_rows if c.get('website'))}")
    print(f"Corporate groups: {sum(1 for c in all_rows if c.get('corporate_group') == 'Yes')}")
    print(f"{region.core_segment_prefix} (inner area): {sum(1 for c in all_rows if is_core(c['postcode'], region.core_outward_set))}")
    print("Segments:", dict(Counter(c.get("blast_segment", "Unknown") for c in all_rows)))
    print("Tiers:", dict(Counter(c.get("wisecall_tier", "Unknown") for c in all_rows)))


def scan_websites(practices: dict[str, dict[str, str]], sleep_s: float = 0.2) -> None:
    total = len(practices)
    for i, practice in enumerate(practices.values(), start=1):
        if i % 25 == 0 or i == total:
            print(f"  Scanning websites: {i}/{total}")
        if practice.get("_lock_crm") == "1":
            practice["wisecall_tier"] = wisecall_tier(
                practice["blast_segment"],
                [],
                practice.get("corporate_group") == "Yes",
            )
            continue
        if practice.get("crm_confidence") == "high" and practice.get("blast_segment", "").endswith("confirmed"):
            practice["wisecall_tier"] = wisecall_tier(
                practice["blast_segment"],
                [practice["blast_segment"].replace(" confirmed", "")],
                practice.get("corporate_group") == "Yes",
            )
            continue
        if not practice["website"]:
            continue
        combined = ""
        body, final_url = fetch(practice["website"])
        combined += body
        if body:
            for link in booking_links(final_url, body):
                sub, _ = fetch(link)
                combined += "\n" + sub
                time.sleep(sleep_s / 2)
        if not body:
            practice["notes"] = "; ".join(filter(None, [practice.get("notes", ""), "website unreachable"]))
            continue
        crm, evidence = detect_crm(combined)
        if practice.get("crm_detected") and practice.get("crm_confidence") in ("high", "medium"):
            if not crm:
                practice["wisecall_tier"] = wisecall_tier(
                    practice["blast_segment"],
                    [],
                    practice.get("corporate_group") == "Yes",
                )
                time.sleep(sleep_s)
                continue
        practice["crm_detected"] = "; ".join(crm) if crm else practice.get("crm_detected", "")
        practice["crm_evidence"] = "; ".join(evidence) if evidence else practice.get("crm_evidence", "")
        practice["crm_confidence"] = (
            "high"
            if any(x in crm for x in ("Street.co.uk", "Reapit", "Alto", "Jupix"))
            else ("medium" if crm else practice.get("crm_confidence") or "none")
        )
        if not practice.get("blast_segment") or practice["blast_segment"] == "Unknown CRM - manual check":
            practice["blast_segment"] = crm_segment(crm)
        practice["wisecall_tier"] = wisecall_tier(
            practice["blast_segment"],
            crm,
            practice.get("corporate_group") == "Yes",
        )
        time.sleep(sleep_s)


def recompute_tiers(practices: dict[str, dict[str, str]]) -> None:
    for practice in practices.values():
        crm = [x.strip() for x in practice.get("crm_detected", "").split(";") if x.strip()]
        practice["wisecall_tier"] = wisecall_tier(
            practice.get("blast_segment", "Unknown CRM - manual check"),
            crm,
            practice.get("corporate_group") == "Yes",
        )


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print("Usage: python estate_agents_lib.py <region_id> [--skip-officers] [--skip-website-scan]")
        sys.exit(1)
    region_id = sys.argv[1]
    skip_officers = "--skip-officers" in sys.argv
    skip_scan = "--skip-website-scan" in sys.argv
    build_region(region_id, skip_officers=skip_officers, skip_scan=skip_scan)