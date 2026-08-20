import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildMorSipDialTexml,
  buildSipUri,
  buildStreamTexml,
  buildUnavailableTexml,
  buildWebhookUrl,
  getStreamCodec,
  probeEdgeHealth,
} from "../_shared/texml.ts";

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

type SipEndpoint = {
  username: string;
  password: string;
  domain: string;
  proxy: string;
};

async function loadSipEndpoint(profileSlug: string): Promise<SipEndpoint | null> {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!url || !key) return null;

  const supabase = createClient(url, key);
  const { data: profile } = await supabase
    .from("wisecall_profiles")
    .select("id")
    .eq("slug", profileSlug)
    .maybeSingle();
  if (!profile?.id) return null;

  const { data } = await supabase
    .from("wisecall_sip_endpoints")
    .select("sip_username, sip_password, sip_domain, sip_proxy, is_enabled")
    .eq("profile_id", profile.id)
    .maybeSingle();

  if (!data?.is_enabled || !data.sip_username || !data.sip_password) return null;
  const domain = String(data.sip_domain || "").trim();
  if (!domain) return null;

  return {
    username: String(data.sip_username),
    password: String(data.sip_password),
    domain,
    proxy: String(data.sip_proxy || "").trim(),
  };
}

async function buildCallbackTexml(input: {
  edgeBaseUrl: string;
  profileSlug: string;
  phone: string;
  from: string;
}) {
  const streamCodec = getStreamCodec();
  if (input.edgeBaseUrl) {
    const health = await probeEdgeHealth(input.edgeBaseUrl);
    if (health.ok) {
      console.log("WiseCall demo callback routing via edge", {
        profile_slug: input.profileSlug,
        latency_ms: health.latency_ms,
      });
      return {
        texml: buildStreamTexml(
          input.edgeBaseUrl,
          input.profileSlug,
          input.phone,
          input.from,
          streamCodec,
        ),
        statusCallbackUrl: buildWebhookUrl(input.edgeBaseUrl, input.profileSlug),
        route: "edge" as const,
      };
    }
    console.warn("WiseCall demo callback edge unhealthy", health);
  }

  const sip = await loadSipEndpoint(input.profileSlug);
  if (sip) {
    console.log("WiseCall demo callback routing via MOR SIP", {
      profile_slug: input.profileSlug,
      sip_domain: sip.domain,
    });
    return {
      texml: buildMorSipDialTexml({
        sipUri: buildSipUri(sip),
        username: sip.username,
        password: sip.password,
        callerId: input.from,
      }),
      statusCallbackUrl: "",
      route: "mor_sip" as const,
    };
  }

  console.error("WiseCall demo callback has no healthy edge or SIP fallback", {
    profile_slug: input.profileSlug,
  });
  return {
    texml: buildUnavailableTexml(
      "Sorry, the WiseCall demo is temporarily unavailable. Please try again shortly.",
    ),
    statusCallbackUrl: "",
    route: "unavailable" as const,
  };
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
    edgeBaseUrl = Deno.env.get("WISECALL_EDGE_BASE_URL")?.trim() || "";
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

  const routed = await buildCallbackTexml({
    edgeBaseUrl,
    profileSlug,
    phone,
    from,
  });

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
        Texml: routed.texml,
        ...(routed.statusCallbackUrl
          ? {
              StatusCallback: routed.statusCallbackUrl,
              StatusCallbackMethod: "POST",
            }
          : {}),
      }),
    },
  );

  const result = await telnyxResponse.json().catch(() => ({}));

  if (!telnyxResponse.ok) {
    console.error("WiseCall demo callback failed", {
      status: telnyxResponse.status,
      profile_slug: profileSlug,
      route: routed.route,
      result,
    });
    return jsonResponse(
      { ok: false, error: "Could not start the demo callback." },
      502,
    );
  }

  console.log("WiseCall demo callback started", {
    profile_slug: profileSlug,
    route: routed.route,
    call_sid: result?.sid || result?.data?.sid || null,
  });

  return jsonResponse({
    ok: true,
    message: `${agentName} is calling now.`,
  });
});
