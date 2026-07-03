"""Shared dental marketing list builder for UK postcode regions."""

from __future__ import annotations

import csv
import json
import re
import ssl
import time
import urllib.request
import xml.etree.ElementTree as ET
import zipfile
from collections import Counter
from dataclasses import dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Callable
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "data" / "research"
REGIONS_DIR = RESEARCH / "regions"
CQC_ZIP_URL = "https://www.cqc.org.uk/sites/default/files/2026-07/01_July_2026_CQC_directory.zip"
CQC_CSV = RESEARCH / "01_July_2026_CQC_directory.csv"
ADG_GROUPS = RESEARCH / "adg-corporate-groups.json"
BDA_GP_KML = RESEARCH / "bda-good-practice.kml"
BDA_GP_KML_URL = "https://www.google.com/maps/d/kml?mid=1jijuQW4yxqNedsPRyfktaHFMG30SrFPz&forcekml=1"

PMS_PATTERNS: list[tuple[str, list[str], str]] = [
    ("Dentally", [r"portal\.dental", r"dentr\.net", r"checkout\.portal\.dental", r"dentally\.co", r"dentally\.com"], "high"),
    ("Exact/SOE", [r"onlineappointments\.co\.uk", r"softwareofexcellence", r"soeidental"], "high"),
    ("Pearl", [r"pearl\.dental", r"pearldentalsoftware"], "medium"),
    ("Aerona", [r"aerona\.com", r"aeronacloud"], "medium"),
    ("Carestream/R4", [r"r4\.dental", r"carestream dental"], "medium"),
    ("MyDentist corporate", [r"mydentist\.co\.uk"], "low"),
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

    @property
    def overrides_path(self) -> Path:
        return RESEARCH / self.overrides_file

    @property
    def master_csv(self) -> Path:
        return RESEARCH / f"{self.file_prefix}-marketing-list.csv"

    @property
    def core_outward_set(self) -> set[str]:
        return set(self.core_outward_codes)


class LinkExtractor(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.links: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag.lower() != "a":
            return
        href = dict(attrs).get("href")
        if href:
            self.links.append(href)


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
    )


def blast_fields(region: RegionConfig) -> list[str]:
    return [
        "practice_name",
        "also_known_as",
        "address",
        "postcode",
        region.area_column,
        "phone",
        "website",
        "nhs_private",
        "pms_detected",
        "pms_confidence",
        "pms_evidence",
        "blast_segment",
        "wisecall_tier",
        "adg_corporate",
        "adg_group",
        "bda_good_practice",
        "provider_name",
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
        "pms",
        "segment",
        "tier",
        "adg_corporate",
        "adg_group",
        "bda_good_practice",
        "website",
        "notes",
    ]


def ensure_cqc_csv() -> None:
    RESEARCH.mkdir(parents=True, exist_ok=True)
    if CQC_CSV.exists():
        return
    zip_path = RESEARCH / "cqc_directory.zip"
    print(f"Downloading CQC directory -> {zip_path}")
    urllib.request.urlretrieve(CQC_ZIP_URL, zip_path)
    with zipfile.ZipFile(zip_path) as zf:
        zf.extractall(RESEARCH)
    print(f"Extracted {CQC_CSV.name}")


def norm_phone(raw: str) -> str:
    digits = re.sub(r"\D", "", raw or "")
    if not digits:
        return ""
    if digits.startswith("44"):
        digits = "0" + digits[2:]
    if len(digits) == 10 and not digits.startswith("0"):
        digits = "0" + digits
    if len(digits) == 11 and digits.startswith("0"):
        if digits.startswith("01") or digits.startswith("02"):
            return f"{digits[:5]} {digits[5:]}"
        return f"{digits[:4]} {digits[4:]}"
    return digits


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


def fetch(url: str, timeout: int = 15) -> tuple[str, str]:
    if not url:
        return "", url
    url = url.strip()
    if not url.startswith("http"):
        url = "https://" + url
    headers = {"User-Agent": "WiseCallResearch/1.0 (+https://wisecall.io)"}
    for attempt in range(2):
        try:
            req = urllib.request.Request(url, headers=headers)
            with urllib.request.urlopen(req, timeout=timeout, context=CTX) as resp:
                return resp.read(350_000).decode("utf-8", "ignore"), resp.geturl()
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
    for href in parser.links:
        if href.startswith(("mailto:", "tel:", "#")):
            continue
        full = urljoin(base_url, href)
        host = urlparse(full).netloc
        if host and base_host and host != base_host:
            if re.search(r"portal\.dental|dentr\.net|onlineappointments|dentally|soeidental", full, re.I):
                out.add(full)
            continue
        if re.search(r"book|appointment|portal|online", full, re.I):
            out.add(full)
    return list(out)[:8]


def detect_pms(html: str) -> tuple[list[str], list[str]]:
    found: list[str] = []
    evidence: list[str] = []
    for name, patterns, _conf in PMS_PATTERNS:
        for pat in patterns:
            match = re.search(pat, html, re.I)
            if match:
                found.append(name)
                evidence.append(f"{name}:{match.group(0)[:100]}")
                break
    return list(dict.fromkeys(found)), evidence


def blast_segment(pms_list: list[str], override: str | None = None) -> str:
    if override:
        return override
    if "Dentally" in pms_list:
        return "Dentally confirmed"
    if "Exact/SOE" in pms_list:
        return "Exact/SOE confirmed"
    if any(x in pms_list for x in ("Pearl", "Aerona", "Carestream/R4")):
        return "Other PMS detected"
    return "Unknown PMS - manual check"


def norm_key(text: str) -> str:
    return re.sub(r"[^a-z0-9]", "", (text or "").lower())


def wisecall_tier(segment: str, pms_list: list[str], adg_corporate: bool = False) -> str:
    if adg_corporate:
        return "Tier 4 - ADG corporate group (lower priority)"
    if segment in ("Dentally confirmed", "Dentally likely"):
        return "Tier 1 - Dentally integration ready"
    if segment == "Exact/SOE confirmed":
        return "Tier 2 - Exact/SOE workflow (no live booking integration yet)"
    if "MyDentist corporate" in pms_list:
        return "Tier 4 - Corporate chain (lower priority)"
    return "Tier 3 - Unknown PMS (qualify on call)"


def load_cqc_practices(region: RegionConfig) -> dict[str, dict[str, str]]:
    practices: dict[str, dict[str, str]] = {}
    pc_re = re.compile(region.postcode_regex)
    with CQC_CSV.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for _ in range(4):
            next(reader)
        header = next(reader)
        idx = {h: i for i, h in enumerate(header)}
        for row in reader:
            pc = row[idx["Postcode"]].strip().upper().replace(" ", "")
            if not pc_re.match(pc):
                continue
            service = row[idx["Service types"]]
            if "Dentist" not in service and "Orthodont" not in service:
                continue
            name = row[idx["Name"]].strip()
            key = re.sub(r"[^a-z0-9]", "", name.lower()) + pc
            postcode = row[idx["Postcode"]].strip().upper()
            practices[key] = {
                "practice_name": name,
                "also_known_as": row[idx["Also known as"]].strip(),
                "address": row[idx["Address"]].replace(",", ", "),
                "postcode": postcode,
                "phone": norm_phone(row[idx["Phone number"]]),
                "website": row[idx["Service's website (if available)"]].strip(),
                "provider_name": row[idx["Provider name"]].strip(),
                "nhs_private": "Unknown",
                "pms_detected": "",
                "pms_confidence": "",
                "pms_evidence": "",
                "blast_segment": "Unknown PMS - manual check",
                "wisecall_tier": "Tier 3 - Unknown PMS (qualify on call)",
                "adg_corporate": "No",
                "adg_group": "",
                "bda_good_practice": "No",
                region.area_column: area_label(postcode, region.area_labels),
                "notes": "",
                "source": "CQC directory (auto-downloaded)",
            }
    return practices


def apply_overrides(practices: dict[str, dict[str, str]], region: RegionConfig) -> None:
    path = region.overrides_path
    if not path.exists():
        return
    data = json.loads(path.read_text(encoding="utf-8"))
    for override in data.get("practices", []):
        names = override.get("match_names", [])
        exact = override.get("match_exact", False)
        for practice in practices.values():
            matched = False
            for n in names:
                pn = practice["practice_name"].lower()
                nn = n.lower()
                if exact and pn == nn:
                    matched = True
                    break
                if not exact and (nn in pn or pn in nn):
                    matched = True
                    break
            if not matched:
                continue
            if override.get("lock_pms"):
                practice["_lock_pms"] = "1"
            for field in (
                "website",
                "phone",
                "pms_detected",
                "pms_confidence",
                "pms_evidence",
                "blast_segment",
                "notes",
            ):
                if field in override:
                    if field == "phone" and override[field]:
                        practice[field] = norm_phone(override[field])
                    else:
                        practice[field] = override[field]
            if override.get("blast_segment"):
                practice["wisecall_tier"] = wisecall_tier(
                    override["blast_segment"],
                    [x.strip() for x in practice.get("pms_detected", "").split(";") if x.strip()],
                    practice.get("adg_corporate") == "Yes",
                )


def ensure_bda_kml() -> None:
    if BDA_GP_KML.exists() and BDA_GP_KML.stat().st_size > 1000:
        return
    print(f"Downloading BDA Good Practice KML -> {BDA_GP_KML}")
    req = urllib.request.Request(BDA_GP_KML_URL, headers={"User-Agent": "WiseCallResearch/1.0"})
    with urllib.request.urlopen(req, timeout=90, context=CTX) as resp:
        BDA_GP_KML.write_bytes(resp.read())


def load_bda_good_practice_index() -> tuple[set[str], dict[str, set[str]]]:
    ensure_bda_kml()
    root = ET.fromstring(BDA_GP_KML.read_bytes())
    ns = {"kml": "http://www.opengis.net/kml/2.2"}
    by_postcode: dict[str, set[str]] = {}
    all_postcodes: set[str] = set()
    for pm in root.findall(".//kml:Placemark", ns):
        name = (pm.find("kml:name", ns).text or "").strip()
        postcode = ""
        for data in pm.findall(".//kml:Data", ns):
            if data.get("name") == "Postcode":
                val = data.find("kml:value", ns)
                if val is not None and val.text:
                    postcode = val.text.strip().upper().replace(" ", "")
        if not postcode:
            desc = pm.find("kml:description", ns)
            if desc is not None and desc.text:
                match = re.search(r"Postcode:\s*([A-Z0-9 ]+)", desc.text, re.I)
                if match:
                    postcode = match.group(1).upper().replace(" ", "")
        if not postcode:
            continue
        all_postcodes.add(postcode)
        by_postcode.setdefault(postcode, set()).add(norm_key(name))
    return all_postcodes, by_postcode


def load_adg_groups() -> list[dict[str, object]]:
    if not ADG_GROUPS.exists():
        return []
    data = json.loads(ADG_GROUPS.read_text(encoding="utf-8"))
    return data.get("groups", [])


def match_adg(practice: dict[str, str], groups: list[dict[str, object]]) -> tuple[bool, str]:
    haystack = " ".join(
        [
            practice.get("practice_name", ""),
            practice.get("also_known_as", ""),
            practice.get("provider_name", ""),
            practice.get("website", ""),
        ]
    ).lower()
    for group in groups:
        name = str(group.get("name", ""))
        for pattern in group.get("patterns", []):
            if str(pattern).lower() in haystack:
                return True, name
    return False, ""


def match_bda(practice: dict[str, str], all_postcodes: set[str], by_postcode: dict[str, set[str]]) -> bool:
    pc = practice.get("postcode", "").upper().replace(" ", "")
    if pc in all_postcodes:
        names = by_postcode.get(pc, set())
        pn = norm_key(practice.get("practice_name", ""))
        aka = norm_key(practice.get("also_known_as", ""))
        if not names:
            return True
        if pn in names or aka in names:
            return True
        for bda_name in names:
            if bda_name and (bda_name in pn or pn in bda_name):
                return True
    return False


def apply_industry_flags(practices: dict[str, dict[str, str]]) -> None:
    adg_groups = load_adg_groups()
    bda_all, bda_by_pc = load_bda_good_practice_index()
    for practice in practices.values():
        is_adg, group = match_adg(practice, adg_groups)
        practice["adg_corporate"] = "Yes" if is_adg else "No"
        practice["adg_group"] = group
        practice["bda_good_practice"] = "Yes" if match_bda(practice, bda_all, bda_by_pc) else "No"


def recompute_tiers(practices: dict[str, dict[str, str]]) -> None:
    for practice in practices.values():
        pms = [x.strip() for x in practice.get("pms_detected", "").split(";") if x.strip()]
        practice["wisecall_tier"] = wisecall_tier(
            practice.get("blast_segment", "Unknown PMS - manual check"),
            pms,
            practice.get("adg_corporate") == "Yes",
        )


def scan_websites(practices: dict[str, dict[str, str]], sleep_s: float = 0.2) -> None:
    total = len(practices)
    for i, practice in enumerate(practices.values(), start=1):
        if i % 25 == 0 or i == total:
            print(f"  Scanning websites: {i}/{total}")
        if practice.get("_lock_pms") == "1":
            practice["wisecall_tier"] = wisecall_tier(
                practice["blast_segment"],
                [],
                practice.get("adg_corporate") == "Yes",
            )
            continue
        if practice.get("pms_confidence") == "high" and practice.get("blast_segment", "").startswith("Dentally"):
            practice["wisecall_tier"] = wisecall_tier(
                practice["blast_segment"],
                ["Dentally"],
                practice.get("adg_corporate") == "Yes",
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
        pms, evidence = detect_pms(combined)
        if practice.get("pms_detected") and practice.get("pms_confidence") in ("high", "medium"):
            if not pms:
                practice["wisecall_tier"] = wisecall_tier(
                    practice["blast_segment"],
                    [],
                    practice.get("adg_corporate") == "Yes",
                )
                time.sleep(sleep_s)
                continue
        practice["pms_detected"] = "; ".join(pms) if pms else practice.get("pms_detected", "")
        practice["pms_evidence"] = "; ".join(evidence) if evidence else practice.get("pms_evidence", "")
        practice["pms_confidence"] = (
            "high"
            if any(x in pms for x in ("Dentally", "Exact/SOE"))
            else ("medium" if pms else practice.get("pms_confidence") or "none")
        )
        if not practice.get("blast_segment") or practice["blast_segment"] == "Unknown PMS - manual check":
            practice["blast_segment"] = blast_segment(pms)
        practice["wisecall_tier"] = wisecall_tier(
            practice["blast_segment"],
            pms,
            practice.get("adg_corporate") == "Yes",
        )
        time.sleep(sleep_s)


def write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fields})


def to_outbound_row(practice: dict[str, str], region: RegionConfig) -> dict[str, str]:
    return {
        "name": practice["practice_name"],
        "phone": practice["phone"],
        "company": practice["practice_name"],
        "postcode": practice["postcode"],
        region.area_column: practice.get(region.area_column, ""),
        "pms": practice.get("pms_detected") or "Unknown",
        "segment": practice["blast_segment"],
        "tier": practice["wisecall_tier"],
        "adg_corporate": practice.get("adg_corporate", "No"),
        "adg_group": practice.get("adg_group", ""),
        "bda_good_practice": practice.get("bda_good_practice", "No"),
        "website": practice.get("website", ""),
        "notes": practice.get("notes", ""),
    }


def load_existing_pms(practices: dict[str, dict[str, str]], region: RegionConfig) -> None:
    path = region.master_csv
    if not path.exists():
        return
    with path.open(newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            key = norm_key(row.get("practice_name", "")) + row.get("postcode", "").upper().replace(" ", "")
            for practice in practices.values():
                pk = norm_key(practice["practice_name"]) + practice["postcode"].upper().replace(" ", "")
                if pk != key:
                    continue
                for field in (
                    "pms_detected",
                    "pms_confidence",
                    "pms_evidence",
                    "blast_segment",
                    "website",
                    "phone",
                    "notes",
                ):
                    if row.get(field):
                        practice[field] = row[field]
                break


def segment_definitions(region: RegionConfig) -> list[tuple[str, Callable[[dict[str, str]], bool]]]:
    core = region.core_segment_prefix
    core_outwards = region.core_outward_set

    def in_core(p: dict[str, str]) -> bool:
        return is_core(p["postcode"], core_outwards) and bool(p["phone"])

    return [
        ("dentally-confirmed", lambda p: p["blast_segment"] == "Dentally confirmed" and p["phone"]),
        ("dentally-tier1-blast", lambda p: p["wisecall_tier"].startswith("Tier 1") and p["phone"]),
        (
            "dentally-tier1-independents",
            lambda p: p["wisecall_tier"].startswith("Tier 1")
            and p["phone"]
            and p.get("adg_corporate") != "Yes",
        ),
        ("exact-soe-confirmed", lambda p: p["blast_segment"] == "Exact/SOE confirmed" and p["phone"]),
        (f"{core}-all", in_core),
        (
            f"{core}-independents",
            lambda p: in_core(p) and p.get("adg_corporate") != "Yes",
        ),
        (
            f"{core}-bda-good-practice",
            lambda p: in_core(p) and p.get("bda_good_practice") == "Yes",
        ),
        (
            f"{core}-unknown-pms",
            lambda p: in_core(p) and p["blast_segment"] == "Unknown PMS - manual check",
        ),
    ]


def build_region(region_id: str, skip_scan: bool = False) -> None:
    region = load_region(region_id)
    ensure_cqc_csv()
    practices = load_cqc_practices(region)
    apply_overrides(practices, region)
    apply_industry_flags(practices)
    if skip_scan:
        print("Skipping website PMS scan (--skip-website-scan); reusing existing PMS columns if present")
        load_existing_pms(practices, region)
        recompute_tiers(practices)
    else:
        print(f"Scanning {len(practices)} practice websites for PMS fingerprints...")
        scan_websites(practices)
        recompute_tiers(practices)

    all_rows = sorted(
        practices.values(),
        key=lambda p: (p["wisecall_tier"], p["postcode"], p["practice_name"]),
    )
    write_csv(region.master_csv, blast_fields(region), all_rows)

    for slug, predicate in segment_definitions(region):
        rows = [to_outbound_row(p, region) for p in all_rows if predicate(p)]
        write_csv(RESEARCH / f"{region.file_prefix}-{slug}-outbound.csv", outbound_fields(region), rows)
        print(f"{slug}: {len(rows)} rows")

    print("---")
    print(f"Region: {region.name} ({region.id})")
    print(f"Total practices: {len(all_rows)}")
    print(f"With phone: {sum(1 for p in all_rows if p['phone'])}")
    print(f"With website: {sum(1 for p in all_rows if p['website'])}")
    print(f"ADG corporate: {sum(1 for p in all_rows if p.get('adg_corporate') == 'Yes')}")
    print(f"BDA Good Practice: {sum(1 for p in all_rows if p.get('bda_good_practice') == 'Yes')}")
    print(f"{region.core_segment_prefix} (inner area): {sum(1 for p in all_rows if is_core(p['postcode'], region.core_outward_set))}")
    print("Segments:", dict(Counter(p["blast_segment"] for p in all_rows)))
    print("Tiers:", dict(Counter(p["wisecall_tier"] for p in all_rows)))
