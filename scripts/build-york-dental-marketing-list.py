#!/usr/bin/env python3
"""Build a York (YO postcode) dental marketing list for WiseCall outbound blasts.

Sources:
  - CQC public directory CSV (downloaded on first run)
  - Practice website scanning for Dentally / Exact-SOE fingerprints
  - Manual overrides in data/research/york-dental-manual-overrides.json

There is no public register of Dentally or Exact users. We infer PMS from public
booking links (portal.dental, dentr.net, onlineappointments.co.uk, etc.).
"""

from __future__ import annotations

import csv
import json
import re
import ssl
import time
import urllib.request
import zipfile
from collections import Counter
from typing import Callable
from html.parser import HTMLParser
from pathlib import Path
from urllib.parse import urljoin, urlparse

ROOT = Path(__file__).resolve().parents[1]
RESEARCH = ROOT / "data" / "research"
CQC_ZIP_URL = "https://www.cqc.org.uk/sites/default/files/2026-07/01_July_2026_CQC_directory.zip"
CQC_CSV = RESEARCH / "01_July_2026_CQC_directory.csv"
OVERRIDES = RESEARCH / "york-dental-manual-overrides.json"

YO_AREAS = {
    "YO1": "York city centre",
    "YO10": "York south/east",
    "YO11": "Scarborough",
    "YO12": "Scarborough",
    "YO13": "Scarborough rural",
    "YO14": "Filey",
    "YO15": "Bridlington",
    "YO16": "Bridlington",
    "YO17": "Malton area",
    "YO18": "Pickering area",
    "YO19": "York south",
    "YO21": "Whitby",
    "YO22": "Whitby rural",
    "YO23": "York west",
    "YO24": "York south-west",
    "YO25": "Driffield",
    "YO26": "York west/Acomb",
    "YO30": "York north/Clifton",
    "YO31": "York east/Heworth",
    "YO32": "York north/Haxby",
    "YO41": "York east/Dunnington",
    "YO42": "Pocklington",
    "YO43": "Market Weighton",
    "YO51": "Boroughbridge",
    "YO60": "Castle Howard",
    "YO61": "Easingwold",
    "YO62": "Helmsley/Kirkbymoorside",
}

YO_CORE_PREFIXES = ("YO1", "YO10", "YO19", "YO23", "YO24", "YO26", "YO30", "YO31", "YO32", "YO41")

PMS_PATTERNS: list[tuple[str, list[str], str]] = [
    ("Dentally", [r"portal\.dental", r"dentr\.net", r"checkout\.portal\.dental", r"dentally\.co", r"dentally\.com"], "high"),
    ("Exact/SOE", [r"onlineappointments\.co\.uk", r"softwareofexcellence", r"soeidental"], "high"),
    ("Pearl", [r"pearl\.dental", r"pearldentalsoftware"], "medium"),
    ("Aerona", [r"aerona\.com", r"aeronacloud"], "medium"),
    ("Carestream/R4", [r"r4\.dental", r"carestream dental"], "medium"),
    ("MyDentist corporate", [r"mydentist\.co\.uk"], "low"),
]

BLAST_FIELDS = [
    "practice_name",
    "also_known_as",
    "address",
    "postcode",
    "yo_area",
    "phone",
    "website",
    "nhs_private",
    "pms_detected",
    "pms_confidence",
    "pms_evidence",
    "blast_segment",
    "wisecall_tier",
    "provider_name",
    "source",
    "notes",
]

OUTBOUND_FIELDS = ["name", "phone", "company", "postcode", "yo_area", "pms", "segment", "tier", "website", "notes"]

CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE


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


def yo_area(postcode: str) -> str:
    pc = postcode.upper().replace(" ", "")
    match = re.match(r"^(YO\d{1,2})", pc)
    return YO_AREAS.get(match.group(1), match.group(1)) if match else "Unknown"


def is_yo_core(postcode: str) -> bool:
    pc = postcode.upper().replace(" ", "")
    return any(pc.startswith(prefix) for prefix in YO_CORE_PREFIXES)


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


def wisecall_tier(segment: str, pms_list: list[str]) -> str:
    if segment in ("Dentally confirmed", "Dentally likely"):
        return "Tier 1 - Dentally integration ready"
    if segment == "Exact/SOE confirmed":
        return "Tier 2 - Exact/SOE workflow (no live booking integration yet)"
    if "MyDentist corporate" in pms_list:
        return "Tier 4 - Corporate chain (lower priority)"
    return "Tier 3 - Unknown PMS (qualify on call)"


def load_cqc_practices() -> dict[str, dict[str, str]]:
    practices: dict[str, dict[str, str]] = {}
    with CQC_CSV.open(newline="", encoding="utf-8-sig") as f:
        reader = csv.reader(f)
        for _ in range(4):
            next(reader)
        header = next(reader)
        idx = {h: i for i, h in enumerate(header)}
        for row in reader:
            pc = row[idx["Postcode"]].strip().upper().replace(" ", "")
            if not re.match(r"^YO\d", pc):
                continue
            service = row[idx["Service types"]]
            if "Dentist" not in service and "Orthodont" not in service:
                continue
            name = row[idx["Name"]].strip()
            key = re.sub(r"[^a-z0-9]", "", name.lower()) + pc
            practices[key] = {
                "practice_name": name,
                "also_known_as": row[idx["Also known as"]].strip(),
                "address": row[idx["Address"]].replace(",", ", "),
                "postcode": row[idx["Postcode"]].strip().upper(),
                "phone": norm_phone(row[idx["Phone number"]]),
                "website": row[idx["Service's website (if available)"]].strip(),
                "provider_name": row[idx["Provider name"]].strip(),
                "nhs_private": "Unknown",
                "pms_detected": "",
                "pms_confidence": "",
                "pms_evidence": "",
                "blast_segment": "Unknown PMS - manual check",
                "wisecall_tier": "Tier 3 - Unknown PMS (qualify on call)",
                "yo_area": yo_area(row[idx["Postcode"]].strip()),
                "notes": "",
                "source": "CQC directory (auto-downloaded)",
            }
    return practices


def apply_overrides(practices: dict[str, dict[str, str]]) -> None:
    if not OVERRIDES.exists():
        return
    data = json.loads(OVERRIDES.read_text(encoding="utf-8"))
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
                )


def scan_websites(practices: dict[str, dict[str, str]], sleep_s: float = 0.2) -> None:
    for practice in practices.values():
        if practice.get("_lock_pms") == "1":
            practice["wisecall_tier"] = wisecall_tier(practice["blast_segment"], [])
            continue
        if practice.get("pms_confidence") == "high" and practice.get("blast_segment", "").startswith("Dentally"):
            practice["wisecall_tier"] = wisecall_tier(practice["blast_segment"], ["Dentally"])
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
            # Keep manual override unless scan also found something
            if not pms:
                practice["wisecall_tier"] = wisecall_tier(practice["blast_segment"], [])
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
        practice["wisecall_tier"] = wisecall_tier(practice["blast_segment"], pms)
        time.sleep(sleep_s)


def write_csv(path: Path, fields: list[str], rows: list[dict[str, str]]) -> None:
    with path.open("w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for row in rows:
            writer.writerow({k: row.get(k, "") for k in fields})


def to_outbound_row(practice: dict[str, str]) -> dict[str, str]:
    return {
        "name": practice["practice_name"],
        "phone": practice["phone"],
        "company": practice["practice_name"],
        "postcode": practice["postcode"],
        "yo_area": practice["yo_area"],
        "pms": practice.get("pms_detected") or "Unknown",
        "segment": practice["blast_segment"],
        "tier": practice["wisecall_tier"],
        "website": practice.get("website", ""),
        "notes": practice.get("notes", ""),
    }


def main() -> None:
    ensure_cqc_csv()
    practices = load_cqc_practices()
    apply_overrides(practices)
    scan_websites(practices)

    all_rows = sorted(
        practices.values(),
        key=lambda p: (p["wisecall_tier"], p["postcode"], p["practice_name"]),
    )
    write_csv(RESEARCH / "york-yo-dental-marketing-list.csv", BLAST_FIELDS, all_rows)

    segments: list[tuple[str, Callable[[dict[str, str]], bool]]] = [
        ("dentally-confirmed", lambda p: p["blast_segment"] == "Dentally confirmed" and p["phone"]),
        (
            "dentally-tier1-blast",
            lambda p: p["wisecall_tier"].startswith("Tier 1") and p["phone"],
        ),
        ("exact-soe-confirmed", lambda p: p["blast_segment"] == "Exact/SOE confirmed" and p["phone"]),
        ("york-core-all", lambda p: is_yo_core(p["postcode"]) and p["phone"]),
        ("york-core-unknown-pms", lambda p: is_yo_core(p["postcode"]) and p["phone"] and p["blast_segment"] == "Unknown PMS - manual check"),
    ]

    for slug, predicate in segments:
        rows = [to_outbound_row(p) for p in all_rows if predicate(p)]
        write_csv(RESEARCH / f"york-yo-dental-{slug}-outbound.csv", OUTBOUND_FIELDS, rows)
        print(f"{slug}: {len(rows)} rows")

    print("---")
    print(f"Total practices: {len(all_rows)}")
    print(f"With phone: {sum(1 for p in all_rows if p['phone'])}")
    print(f"With website: {sum(1 for p in all_rows if p['website'])}")
    print("Segments:", dict(Counter(p["blast_segment"] for p in all_rows)))
    print("Tiers:", dict(Counter(p["wisecall_tier"] for p in all_rows)))


if __name__ == "__main__":
    main()
