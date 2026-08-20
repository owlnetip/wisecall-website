/** Live Telnyx media edge. 13.40.127.21 is the old Elastic IP (down). */
export const LIVE_EDGE_BASE_URL = "https://18.132.149.25.sslip.io";
const DEAD_EDGE_HOSTS = ["18.171.233.209", "13.40.127.21"];

export function resolveEdgeBaseUrl(configured?: string | null) {
  const value = String(configured || "").trim().replace(/\/+$/, "");
  if (!value || DEAD_EDGE_HOSTS.some((host) => value.includes(host))) {
    return LIVE_EDGE_BASE_URL;
  }
  return value;
}

export function escapeXmlAttribute(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function buildWebhookUrl(edgeBaseUrl: string, profileSlug: string) {
  const url = new URL("/telnyx/texml-status", edgeBaseUrl.replace(/\/+$/, ""));
  url.searchParams.set("profile_slug", profileSlug);
  return url.toString();
}

export function getStreamCodec() {
  const value = (Deno.env.get("WISECALL_DEMO_STREAM_CODEC") || "PCMA")
    .trim()
    .toUpperCase();
  return value === "PCMA" ? "PCMA" : "PCMU";
}

export function buildStreamTexml(
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

export function buildMorSipDialTexml(input: {
  sipUri: string;
  username: string;
  password: string;
  callerId: string;
}) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${escapeXmlAttribute(input.callerId)}" timeout="45">
    <Sip
      username="${escapeXmlAttribute(input.username)}"
      password="${escapeXmlAttribute(input.password)}"
      sipRegion="Europe"
    >${escapeXmlAttribute(input.sipUri)}</Sip>
  </Dial>
</Response>`;
}

/** Bridge the answered Telnyx call onto a live MOR DDI. This is how customer agents already answer. */
export function buildPstnDialTexml(input: { number: string; callerId: string }) {
  const number = normalizeE164(input.number);
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${escapeXmlAttribute(input.callerId)}" timeout="45">
    <Number>${escapeXmlAttribute(number)}</Number>
  </Dial>
</Response>`;
}

export function morDidFromMetadata(metadata: unknown): string {
  if (!metadata || typeof metadata !== "object") return "";
  const routing = (metadata as { routing?: Record<string, unknown> }).routing;
  const raw = String(routing?.morDid || "").trim();
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("44") && digits.length >= 11) return `+${digits}`;
  return "";
}

export function buildUnavailableTexml(message: string) {
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="female">${escapeXmlAttribute(message)}</Say>
  <Hangup/>
</Response>`;
}

export function texmlResponse(body: string, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "text/xml; charset=utf-8",
      "Cache-Control": "no-store",
    },
  });
}

export async function probeEdgeHealth(baseUrl: string) {
  const healthUrl = new URL("/health", baseUrl.replace(/\/+$/, ""));
  const started = Date.now();
  try {
    const response = await fetch(healthUrl.toString(), {
      signal: AbortSignal.timeout(1500),
    });
    const text = await response.text().catch(() => "");
    const looksLikeEdge =
      response.ok &&
      !/<(html|!doctype)/i.test(text) &&
      (/"ok"\s*:\s*true/i.test(text) || /healthy/i.test(text) || text.trim().toLowerCase() === "ok");
    return {
      ok: looksLikeEdge,
      status: response.status,
      latency_ms: Date.now() - started,
      body: text.slice(0, 200),
    };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      latency_ms: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

export function normalizeE164(raw: string) {
  const digits = raw.trim().replace(/[^\d+]/g, "");
  if (!digits) return "";
  return digits.startsWith("+") ? digits : `+${digits.replace(/^\+/, "")}`;
}

export async function parseTelnyxRequest(req: Request) {
  const url = new URL(req.url);
  const params = new URLSearchParams(url.search);

  if (req.method === "POST") {
    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const form = await req.formData();
      for (const [key, value] of form.entries()) {
        if (typeof value === "string") params.set(key, value);
      }
    } else if (contentType.includes("application/json")) {
      const body = await req.json().catch(() => ({}));
      for (const [key, value] of Object.entries(body as Record<string, unknown>)) {
        if (typeof value === "string") params.set(key, value);
      }
    }
  }

  return params;
}

export function buildSipUri(endpoint: {
  username: string;
  domain: string;
  proxy: string;
}) {
  const host = endpoint.proxy.split(":")[0] || endpoint.domain;
  return `sip:${endpoint.username}@${host}`;
}
