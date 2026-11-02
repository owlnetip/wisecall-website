// wisecall-listing-sync — mirror each agent's Rightmove branch listings into
// public.property_listings, and (when the feed has a kb_prefix) keep the agent's
// knowledge-base docs in step. Replaces ~/Desktop/bettermove-demo/sync_rightmove.py,
// which only ran while Luke's Mac was awake.
//
// Called hourly by pg_cron with x-cron-secret = Vault cron_secret.
// POST {} syncs every enabled feed; {profile_id} syncs one; {dry_run:true}
// fetches and reports without writing.
//
// KB docs are rendered exactly as the Python script did, so the hashes it left
// behind (seeded into property_listing_feeds.kb_doc_hashes) carry over and only
// new or changed listings are re-ingested. At most KB_INGEST_CAP docs per run;
// the next run picks up the rest.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { getSecret } from "../_shared/app-secrets.ts";
import { rightmovePrice, rightmoveStatus, rightmoveToRow } from "../_shared/property-listings.ts";

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128 Safari/537.36";
// Supabase rate-limits one function calling another (per trace), so keep each
// run's kb-ingest calls small and stop at the first refusal; hashes are saved
// after each doc, and the next hourly run carries on.
const KB_INGEST_CAP = 25;

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchPage(searchUrl: string, index: number) {
  const res = await fetch(searchUrl.replace("{index}", String(index)), { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`Rightmove page ${index}: HTTP ${res.status}`);
  const body = await res.text();
  const m = body.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error(`Rightmove page ${index}: no __NEXT_DATA__ (layout changed or blocked?)`);
  return JSON.parse(m[1]).props.pageProps.searchResults;
}

async function fetchRightmove(searchUrl: string) {
  const first = await fetchPage(searchUrl, 0);
  const total = Number(String(first.resultCount || "0").replace(/,/g, ""));
  const props: any[] = [...first.properties];
  for (const opt of (first.pagination?.options || []).slice(1)) {
    await sleep(1200 + Math.random() * 800);
    props.push(...(await fetchPage(searchUrl, Number(opt.value))).properties);
  }
  const seen = new Set<string>();
  // Featured listings can repeat across pages.
  return { total, props: props.filter((p) => (seen.has(String(p.id)) ? false : (seen.add(String(p.id)), true))) };
}

// ── KB docs (same text as sync_rightmove.py, so the old hashes still match) ───

function townOf(p: any): string {
  const parts = String(p.displayAddress).split(",").map((x: string) => x.trim()).filter(Boolean);
  if (parts.length >= 2 && /^[A-Z]{1,2}\d[A-Z\d]?(\s*\d[A-Z]{2})?$/.test(parts[parts.length - 1])) parts.pop();
  return parts.length >= 2 ? parts[parts.length - 1] : "Other";
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/(^|[^a-z])([a-z])/g, (_m, a, b) => a + b.toUpperCase());
}

function renderArticle(p: any): string {
  const { label, qualifier } = rightmovePrice(p);
  const status = rightmoveStatus(p);
  const lines = [`# ${p.displayAddress} — ${label} (${status})`, ""];
  lines.push(`Property reference: ${p.id}`);
  lines.push(`Address: ${p.displayAddress}`);
  const facts: string[] = [];
  if (p.propertySubType) facts.push(p.propertySubType);
  if (p.bedrooms) facts.push(`${p.bedrooms} bed`);
  if (p.bathrooms) facts.push(`${p.bathrooms} bath`);
  const tenure = p.tenure?.tenureType;
  if (tenure) facts.push(titleCase(tenure));
  if (facts.length) lines.push("Key facts: " + facts.join(", "));
  if (qualifier) lines.push(`Price qualifier: ${qualifier}`);
  lines.push(`Status: ${status}`);
  lines.push(`Listing page: https://www.rightmove.co.uk/properties/${p.id}`);
  const feats = (p.keyFeatures || []).map((f: any) => f?.description).filter(Boolean);
  if (feats.length) lines.push("", "Features:", ...feats.map((f: string) => `- ${f}`));
  if (p.summary) lines.push("", String(p.summary).trim());
  return lines.join("\n") + "\n";
}

function renderTownIndex(town: string, plist: any[]): string {
  const lines = [`# Bettermove properties in ${town} (current listings)`, ""];
  for (const p of [...plist].sort((a, b) => (a.price?.amount || 0) - (b.price?.amount || 0))) {
    const bits: string[] = [p.displayAddress];
    if (p.bedrooms) bits.push(`${p.bedrooms} bed`);
    if (p.propertySubType) bits.push(String(p.propertySubType).toLowerCase());
    bits.push(rightmovePrice(p).label, rightmoveStatus(p), `ref ${p.id}`);
    lines.push("- " + bits.filter(Boolean).join(", "));
  }
  lines.push("", `Total: ${plist.length} properties currently listed in ${town} with Bettermove.`);
  return lines.join("\n") + "\n";
}

function renderBudgetIndex(props: any[]): string {
  // Parsed by _shared/kb-property-budget-lookup.ts.
  const lines = ["# Bettermove listings by price (for sale, excludes sold STC)", ""];
  const live = props.filter((p) => rightmoveStatus(p) === "FOR SALE" && p.price?.amount);
  for (const p of live.sort((a, b) => a.price.amount - b.price.amount)) {
    lines.push(`- ${p.displayAddress} — £${p.price.amount.toLocaleString("en-GB")} — ${p.bedrooms || 0} bed — ref ${p.id}`);
  }
  return lines.join("\n") + "\n";
}

async function sha256(text: string) {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

// ── Sync one feed ─────────────────────────────────────────────────────────────

async function syncFeed(supabase: any, feed: any, dryRun: boolean) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const started = new Date().toISOString();
  const { total, props } = await fetchRightmove(feed.search_url);
  if (props.length < 20 || props.length < total * 0.9) {
    throw new Error(`refusing to sync: pulled ${props.length} of ${total} (blocked or layout change?)`);
  }
  const report: Record<string, unknown> = { profile_id: feed.profile_id, pulled: props.length, rightmove_total: total };
  if (dryRun) return { ...report, sample: props.slice(0, 3).map((p) => rightmoveToRow(p, feed.profile_id)) };

  // Listings table.
  const rows = props.map((p) => ({ ...rightmoveToRow(p, feed.profile_id), last_seen_at: started, removed_at: null }));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await supabase
      .from("property_listings")
      .upsert(rows.slice(i, i + 200), { onConflict: "profile_id,provider,listing_id" });
    if (error) throw new Error(`upsert listings: ${error.message}`);
  }
  const { count: removed, error: rmErr } = await supabase
    .from("property_listings")
    .update({ removed_at: started }, { count: "exact" })
    .eq("profile_id", feed.profile_id)
    .is("removed_at", null)
    .lt("last_seen_at", started);
  if (rmErr) throw new Error(`mark removed: ${rmErr.message}`);
  report.removed = removed ?? 0;

  // KB docs.
  if (feed.kb_prefix) {
    const prefix = feed.kb_prefix;
    const docs: Record<string, string> = {};
    const towns = new Map<string, any[]>();
    for (const p of props) {
      docs[`${prefix}-${p.id}.md`] = renderArticle(p);
      const t = townOf(p);
      towns.set(t, [...(towns.get(t) || []), p]);
    }
    for (const [town, plist] of towns) {
      const slug = town.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "other";
      docs[`${prefix}-town-${slug}.md`] = renderTownIndex(town, plist);
    }
    const budgetDoc = `${prefix}-budget-index.md`;
    const budget = renderBudgetIndex(props);

    const hashes: Record<string, string> = { ...(feed.kb_doc_hashes || {}) };
    const want: Record<string, string> = {};
    for (const [fn, text] of Object.entries(docs)) want[fn] = await sha256(text);
    const toIngest = Object.keys(docs).filter((fn) => hashes[fn] !== want[fn]);
    const toDelete = Object.keys(hashes).filter((fn) => !(fn in docs) && fn !== budgetDoc);
    const batch = toIngest.slice(0, KB_INGEST_CAP);
    const failed: string[] = [];

    let rateLimited = false;
    const ingest = async (fn: string) => {
      const res = await fetch(`${supabaseUrl}/functions/v1/kb-ingest`, {
        method: "POST",
        headers: { apikey: svcKey, Authorization: `Bearer ${svcKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          source_type: "upload",
          filename: fn,
          text: docs[fn],
          category: "General",
          bot_ids: [feed.profile_id],
        }),
      });
      const ok = res.ok && (await res.json().catch(() => ({})))?.success;
      if (res.status === 429) rateLimited = true;
      if (ok) hashes[fn] = want[fn];
      else failed.push(fn);
    };
    let ingested = 0;
    for (const fn of batch) {
      try {
        await ingest(fn);
      } catch (e) {
        // The runtime throws (rather than returning 429) once the trace's budget is spent.
        rateLimited = /rate limit/i.test((e as Error).message);
        failed.push(fn);
      }
      if (rateLimited) break;
      ingested++;
    }

    for (const fn of toDelete) {
      const { error } = await supabase
        .from("knowledge_base")
        .delete()
        .eq("source", `upload:${fn}`)
        .contains("bot_ids", [feed.profile_id]);
      if (error) failed.push(fn);
      else delete hashes[fn];
    }

    // The budget lookup reads exactly one row, so it is written directly, unchunked.
    const budgetHash = await sha256(budget);
    if (hashes[budgetDoc] !== budgetHash) {
      await supabase.from("knowledge_base").delete().eq("source", `upload:${budgetDoc}`).contains("bot_ids", [feed.profile_id]);
      const { error } = await supabase.from("knowledge_base").insert({
        content: budget,
        source: `upload:${budgetDoc}`,
        source_type: "upload",
        category: "General",
        title: "Bettermove listings by price",
        chunk_index: 0,
        bot_ids: [feed.profile_id],
      });
      if (error) failed.push(budgetDoc);
      else hashes[budgetDoc] = budgetHash;
    }

    await supabase.from("property_listing_feeds").update({ kb_doc_hashes: hashes }).eq("profile_id", feed.profile_id);
    Object.assign(report, {
      kb_ingested: ingested - failed.filter((f) => batch.includes(f)).length,
      kb_pending: toIngest.filter((fn) => hashes[fn] !== want[fn]).length,
      kb_rate_limited: rateLimited,
      kb_deleted: toDelete.length,
      kb_failed: failed,
    });
  }

  await supabase.from("property_listing_feeds").update({
    last_run_at: started,
    last_success_at: started,
    last_count: props.length,
    last_error: null,
  }).eq("profile_id", feed.profile_id);
  return report;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  const expected = await getSecret("cron_secret");
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supplied = req.headers.get("x-cron-secret") || "";
  const bearer = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!(expected && supplied === expected) && bearer !== svcKey) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const supabase = createClient(Deno.env.get("SUPABASE_URL")!, svcKey, { auth: { persistSession: false } });
  let q = supabase.from("property_listing_feeds").select("*").eq("enabled", true);
  if (body.profile_id) q = q.eq("profile_id", body.profile_id);
  const { data: feeds, error } = await q;
  if (error) return json({ error: error.message }, 500);

  const results = [];
  for (const feed of feeds || []) {
    try {
      results.push(await syncFeed(supabase, feed, !!body.dry_run));
    } catch (e) {
      const message = (e as Error).message;
      console.error(`[wisecall-listing-sync] ${feed.profile_id}: ${message}`);
      if (!body.dry_run) {
        await supabase.from("property_listing_feeds")
          .update({ last_run_at: new Date().toISOString(), last_error: message.slice(0, 500) })
          .eq("profile_id", feed.profile_id);
      }
      results.push({ profile_id: feed.profile_id, error: message });
    }
  }
  return json({ ok: true, results });
});
