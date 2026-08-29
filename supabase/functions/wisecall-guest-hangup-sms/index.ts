// Guest Facebook hangup → existing Ava signup SMS (login_v2).
// Same Vonage path, message, portal URL, and 24h suppression as wisecall-demo-sms.
// Does not change that function or the 2277 inbound hook.
//
// Auth: portal after-call webhook already has WISECALL_TRIAL_REMINDER_SECRET /
// WISECALL_WEBHOOK_SECRET. Demo-sms's own secret is also accepted.

import {
  findRecentSms,
  getSupabaseServiceClient,
  logSmsAttempt,
  normalizeUkMobileDigits,
  suppressionHours,
} from "../_shared/wisecall-sms-utils.ts";

const CONNECTED_OUTCOMES = new Set([
  "caller_stop",
  "remote_hangup",
  "agent_hangup",
  "completed",
  "hangup",
]);

const NEVER_CONNECTED_OUTCOMES = new Set([
  "no-answer",
  "no_answer",
  "busy",
  "failed",
  "canceled",
  "cancelled",
  "unanswered",
  "sms_sent",
  "sms_failed",
]);

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wisecall-demo-secret, x-wisecall-secret",
};

type AfterCallWebhook = {
  event?: string;
  profile?: {
    id?: string;
    slug?: string;
    profile_name?: string;
    business_name?: string;
  };
  session?: {
    call_id?: string;
    caller_id?: string;
  };
  extra?: {
    reason?: string;
    summary?: string;
  };
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function presentedSecrets(req: Request): string[] {
  const authHeader = (req.headers.get("authorization") || "").trim();
  const bearerKey = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  return [
    req.headers.get("x-wisecall-demo-secret"),
    req.headers.get("x-wisecall-secret"),
    req.headers.get("apikey"),
    bearerKey,
  ]
    .map((value) => (value || "").trim())
    .filter(Boolean);
}

function hasSharedSecret(req: Request): boolean {
  const accepted = [
    Deno.env.get("WISECALL_DEMO_SMS_SECRET"),
    Deno.env.get("WISECALL_WEBHOOK_SECRET"),
    Deno.env.get("WISECALL_TRIAL_REMINDER_SECRET"),
    Deno.env.get("WISECALL_POOL_REPLENISH_SECRET"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  ]
    .map((value) => (value || "").trim())
    .filter(Boolean);
  if (!accepted.length) return false;
  return presentedSecrets(req).some((value) => accepted.includes(value));
}

function isGuestMetadata(metadata: unknown): boolean {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  return record.source === "guest_setup_test" || record.guest_test === true;
}

function callConnected(outcome: string | null | undefined, transcript: string | null | undefined, summary: string | null | undefined) {
  const reason = String(outcome || "").trim().toLowerCase();
  if (NEVER_CONNECTED_OUTCOMES.has(reason)) return false;
  if (String(transcript || "").trim().length >= 20) return true;
  return CONNECTED_OUTCOMES.has(reason) && String(summary || "").trim().length > 0;
}

async function isRecordedGuestHangup(body: AfterCallWebhook): Promise<boolean> {
  const callId = String(body.session?.call_id || "").trim();
  if (!callId) return false;
  const supabase = getSupabaseServiceClient();
  if (!supabase) return false;

  const { data: byId } = await supabase
    .from("wisecall_call_logs")
    .select("id, profile_id, caller_id, outcome, summary, transcript")
    .eq("id", callId)
    .maybeSingle();
  const { data: byCallId } = byId
    ? { data: null }
    : await supabase
        .from("wisecall_call_logs")
        .select("id, profile_id, caller_id, outcome, summary, transcript")
        .eq("call_id", callId)
        .maybeSingle();
  const log = byId || byCallId;
  if (!log?.profile_id) return false;
  if (!normalizeUkMobileDigits(String(log.caller_id || ""))) return false;
  if (!callConnected(log.outcome, log.transcript, log.summary)) return false;

  const { data: profile } = await supabase
    .from("wisecall_profiles")
    .select("metadata")
    .eq("id", log.profile_id)
    .maybeSingle();
  return isGuestMetadata(profile?.metadata);
}

function cleanSummary(raw: string) {
  return raw
    .trim()
    .replace(/\bMia captured\b/gi, "The WiseCall assistant captured")
    .replace(/\bMia\b/g, "the WiseCall assistant");
}

function profileSlugOrDefault(value: unknown) {
  return String(value || "").trim() || "default";
}

const DEFAULT_PORTAL_URL = "https://app.wisecall.io/?login=1&redirect=%2Fbilling";

function resolvePortalUrl() {
  const configured =
    Deno.env.get("WISECALL_DEMO_PORTAL_URL")?.trim() ||
    Deno.env.get("WISECALL_DEMO_BOOKING_URL")?.trim() ||
    "";

  if (!configured) {
    return DEFAULT_PORTAL_URL;
  }

  try {
    const url = new URL(configured);

    if (url.hostname === "app.wisecall.io" || url.hostname.endsWith(".wisecall.io")) {
      url.searchParams.set("login", "1");
      url.searchParams.delete("signup");
      if (!url.searchParams.get("redirect")) {
        url.searchParams.set("redirect", "/billing");
      }
      return url.toString();
    }

    return configured;
  } catch {
    return DEFAULT_PORTAL_URL;
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  let body: AfterCallWebhook;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const allowed = hasSharedSecret(req) || (await isRecordedGuestHangup(body));
  if (!allowed) {
    return json({ error: "Unauthorized", gate: "guest-hangup" }, 401);
  }

  if (body.event && body.event !== "after_call") {
    return json({ success: true, skipped: `event ${body.event} ignored` });
  }

  const callerId = String(body.session?.caller_id || "");
  const phone = normalizeUkMobileDigits(callerId);
  const profileSlug = profileSlugOrDefault(body.profile?.slug);

  if (!phone) {
    return json({ success: true, skipped: "caller is not a UK mobile" });
  }

  const summary = cleanSummary(String(body.extra?.summary || ""));
  const portalUrl = resolvePortalUrl();
  const message = [
    "Thanks for trying WiseCall.",
    summary ? `Demo summary: ${summary}` : "",
    `Set it up for your own business? Log in here: ${portalUrl}`,
    "Every caller can receive a follow-up like this automatically.",
  ]
    .filter(Boolean)
    .join(" ")
    .slice(0, 612);

  const supabase = getSupabaseServiceClient();
  const recentSms = await findRecentSms(supabase, phone, {
    ignoreProfileSlug: true,
    linkType: "guest_demo_follow_up",
  });

  if (recentSms) {
    return json({
      success: true,
      suppressed: true,
      status: "suppressed_recent",
      provider: "vonage",
      message_id: recentSms.metadata?.provider_message_id || null,
      last_sent_at: recentSms.created_at,
      suppression_hours: suppressionHours(),
    });
  }

  const apiKey = Deno.env.get("VONAGE_API_KEY");
  const apiSecret = Deno.env.get("VONAGE_API_SECRET");
  const from = Deno.env.get("WISECALL_SMS_FROM") || Deno.env.get("VONAGE_FROM_NUMBER") || "WiseCall";

  if (!apiKey || !apiSecret) {
    return json({ error: "Vonage credentials not configured" }, 500);
  }

  const response = await fetch("https://rest.nexmo.com/sms/json", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: phone,
      text: message,
      api_key: apiKey,
      api_secret: apiSecret,
    }),
  });

  const result = await response.json();
  const providerMessage = result.messages?.[0];

  if (providerMessage?.status === "0") {
    await logSmsAttempt(supabase, {
      phone,
      profile_id: body.profile?.id || null,
      profile_slug: profileSlug,
      link_type: "guest_demo_follow_up",
      call_id: body.session?.call_id || null,
      provider: "vonage",
      provider_message_id: providerMessage["message-id"] || null,
      status: "sent",
      message,
      portal_url: portalUrl,
      template_version: "login_v2",
    });

    return json({
      success: true,
      provider: "vonage",
      message_id: providerMessage["message-id"] || null,
    });
  }

  const errorText = providerMessage?.["error-text"] || "Unknown Vonage error";
  await logSmsAttempt(supabase, {
    phone,
    profile_id: body.profile?.id || null,
    profile_slug: profileSlug,
    link_type: "guest_demo_follow_up",
    call_id: body.session?.call_id || null,
    provider: "vonage",
    provider_message_id: providerMessage?.["message-id"] || null,
    status: "failed",
    message,
    portal_url: portalUrl,
  });

  return json({ success: false, error: errorText }, 502);
});
