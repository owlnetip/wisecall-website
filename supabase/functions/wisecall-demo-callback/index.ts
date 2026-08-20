// Website "Call me" ring-back. This must match inbound to +441135222277:
// Telnyx answers the mobile, then Connect/Stream to WISECALL_EDGE_BASE_URL/media.
// Do not health-check that host from Supabase — TLS/404 from this network does
// not mean Telnyx cannot open the websocket (direct calls already prove it).

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type CallbackRequest = {
  phone?: string;
  profile_slug?: string;
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

function requiredEnv(name: string) {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`${name} is not configured`);
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
    const configuredEdge = Deno.env.get("WISECALL_EDGE_BASE_URL")?.trim() || "";
    edgeBaseUrl = configuredEdge.includes("18.171.233.209") ||
        configuredEdge.includes("13.40.127.21") ||
        !configuredEdge
      ? "https://18.132.149.25.sslip.io"
      : configuredEdge.replace(/\/+$/, "");
  } catch (error) {
    console.error("WiseCall demo callback config missing", {
      error: error instanceof Error ? error.message : String(error),
    });
    return jsonResponse(
      { ok: false, error: "Demo callback is not configured yet." },
      500,
    );
  }

  const profileSlug =
    String(body.profile_slug || Deno.env.get("WISECALL_DEMO_PROFILE_SLUG") || "")
      .trim() || "wisecall";
  const agentName = String(body.agent_name || "WiseCall Website Assistant").trim();
  const streamCodec = getStreamCodec();

  const texml = buildStreamTexml(edgeBaseUrl, profileSlug, phone, from, streamCodec);
  const statusCallbackUrl = buildWebhookUrl(edgeBaseUrl, profileSlug);
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim().replace(/\/+$/, "") || "";
  const inboundUrl = supabaseUrl
    ? `${supabaseUrl}/functions/v1/wisecall-telnyx-inbound?profile_slug=${encodeURIComponent(profileSlug)}`
    : "";

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
        ...(inboundUrl ? { Url: inboundUrl } : {}),
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
      result,
    });
    return jsonResponse(
      { ok: false, error: "Could not start the demo callback." },
      502,
    );
  }

  console.log("WiseCall demo callback started", {
    profile_slug: profileSlug,
    stream_codec: streamCodec,
    edge_base_url: edgeBaseUrl,
    call_sid: result?.sid || result?.data?.sid || null,
  });

  return jsonResponse({
    ok: true,
    message: `${agentName} is calling now.`,
  });
});
