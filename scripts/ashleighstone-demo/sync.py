#!/usr/bin/env python3
"""Ashleigh Stone -> WiseCall KB sync.

Scrapes live property listings from ashleighstone.co.uk (Expert Agent PHP site),
renders one KB article per property (plus per-town index docs), then ingests
new/changed docs through the kb-ingest edge function and deletes docs for
properties that have left the market. Safe to re-run; state lives in state.json
next to this script.

Usage:
  python3 sync.py            # incremental sync (first run ingests everything)
  python3 sync.py --dry-run  # show what would change, touch nothing
"""
import hashlib
import html
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, "state.json")
ARTICLES_DIR = os.path.join(HERE, "articles")
STATIC_ARTICLES = {
    "ashleighstone-tenant-maintenance-reporting.md": os.path.join(
        HERE, "articles", "ashleighstone-tenant-maintenance-reporting.md"
    ),
}

PROFILE_ID = "cad953f9-5d50-4d4b-98ee-1794a59f1a68"  # WiseCall Ashleigh Stone profile
CATEGORY = "General"
BASE = "https://www.ashleighstone.co.uk"
ENV_FILE = os.path.join(HERE, "..", "..", "apps", "portal", ".env.local")
CONCURRENCY = 4
TAG = re.compile(r"<[^>]+>")
DRY_RUN = "--dry-run" in sys.argv
NO_INGEST = "--no-ingest" in sys.argv
UA = {"User-Agent": "Mozilla/5.0 (WiseCall sync)"}


def load_env():
    env = {}
    for line in open(ENV_FILE):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, v = line.split("=", 1)
            env[k] = v
    return env["NEXT_PUBLIC_SUPABASE_URL"], env["SUPABASE_SERVICE_ROLE_KEY"]


SUPABASE_URL, SVC_KEY = load_env()


def http(url, method="GET", body=None, headers=None, timeout=120):
    req = urllib.request.Request(url, method=method)
    for k, v in {**UA, **(headers or {})}.items():
        req.add_header(k, v)
    data = json.dumps(body).encode() if body is not None else None
    if data:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, data, timeout=timeout) as r:
        return r.status, r.read().decode("utf-8", "replace")


def sb_headers():
    return {"apikey": SVC_KEY, "Authorization": f"Bearer {SVC_KEY}"}


def clean(s):
    if not s:
        return ""
    return html.unescape(TAG.sub("", str(s))).replace("\xa0", " ").strip()


def slugify(text, limit=70):
    slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return slug[:limit] or "property"


def parse_price_pounds(price_text):
    if not price_text:
        return None
    digits = re.sub(r"[^\d]", "", str(price_text))
    if not digits:
        return None
    return int(digits)


# ── Pull ──────────────────────────────────────────────────────────────────

def parse_listing_page(html_text, instruction):
    props = []
    for block in re.split(r'<article class="teaser', html_text)[1:]:
        m_ref = re.search(r"details\.php\?reference=(\d+)", block)
        if not m_ref:
            continue
        ref = m_ref.group(1)
        street = re.search(r'teaser__heading[^>]*>([^<]+)', block)
        beds = re.search(r">Bedrooms</dt>\s*<dd[^>]*>(\d+)", block)
        recs = re.search(r">Receptions</dt>\s*<dd[^>]*>(\d+)", block)
        baths = re.search(r">Bathrooms</dt>\s*<dd[^>]*>(\d+)", block)
        price = re.search(r"teaser__price[^>]*>[\s\S]*?(£[\d,]+(?:\s*pcm)?)", block)
        addr = re.search(r'reveal-article__address">([^<]+)', block)
        specs = re.findall(r'teaser-spec__item">([^<]+)', block)
        address = clean(addr.group(1)) if addr else ""
        town = address.rsplit(",", 1)[-1].strip() if "," in address else ""
        props.append(
            {
                "ref": ref,
                "street": clean(street.group(1)) if street else "",
                "town": town,
                "address": address,
                "bedrooms": beds.group(1) if beds else "",
                "receptions": recs.group(1) if recs else "",
                "bathrooms": baths.group(1) if baths else "",
                "price": clean(price.group(1)) if price else "",
                "specs": [clean(s) for s in specs if clean(s)],
                "instruction": instruction,
                "url": f"{BASE}/view-properties/details.php?reference={ref}",
            }
        )
    return props


def fetch_listings(path, instruction):
    props, page = [], 1
    while True:
        url = f"{BASE}{path}?search=1&page={page}"
        try:
            _, body = http(url)
        except urllib.error.HTTPError:
            break
        batch = parse_listing_page(body, instruction)
        if not batch:
            break
        props.extend(batch)
        page += 1
        if page > 20:
            break
    return props


def parse_detail(html_text):
    street = re.search(r'section__heading_address">([^<]+)', html_text)
    town = re.search(r'section__heading_pr">([^<]+)', html_text)
    price = re.search(r"section__price[^>]*>[\s\S]*?(£[\d,]+(?:\s*pcm)?)", html_text)
    desc = ""
    desc_m = re.search(
        r'property-spec__heading_4">Description</h4>\s*(.*?)\s*<div class="link-group">',
        html_text,
        re.S,
    )
    if desc_m:
        paras = re.findall(r"<p[^>]*>(.*?)</p>", desc_m.group(1), re.S)
        chunks = []
        for para in paras:
            chunk = re.sub(r"<br\s*/?>", "\n", para)
            chunk = clean(re.sub(r"[ \t]+", " ", TAG.sub(" ", chunk)))
            if chunk:
                chunks.append(chunk)
        desc = "\n\n".join(chunks)
    status = "TO LET" if re.search(r"\bTo Let\b", html_text[:8000]) else "FOR SALE"
    return {
        "street": clean(street.group(1)) if street else "",
        "town": clean(town.group(1)) if town else "",
        "price": clean(price.group(1)) if price else "",
        "description": desc,
        "status": status,
    }


def enrich_property(prop):
    try:
        _, body = http(prop["url"], timeout=60)
        detail = parse_detail(body)
    except Exception as e:
        return prop, str(e)
    prop = {**prop, **{k: v for k, v in detail.items() if v}}
    if detail.get("town"):
        prop["town"] = detail["town"]
    if not prop.get("address") and prop.get("street") and prop.get("town"):
        prop["address"] = f"{prop['street']}, {prop['town']}"
    return prop, None


def fetch_properties():
    sales = fetch_listings("/view-properties/sales.php", "FOR SALE")
    lettings = fetch_listings("/view-properties/rent.php", "TO LET")
    by_ref = {p["ref"]: p for p in sales + lettings}
    props = list(by_ref.values())
    failed = []
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        futs = {ex.submit(enrich_property, p): p["ref"] for p in props}
        for fut in as_completed(futs):
            ref = futs[fut]
            prop, err = fut.result()
            by_ref[ref] = prop
            if err:
                failed.append((ref, err))
    if failed:
        print(f"  warning: {len(failed)} detail pages failed", flush=True)
    return list(by_ref.values())


def town_of(p):
    return p.get("town") or "Other"


def render_article(p):
    title_bits = [p.get("street") or "Property"]
    if p.get("town"):
        title_bits.append(p["town"])
    title = ", ".join(title_bits)
    avail = p.get("status") or p.get("instruction") or "FOR SALE"
    price = p.get("price") or "Price on application"
    lines = [f"# {title} — {price} ({avail})", ""]
    lines.append(f"Property reference: {p['ref']}")
    if p.get("address"):
        lines.append(f"Address: {p['address']}")
    facts = []
    if p.get("bedrooms"):
        facts.append(f"{p['bedrooms']} bed")
    if p.get("bathrooms"):
        facts.append(f"{p['bathrooms']} bath")
    if p.get("receptions"):
        facts.append(f"{p['receptions']} reception")
    for spec in p.get("specs") or []:
        facts.append(spec)
    if facts:
        lines.append("Key facts: " + ", ".join(facts))
    lines.append(f"Status: {avail}")
    lines.append(f"Listing page: {p['url']}")
    if p.get("description"):
        lines += ["", p["description"]]
    return "\n".join(lines) + "\n"


def render_town_index(town, plist):
    lines = [f"# Ashleigh Stone properties in {town} (current listings)", ""]
    for p in sorted(plist, key=lambda x: parse_price_pounds(x.get("price")) or 10**12):
        bits = []
        if p.get("street"):
            bits.append(p["street"])
        if p.get("bedrooms"):
            bits.append(f"{p['bedrooms']} bed")
        if p.get("price"):
            bits.append(p["price"])
        bits.append(p.get("status") or p.get("instruction") or "FOR SALE")
        bits.append(f"ref {p['ref']}")
        lines.append("- " + ", ".join(bits))
    lines += [
        "",
        f"Total: {len(plist)} properties currently listed in {town} with Ashleigh Stone.",
    ]
    return "\n".join(lines) + "\n"


def render_budget_index(props):
    priced = []
    for p in props:
        pounds = parse_price_pounds(p.get("price"))
        if pounds is None:
            continue
        title_bits = [p.get("street") or "Property"]
        if p.get("town"):
            title_bits.append(p["town"])
        address = ", ".join(title_bits)
        beds = f"{p['bedrooms']} bed" if p.get("bedrooms") else "beds n/a"
        priced.append(
            {
                "address": address,
                "pounds": pounds,
                "price": p.get("price") or f"£{pounds:,}",
                "beds": beds,
                "ref": p["ref"],
            }
        )
    priced.sort(key=lambda x: x["pounds"])

    lines = [
        "# Ashleigh Stone current sales listings by price (budget search guide)",
        "",
        "Use this document when callers or emails ask for properties under, below, up to, or around a budget.",
        'Treat "under £300k" as up to and including £300,000.',
        "If nothing is strictly below their budget, suggest the closest listings at or just above it.",
        "",
        "## All listings sorted lowest to highest",
    ]
    for item in priced:
        lines.append(
            f"- {item['address']} — {item['price']} — {item['beds']} — ref {item['ref']}"
        )

    bands = [
        ("Up to £200,000", 0, 200_000),
        ("£200,000 to £250,000", 200_000, 250_000),
        ("£250,000 to £300,000 (includes at £300k)", 250_000, 300_000),
        ("Just above £300,000 (£300,001 to £350,000)", 300_000, 350_000),
        ("£350,000 to £400,000", 350_000, 400_000),
        ("£400,000 to £500,000", 400_000, 500_000),
        ("Above £500,000", 500_000, 10**12),
    ]
    lines += ["", "## Budget quick reference"]
    for label, low, high in bands:
        band_items = [i for i in priced if low < i["pounds"] <= high] if low else [
            i for i in priced if i["pounds"] <= high
        ]
        if low == 500_000:
            band_items = [i for i in priced if i["pounds"] > low]
        if not band_items:
            continue
        lines += ["", f"### {label}"]
        for item in band_items:
            lines.append(
                f"- {item['address']} — {item['price']} — {item['beds']} — ref {item['ref']}"
            )

    lines += [
        "",
        f"Total: {len(priced)} properties currently for sale with Ashleigh Stone.",
    ]
    return "\n".join(lines) + "\n"


# ── Ingest / delete ───────────────────────────────────────────────────────

def ingest_doc(filename, text):
    status, body = http(
        f"{SUPABASE_URL}/functions/v1/kb-ingest",
        method="POST",
        body={
            "source_type": "upload",
            "filename": filename,
            "text": text,
            "category": CATEGORY,
            "bot_ids": [PROFILE_ID],
        },
        headers=sb_headers(),
        timeout=180,
    )
    ok = status == 200 and json.loads(body).get("success")
    return ok, body[:200]


def delete_doc(filename):
    src = urllib.parse.quote(f"upload:{filename}")
    status, _ = http(
        f"{SUPABASE_URL}/rest/v1/knowledge_base?source=eq.{src}",
        method="DELETE",
        headers=sb_headers(),
    )
    return status in (200, 204)


# ── Main ──────────────────────────────────────────────────────────────────

def bot_exists(bot_id):
    src = urllib.parse.quote(f"eq.{bot_id}")
    status, body = http(
        f"{SUPABASE_URL}/rest/v1/bots?id={src}&select=id",
        headers=sb_headers(),
        timeout=30,
    )
    if status != 200:
        return False
    return bool(json.loads(body))


def main():
    print(f"[{time.strftime('%F %T')}] pulling properties…", flush=True)
    props = fetch_properties()
    print(f"  {len(props)} live properties on ashleighstone.co.uk", flush=True)
    if not props:
        sys.exit("Refusing to sync: no properties found (site issue?)")

    os.makedirs(ARTICLES_DIR, exist_ok=True)
    docs = {}
    towns = defaultdict(list)
    for p in props:
        street_slug = slugify(p.get("street") or "property")
        fn = f"ashleighstone-{street_slug}-{p['ref']}.md"
        docs[fn] = render_article(p)
        towns[town_of(p)].append(p)
    for town, plist in towns.items():
        slug = slugify(town)
        docs[f"ashleighstone-town-{slug}.md"] = render_town_index(town, plist)
    docs["ashleighstone-budget-index.md"] = render_budget_index(props)
    for fn, path in STATIC_ARTICLES.items():
        if os.path.exists(path):
            docs[fn] = open(path).read()

    state = json.load(open(STATE_FILE)) if os.path.exists(STATE_FILE) else {}
    hashes = {fn: hashlib.sha256(t.encode()).hexdigest() for fn, t in docs.items()}
    to_ingest = [fn for fn in docs if state.get(fn) != hashes[fn]]
    to_delete = [fn for fn in state if fn not in docs]
    print(
        f"  articles: {len(docs)} ({len(to_ingest)} new/changed, "
        f"{len(docs) - len(to_ingest)} unchanged)",
        flush=True,
    )

    for fn, text in docs.items():
        with open(os.path.join(ARTICLES_DIR, fn), "w") as fh:
            fh.write(text)

    can_ingest = not NO_INGEST and bot_exists(PROFILE_ID)
    if not can_ingest:
        reason = "--no-ingest" if NO_INGEST else "no bot record yet for Ashleigh Stone profile"
        print(f"  skipping KB ingest ({reason})", flush=True)
        json.dump(hashes, open(STATE_FILE, "w"))
        print(f"[{time.strftime('%F %T')}] scrape complete: {len(docs)} markdown articles written", flush=True)
        return

    print(f"  ingest: {len(to_ingest)} new/changed, delete: {len(to_delete)} gone", flush=True)
    if DRY_RUN:
        print("dry run — no ingest/delete performed")
        return

    failed = []
    done = 0
    with ThreadPoolExecutor(max_workers=CONCURRENCY) as ex:
        futs = {ex.submit(ingest_doc, fn, docs[fn]): fn for fn in to_ingest}
        for fut in as_completed(futs):
            fn = futs[fut]
            try:
                ok, info = fut.result()
            except Exception as e:
                ok, info = False, str(e)
            if ok:
                state[fn] = hashes[fn]
            else:
                failed.append((fn, info))
            done += 1
            if done % 10 == 0 or done == len(to_ingest):
                print(f"  ingested {done}/{len(to_ingest)} ({len(failed)} failed)", flush=True)
            json.dump(state, open(STATE_FILE, "w"))

    for fn in to_delete:
        if delete_doc(fn):
            state.pop(fn, None)
        else:
            failed.append((fn, "delete failed"))
    json.dump(state, open(STATE_FILE, "w"))

    if failed:
        print("FAILURES:")
        for fn, info in failed[:20]:
            print(f"  {fn}: {info}")
        sys.exit(1)
    print(f"[{time.strftime('%F %T')}] sync complete: {len(state)} docs in KB", flush=True)


if __name__ == "__main__":
    main()
