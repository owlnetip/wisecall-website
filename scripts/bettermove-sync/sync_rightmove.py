#!/usr/bin/env python3
"""Bettermove -> WiseCall KB sync, from Rightmove.

bettermove.co.uk's own property feed stopped updating on 22 Sep 2026, so the
listings now come from Bettermove's Rightmove branch page (BRANCH^102082, for
sale + sold STC). One polite pass over the ~21 search-result pages; no detail
pages are fetched.

Writes, for the WiseCall Bettermove agent:
  - one KB article per property   (upload:bettermove-rm-<id>.md, via kb-ingest)
  - one index per town            (upload:bettermove-rm-town-<slug>.md, via kb-ingest)
  - one budget index, single row  (upload:bettermove-rm-budget-index.md, direct
    insert: the budget lookup reads exactly one row, so it must not be chunked)
and deletes docs for properties that have left Rightmove. The first run also
removes the old website-feed docs (upload:bettermove-*, not -rm-).

Usage:
  python3 sync_rightmove.py            # incremental sync
  python3 sync_rightmove.py --dry-run  # show what would change, touch nothing
"""
import json, os, re, sys, time, hashlib, random, urllib.parse
import urllib.request
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor, as_completed

HERE = os.path.dirname(os.path.abspath(__file__))
STATE_FILE = os.path.join(HERE, "state-rightmove.json")
ARTICLES_DIR = os.path.join(HERE, "articles-rightmove")

PROFILE_ID = "b3b2374c-ddc6-4e66-87a8-c60703ac89f9"  # WiseCall Bettermove agent
CATEGORY = "General"
BRANCH = "BRANCH%5E102082"
SEARCH_URL = (
    "https://www.rightmove.co.uk/property-for-sale/find/Bettermove/Nationwide.html"
    f"?locationIdentifier={BRANCH}&includeSSTC=true&sortType=6&index={{index}}"
)
LISTING_URL = "https://www.rightmove.co.uk/properties/{id}"
BUDGET_DOC = "bettermove-rm-budget-index.md"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36"
ENV_FILE = os.path.expanduser(
    "~/Desktop/Screenshots/wisecall-website/apps/portal/.env.local"
)
CONCURRENCY = 4
DRY_RUN = "--dry-run" in sys.argv


def load_env():
    # On the server the values come from the environment (sourced from the voice
    # runtime's .env); on the Mac they come from the portal's .env.local.
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if url and key:
        return url, key
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
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    data = json.dumps(body).encode() if body is not None else None
    if data:
        req.add_header("Content-Type", "application/json")
    with urllib.request.urlopen(req, data, timeout=timeout) as r:
        return r.status, r.read().decode()


def sb_headers(extra=None):
    return {"apikey": SVC_KEY, "Authorization": f"Bearer {SVC_KEY}", **(extra or {})}


# ── Pull ──────────────────────────────────────────────────────────────────

def fetch_page(index):
    _, body = http(SEARCH_URL.format(index=index), headers={"User-Agent": UA}, timeout=60)
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', body, re.S)
    if not m:
        raise RuntimeError(f"no __NEXT_DATA__ on page index={index} (layout changed or blocked?)")
    results = json.loads(m.group(1))["props"]["pageProps"]["searchResults"]
    return results


def fetch_properties():
    first = fetch_page(0)
    total = int(first.get("resultCount", "0").replace(",", ""))
    props = list(first["properties"])
    for opt in first["pagination"]["options"][1:]:
        time.sleep(1.5 + random.random())
        props.extend(fetch_page(int(opt["value"]))["properties"])
    seen, out = set(), []
    for p in props:  # featured listings can repeat across pages
        if p["id"] not in seen:
            seen.add(p["id"])
            out.append(p)
    return out, total


def status_of(p):
    s = (p.get("displayStatus") or "").strip()
    return s.upper() if s else "FOR SALE"


def price_of(p):
    dp = ((p.get("price") or {}).get("displayPrices") or [{}])[0]
    return dp.get("displayPrice") or "", dp.get("displayPriceQualifier") or ""


def town_of(p):
    # "Street, Town, POSTCODE-DISTRICT" (the last part is often a district like HU17).
    parts = [x.strip() for x in p["displayAddress"].split(",") if x.strip()]
    if len(parts) >= 2 and re.fullmatch(r"[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?", parts[-1]):
        parts = parts[:-1]
    return parts[-1] if len(parts) >= 2 else "Other"


def render_article(p):
    price, qualifier = price_of(p)
    status = status_of(p)
    lines = [f"# {p['displayAddress']} — {price} ({status})", ""]
    lines.append(f"Property reference: {p['id']}")
    lines.append(f"Address: {p['displayAddress']}")
    facts = []
    if p.get("propertySubType"):
        facts.append(p["propertySubType"])
    if p.get("bedrooms"):
        facts.append(f"{p['bedrooms']} bed")
    if p.get("bathrooms"):
        facts.append(f"{p['bathrooms']} bath")
    tenure = (p.get("tenure") or {}).get("tenureType")
    if tenure:
        facts.append(tenure.title())
    if facts:
        lines.append("Key facts: " + ", ".join(facts))
    if qualifier:
        lines.append(f"Price qualifier: {qualifier}")
    lines.append(f"Status: {status}")
    lines.append(f"Listing page: {LISTING_URL.format(id=p['id'])}")
    feats = [f["description"] for f in (p.get("keyFeatures") or []) if f.get("description")]
    if feats:
        lines += ["", "Features:"] + [f"- {f}" for f in feats]
    if p.get("summary"):
        lines += ["", p["summary"].strip()]
    return "\n".join(lines) + "\n"


def render_town_index(town, plist):
    lines = [f"# Bettermove properties in {town} (current listings)", ""]
    for p in sorted(plist, key=lambda x: (x.get("price") or {}).get("amount") or 0):
        bits = [p["displayAddress"]]
        if p.get("bedrooms"):
            bits.append(f"{p['bedrooms']} bed")
        if p.get("propertySubType"):
            bits.append(p["propertySubType"].lower())
        bits += [price_of(p)[0], status_of(p), f"ref {p['id']}"]
        lines.append("- " + ", ".join(str(b) for b in bits if b))
    lines += ["", f"Total: {len(plist)} properties currently listed in {town} with Bettermove."]
    return "\n".join(lines) + "\n"


def render_budget_index(props):
    # Line format is parsed by _shared/kb-property-budget-lookup.ts:
    # "- Beaufort Street, Southend-on-Sea — £300,000 — 2 bed — ref 12827458"
    lines = ["# Bettermove listings by price (for sale, excludes sold STC)", ""]
    live = [p for p in props if status_of(p) == "FOR SALE" and (p.get("price") or {}).get("amount")]
    for p in sorted(live, key=lambda x: x["price"]["amount"]):
        beds = p.get("bedrooms") or 0
        lines.append(f"- {p['displayAddress']} — £{p['price']['amount']:,} — {beds} bed — ref {p['id']}")
    return "\n".join(lines) + "\n"


# ── Write ─────────────────────────────────────────────────────────────────

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


def delete_source(source):
    src = urllib.parse.quote(source)
    status, _ = http(
        f"{SUPABASE_URL}/rest/v1/knowledge_base?source=eq.{src}&bot_ids=cs.{{{PROFILE_ID}}}",
        method="DELETE",
        headers=sb_headers(),
    )
    return status in (200, 204)


def write_budget_index(text):
    delete_source(f"upload:{BUDGET_DOC}")
    status, _ = http(
        f"{SUPABASE_URL}/rest/v1/knowledge_base",
        method="POST",
        body={
            "content": text,
            "source": f"upload:{BUDGET_DOC}",
            "source_type": "upload",
            "category": CATEGORY,
            "title": "Bettermove listings by price",
            "chunk_index": 0,
            "bot_ids": [PROFILE_ID],
        },
        headers=sb_headers({"Prefer": "return=minimal"}),
    )
    return status in (200, 201, 204)


def delete_old_website_docs():
    # One filtered DELETE: listing sources first hits PostgREST's 1,000-row cap.
    status, _ = http(
        f"{SUPABASE_URL}/rest/v1/knowledge_base?source=like.upload:bettermove-*"
        f"&source=not.like.upload:bettermove-rm-*&bot_ids=cs.{{{PROFILE_ID}}}",
        method="DELETE",
        headers=sb_headers(),
    )
    return status in (200, 204)


# ── Main ──────────────────────────────────────────────────────────────────

def main():
    print(f"[{time.strftime('%F %T')}] pulling Rightmove listings…", flush=True)
    props, total = fetch_properties()
    print(f"  {len(props)} listings pulled (Rightmove says {total})", flush=True)
    if len(props) < 50 or len(props) < total * 0.9:
        sys.exit("Refusing to sync: too few listings pulled (blocked or layout change?)")

    docs = {}
    towns = defaultdict(list)
    for p in props:
        docs[f"bettermove-rm-{p['id']}.md"] = render_article(p)
        towns[town_of(p)].append(p)
    for town, plist in towns.items():
        slug = re.sub(r"[^a-z0-9]+", "-", town.lower()).strip("-") or "other"
        docs[f"bettermove-rm-town-{slug}.md"] = render_town_index(town, plist)
    budget = render_budget_index(props)

    state = json.load(open(STATE_FILE)) if os.path.exists(STATE_FILE) else {}
    hashes = {fn: hashlib.sha256(t.encode()).hexdigest() for fn, t in docs.items()}
    to_ingest = [fn for fn in docs if state.get(fn) != hashes[fn]]
    to_delete = [fn for fn in state if fn not in docs and fn != BUDGET_DOC]
    print(f"  ingest: {len(to_ingest)} new/changed, delete: {len(to_delete)} gone, "
          f"unchanged: {len(docs) - len(to_ingest)}, towns: {len(towns)}", flush=True)

    os.makedirs(ARTICLES_DIR, exist_ok=True)
    for fn, text in {**docs, BUDGET_DOC: budget}.items():
        with open(os.path.join(ARTICLES_DIR, fn), "w") as fh:
            fh.write(text)
    if DRY_RUN:
        print("dry run — no ingest/delete performed")
        return

    failed, done = [], 0
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
            if done % 50 == 0 or done == len(to_ingest):
                print(f"  ingested {done}/{len(to_ingest)} ({len(failed)} failed)", flush=True)
            json.dump(state, open(STATE_FILE, "w"))

    for fn in to_delete:
        if delete_source(f"upload:{fn}"):
            state.pop(fn, None)
        else:
            failed.append((fn, "delete failed"))

    if write_budget_index(budget):
        state[BUDGET_DOC] = hashlib.sha256(budget.encode()).hexdigest()
    else:
        failed.append((BUDGET_DOC, "budget index write failed"))
    json.dump(state, open(STATE_FILE, "w"))

    # Retire the old bettermove.co.uk feed docs once the Rightmove set is in.
    if not failed and not delete_old_website_docs():
        failed.append(("old website-feed docs", "delete failed"))

    if failed:
        print("FAILURES:")
        for fn, info in failed[:20]:
            print(f"  {fn}: {info}")
        sys.exit(1)
    print(f"[{time.strftime('%F %T')}] sync complete: {len(state)} docs in KB", flush=True)


if __name__ == "__main__":
    main()
