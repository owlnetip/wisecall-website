// wisecall-pool-replenish — tops up the GB number pool when it runs low.
//
// Triggered on a schedule (pg_cron → net.http_post) and/or on demand. When the
// number of FREE numbers in wisecall_number_pool drops below the threshold, it
// orders enough GB 0113 numbers (referencing the approved requirement group +
// the shared TeXML app) to reach the target, then seeds them into the pool.
// Fail-soft; on insufficient Telnyx credit it emails an alert instead of erroring.
//
// Auth: header x-trigger-secret == WISECALL_POOL_REPLENISH_SECRET.
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, TELNYX_API_KEY,
//          WISECALL_POOL_REPLENISH_SECRET, RESEND_API_KEY (alerts),
//          WISECALL_EMAIL_FROM / WISECALL_EMAIL_TO (alert from/to).
// Tunables: WISECALL_POOL_MIN_FREE (default 2), WISECALL_POOL_TARGET (default 10),
//           WISECALL_POOL_NDC (default 113).

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const REQUIREMENT_GROUP = "cc32dd8f-1c1b-46aa-81f5-fc54beeb0be2";
const CONNECTION_ID = "2985822410638362142"; // shared "WiseCall Pool" TeXML app
const TELNYX = "https://api.telnyx.com/v2";

function num(env: string, dflt: number) {
  const v = Number(Deno.env.get(env));
  return Number.isFinite(v) && v > 0 ? v : dflt;
}

async function alertEmail(subject: string, text: string) {
  const key = Deno.env.get("RESEND_API_KEY");
  if (!key) return;
  const from = Deno.env.get("WISECALL_EMAIL_FROM") || "WiseCall <info@owlnet.io>";
  const to = (Deno.env.get("WISECALL_EMAIL_TO") || "info@owlnet.io").split(",").map((s) => s.trim());
  try {
    await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, text }),
    });
  } catch (_e) { /* ignore */ }
}

// Assigns free pool numbers to agents that signed up while the pool was empty
// (metadata.awaiting_number === true, no number yet) and activates them, so the
// create → empty-pool → replenish → live loop closes with no human step. The
// runtime only routes calls to is_active profiles, so is_active MUST be set here
// alongside the number. Returns how many agents were put live.
async function assignWaitingAgents(
  supabase: ReturnType<typeof createClient>,
): Promise<number> {
  const { data: waiting, error } = await supabase
    .from("wisecall_profiles")
    .select("id, metadata")
    .eq("metadata->>awaiting_number", "true")
    .is("telnyx_number", null)
    .limit(50);
  if (error || !waiting?.length) return 0;

  let assignedCount = 0;
  for (const row of waiting) {
    const { data: number } = await supabase.rpc("wisecall_assign_pool_number", {
      p_profile_id: row.id,
    });
    if (!number) break; // pool drained — stop, remaining stay pending for next run
    const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
    delete metadata.awaiting_number;
    await supabase
      .from("wisecall_profiles")
      .update({
        telnyx_number: number,
        is_active: true,
        metadata: {
          ...metadata,
          routing: { provider: "telnyx", number, status: "live" },
        },
      })
      .eq("id", row.id as string);
    assignedCount += 1;
  }
  return assignedCount;
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const expected = Deno.env.get("WISECALL_POOL_REPLENISH_SECRET") || "";
  const provided = req.headers.get("x-trigger-secret") || "";
  if (!expected || provided !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401 });
  }

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const telnyxKey = Deno.env.get("TELNYX_API_KEY");
  if (!telnyxKey) return json({ ok: false, error: "TELNYX_API_KEY not configured" }, 500);

  const minFree = num("WISECALL_POOL_MIN_FREE", 2);
  const target = num("WISECALL_POOL_TARGET", 10);
  const ndc = Deno.env.get("WISECALL_POOL_NDC") || "113";

  // How many free do we have?
  const { count: freeCount, error: cErr } = await supabase
    .from("wisecall_number_pool")
    .select("id", { count: "exact", head: true })
    .eq("status", "free");
  if (cErr) return json({ ok: false, error: cErr.message }, 500);

  // Serve any agents already waiting from the current free pool first (e.g. a
  // number freed by a cancellation, or signups that outran the pool). This runs
  // every cycle, even when the pool is healthy.
  const assignedFromExisting = await assignWaitingAgents(supabase);

  // Re-count free after those assignments so the order math and health check are
  // based on the true remaining stock.
  const { count: freeAfter } = await supabase
    .from("wisecall_number_pool")
    .select("id", { count: "exact", head: true })
    .eq("status", "free");
  const free = freeAfter ?? Math.max(0, (freeCount ?? 0) - assignedFromExisting);

  if (free >= minFree) {
    return json({ ok: true, skipped: "pool healthy", free, minFree, assigned: assignedFromExisting });
  }

  const need = Math.max(0, target - free);
  const tHeaders = { Authorization: `Bearer ${telnyxKey}`, "Content-Type": "application/json" };

  // Find available numbers (ask for extra in case some become unreservable).
  const q = new URLSearchParams();
  q.append("filter[country_code]", "GB");
  q.append("filter[national_destination_code]", ndc);
  q.append("filter[features][]", "voice");
  q.append("filter[limit]", String(need + 5));
  const availRes = await fetch(`${TELNYX}/available_phone_numbers?${q}`, { headers: tHeaders });
  const avail = await availRes.json().catch(() => ({}));
  const candidates: string[] = (avail.data ?? [])
    .filter((r: any) => r.reservable)
    .map((r: any) => r.phone_number)
    .slice(0, need);

  if (!candidates.length) {
    await alertEmail("WiseCall pool: no GB numbers available", `Pool is low (${free} free) but Telnyx returned no available 0${ndc} numbers to order.`);
    return json({ ok: false, reason: "no_numbers_available", free });
  }

  // Order them against the approved requirement group + shared TeXML app.
  const orderRes = await fetch(`${TELNYX}/number_orders`, {
    method: "POST",
    headers: tHeaders,
    body: JSON.stringify({
      phone_numbers: candidates.map((n) => ({ phone_number: n, requirement_group_id: REQUIREMENT_GROUP })),
      connection_id: CONNECTION_ID,
    }),
  });
  const order = await orderRes.json().catch(() => ({}));

  if (!orderRes.ok) {
    const code = order?.errors?.[0]?.code;
    const detail = order?.errors?.[0]?.detail || JSON.stringify(order).slice(0, 300);
    if (code === "20100") {
      await alertEmail(
        "WiseCall pool: top up Telnyx credit",
        `The number pool is low (${free} free) and auto-replenish couldn't order ${need} more — Telnyx reported insufficient funds.\n\n${detail}\n\nTop up the Telnyx balance and it'll order on the next run.`,
      );
      return json({ ok: false, reason: "insufficient_funds", free, need, detail });
    }
    return json({ ok: false, reason: "order_failed", detail }, 502);
  }

  const orderedNumbers: string[] = (order.data?.phone_numbers ?? []).map((p: any) => p.phone_number);

  // Give Telnyx a moment to activate (requirement group is approved → fast), then
  // fetch ids. Seed regardless — telnyx_id is only used for management, not routing.
  await new Promise((r) => setTimeout(r, 6000));
  const idByNumber: Record<string, string> = {};
  try {
    const pnRes = await fetch(`${TELNYX}/phone_numbers?page[size]=250`, { headers: tHeaders });
    const data = (await pnRes.json().catch(() => ({}))).data ?? [];
    for (const pn of data) {
      if (orderedNumbers.includes(pn.phone_number)) idByNumber[pn.phone_number] = pn.id;
    }
  } catch (_e) { /* best effort — telnyx_id isn't needed for routing */ }

  const rows = orderedNumbers.map((n) => ({
    phone_number: n,
    telnyx_id: idByNumber[n] ?? null,
    area_code: ndc,
    status: "free",
  }));
  const { error: insErr } = await supabase
    .from("wisecall_number_pool")
    .upsert(rows, { onConflict: "phone_number", ignoreDuplicates: true });
  if (insErr) {
    return json({ ok: false, reason: "seed_failed", error: insErr.message, ordered: orderedNumbers });
  }

  // Now that fresh numbers are in the pool, drain any remaining waiting agents.
  const assignedAfterOrder = await assignWaitingAgents(supabase);

  return json({
    ok: true,
    ordered: orderedNumbers.length,
    numbers: orderedNumbers,
    free_before: free,
    target,
    assigned: assignedFromExisting + assignedAfterOrder,
  });
});
