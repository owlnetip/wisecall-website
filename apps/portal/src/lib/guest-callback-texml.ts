// TeXML the guest Call me path sends to Telnyx. Must NOT set called_number to
// Ava's DDI / demo caller ID — the live media edge routes by called_number.

export const LIVE_EDGE_BASE_URL = "https://18.132.149.25.sslip.io";
const DEAD_EDGE_HOSTS = ["18.171.233.209", "13.40.127.21"];

export function resolveEdgeBaseUrl(configured?: string | null): string {
  const value = String(configured || "").trim().replace(/\/+$/, "");
  if (!value || DEAD_EDGE_HOSTS.some((host) => value.includes(host))) {
    return LIVE_EDGE_BASE_URL;
  }
  return value;
}

function escapeXmlAttribute(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildGuestStreamTexml(opts: {
  edgeBaseUrl: string;
  profileSlug: string;
  callerId: string;
  calledNumber: string;
  streamCodec?: string;
}): string {
  const codec = (opts.streamCodec || "PCMA").toUpperCase() === "PCMU" ? "PCMU" : "PCMA";
  const streamUrl = new URL("/media", opts.edgeBaseUrl.replace(/\/+$/, ""));
  streamUrl.protocol = streamUrl.protocol === "https:" ? "wss:" : "ws:";
  streamUrl.searchParams.set("provider", "telnyx");
  streamUrl.searchParams.set("media_source", "texml");
  streamUrl.searchParams.set("profile_slug", opts.profileSlug);
  streamUrl.searchParams.set("caller_id", opts.callerId);
  streamUrl.searchParams.set("called_number", opts.calledNumber);

  const statusCallbackUrl = new URL("/telnyx/texml-status", opts.edgeBaseUrl.replace(/\/+$/, ""));
  statusCallbackUrl.searchParams.set("profile_slug", opts.profileSlug);

  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Connect>
    <Stream
      url="${escapeXmlAttribute(streamUrl.toString())}"
      track="both_tracks"
      codec="${codec}"
      bidirectionalMode="rtp"
      bidirectionalCodec="${codec}"
      bidirectionalSamplingRate="8000"
      statusCallback="${escapeXmlAttribute(statusCallbackUrl.toString())}"
      statusCallbackMethod="POST"
    />
  </Connect>
</Response>`;
}

export type TelnyxCallbackConfig = {
  apiKey: string;
  accountSid: string;
  applicationSid: string;
  from: string;
  edgeBaseUrl: string;
};

export function readTelnyxCallbackConfig(
  env: NodeJS.ProcessEnv = process.env,
): TelnyxCallbackConfig | null {
  const apiKey = env.TELNYX_API_KEY?.trim();
  const accountSid = (env.WISECALL_TEXML_ACCOUNT_SID || env.TELNYX_ACCOUNT_SID || "").trim();
  if (!apiKey || !accountSid) return null;
  return {
    apiKey,
    accountSid,
    applicationSid: (env.WISECALL_TEXML_APPLICATION_SID || "2941088157250094723").trim(),
    from: (env.WISECALL_DEMO_CALLER_ID || "+441135221606").trim(),
    edgeBaseUrl: resolveEdgeBaseUrl(env.WISECALL_EDGE_BASE_URL),
  };
}

export async function placeGuestCallbackViaTelnyx(opts: {
  phone: string;
  profileSlug: string;
  calledNumber: string;
  agentName: string;
  config: TelnyxCallbackConfig;
}): Promise<{ ok: true; message: string } | { ok: false; error: string; status: number }> {
  const texml = buildGuestStreamTexml({
    edgeBaseUrl: opts.config.edgeBaseUrl,
    profileSlug: opts.profileSlug,
    callerId: opts.phone,
    calledNumber: opts.calledNumber,
  });

  const telnyxResponse = await fetch(
    `https://api.telnyx.com/v2/texml/Accounts/${opts.config.accountSid}/Calls`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.config.apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        ApplicationSid: opts.config.applicationSid,
        To: opts.phone,
        From: opts.config.from,
        Texml: texml,
      }),
    },
  );

  if (!telnyxResponse.ok) {
    await telnyxResponse.text().catch(() => "");
    console.error("guest Telnyx callback failed", {
      status: telnyxResponse.status,
      profile_slug: opts.profileSlug,
    });
    return {
      ok: false,
      error: "Could not start the test call.",
      status: telnyxResponse.status || 502,
    };
  }

  return {
    ok: true,
    message: `${opts.agentName} is calling now.`,
  };
}
