// wisecall-qualify-enquiry — upsert a Digital Negotiator enquiry with
// qualification fields (budget, area, beds, timeline, vendor opportunity).
//
// Called as a during_call integration webhook (log_enquiry tool) or from the
// portal. Mirrors the auth model of wisecall-viewing-request.
//
// Auth: X-WiseCall-SMS-Secret == WISECALL_SMS_WEBHOOK_SECRET
//   OR Authorization: Bearer <service role key>
//
// Body (snake or camel):
//   profile_id (required)
//   contact_name, contact_phone / callerId, contact_email
//   party_role: buyer | tenant | vendor | landlord | other
//   status: new | qualifying | qualified | viewing_requested | …
//   budget_text, budget_min, budget_max, areas, beds_min, property_types
//   move_timeline, financing, has_property_to_sell, chain_position
//   listing_interest, listing_ref, property_id, viewing_id
//   summary, needs_human, human_reason, source, call_id

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wisecall-sms-secret",
};

type Body = Record<string, unknown>;

const PARTY_ROLES = new Set(["buyer", "tenant", "vendor", "landlord", "other"]);
const STATUSES = new Set([
  "new",
  "qualifying",
  "qualified",
  "viewing_requested",
  "confirmed",
  "handed_to_negotiator",
  "closed_lost",
  "closed_won",
]);
const SOURCES = new Set(["phone", "whatsapp", "sms", "email", "web", "manual", "analysis"]);

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function authorised(req: Request): boolean {
  const smsSecret = Deno.env.get("WISECALL_SMS_WEBHOOK_SECRET") || "";
  const supplied = req.headers.get("X-WiseCall-SMS-Secret") || "";
  if (smsSecret && supplied === smsSecret) return true;

  const svc = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const auth = req.headers.get("Authorization") || "";
  if (svc && (auth === `Bearer ${svc}` || req.headers.get("apikey") === svc)) return true;
  return false;
}

function str(body: Body, ...keys: string[]): string {
  for (const key of keys) {
    const v = body[key];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number" && Number.isFinite(v)) return String(v);
  }
  return "";
}

function bool(body: Body, ...keys: string[]): boolean | null {
  for (const key of keys) {
    const v = body[key];
    if (typeof v === "boolean") return v;
    if (typeof v === "string") {
      const t = v.trim().toLowerCase();
      if (["true", "yes", "1", "y"].includes(t)) return true;
      if (["false", "no", "0", "n"].includes(t)) return false;
    }
  }
  return null;
}

function int(body: Body, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = body[key];
    if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.replace(/[£$,\s]/g, ""));
      if (Number.isFinite(n)) return Math.round(n);
    }
  }
  return null;
}

function strArray(body: Body, ...keys: string[]): string[] {
  for (const key of keys) {
    const v = body[key];
    if (Array.isArray(v)) {
      return v
        .filter((x): x is string => typeof x === "string")
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 20);
    }
    if (typeof v === "string" && v.trim()) {
      return v
        .split(/[,;|]/)
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(0, 20);
    }
  }
  return [];
}

function normalisePhone(raw: string): string {
  const digits = raw.replace(/[^\d+]/g, "");
  if (!digits) return "";
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0") && digits.length >= 10) return `+44${digits.slice(1)}`;
  return digits.startsWith("44") ? `+${digits}` : digits;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }
  if (!authorised(req)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let body: Body = {};
  try {
    body = (await req.json()) as Body;
  } catch {
    return json({ ok: false, error: "Invalid JSON" }, 400);
  }

  const profileId = str(body, "profile_id", "profileId");
  if (!profileId) return json({ ok: false, error: "profile_id required" }, 400);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !serviceKey) {
    return json({ ok: false, error: "Supabase not configured" }, 503);
  }
  const sb = createClient(supabaseUrl, serviceKey);

  const { data: profile, error: profileErr } = await sb
    .from("wisecall_profiles")
    .select("id")
    .eq("id", profileId)
    .maybeSingle();
  if (profileErr || !profile) {
    return json({ ok: false, error: "Profile not found" }, 404);
  }

  const partyRaw = str(body, "party_role", "partyRole").toLowerCase() || "buyer";
  const party_role = PARTY_ROLES.has(partyRaw) ? partyRaw : "buyer";

  const statusRaw = str(body, "status").toLowerCase() || "qualified";
  const status = STATUSES.has(statusRaw) ? statusRaw : "qualified";

  const sourceRaw = str(body, "source").toLowerCase() || "phone";
  const source = SOURCES.has(sourceRaw) ? sourceRaw : "phone";

  const contact_phone = normalisePhone(
    str(body, "contact_phone", "contactPhone", "callerId", "phone", "viewer_phone"),
  );
  const contact_name = str(body, "contact_name", "contactName", "viewer_name", "name");
  const contact_email = str(body, "contact_email", "contactEmail", "email");
  const call_id = str(body, "call_id", "callId") || null;
  const summary = str(body, "summary", "notes").slice(0, 1000) || null;
  const needsHuman = bool(body, "needs_human", "needsHuman") === true;
  const human_reason = str(body, "human_reason", "humanReason").slice(0, 500) || null;

  let contact_id: string | null = null;
  if (contact_phone) {
    const { data: contact } = await sb
      .from("wisecall_contacts")
      .select("id")
      .eq("profile_id", profileId)
      .eq("phone", contact_phone)
      .maybeSingle();
    contact_id = (contact?.id as string) || null;

    if (!contact_id) {
      const { data: created } = await sb
        .from("wisecall_contacts")
        .insert({
          profile_id: profileId,
          phone: contact_phone,
          name: contact_name || null,
          email: contact_email || null,
          metadata: { role: party_role, source: "digital_negotiator" },
        })
        .select("id")
        .maybeSingle();
      contact_id = (created?.id as string) || null;
    } else if (contact_name) {
      await sb
        .from("wisecall_contacts")
        .update({
          name: contact_name,
          ...(contact_email ? { email: contact_email } : {}),
          updated_at: new Date().toISOString(),
        })
        .eq("id", contact_id)
        .is("name", null);
    }
  }

  const row = {
    profile_id: profileId,
    contact_id,
    property_id: str(body, "property_id", "propertyId") || null,
    viewing_id: str(body, "viewing_id", "viewingId") || null,
    call_id,
    party_role,
    status,
    contact_name: contact_name || null,
    contact_phone: contact_phone || null,
    contact_email: contact_email || null,
    budget_min: int(body, "budget_min", "budgetMin"),
    budget_max: int(body, "budget_max", "budgetMax"),
    budget_text: str(body, "budget_text", "budgetText", "budget").slice(0, 80) || null,
    areas: strArray(body, "areas", "area"),
    beds_min: int(body, "beds_min", "bedsMin", "beds"),
    property_types: strArray(body, "property_types", "propertyTypes"),
    move_timeline: str(body, "move_timeline", "moveTimeline", "timeline").slice(0, 120) || null,
    financing: str(body, "financing").slice(0, 120) || null,
    has_property_to_sell: bool(body, "has_property_to_sell", "hasPropertyToSell"),
    chain_position: str(body, "chain_position", "chainPosition").slice(0, 120) || null,
    listing_interest: str(body, "listing_interest", "listingInterest").slice(0, 280) || null,
    listing_ref: str(body, "listing_ref", "listingRef").slice(0, 80) || null,
    summary,
    needs_human: needsHuman,
    human_reason,
    source,
    updated_at: new Date().toISOString(),
  };

  // Upsert-ish: if same phone + open enquiry in last 48h, update it
  let enquiryId: string | null = null;
  if (contact_phone) {
    const since = new Date(Date.now() - 48 * 3600 * 1000).toISOString();
    const { data: existingRows } = await sb
      .from("wisecall_enquiries")
      .select("id, status")
      .eq("profile_id", profileId)
      .eq("contact_phone", contact_phone)
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(5);
    const existing = (existingRows || []).find(
      (r) => r.status !== "closed_lost" && r.status !== "closed_won",
    );
    if (existing?.id) {
      const { data: updated, error: updErr } = await sb
        .from("wisecall_enquiries")
        .update(row)
        .eq("id", existing.id)
        .select("id, status")
        .single();
      if (updErr) return json({ ok: false, error: updErr.message }, 500);
      enquiryId = updated.id as string;
      return json({
        ok: true,
        enquiry_id: enquiryId,
        status: updated.status,
        updated: true,
        message: "Enquiry updated for the branch weekend results board.",
      });
    }
  }

  const { data: inserted, error: insErr } = await sb
    .from("wisecall_enquiries")
    .insert({ ...row, created_at: new Date().toISOString() })
    .select("id, status")
    .single();

  if (insErr || !inserted) {
    return json({ ok: false, error: insErr?.message || "Failed to save enquiry" }, 500);
  }

  return json({
    ok: true,
    enquiry_id: inserted.id,
    status: inserted.status,
    updated: false,
    message: "Enquiry logged for the branch weekend results board.",
  });
});
