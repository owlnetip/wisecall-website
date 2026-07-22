// wisecall-viewing-request — create a property viewing request, check agent
// availability when a calendar connector exists, email the agent, then ask the
// owner via SMS whether the proposed slot is ok.
//
// Called as a during_call integration webhook or from the portal (service role
// / shared SMS secret). Mirrors the safety model of wisecall-listing-sms.
//
// Auth: X-WiseCall-SMS-Secret == WISECALL_SMS_WEBHOOK_SECRET
//   OR Authorization: Bearer <service role key>
//
// Body:
//   profile_id | profileId (required)
//   property_id | propertyId  OR  address / listing_ref (looked up in register)
//   starts_at | startsAt (ISO)
//   ends_at | endsAt (ISO, optional — defaults +30 mins)
//   viewer_name, viewer_phone / callerId, viewer_email
//   source: phone | whatsapp | sms | email | manual | web
//   call_id
//   skip_owner_notify?: boolean  (create only)

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  normalisePhone,
  ownerAskMessage,
} from "../_shared/viewing-confirm.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wisecall-sms-secret",
};

type Body = {
  profile_id?: string;
  profileId?: string;
  property_id?: string;
  propertyId?: string;
  address?: string;
  postcode?: string;
  listing_ref?: string;
  listing_url?: string;
  owner_name?: string;
  owner_phone?: string;
  owner_email?: string;
  owner_preferred_channel?: string;
  starts_at?: string;
  startsAt?: string;
  ends_at?: string;
  endsAt?: string;
  viewer_name?: string;
  viewer_phone?: string;
  callerId?: string;
  phone?: string;
  viewer_email?: string;
  source?: string;
  call_id?: string;
  callId?: string;
  notes?: string;
  skip_owner_notify?: boolean;
  duration_mins?: number;
};

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

function asEmailList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function uniqueEmails(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const email = value.trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

function agentRecipients(metadata: Record<string, unknown>): string[] {
  const configured = uniqueEmails([
    ...asEmailList(metadata.default_routing_email),
    ...asEmailList(metadata.notification_emails),
  ]);
  if (configured.length) return configured;
  return asEmailList(Deno.env.get("WISECALL_EMAIL_TO") || "info@owlnet.io");
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function sendAgentViewingEmail(opts: {
  businessName: string;
  metadata: Record<string, unknown>;
  viewing: Record<string, unknown>;
  availability: { checked: boolean; available: boolean | null; note: string | null };
}): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL") ?? "WiseCall <hello@wisecall.io>";
  if (!resendKey) return { ok: false, skipped: "missing_resend" };

  const to = agentRecipients(opts.metadata);
  if (!to.length) return { ok: false, skipped: "no_recipients" };

  const slot = new Date(String(opts.viewing.proposed_starts_at)).toLocaleString("en-GB", {
    timeZone: "Europe/London",
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
  const address = String(opts.viewing.property_address || "Property");
  const viewerName = String(opts.viewing.viewer_name || "Unknown caller");
  const viewerPhone = String(opts.viewing.viewer_phone || "—");
  const ownerName = String(opts.viewing.owner_name || "Owner");
  const ownerPhone = String(opts.viewing.owner_phone || "—");
  const availabilityNote = opts.availability.note
    ? `<p style="margin:0 0 12px;padding:12px;background:#f0faf9;border-radius:8px;">${escapeHtml(opts.availability.note)}</p>`
    : "";

  const html = `
    <div style="font-family:system-ui,sans-serif;color:#172929;max-width:560px;">
      <h2 style="margin:0 0 12px;font-size:18px;">New viewing request</h2>
      <p style="margin:0 0 16px;color:#4a5c5b;">${escapeHtml(opts.businessName)} · ${escapeHtml(slot)}</p>
      ${availabilityNote}
      <p style="margin:0 0 8px;"><strong>Property:</strong> ${escapeHtml(address)}</p>
      <p style="margin:0 0 8px;"><strong>Viewer:</strong> ${escapeHtml(viewerName)} · ${escapeHtml(viewerPhone)}</p>
      <p style="margin:0 0 16px;"><strong>Owner:</strong> ${escapeHtml(ownerName)} · ${escapeHtml(ownerPhone)}</p>
      <p style="margin:0;font-size:12px;color:#7a8a89;">The owner has been texted to confirm. You'll get another update when they reply.</p>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: `Viewing request · ${address} · ${opts.businessName}`,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
}

async function sendSmsViaHelper(opts: {
  phone: string;
  message: string;
  profileId: string;
  profileSlug: string | null;
  callId: string | null;
  linkType: string;
}): Promise<{ ok: boolean; error?: string }> {
  const expectedSecret = Deno.env.get("WISECALL_SMS_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!expectedSecret || !supabaseUrl) {
    return { ok: false, error: "SMS helper not configured" };
  }
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
      call_id: opts.callId,
      profile_id: opts.profileId,
      profile_slug: opts.profileSlug,
    }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok || !result.success) {
    return { ok: false, error: result.error || `SMS ${res.status}` };
  }
  return { ok: true };
}

  return { ok: true };
}

async function lookupProperty(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
  opts: { listingRef?: string | null; address?: string },
): Promise<Record<string, unknown> | null> {
  const listingRef = String(opts.listingRef || "").trim();
  const address = String(opts.address || "").trim();

  if (listingRef) {
    const { data } = await supabase
      .from("wisecall_properties")
      .select("*")
      .eq("profile_id", profileId)
      .eq("is_active", true)
      .ilike("listing_ref", listingRef)
      .maybeSingle();
    if (data) return data;
  }

  if (address) {
    const { data: exact } = await supabase
      .from("wisecall_properties")
      .select("*")
      .eq("profile_id", profileId)
      .eq("is_active", true)
      .ilike("address", address)
      .maybeSingle();
    if (exact) return exact;

    const { data: fuzzy } = await supabase
      .from("wisecall_properties")
      .select("*")
      .eq("profile_id", profileId)
      .eq("is_active", true)
      .ilike("address", `%${address}%`)
      .limit(1)
      .maybeSingle();
    if (fuzzy) return fuzzy;
  }

  return null;
}

async function checkAgentAvailability(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
  startsAt: Date,
  endsAt: Date,
): Promise<{ checked: boolean; available: boolean | null; note: string | null }> {
  const { data: conn } = await supabase
    .from("wisecall_calendar_connections")
    .select("provider, access_token, config, event_types, status")
    .eq("profile_id", profileId)
    .eq("status", "connected")
    .maybeSingle();

  if (!conn?.access_token) {
    return {
      checked: false,
      available: null,
      note: "No calendar connector — owner ask proceeds; agent diary not verified.",
    };
  }

  if (conn.provider === "cal_com") {
    try {
      const eventTypes = Array.isArray(conn.event_types) ? conn.event_types : [];
      const eventTypeId = eventTypes[0]?.id;
      if (!eventTypeId) {
        return { checked: false, available: null, note: "Cal.com connected but no event type selected." };
      }
      const fromISO = startsAt.toISOString();
      const toISO = new Date(endsAt.getTime() + 60 * 60 * 1000).toISOString();
      const qs = new URLSearchParams({
        eventTypeId: String(eventTypeId),
        start: fromISO,
        end: toISO,
      });
      const r = await fetch(`https://api.cal.com/v2/slots?${qs}`, {
        headers: {
          Authorization: `Bearer ${conn.access_token}`,
          "cal-api-version": "2024-08-13",
        },
        signal: AbortSignal.timeout(10000),
      });
      if (!r.ok) {
        return { checked: true, available: null, note: `Cal.com slots lookup failed (${r.status}).` };
      }
      const body = await r.json();
      const data = body?.data ?? {};
      const days = data.slots ?? data;
      const slots: string[] = [];
      for (const key of Object.keys(days || {})) {
        for (const s of days[key] || []) {
          if (s?.start) slots.push(s.start);
        }
      }
      const target = startsAt.getTime();
      const hit = slots.some((s) => Math.abs(new Date(s).getTime() - target) < 2 * 60 * 1000);
      return {
        checked: true,
        available: hit,
        note: hit
          ? "Cal.com has an open slot at the proposed time."
          : "Cal.com has no open slot at the proposed time — owner ask still sent; negotiator should confirm.",
      };
    } catch (e) {
      return { checked: true, available: null, note: `Cal.com error: ${(e as Error).message}` };
    }
  }

  return {
    checked: false,
    available: null,
    note: `Calendar provider ${conn.provider} connected — availability check not automated yet.`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!authorised(req)) return json({ error: "Unauthorized" }, 401);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const profileId = String(body.profileId || body.profile_id || "").trim();
  if (!profileId) return json({ success: false, error: "profile_id required" }, 400);

  const startsRaw = String(body.startsAt || body.starts_at || "").trim();
  const startsAt = startsRaw ? new Date(startsRaw) : null;
  if (!startsAt || Number.isNaN(startsAt.getTime())) {
    return json({ success: false, error: "starts_at must be a valid ISO datetime" }, 400);
  }
  const durationMins = Math.min(Math.max(Number(body.duration_mins) || 30, 15), 180);
  const endsRaw = String(body.endsAt || body.ends_at || "").trim();
  const endsAt = endsRaw
    ? new Date(endsRaw)
    : new Date(startsAt.getTime() + durationMins * 60 * 1000);
  if (Number.isNaN(endsAt.getTime()) || endsAt <= startsAt) {
    return json({ success: false, error: "ends_at must be after starts_at" }, 400);
  }

  const viewerPhone = normalisePhone(
    String(body.viewer_phone || body.phone || body.callerId || "").trim(),
  );
  const viewerName = String(body.viewer_name || "").trim().slice(0, 120) || null;
  const viewerEmail = String(body.viewer_email || "").trim().slice(0, 200) || null;
  const source = String(body.source || "phone").trim().toLowerCase();
  const callId = String(body.callId || body.call_id || "").trim() || null;
  const notes = String(body.notes || "").trim().slice(0, 1000) || null;

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: profile } = await supabase
    .from("wisecall_profiles")
    .select("id, business_name, clinic_name, profile_name, slug, sms_enabled, metadata")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return json({ success: false, error: "profile not found" }, 404);

  const businessName = String(
    profile.business_name || profile.clinic_name || profile.profile_name || "WiseCall",
  ).slice(0, 40);

  // Resolve or create property
  let propertyId = String(body.propertyId || body.property_id || "").trim() || null;
  let address = String(body.address || "").trim();
  let ownerPhone = normalisePhone(String(body.owner_phone || "").trim());
  let ownerName = String(body.owner_name || "").trim().slice(0, 120) || null;
  let ownerEmail = String(body.owner_email || "").trim().slice(0, 200) || null;
  let listingRef = String(body.listing_ref || "").trim().slice(0, 80) || null;
  let preferredChannel = String(body.owner_preferred_channel || "auto").trim().toLowerCase();

  if (propertyId) {
    const { data: prop } = await supabase
      .from("wisecall_properties")
      .select("*")
      .eq("id", propertyId)
      .eq("profile_id", profileId)
      .maybeSingle();
    if (!prop) return json({ success: false, error: "property not found for this agent" }, 404);
    address = prop.address;
    ownerPhone = normalisePhone(prop.owner_phone || "") || ownerPhone;
    ownerName = prop.owner_name || ownerName;
    ownerEmail = prop.owner_email || ownerEmail;
    listingRef = prop.listing_ref || listingRef;
    preferredChannel = prop.owner_preferred_channel || preferredChannel;
  } else {
    const found = await lookupProperty(supabase, profileId, { listingRef, address });
    if (found) {
      propertyId = String(found.id);
      address = String(found.address || address);
      ownerPhone = normalisePhone(String(found.owner_phone || "")) || ownerPhone;
      ownerName = (found.owner_name as string | null) || ownerName;
      ownerEmail = (found.owner_email as string | null) || ownerEmail;
      listingRef = (found.listing_ref as string | null) || listingRef;
      preferredChannel = String(found.owner_preferred_channel || preferredChannel);
    } else if (address && ownerPhone) {
      const { data: created, error: propErr } = await supabase
        .from("wisecall_properties")
        .insert({
          profile_id: profileId,
          address,
          postcode: String(body.postcode || "").trim() || null,
          listing_ref: listingRef,
          listing_url: String(body.listing_url || "").trim() || null,
          owner_name: ownerName,
          owner_phone: ownerPhone,
          owner_email: ownerEmail,
          owner_preferred_channel: "sms",
        })
        .select("id")
        .single();
      if (propErr || !created) {
        return json({ success: false, error: propErr?.message || "failed to create property" }, 500);
      }
      propertyId = created.id;
    } else {
      return json({
        success: false,
        error:
          "Property not found — import it on the agent (CSV) or provide property_id, listing_ref, or address with owner_phone",
      }, 400);
    }
  }

  if (!ownerPhone) {
    return json({ success: false, error: "property has no owner_phone — cannot ask for confirmation" }, 400);
  }

  const availability = await checkAgentAvailability(supabase, profileId, startsAt, endsAt);

  const allowedSources = new Set(["phone", "whatsapp", "sms", "email", "manual", "web"]);
  const { data: viewing, error: viewErr } = await supabase
    .from("wisecall_viewing_requests")
    .insert({
      profile_id: profileId,
      property_id: propertyId,
      property_address: address,
      listing_ref: listingRef,
      owner_name: ownerName,
      owner_phone: ownerPhone,
      owner_email: ownerEmail,
      viewer_name: viewerName,
      viewer_phone: viewerPhone || null,
      viewer_email: viewerEmail,
      proposed_starts_at: startsAt.toISOString(),
      proposed_ends_at: endsAt.toISOString(),
      agent_availability_checked: availability.checked,
      agent_available: availability.available,
      agent_availability_note: availability.note,
      status: "requested",
      source: allowedSources.has(source) ? source : "phone",
      call_id: callId,
      notes,
    })
    .select("*")
    .single();

  if (viewErr || !viewing) {
    return json({ success: false, error: viewErr?.message || "failed to create viewing request" }, 500);
  }

  const profileMetadata = (profile.metadata as Record<string, unknown>) ?? {};
  const agentEmail = await sendAgentViewingEmail({
    businessName,
    metadata: profileMetadata,
    viewing,
    availability,
  });
  if (agentEmail.ok) {
    const emailedAt = new Date().toISOString();
    await supabase
      .from("wisecall_viewing_requests")
      .update({
        confirmation_sent_to_agent_at: emailedAt,
        updated_at: emailedAt,
      })
      .eq("id", viewing.id);
    await supabase.from("wisecall_viewing_messages").insert({
      viewing_request_id: viewing.id,
      profile_id: profileId,
      direction: "outbound",
      channel: "email",
      party: "agent",
      body: `New viewing request for ${address} at ${startsAt.toISOString()}`,
      purpose: "confirm_agent",
    });
  }

  if (body.skip_owner_notify) {
    return json({
      success: true,
      viewing_request_id: viewing.id,
      status: viewing.status,
      agent_availability: availability,
      agent_email: agentEmail.ok ? "sent" : agentEmail.skipped || agentEmail.error || "failed",
      note: "Created without notifying the owner.",
    });
  }

  const ask = ownerAskMessage({
    businessName,
    viewerName,
    address,
    startsAt: startsAt.toISOString(),
  });

  if (profile.sms_enabled === false) {
    return json({
      success: false,
      error: "SMS is disabled for this agent — cannot text the owner for confirmation",
      viewing_request_id: viewing.id,
      agent_availability: availability,
      agent_email: agentEmail.ok ? "sent" : agentEmail.skipped || agentEmail.error || "failed",
    }, 403);
  }

  const sms = await sendSmsViaHelper({
    phone: ownerPhone,
    message: ask,
    profileId: profile.id,
    profileSlug: profile.slug || null,
    callId,
    linkType: `viewing-ask-${viewing.id.slice(0, 8)}`,
  });

  if (!sms.ok) {
    return json({
      success: false,
      error: sms.error || "failed to notify owner",
      viewing_request_id: viewing.id,
      agent_availability: availability,
      agent_email: agentEmail.ok ? "sent" : agentEmail.skipped || agentEmail.error || "failed",
    }, 502);
  }

  const now = new Date().toISOString();
  await supabase
    .from("wisecall_viewing_requests")
    .update({
      status: "pending_owner",
      owner_channel: "sms",
      owner_asked_at: now,
      updated_at: now,
    })
    .eq("id", viewing.id);

  await supabase.from("wisecall_viewing_messages").insert({
    viewing_request_id: viewing.id,
    profile_id: profileId,
    direction: "outbound",
    channel: "sms",
    party: "owner",
    to_address: ownerPhone,
    body: ask,
    purpose: "owner_ask",
  });

  return json({
    success: true,
    viewing_request_id: viewing.id,
    status: "pending_owner",
    owner_channel: "sms",
    agent_availability: availability,
    agent_email: agentEmail.ok ? "sent" : agentEmail.skipped || agentEmail.error || "failed",
    note:
      "Owner asked to confirm by SMS. Tell the caller you'll confirm once the owner replies YES.",
  });
});
