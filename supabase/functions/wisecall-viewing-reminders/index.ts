// wisecall-viewing-reminders — day-before "still ok?" + day-of reminders
// for confirmed property viewings.
//
// Trigger: Vercel cron → portal /api/cron/viewing-reminders → this function,
// or pg_cron → net.http_post directly.
//
// Auth: x-trigger-secret == WISECALL_POOL_REPLENISH_SECRET
//   OR Authorization: Bearer CRON_SECRET / service role
//
// Windows (Europe/London calendar day):
//   - Day-before still-ok: confirmed viewings whose slot is tomorrow, not yet sent
//   - Day-of reminder: confirmed viewings whose slot is today, not yet sent

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  dayBeforeStillOkMessage,
  dayOfReminderMessage,
  normalisePhone,
} from "../_shared/viewing-confirm.ts";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function authorised(req: Request): boolean {
  const trigger = Deno.env.get("WISECALL_POOL_REPLENISH_SECRET") || "";
  if (trigger && req.headers.get("x-trigger-secret") === trigger) return true;

  const cron = Deno.env.get("CRON_SECRET") || "";
  const auth = req.headers.get("Authorization") || "";
  if (cron && auth === `Bearer ${cron}`) return true;

  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (svc && auth === `Bearer ${svc}`) return true;
  return false;
}

/** London calendar day bounds as UTC ISO strings. */
function londonDayBounds(offsetDays: number): { start: string; end: string } {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/London",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const now = new Date();
  const base = new Date(now.getTime() + offsetDays * 24 * 60 * 60 * 1000);
  // Approximate: take YYYY-MM-DD in London, then treat as midnight London via
  // iterative parse (good enough for daily reminder windows).
  const parts = fmt.format(base); // YYYY-MM-DD
  // Build start/end by scanning hours — find first/last UTC instant on that London date.
  let start: Date | null = null;
  let end: Date | null = null;
  const probe = new Date(`${parts}T00:00:00.000Z`);
  for (let h = -24; h < 48; h++) {
    const d = new Date(probe.getTime() + h * 60 * 60 * 1000);
    if (fmt.format(d) === parts) {
      if (!start) start = d;
      end = new Date(d.getTime() + 60 * 60 * 1000);
    }
  }
  if (!start || !end) {
    // Fallback UTC day
    const s = new Date(`${parts}T00:00:00.000Z`);
    return { start: s.toISOString(), end: new Date(s.getTime() + 86400000).toISOString() };
  }
  return { start: start.toISOString(), end: end.toISOString() };
}

async function sendSms(opts: {
  phone: string;
  message: string;
  profileId: string;
  profileSlug: string | null;
  linkType: string;
}): Promise<boolean> {
  const expectedSecret = Deno.env.get("WISECALL_SMS_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!expectedSecret || !supabaseUrl) return false;
  const res = await fetch(`${supabaseUrl}/functions/v1/wisecall-send-sms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-WiseCall-SMS-Secret": expectedSecret,
    },
    body: JSON.stringify({
      phone: opts.phone,
      message: opts.message,
      link_type: opts.linkType,
      profile_id: opts.profileId,
      profile_slug: opts.profileSlug,
    }),
  });
  const result = await res.json().catch(() => ({}));
  return res.ok && !!result.success;
}

Deno.serve(async (req) => {
  if (req.method !== "POST" && req.method !== "GET") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  if (!authorised(req)) return json({ ok: false, error: "Unauthorized" }, 401);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const tomorrow = londonDayBounds(1);
  const today = londonDayBounds(0);

  const { data: dayBeforeRows, error: dbErr } = await supabase
    .from("wisecall_viewing_requests")
    .select(
      "id, profile_id, property_address, owner_phone, viewer_phone, viewer_name, owner_name, proposed_starts_at",
    )
    .eq("status", "confirmed")
    .is("day_before_still_ok_sent_at", null)
    .gte("proposed_starts_at", tomorrow.start)
    .lt("proposed_starts_at", tomorrow.end)
    .limit(200);

  if (dbErr) return json({ ok: false, error: dbErr.message }, 500);

  const { data: dayOfRows, error: doErr } = await supabase
    .from("wisecall_viewing_requests")
    .select(
      "id, profile_id, property_address, owner_phone, viewer_phone, viewer_name, owner_name, proposed_starts_at",
    )
    .eq("status", "confirmed")
    .is("day_of_reminder_sent_at", null)
    .gte("proposed_starts_at", today.start)
    .lt("proposed_starts_at", today.end)
    .limit(200);

  if (doErr) return json({ ok: false, error: doErr.message }, 500);

  const profileCache = new Map<string, { name: string; slug: string | null }>();
  async function businessFor(profileId: string) {
    if (profileCache.has(profileId)) return profileCache.get(profileId)!;
    const { data } = await supabase
      .from("wisecall_profiles")
      .select("business_name, clinic_name, profile_name, slug")
      .eq("id", profileId)
      .maybeSingle();
    const name = String(
      data?.business_name || data?.clinic_name || data?.profile_name || "WiseCall",
    ).slice(0, 40);
    const info = { name, slug: (data?.slug as string | null) ?? null };
    profileCache.set(profileId, info);
    return info;
  }

  let dayBeforeSent = 0;
  for (const row of dayBeforeRows || []) {
    const biz = await businessFor(row.profile_id);
    const now = new Date().toISOString();
    let any = false;

    for (const party of ["owner", "viewer"] as const) {
      const phone = normalisePhone(
        party === "owner" ? row.owner_phone || "" : row.viewer_phone || "",
      );
      if (!phone) continue;
      const message = dayBeforeStillOkMessage({
        businessName: biz.name,
        address: row.property_address,
        startsAt: row.proposed_starts_at,
        party,
      });
      const ok = await sendSms({
        phone,
        message,
        profileId: row.profile_id,
        profileSlug: biz.slug,
        linkType: `viewing-d1-${row.id.slice(0, 8)}-${party}`,
      });
      if (ok) {
        any = true;
        dayBeforeSent += 1;
        await supabase.from("wisecall_viewing_messages").insert({
          viewing_request_id: row.id,
          profile_id: row.profile_id,
          direction: "outbound",
          channel: "sms",
          party,
          to_address: phone,
          body: message,
          purpose: "day_before_still_ok",
        });
      }
    }

    if (any) {
      await supabase
        .from("wisecall_viewing_requests")
        .update({ day_before_still_ok_sent_at: now, updated_at: now })
        .eq("id", row.id);
    }
  }

  let dayOfSent = 0;
  for (const row of dayOfRows || []) {
    const biz = await businessFor(row.profile_id);
    const now = new Date().toISOString();
    let any = false;

    // Owner gets viewer details; viewer gets a lighter day-of nudge.
    const parties: Array<{
      party: "owner" | "viewer";
      phone: string;
      counterpartyName: string | null;
      counterpartyPhone: string | null;
    }> = [];
    if (row.owner_phone) {
      parties.push({
        party: "owner",
        phone: normalisePhone(row.owner_phone),
        counterpartyName: row.viewer_name,
        counterpartyPhone: row.viewer_phone,
      });
    }
    if (row.viewer_phone) {
      parties.push({
        party: "viewer",
        phone: normalisePhone(row.viewer_phone),
        counterpartyName: row.owner_name,
        counterpartyPhone: null, // don't share owner number with viewer by default
      });
    }

    for (const p of parties) {
      if (!p.phone) continue;
      const message = dayOfReminderMessage({
        businessName: biz.name,
        address: row.property_address,
        startsAt: row.proposed_starts_at,
        counterpartyName: p.counterpartyName,
        counterpartyPhone: p.counterpartyPhone,
      });
      const ok = await sendSms({
        phone: p.phone,
        message,
        profileId: row.profile_id,
        profileSlug: biz.slug,
        linkType: `viewing-d0-${row.id.slice(0, 8)}-${p.party}`,
      });
      if (ok) {
        any = true;
        dayOfSent += 1;
        await supabase.from("wisecall_viewing_messages").insert({
          viewing_request_id: row.id,
          profile_id: row.profile_id,
          direction: "outbound",
          channel: "sms",
          party: p.party,
          to_address: p.phone,
          body: message,
          purpose: "day_of_reminder",
        });
      }
    }

    if (any) {
      await supabase
        .from("wisecall_viewing_requests")
        .update({ day_of_reminder_sent_at: now, updated_at: now })
        .eq("id", row.id);
    }
  }

  return json({
    ok: true,
    day_before_messages: dayBeforeSent,
    day_of_messages: dayOfSent,
    day_before_candidates: (dayBeforeRows || []).length,
    day_of_candidates: (dayOfRows || []).length,
  });
});
