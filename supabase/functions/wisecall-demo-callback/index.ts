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

import {
  buildStreamTexml,
  buildWebhookUrl,
  getStreamCodec,
} from "../_shared/texml.ts";

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
    edgeBaseUrl = requiredEnv("WISECALL_EDGE_BASE_URL");
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
    call_sid: result?.sid || result?.data?.sid || null,
  });

  return jsonResponse({
    ok: true,
    message: `${agentName} is calling now.`,
  });
});
