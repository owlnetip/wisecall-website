// Telnyx TeXML voice_url handler for inbound calls on WiseCall DDIs.
//
// When the voice edge (WISECALL_EDGE_BASE_URL) is down, callers hear Telnyx's
// robotic fallback if the TeXML app points directly at the edge. This function
// becomes the TeXML voice_url and routes calls through the healthy MOR SIP
// bridge when the edge is unavailable.
//
// Auth: Telnyx webhook (no JWT). Set verify_jwt = false.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildMorSipDialTexml,
  buildStreamTexml,
  buildUnavailableTexml,
  getStreamCodec,
  normalizeE164,
  parseTelnyxRequest,
  probeEdgeHealth,
  texmlResponse,
} from "../_shared/texml.ts";

type InboundMode = "auto" | "edge" | "mor_sip";

function inboundMode(): InboundMode {
  const value = (Deno.env.get("WISECALL_TELNYX_INBOUND_MODE") || "auto")
    .trim()
    .toLowerCase();
  if (value === "edge" || value === "mor_sip") return value;
  return "auto";
}

function serviceClient() {
  const url = Deno.env.get("SUPABASE_URL")?.trim();
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")?.trim();
  if (!url || !key) return null;
  return createClient(url, key);
}

async function resolveProfile(
  supabase: ReturnType<typeof createClient>,
  calledNumber: string,
  profileSlugHint: string,
) {
  const normalized = normalizeE164(calledNumber);
  if (normalized) {
    const { data: byNumber } = await supabase
      .from("wisecall_profiles")
      .select("id, slug, telnyx_number, is_active")
      .eq("telnyx_number", normalized)
      .maybeSingle();
    if (byNumber?.slug) return byNumber;
  }

  const slug = profileSlugHint.trim();
  if (slug) {
    const { data: bySlug } = await supabase
      .from("wisecall_profiles")
      .select("id, slug, telnyx_number, is_active")
      .eq("slug", slug)
      .maybeSingle();
    if (bySlug?.slug) return bySlug;
  }

  return null;
}

async function loadSipEndpoint(
  supabase: ReturnType<typeof createClient>,
  profileId: string,
) {
  const { data } = await supabase
    .from("wisecall_sip_endpoints")
    .select("sip_username, sip_password, sip_domain, sip_proxy, is_enabled, pbx_type")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (!data?.is_enabled || !data.sip_username || !data.sip_password) {
    return null;
  }

  const domain = String(data.sip_domain || "").trim();
  if (!domain) return null;

  return {
    username: String(data.sip_username),
    password: String(data.sip_password),
    domain,
    proxy: String(data.sip_proxy || "").trim(),
    pbxType: String(data.pbx_type || "mor"),
  };
}

function buildSipUri(endpoint: {
  username: string;
  domain: string;
  proxy: string;
}) {
  const host = endpoint.proxy.split(":")[0] || endpoint.domain;
  return `sip:${endpoint.username}@${host}`;
}

Deno.serve(async (req) => {
  if (req.method !== "GET" && req.method !== "POST") {
    return texmlResponse(buildUnavailableTexml("This line is temporarily unavailable."), 405);
  }

  const params = await parseTelnyxRequest(req);
  const from = normalizeE164(String(params.get("From") || params.get("CallerId") || ""));
  const to = normalizeE164(String(params.get("To") || ""));
  const profileSlugHint = String(params.get("profile_slug") || "").trim();

  const supabase = serviceClient();
  if (!supabase) {
    console.error("wisecall-telnyx-inbound: Supabase not configured");
    return texmlResponse(
      buildUnavailableTexml("This line is temporarily unavailable. Please try again shortly."),
      500,
    );
  }

  const profile = await resolveProfile(supabase, to, profileSlugHint);
  if (!profile?.slug) {
    console.error("wisecall-telnyx-inbound: profile not found", { to, profileSlugHint });
    return texmlResponse(
      buildUnavailableTexml("Sorry, this number is not configured."),
      404,
    );
  }

  if (profile.is_active === false) {
    return texmlResponse(
      buildUnavailableTexml("This assistant is not active right now."),
      403,
    );
  }

  const edgeBaseUrl = Deno.env.get("WISECALL_EDGE_BASE_URL")?.trim() || "";
  const mode = inboundMode();
  const edgeHealth = edgeBaseUrl && mode !== "mor_sip"
    ? await probeEdgeHealth(edgeBaseUrl)
    : { ok: false, status: 0, latency_ms: 0 };
  const edgeHealthy = Boolean(edgeHealth.ok);
  const useEdge = mode === "edge" || (mode === "auto" && edgeHealthy);

  if (useEdge && edgeBaseUrl) {
    const streamCodec = getStreamCodec();
    const texml = buildStreamTexml(
      edgeBaseUrl,
      profile.slug,
      from || "anonymous",
      to || profile.telnyx_number || "",
      streamCodec,
    );
    console.log("wisecall-telnyx-inbound: routing via edge", {
      profile_slug: profile.slug,
      to,
      edge_latency_ms: edgeHealth.latency_ms,
    });
    return texmlResponse(texml);
  }

  const sipEndpoint = await loadSipEndpoint(supabase, profile.id);
  if (!sipEndpoint) {
    console.error("wisecall-telnyx-inbound: no SIP fallback", {
      profile_slug: profile.slug,
      edge_ok: edgeHealthy,
      edge_status: edgeHealth.status,
    });
    return texmlResponse(
      buildUnavailableTexml(
        "Sorry, our phone assistant is temporarily unavailable. Please try again in a few minutes.",
      ),
      503,
    );
  }

  const texml = buildMorSipDialTexml({
    sipUri: buildSipUri(sipEndpoint),
    username: sipEndpoint.username,
    password: sipEndpoint.password,
    callerId: from || to || "+441135222277",
  });

  console.log("wisecall-telnyx-inbound: routing via MOR SIP", {
    profile_slug: profile.slug,
    to,
    sip_domain: sipEndpoint.domain,
    edge_ok: edgeHealthy,
  });

  return texmlResponse(texml);
});
