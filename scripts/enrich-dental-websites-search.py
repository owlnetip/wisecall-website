#!/usr/bin/env python3
"""Discover practice websites via web search for PMS fingerprinting.

Scotland/Wales/NI registers often lack website URLs. This script searches
(per practice or by city) and writes results into region manual-override JSON
files, then you rebuild the region to run the Dentally/Exact website scan.

Recommended: per-practice search (accurate). City batch mode ("dentists in
Glasgow") is faster but needs fuzzy name matching — use for gap-fill only.

Search backends (first configured wins):
  1. Google Custom Search — GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX
  2. SerpAPI — SERPAPI_KEY

Usage:
  export GOOGLE_CSE_API_KEY=...
  export GOOGLE_CSE_CX=...

  # Glasgow NHS practices missing websites (dry run first)
  python3 scripts/enrich-dental-websites-search.py --region glasgow --limit 20 --dry-run

  # Apply overrides for all Scotland regions
  python3 scripts/enrich-dental-websites-search.py --country scotland

  # City batch mode (one search per region name)
  python3 scripts/enrich-dental-websites-search.py --region glasgow --mode city

After enrichment, rescan PMS:
  python3 scripts/build-dental-marketing-list.py --region glasgow
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from difflib import SequenceMatcher
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

from dental_marketing_lib import RESEARCH, REGIONS_DIR, load_region, load_practices, ensure_dataset  # noqa: E402

BLOCKLIST_DOMAINS = {
    "facebook.com",
    "fb.com",
    "instagram.com",
    "linkedin.com",
    "twitter.com",
    "x.com",
    "youtube.com",
    "tiktok.com",
    "yell.com",
    "yelp.com",
    "trustpilot.com",
    "google.com",
    "google.co.uk",
    "wikipedia.org",
    "nhs.uk",
    "nhsinform.scot",
    "whatclinic.com",
    "dentistsnearme.com",
    "carehome.co.uk",
    "cqc.org.uk",
    "hiw.org.uk",
    "rqia.org.uk",
    "bda.org",
    "find.nhs.uk",
    "maps.app.goo.gl",
    "goo.gl",
}

DIRECTORY_HINTS = (
    "top 10",
    "best dentist",
    "dentists in",
    "near me",
    "directory",
    "list of",
    "ranked",
)


def norm_tokens(text: str) -> set[str]:
    stop = {"dental", "dentist", "dentists", "care", "practice", "clinic", "surgery", "the", "and", "ltd", "limited", "uk", "nhs"}
    words = re.findall(r"[a-z0-9]+", text.lower())
    return {w for w in words if len(w) > 2 and w not in stop}


def domain_of(url: str) -> str:
    host = urllib.parse.urlparse(url).netloc.lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def is_blocked(url: str) -> bool:
    host = domain_of(url)
    if not host:
        return True
    if any(host == d or host.endswith("." + d) for d in BLOCKLIST_DOMAINS):
        return True
    return False


def name_similarity(a: str, b: str) -> float:
    ta, tb = norm_tokens(a), norm_tokens(b)
    if not ta or not tb:
        return SequenceMatcher(None, a.lower(), b.lower()).ratio()
    overlap = len(ta & tb) / max(len(ta), 1)
    seq = SequenceMatcher(None, a.lower(), b.lower()).ratio()
    return 0.6 * overlap + 0.4 * seq


def google_cse_search(query: str, num: int = 5) -> list[dict[str, str]]:
    api_key = os.environ.get("GOOGLE_CSE_API_KEY", "").strip()
    cx = os.environ.get("GOOGLE_CSE_CX", "").strip()
    if not api_key or not cx:
        return []
    params = urllib.parse.urlencode({"key": api_key, "cx": cx, "q": query, "num": min(num, 10)})
    url = f"https://www.googleapis.com/customsearch/v1?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "WiseCallResearch/1.0"})
    with urllib.request.urlopen(req, timeout=20) as resp:
        data = json.loads(resp.read().decode())
    out: list[dict[str, str]] = []
    for item in data.get("items") or []:
        out.append({"url": item.get("link", ""), "title": item.get("title", ""), "snippet": item.get("snippet", "")})
    return out


def serpapi_search(query: str, num: int = 5) -> list[dict[str, str]]:
    key = os.environ.get("SERPAPI_KEY", "").strip()
    if not key:
        return []
    params = urllib.parse.urlencode({"engine": "google", "q": query, "api_key": key, "num": min(num, 10), "gl": "uk", "hl": "en"})
    url = f"https://serpapi.com/search.json?{params}"
    req = urllib.request.Request(url, headers={"User-Agent": "WiseCallResearch/1.0"})
    with urllib.request.urlopen(req, timeout=30) as resp:
        data = json.loads(resp.read().decode())
    out: list[dict[str, str]] = []
    for item in data.get("organic_results") or []:
        out.append({"url": item.get("link", ""), "title": item.get("title", ""), "snippet": item.get("snippet", "")})
    return out


def web_search(query: str, num: int = 5) -> list[dict[str, str]]:
    for fn in (google_cse_search, serpapi_search):
        try:
            results = fn(query, num=num)
            if results:
                return results
        except urllib.error.HTTPError as exc:
            print(f"  search HTTP error: {exc.code} {query[:60]}", file=sys.stderr)
        except Exception as exc:
            print(f"  search error: {exc} {query[:60]}", file=sys.stderr)
    return []


def pick_best_result(practice_name: str, results: list[dict[str, str]]) -> tuple[str, float] | None:
    best_url = ""
    best_score = 0.0
    for item in results:
        url = item.get("url", "")
        if not url or is_blocked(url):
            continue
        title = item.get("title", "")
        snippet = item.get("snippet", "")
        blob = f"{title} {snippet} {url}".lower()
        if any(h in blob for h in DIRECTORY_HINTS):
            continue
        score = name_similarity(practice_name, title)
        score = max(score, name_similarity(practice_name, domain_of(url).replace(".", " ")))
        if "dental" in blob or "dentist" in blob:
            score += 0.08
        if score > best_score:
            best_score = score
            best_url = url
    if best_score >= 0.45 and best_url:
        return best_url, best_score
    return None


def practice_query(practice: dict[str, str]) -> str:
    name = practice["practice_name"]
    pc = practice.get("postcode", "").replace(" ", "")
    outward = pc[:-3] if len(pc) >= 5 else ""
    area = practice.get("area", "")
    city = area.split("(")[0].strip() if area else ""
    parts = [name, "dentist"]
    if outward:
        parts.append(outward)
    elif city:
        parts.append(city)
    return " ".join(parts)


def city_query(region_name: str) -> str:
    base = region_name.split("&")[0].split("(")[0].strip()
    return f"dentists in {base} dental practice website"


def load_manifest_regions(*, country: str | None, region_id: str | None, phase: int | None) -> list[str]:
    manifest = json.loads((REGIONS_DIR / "manifest.json").read_text(encoding="utf-8"))
    ids: list[str] = []
    for entry in manifest["regions"]:
        if region_id and entry["id"] != region_id:
            continue
        if phase and entry.get("phase") != phase:
            continue
        if country and entry.get("country", "england") != country:
            continue
        ids.append(entry["id"])
    return ids


def load_overrides(path: Path) -> dict:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return {"practices": []}


def save_overrides(path: Path, data: dict) -> None:
    path.write_text(json.dumps(data, indent=2) + "\n", encoding="utf-8")


def merge_override(data: dict, practice_name: str, website: str, note: str) -> None:
    for item in data.get("practices", []):
        names = [n.lower() for n in item.get("match_names", [])]
        if practice_name.lower() in names:
            item["website"] = website
            item["notes"] = note
            return
    data.setdefault("practices", []).append(
        {
            "match_names": [practice_name],
            "match_exact": True,
            "website": website,
            "notes": note,
        }
    )


def enrich_region(
    region_id: str,
    *,
    mode: str,
    limit: int | None,
    dry_run: bool,
    sleep_s: float,
) -> tuple[int, int]:
    region = load_region(region_id)
    ensure_dataset(region.data_source)
    practices = load_practices(region)
    missing = [p for p in practices.values() if not (p.get("website") or "").strip()]
    if limit:
        missing = missing[:limit]

    city_results: list[dict[str, str]] = []
    if mode == "city" and missing:
        query = city_query(region.name)
        print(f"[{region_id}] city search: {query}")
        city_results = web_search(query, num=10)

    found = 0
    overrides_path = region.overrides_path
    overrides = load_overrides(overrides_path)

    for i, practice in enumerate(missing, start=1):
        name = practice["practice_name"]
        if mode == "city" and city_results:
            picked = pick_best_result(name, city_results)
            query = city_query(region.name)
        else:
            query = practice_query(practice)
            results = web_search(query, num=5)
            picked = pick_best_result(name, results)

        if not picked:
            print(f"  [{i}/{len(missing)}] no match: {name}")
            time.sleep(sleep_s)
            continue

        url, score = picked
        found += 1
        note = f"website via search ({mode}, score={score:.2f}, query={query})"
        print(f"  [{i}/{len(missing)}] {name} -> {url} ({score:.2f})")
        if not dry_run:
            merge_override(overrides, name, url, note)
        time.sleep(sleep_s)

    if not dry_run and found:
        save_overrides(overrides_path, overrides)
    return len(missing), found


def main() -> None:
    if not os.environ.get("GOOGLE_CSE_API_KEY") and not os.environ.get("SERPAPI_KEY"):
        print(
            "Set GOOGLE_CSE_API_KEY + GOOGLE_CSE_CX (Google Custom Search) or SERPAPI_KEY.\n"
            "Create a Programmable Search Engine at https://programmablesearchengine.google.com/",
            file=sys.stderr,
        )
        sys.exit(1)

    parser = argparse.ArgumentParser(description="Find dental practice websites via web search")
    parser.add_argument("--region", help="Single region id (e.g. glasgow)")
    parser.add_argument("--country", choices=["scotland", "wales", "northern_ireland", "england"])
    parser.add_argument("--phase", type=int)
    parser.add_argument("--mode", choices=["practice", "city"], default="practice", help="Search per practice or once per city")
    parser.add_argument("--limit", type=int, help="Max practices per region (for testing)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--sleep", type=float, default=1.0, help="Seconds between searches")
    args = parser.parse_args()

    region_ids = load_manifest_regions(country=args.country, region_id=args.region, phase=args.phase)
    if not region_ids:
        parser.error("No regions matched")

    total_missing = total_found = 0
    for rid in region_ids:
        print(f"=== {rid} ===")
        missing, found = enrich_region(
            rid,
            mode=args.mode,
            limit=args.limit,
            dry_run=args.dry_run,
            sleep_s=args.sleep,
        )
        total_missing += missing
        total_found += found
        print(f"  -> {found}/{missing} websites {'would be ' if args.dry_run else ''}saved\n")

    print(f"Done: {total_found}/{total_missing} websites matched across {len(region_ids)} region(s)")
    if total_found and not args.dry_run:
        print("Rebuild to scan PMS, e.g.:")
        if args.region:
            print(f"  python3 scripts/build-dental-marketing-list.py --region {args.region}")
        elif args.country == "scotland":
            print("  python3 scripts/build-dental-marketing-list.py --phase 10")


if __name__ == "__main__":
    main()
