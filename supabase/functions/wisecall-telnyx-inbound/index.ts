// Telnyx TeXML voice_url handler for inbound calls on WiseCall DDIs.
//
// Always Connect/Stream to WISECALL_EDGE_BASE_URL/media — the same path that
// worked for website Call me and the demo DDI. Do not Dial SIP/PSTN here;
// those fallbacks hang up before the AI bridge answers.
//
// Auth: Telnyx webhook (no JWT). Set verify_jwt = false.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import {
  buildStreamTexml,
  buildUnavailableTexml,
  getStreamCodec,
  normalizeE164,
  parseTelnyxRequest,
  texmlResponse,
} from "../_shared/texml.ts";

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
      .select("id, slug, telnyx_number, is_active, metadata")
      .eq("telnyx_number", normalized)
      .maybeSingle();
    if (byNumber?.slug) return byNumber;
  }

  const slug = profileSlugHint.trim();
  if (slug) {
    const { data: bySlug } = await supabase
      .from("wisecall_profiles")
      .select("id, slug, telnyx_number, is_active, metadata")
      .eq("slug", slug)
      .maybeSingle();
    if (bySlug?.slug) return bySlug;
  }

  return null;
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
  if (!edgeBaseUrl) {
    console.error("wisecall-telnyx-inbound: WISECALL_EDGE_BASE_URL missing", {
      profile_slug: profile.slug,
    });
    return texmlResponse(
      buildUnavailableTexml(
        "Sorry, the WiseCall demo is temporarily unavailable. Please try again shortly.",
      ),
      503,
    );
  }

  const streamCodec = getStreamCodec();
  const texml = buildStreamTexml(
    edgeBaseUrl,
    profile.slug,
    from || "anonymous",
    to || profile.telnyx_number || "",
    streamCodec,
  );
  console.log("wisecall-telnyx-inbound: routing via edge stream", {
    profile_slug: profile.slug,
    to,
  });
  return texmlResponse(texml);
});
