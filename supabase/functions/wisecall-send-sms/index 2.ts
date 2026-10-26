import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { agentSmsSend, verifiedServiceSmsAuth, type AgentSms } from "../_shared/agent-sms-send.ts";
import { sendVonageSms, smsPhoneDigits } from "../_shared/vonage-messages.ts";
import { smsStatusToken } from "../_shared/sms-status-token.ts";

// Delivery receipts for agent (Salesforce) sends go to wisecall-sms-status.
async function smsStatusUrl(): Promise<string | undefined> {
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/+$/, "");
  const token = await smsStatusToken();
  if (!base || !token) return undefined;
  return `${base}/functions/v1/wisecall-sms-status?token=${token}`;
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-wisecall-sms-secret",
};

type SmsRequest = {
  from?: string;
  request_id?: string;
  phone?: string;
  message?: string;
  link_type?: string;
  call_id?: string;
  profile_id?: string;
  profile_slug?: string;
};

function jsonResponse(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}

function cleanPhone(phone: string) {
  return phone.trim().replace(/[^\d+]/g, "").replace(/^\+/, "");
}

function fallbackMessage(linkType: string) {
  if (linkType === "repair") {
    return "The Home Cloud: please report repairs, leaks or maintenance here: https://thehomecloud.fixflo.com/issuereport/CreateIssue";
  }

  if (linkType === "management") {
    return "The Home Cloud: please visit thehomecloud.co.uk and click Management Request in the top menu.";
  }

  return "";
}

function profileSlugOrDefault(value: unknown) {
  return String(value || "").trim() || "default";
}

function suppressionMinutes() {
  const value = Number(Deno.env.get("WISECALL_SMS_CROSS_CALL_SUPPRESSION_MINUTES") || 5);
  return Number.isFinite(value) && value >= 0 ? value : 5;
}

function getSupabaseClient() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

  if (!supabaseUrl || !serviceRoleKey) {
    return null;
  }

  return createClient(supabaseUrl, serviceRoleKey);
}

async function findRecentSms(
  supabase: ReturnType<typeof createClient> | null,
  phone: string,
  profileSlug: string,
  linkType: string,
  callId: string | null | undefined,
) {
  if (!supabase) {
    return null;
  }

  const crossCallMinutes = suppressionMinutes();
  const since = new Date(Date.now() - crossCallMinutes * 60 * 1000).toISOString();
  const metadataFilter: Record<string, string> = {
    record_type: "sms",
    profile_slug: profileSlug,
  };
  if (linkType) {
    metadataFilter.link_type = linkType;
  }

  const { data, error } = await supabase
    .from("wisecall_call_logs")
    .select("id,created_at,metadata")
    .eq("caller_id", phone)
    .eq("outcome", "sms_sent")
    .contains("metadata", metadataFilter)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    console.error("WiseCall SMS dedupe lookup failed", {
      error: error.message,
      profile_slug: profileSlug,
    });
    return null;
  }

  if (!data) {
    return null;
  }

  const originalCallId = (data.metadata as Record<string, unknown> | null)?.original_call_id;
  if (callId && originalCallId && String(callId) === String(originalCallId)) {
    return data;
  }

  if (crossCallMinutes <= 0) {
    return null;
  }

  return data;
}

async function logSmsAttempt(
  supabase: ReturnType<typeof createClient> | null,
  payload: {
    phone: string;
    profile_id?: string | null;
    profile_slug: string;
    link_type: string;
    call_id?: string | null;
    provider?: string | null;
    provider_message_id?: string | null;
    status: "sent" | "failed";
    message: string;
  },
) {
  if (!supabase) {
    return;
  }

  const { error } = await supabase.from("wisecall_call_logs").insert({
    call_id: `sms_${crypto.randomUUID()}`,
    profile_id: payload.profile_id || null,
    profile_name: payload.profile_slug,
    caller_id: payload.phone,
    summary:
      payload.status === "sent"
        ? `WiseCall SMS sent for ${payload.link_type || "general"}`
        : `WiseCall SMS failed for ${payload.link_type || "general"}`,
    outcome: payload.status === "sent" ? "sms_sent" : "sms_failed",
    transcript: "",
    metadata: {
      record_type: "sms",
      original_call_id: payload.call_id || null,
      profile_slug: payload.profile_slug,
      link_type: payload.link_type || "general",
      provider: payload.provider || null,
      provider_message_id: payload.provider_message_id || null,
      message_preview: payload.message.slice(0, 160),
    },
  });

  if (error) {
    console.error("WiseCall SMS log insert failed", {
      error: error.message,
      profile_slug: payload.profile_slug,
      link_type: payload.link_type,
    });
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  const expectedSecret = Deno.env.get("WISECALL_SMS_WEBHOOK_SECRET");
  const suppliedSecret = req.headers.get("X-WiseCall-SMS-Secret") || "";

  const serviceAuth = await verifiedServiceSmsAuth(req.headers.get("Authorization"), Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"), async token => {
    // Hosted runtime keys and legacy project JWTs can differ. GoTrue must verify
    // this JWT's signature and admin permission. Do not read or log the user body.
    const response = await fetch(`${Deno.env.get("SUPABASE_URL")}/auth/v1/admin/users?page=1&per_page=1`, {
      headers: { Authorization: `Bearer ${token}`, apikey: token },
      redirect: "error", signal: AbortSignal.timeout(10_000),
    });
    const allowed = response.status === 200;
    await response.body?.cancel();
    return allowed;
  });
  if (!serviceAuth && (!expectedSecret || suppliedSecret !== expectedSecret)) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  let body: SmsRequest;

  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }


  // Explicit numeric sender is restricted to the existing service-role caller.
  // Service-role requests can NEVER fall back to the legacy global sender.
  if (serviceAuth || body?.from !== undefined) {
    if (!serviceAuth) return jsonResponse({ error: "Service authentication required for agent sender" }, 403);
    const supabase = getSupabaseClient();
    const key = Deno.env.get("VONAGE_API_KEY");
    const secret = Deno.env.get("VONAGE_API_SECRET");
    if (!supabase || !key || !secret) return jsonResponse({ error: "SMS service unavailable" }, 503);
    const metadata = (input: AgentSms, providerId?: string | null) => ({
      record_type: "agent_sms", channel: "sms", provider: "vonage",
      request: input, provider_message_id: providerId ?? null,
    });
    try {
      const result = await agentSmsSend(body, {
        normalise: smsPhoneDigits,
        activeNumbers: async (profile) => {
          const { data, error } = await supabase.from("wisecall_sms_numbers").select("sms_number")
            .eq("profile_id", profile).eq("status", "active");
          if (error) throw new Error("Number lookup failed");
          return (data ?? []).map(row => row.sms_number);
        },
        claim: async (input) => {
          // Existing UUID primary key supplies an atomic, durable send reservation.
          const { error } = await supabase.from("wisecall_call_logs").insert({
            id: input.request_id, call_id: `agent_sms_${input.request_id}`, profile_id: input.profile_id,
            caller_id: input.phone, summary: "Agent SMS send pending", outcome: "sms_pending",
            transcript: "", metadata: metadata(input),
          });
          if (!error) return null;
          if (error.code !== "23505") throw new Error("SMS reservation failed");
          const previous = await supabase.from("wisecall_call_logs").select("outcome,metadata")
            .eq("id", input.request_id).maybeSingle();
          if (previous.error || !previous.data) throw new Error("SMS reservation unavailable");
          return previous.data;
        },
        finish: async (input, outcome, providerId) => {
          const { error } = await supabase.from("wisecall_call_logs").update({
            outcome, summary: outcome === "sms_sent" ? "Agent SMS sent" : "Agent SMS outcome unknown",
            metadata: metadata(input, providerId),
          }).eq("id", input.request_id);
          if (error) throw new Error("SMS result persistence failed");
        },
        send: async input => sendVonageSms(input, { key, secret }, fetch, {
          statusUrl: await smsStatusUrl(),
          clientRef: typeof body?.request_id === "string" ? body.request_id : undefined,
        }),
        usage: async profile => {
          const { error } = await supabase.rpc("wisecall_record_sms_message", { p_profile_id: profile });
          if (error) console.error("Agent SMS usage update failed; reconcile sent log");
        },
      });
      return jsonResponse(result.body, result.status);
    } catch {
      // An uncertain result must not cause a blind resend with a new request_id.
      console.error("Agent SMS request failed; inspect its reservation before retrying");
      return jsonResponse({ error: "SMS outcome unavailable; inspect request_id before retrying" }, 503);
    }
  }

  const phone = cleanPhone(body.phone || "");
  const linkType = String(body.link_type || "").toLowerCase();
  const profileSlug = profileSlugOrDefault(body.profile_slug);
  const message = String(body.message || fallbackMessage(linkType)).slice(0, 612);

  if (!phone) {
    return jsonResponse({ error: "phone is required" }, 400);
  }

  if (!message) {
    return jsonResponse({ error: "message is required" }, 400);
  }

  const supabase = getSupabaseClient();
  const recentSms = await findRecentSms(supabase, phone, profileSlug, linkType, body.call_id);

  if (recentSms) {
    console.log("WiseCall SMS suppressed because one was sent recently", {
      phone,
      profile_slug: profileSlug,
      link_type: linkType,
      last_sent_at: recentSms.created_at,
    });

    return jsonResponse({
      success: true,
      suppressed: true,
      status: "suppressed_recent",
      provider: "vonage",
      message_id: recentSms.metadata?.provider_message_id || null,
      last_sent_at: recentSms.created_at,
      suppression_minutes: suppressionMinutes(),
    });
  }

  const apiKey = Deno.env.get("VONAGE_API_KEY");
  const apiSecret = Deno.env.get("VONAGE_API_SECRET");
  const from = Deno.env.get("WISECALL_SMS_FROM") || Deno.env.get("VONAGE_FROM_NUMBER") || "WiseCall";

  if (!apiKey || !apiSecret) {
    return jsonResponse({ error: "Vonage credentials not configured" }, 500);
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
      profile_id: body.profile_id || null,
      profile_slug: profileSlug,
      link_type: linkType || "general",
      call_id: body.call_id || null,
      provider: "vonage",
      provider_message_id: providerMessage["message-id"] || null,
      status: "sent",
      message,
    });

    console.log("WiseCall SMS sent", {
      message_id: providerMessage["message-id"],
      link_type: linkType,
      call_id: body.call_id || null,
      profile_slug: profileSlug,
    });

    return jsonResponse({
      success: true,
      provider: "vonage",
      message_id: providerMessage["message-id"] || null,
    });
  }

  const errorText = providerMessage?.["error-text"] || "Unknown Vonage error";
  await logSmsAttempt(supabase, {
    phone,
    profile_id: body.profile_id || null,
    profile_slug: profileSlug,
    link_type: linkType || "general",
    call_id: body.call_id || null,
    provider: "vonage",
    provider_message_id: providerMessage?.["message-id"] || null,
    status: "failed",
    message,
  });

  console.error("WiseCall SMS failed", {
    error: errorText,
    link_type: linkType,
    call_id: body.call_id || null,
    profile_slug: profileSlug,
  });

  return jsonResponse({ success: false, error: errorText }, 502);
});
