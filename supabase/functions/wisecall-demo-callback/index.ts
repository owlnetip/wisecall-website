// Website "Call me" ring-back.
//
// Ava / homepage demo: profile_slug wisecall, stream called_number = demo caller ID.
// Guest website-setup: MUST use the drafted agent's slug + its routing number.
// Never fall back to Ava for source=guest_setup_test. The live media edge routes
// by called_number, so passing the demo DDI here is what made guests hear Ava.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const AVA_SLUG = "wisecall";
const GUEST_SOURCE = "guest_setup_test";
const LIVE_EDGE_BASE_URL = "https://18.132.149.25.sslip.io";
const DEAD_EDGE_HOSTS = ["18.171.233.209", "13.40.127.21"];

type CallbackRequest = {
  phone?: string;
  profile_slug?: string;
  called_number?: string;
  agent_name?: string;
  source?: string;
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

function normalizeUkMobile(rawValue: string) {
  let digits = rawValue
    .trim()
    .replace(/[^\d+]/g, "")
    .replace(/^\+/, "")
    .replace(/^00/, "");

  if (digits.startsWith("07")) {
    digits = `44${digits.slice(1)}`;
  }

  return /^447\d{9}$/.test(digits) ? `+${digits}` : "";
}

function phoneDigits(value: string) {
  return String(value || "").replace(/\D/g, "");
}

function isAvaSlug(slug: string) {
  return slug.trim().toLowerCase() === AVA_SLUG;
}

function isAvaNumber(value: string) {
  const digits = phoneDigits(value);
  if (digits === "441135222277" || digits === "01135222277" || digits === "441135221606") {
    return true;
  }
  return digits.endsWith("1135222277") && digits.length >= 10 && digits.length <= 13;
}

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
  }
  return value;
}

function resolveEdgeBaseUrl(configured: string) {
  const value = configured.replace(/\/+$/, "");
  if (!value || DEAD_EDGE_HOSTS.some((host) => value.includes(host))) {
    return LIVE_EDGE_BASE_URL;
  }
  return value;
}

function buildWebhookUrl(edgeBaseUrl: string, profileSlug: string) {
  const url = new URL("/telnyx/texml-status", edgeBaseUrl.replace(/\/+$/, ""));
  url.searchParams.set("profile_slug", profileSlug);
  return url.toString();
}

function escapeXmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildStreamTexml(
  edgeBaseUrl: string,
  profileSlug: string,
  callerId: string,
  calledNumber: string,
  streamCodec: string,
) {
  const streamUrl = new URL("/media", edgeBaseUrl.replace(/\/+$/, ""));
  streamUrl.protocol = streamUrl.protocol === "https:" ? "wss:" : "ws:";
  streamUrl.searchParams.set("provider", "telnyx");
  streamUrl.searchParams.set("media_source", "texml");
  streamUrl.searchParams.set("profile_slug", profileSlug);
  streamUrl.searchParams.set("caller_id", callerId);
  streamUrl.searchParams.set("called_number", calledNumber);

  const statusCallbackUrl = buildWebhookUrl(edgeBaseUrl, profileSlug);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream
      url="${escapeXmlAttribute(streamUrl.toString())}"
      track="both_tracks"
      codec="${escapeXmlAttribute(streamCodec)}"
      bidirectionalMode="rtp"
      bidirectionalCodec="${escapeXmlAttribute(streamCodec)}"
      bidirectionalSamplingRate="8000"
      statusCallback="${escapeXmlAttribute(statusCallbackUrl)}"
      statusCallbackMethod="POST"
    />
  </Connect>
</Response>`;
}

function getStreamCodec() {
  const value = (Deno.env.get("WISECALL_DEMO_STREAM_CODEC") || "PCMA")
    .trim()
    .toUpperCase();
  return value === "PCMA" ? "PCMA" : "PCMU";
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

async function loadGuestProfile(slug: string) {
  const supabase = serviceClient();
  if (!supabase) return null;
  const { data } = await supabase
    .from("wisecall_profiles")
    .select("slug, telnyx_number, system_prompt, metadata, is_active")
    .eq("slug", slug)
    .maybeSingle();
  return data;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ ok: false, error: "Method not allowed" }, 405);
  }

  let body: CallbackRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ ok: false, error: "Invalid JSON body" }, 400);
  }

  const phone = normalizeUkMobile(String(body.phone || ""));
  if (!phone) {
    return jsonResponse({ ok: false, error: "Enter a valid UK mobile number." }, 400);
  }

  let telnyxApiKey = "";
  let accountSid = "";
  let applicationSid = "";
  let from = "";
  let edgeBaseUrl = "";

  try {
    telnyxApiKey = requiredEnv("TELNYX_API_KEY");
    accountSid =
      Deno.env.get("WISECALL_TEXML_ACCOUNT_SID")?.trim() ||
      requiredEnv("TELNYX_ACCOUNT_SID");
    applicationSid =
      Deno.env.get("WISECALL_TEXML_APPLICATION_SID")?.trim() ||
      "2941088157250094723";
    from =
      Deno.env.get("WISECALL_DEMO_CALLER_ID")?.trim() ||
      "+441135221606";
    edgeBaseUrl = resolveEdgeBaseUrl(Deno.env.get("WISECALL_EDGE_BASE_URL")?.trim() || "");
  } catch (error) {
    console.error("WiseCall demo callback config missing", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      { ok: false, error: "Demo callback is not configured yet." },
      500,
    );
  }

  const source = String(body.source || "").trim();
  const requestedSlug = String(body.profile_slug || "").trim();
  const requestedCalled = String(body.called_number || "").trim();
  const streamCodec = getStreamCodec();

  let profileSlug = requestedSlug;
  let calledNumber = requestedCalled;
  let agentName = String(body.agent_name || "").trim();

  if (source === GUEST_SOURCE) {
    if (!requestedSlug || isAvaSlug(requestedSlug) || !requestedSlug.startsWith("guest-")) {
      return jsonResponse(
        {
          ok: false,
          error: "Could not start the test call on the receptionist we just drafted. Try again.",
        },
        400,
      );
    }

    const profile = await loadGuestProfile(requestedSlug);
    const liveSlug = String(profile?.slug || "");
    const liveNumber = String(profile?.telnyx_number || requestedCalled);
    if (
      !profile ||
      isAvaSlug(liveSlug) ||
      !liveSlug.startsWith("guest-") ||
      isAvaNumber(liveNumber) ||
      !liveNumber ||
      !String(profile.system_prompt || "").trim()
    ) {
      console.error("WiseCall guest callback refused Ava fallback", {
        requested_slug: requestedSlug,
        live_slug: liveSlug,
        live_number: liveNumber,
      });
      return jsonResponse(
        {
          ok: false,
          error: "Could not start the test call on the receptionist we just drafted. Try again.",
        },
        404,
      );
    }

    profileSlug = liveSlug;
    calledNumber = liveNumber;
    if (!agentName) agentName = "Your receptionist";
  } else {
    profileSlug = requestedSlug || Deno.env.get("WISECALL_DEMO_PROFILE_SLUG")?.trim() || AVA_SLUG;
    calledNumber = from;
    if (!agentName) agentName = "WiseCall Website Assistant";
  }

  const texml = buildStreamTexml(edgeBaseUrl, profileSlug, phone, calledNumber, streamCodec);
  const statusCallbackUrl = buildWebhookUrl(edgeBaseUrl, profileSlug);

  const telnyxResponse = await fetch(
    `https://api.telnyx.com/v2/texml/Accounts/${accountSid}/Calls`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${telnyxApiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        ApplicationSid: applicationSid,
        To: phone,
        From: from,
        Texml: texml,
        StatusCallback: statusCallbackUrl,
        StatusCallbackMethod: "POST",
      }),
    },
  );

  const result = await telnyxResponse.json().catch(() => ({}));

  if (!telnyxResponse.ok) {
    console.error("WiseCall demo callback failed", {
      status: telnyxResponse.status,
      profile_slug: profileSlug,
      source,
      result,
    });
    return jsonResponse(
      { ok: false, error: "Could not start the demo callback." },
      502,
    );
  }

  console.log("WiseCall demo callback started", {
    profile_slug: profileSlug,
    called_number: calledNumber,
    source,
    stream_codec: streamCodec,
    edge_base_url: edgeBaseUrl,
    call_sid: result?.sid || result?.data?.sid || null,
  });

  return jsonResponse({
    ok: true,
    message: `${agentName} is calling now.`,
  });
});
