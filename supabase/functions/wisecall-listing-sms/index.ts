// wisecall-listing-sms — text a caller the direct link to a property/listing
// they asked about during a call.
//
// Called as a per-agent during_call integration webhook (profile metadata), so
// only profiles that explicitly configure the tool ever expose it — the shared
// runtime and the existing wisecall-send-sms behaviour are untouched.
//
// Safety model:
//   - Same X-WiseCall-SMS-Secret shared secret as wisecall-send-sms.
//   - Destination is always the caller's own number (callerId from the runtime
//     context / a {{caller_id}} template param) — the model cannot redirect it.
//   - The URL must appear verbatim in THIS profile's knowledge_base chunks, so
//     the model can only send links that genuinely exist in the agent's KB.
//   - Delivery is delegated to wisecall-send-sms (Vonage + logging + per-link
//     suppression) with link_type "listing-<hash>" so different properties in
//     one call are not suppressed against each other.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wisecall-sms-secret",
};

type ListingSmsRequest = {
  property_url?: string;
  property_name?: string;
  phone?: string;
  callerId?: string;
  profileId?: string;
  profile_id?: string;
  callId?: string;
  call_id?: string;
};

function json(body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function shortHash(value: string): Promise<string> {
  const data = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(digest))
    .slice(0, 4)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const expectedSecret = Deno.env.get("WISECALL_SMS_WEBHOOK_SECRET");
  const suppliedSecret = req.headers.get("X-WiseCall-SMS-Secret") || "";
  if (!expectedSecret || suppliedSecret !== expectedSecret) {
    return json({ error: "Unauthorized" }, 401);
  }

  let body: ListingSmsRequest;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body" }, 400);
  }

  const profileId = String(body.profileId || body.profile_id || "").trim();
  const callId = String(body.callId || body.call_id || "").trim();
  const phone = String(body.phone || body.callerId || "").trim();
  const propertyName = String(body.property_name || "").trim().slice(0, 120);
  const url = String(body.property_url || "").trim();

  if (!profileId) return json({ success: false, error: "profile id missing" }, 400);
  if (!/^https:\/\/[^\s"'<>]{10,300}$/.test(url)) {
    return json({
      success: false,
      error: "property_url must be the exact https listing URL from the knowledge base",
    }, 400);
  }
  if (!phone || phone.toLowerCase() === "unknown" || phone.toLowerCase() === "anonymous") {
    return json({
      success: false,
      error:
        "The caller's number is unavailable (withheld). Tell them the team will email or call back with the link instead.",
    }, 400);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const svcKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, svcKey);

  const { data: profile } = await supabase
    .from("wisecall_profiles")
    .select("id, business_name, slug, sms_enabled")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return json({ success: false, error: "profile not found" }, 404);
  if (profile.sms_enabled === false) {
    return json({ success: false, error: "SMS is disabled for this agent" }, 403);
  }

  // The URL must exist verbatim in this profile's own KB chunks. Strip one
  // trailing slash so "…/foo" matches a chunk that stored "…/foo/".
  const bare = url.replace(/\/+$/, "");
  const { data: kbHit } = await supabase
    .from("knowledge_base")
    .select("id")
    .contains("bot_ids", [profileId])
    .or(`content.ilike.%${bare}%,content.ilike.%${bare}/%`)
    .limit(1);
  if (!kbHit || kbHit.length === 0) {
    return json({
      success: false,
      error:
        "That URL is not in the knowledge base for this agent. Re-check the listing with lookup_knowledge_base and use its exact 'Listing page' URL.",
    }, 403);
  }

  const business = String(profile.business_name || "WiseCall").slice(0, 40);
  const message = (propertyName
    ? `${business}: here's the listing you asked about — ${propertyName}. Full details: ${url}`
    : `${business}: here's the listing you asked about. Full details: ${url}`
  ).slice(0, 612);

  const linkType = `listing-${await shortHash(bare)}`;
  const res = await fetch(`${supabaseUrl}/functions/v1/wisecall-send-sms`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-WiseCall-SMS-Secret": expectedSecret,
    },
    body: JSON.stringify({
      phone,
      message,
      link_type: linkType,
      call_id: callId || null,
      profile_id: profile.id,
      profile_slug: profile.slug || null,
    }),
  });
  const result = await res.json().catch(() => ({}));

  if (!res.ok || !result.success) {
    return json({
      success: false,
      error: result.error || `SMS provider returned ${res.status}`,
    }, 502);
  }

  return json({
    success: true,
    status: result.suppressed ? "already_sent_recently" : "sent",
    note: result.suppressed
      ? "This link was already texted to the caller recently; let them know it's in their messages."
      : "Texted. Tell the caller the link is on its way to their mobile.",
  });
});
