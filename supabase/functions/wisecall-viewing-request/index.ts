// wisecall-viewing-request — create a property viewing request, check agent
// availability when a calendar connector exists, then ask the owner via
// WhatsApp (prefer) or SMS whether the proposed slot is ok.
//
// Called as a during_call integration webhook or from the portal (service role
// / shared SMS secret). Mirrors the safety model of wisecall-listing-sms.
//
// Auth: X-WiseCall-SMS-Secret == WISECALL_SMS_WEBHOOK_SECRET
//   OR Authorization: Bearer <service role key>
//
// Body:
//   profile_id | profileId (required)
//   property_id | propertyId  OR  address + owner_phone
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

async function sendWhatsapp(opts: {
  from: string;
  to: string;
  body: string;
}): Promise<{ ok: boolean; error?: string }> {
  const accountSid = Deno.env.get("TWILIO_ACCOUNT_SID");
  const authToken = Deno.env.get("TWILIO_AUTH_TOKEN");
  if (!accountSid || !authToken) return { ok: false, error: "Twilio not configured" };

  const to = opts.to.startsWith("whatsapp:") ? opts.to : `whatsapp:${opts.to}`;
  const from = opts.from.startsWith("whatsapp:") ? opts.from : `whatsapp:${opts.from}`;
  const res = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        Authorization: `Basic ${btoa(`${accountSid}:${authToken}`)}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ From: from, To: to, Body: opts.body }),
    },
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `Twilio ${res.status}: ${text.slice(0, 200)}` };
  }
  return { ok: true };
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
    if (!address) return json({ success: false, error: "address or property_id required" }, 400);
    if (!ownerPhone) {
      return json({ success: false, error: "owner_phone required when property_id is omitted" }, 400);
    }
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
        owner_preferred_channel: ["auto", "whatsapp", "sms", "email"].includes(preferredChannel)
          ? preferredChannel
          : "auto",
      })
      .select("id")
      .single();
    if (propErr || !created) {
      return json({ success: false, error: propErr?.message || "failed to create property" }, 500);
    }
    propertyId = created.id;
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

  if (body.skip_owner_notify) {
    return json({
      success: true,
      viewing_request_id: viewing.id,
      status: viewing.status,
      agent_availability: availability,
      note: "Created without notifying the owner.",
    });
  }

  // Choose channel: WhatsApp if preferred/auto and agent has an active WA number.
  const { data: waRow } = await supabase
    .from("wisecall_whatsapp_numbers")
    .select("whatsapp_number, status")
    .eq("profile_id", profileId)
    .eq("status", "active")
    .maybeSingle();

  let channel: "whatsapp" | "sms" = "sms";
  if (
    (preferredChannel === "whatsapp" || preferredChannel === "auto") &&
    waRow?.whatsapp_number
  ) {
    channel = "whatsapp";
  }
  if (preferredChannel === "sms") channel = "sms";

  const ask = ownerAskMessage({
    businessName,
    viewerName,
    address,
    startsAt: startsAt.toISOString(),
  });

  let notifyOk = false;
  let notifyError: string | undefined;

  if (channel === "whatsapp" && waRow?.whatsapp_number) {
    const wa = await sendWhatsapp({
      from: waRow.whatsapp_number,
      to: ownerPhone,
      body: ask,
    });
    notifyOk = wa.ok;
    notifyError = wa.error;
    if (!wa.ok && preferredChannel === "auto") {
      // Fall back to SMS when WhatsApp fails
      channel = "sms";
    }
  }

  if (channel === "sms") {
    if (profile.sms_enabled === false) {
      return json({
        success: false,
        error: "SMS is disabled for this agent and WhatsApp notify failed or was unavailable",
        viewing_request_id: viewing.id,
        agent_availability: availability,
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
    notifyOk = sms.ok;
    notifyError = sms.error;
  }

  if (!notifyOk) {
    return json({
      success: false,
      error: notifyError || "failed to notify owner",
      viewing_request_id: viewing.id,
      agent_availability: availability,
    }, 502);
  }

  const now = new Date().toISOString();
  await supabase
    .from("wisecall_viewing_requests")
    .update({
      status: "pending_owner",
      owner_channel: channel,
      owner_asked_at: now,
      updated_at: now,
    })
    .eq("id", viewing.id);

  await supabase.from("wisecall_viewing_messages").insert({
    viewing_request_id: viewing.id,
    profile_id: profileId,
    direction: "outbound",
    channel,
    party: "owner",
    to_address: ownerPhone,
    body: ask,
    purpose: "owner_ask",
  });

  return json({
    success: true,
    viewing_request_id: viewing.id,
    status: "pending_owner",
    owner_channel: channel,
    agent_availability: availability,
    note:
      "Owner asked to confirm. Tell the caller you'll confirm once the owner replies YES.",
  });
});
