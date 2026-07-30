// Point Telnyx TeXML applications at wisecall-telnyx-inbound and optionally
// provision MOR SIP for the website demo profile.
//
// Auth: x-trigger-secret == WISECALL_POOL_REPLENISH_SECRET, or service-role key.

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-trigger-secret",
};

const DEFAULT_DEMO_APP_ID = "2980953819380188229"; // WiseCall Demo
const DEFAULT_POOL_APP_ID = "2985822410638362142"; // WiseCall Pool
const DEFAULT_DEMO_PROFILE_SLUG = "wisecall";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function inboundVoiceUrl() {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim().replace(/\/+$/, "");
  if (!supabaseUrl) throw new Error("SUPABASE_URL not configured");
  return `${supabaseUrl}/functions/v1/wisecall-telnyx-inbound`;
}

async function updateTexmlApp(appId: string, voiceUrl: string) {
  const telnyxKey = Deno.env.get("TELNYX_API_KEY")?.trim();
  if (!telnyxKey) throw new Error("TELNYX_API_KEY not configured");

  const response = await fetch(`https://api.telnyx.com/v2/texml_applications/${appId}`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${telnyxKey}`,
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      voice_url: voiceUrl,
      voice_method: "POST",
    }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(
      `Telnyx app ${appId} update failed (${response.status}): ${
        JSON.stringify(payload).slice(0, 300)
      }`,
    );
  }

  return payload;
}

async function provisionMorForProfile(profileId: string, serviceRoleKey: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL")?.trim().replace(/\/+$/, "");
  if (!supabaseUrl) throw new Error("SUPABASE_URL not configured");

  const response = await fetch(`${supabaseUrl}/functions/v1/wisecall-provision-mor-agent`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${serviceRoleKey}`,
      apikey: serviceRoleKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ profile_id: profileId }),
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.ok) {
    throw new Error(
      payload?.error ||
        `wisecall-provision-mor-agent failed (${response.status})`,
    );
  }
  return payload;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return json({ ok: false, error: "Method not allowed" }, 405);
  }

  const expected = Deno.env.get("WISECALL_POOL_REPLENISH_SECRET") || "";
  const provided = req.headers.get("x-trigger-secret") || "";
  const authHeader = req.headers.get("authorization") || "";
  const apikey = req.headers.get("apikey") || "";
  const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const token = authHeader.replace(/^Bearer\s+/i, "").trim() || apikey.trim();
  const authorised =
    (expected && provided === expected) ||
    (serviceRole && token === serviceRole);
  if (!authorised) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }

  let body: {
    app_ids?: string[];
    provision_demo_mor?: boolean;
    profile_slug?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const appIds = (body.app_ids?.length
    ? body.app_ids
    : [DEFAULT_DEMO_APP_ID, DEFAULT_POOL_APP_ID]).map((id) => id.trim()).filter(Boolean);
  const provisionDemoMor = body.provision_demo_mor !== false;
  const profileSlug = String(body.profile_slug || DEFAULT_DEMO_PROFILE_SLUG).trim();

  let voiceUrl = "";
  try {
    voiceUrl = inboundVoiceUrl();
  } catch (error) {
    return json({
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    }, 500);
  }

  const appResults: Record<string, unknown> = {};
  const errors: string[] = [];

  for (const appId of appIds) {
    try {
      appResults[appId] = await updateTexmlApp(appId, voiceUrl);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(message);
      appResults[appId] = { ok: false, error: message };
    }
  }

  let morProvision: Record<string, unknown> | null = null;
  if (provisionDemoMor && serviceRole) {
    try {
      const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2.45.0");
      const supabase = createClient(
        Deno.env.get("SUPABASE_URL")!,
        serviceRole,
      );
      const { data: profile } = await supabase
        .from("wisecall_profiles")
        .select("id, slug")
        .eq("slug", profileSlug)
        .maybeSingle();

      if (!profile?.id) {
        errors.push(`Profile slug not found: ${profileSlug}`);
      } else {
        const { data: profileRow } = await supabase
          .from("wisecall_profiles")
          .select("telnyx_number")
          .eq("id", profile.id)
          .single();
        const preserveNumber = String(profileRow?.telnyx_number || "").trim();

        const { data: existingSip } = await supabase
          .from("wisecall_sip_endpoints")
          .select("id, is_enabled")
          .eq("profile_id", profile.id)
          .maybeSingle();

        if (existingSip?.is_enabled) {
          morProvision = {
            ok: true,
            action: "already_provisioned",
            profile_slug: profileSlug,
            endpoint_id: existingSip.id,
            preserved_telnyx_number: preserveNumber || null,
          };
        } else {
          const provisionResult = await provisionMorForProfile(profile.id, serviceRole);
          if (preserveNumber) {
            await supabase
              .from("wisecall_profiles")
              .update({ telnyx_number: preserveNumber })
              .eq("id", profile.id);
          }
          morProvision = {
            ok: true,
            action: "provisioned",
            profile_slug: profileSlug,
            preserved_telnyx_number: preserveNumber || null,
            result: provisionResult,
          };
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`MOR provision: ${message}`);
      morProvision = { ok: false, error: message };
    }
  }

  const appsUpdated = appIds.filter((id) => {
    const result = appResults[id] as { ok?: boolean; data?: unknown } | undefined;
    return result && result.ok !== false && !("error" in (result as object));
  }).length;

  return json({
    ok: errors.length === 0,
    voice_url: voiceUrl,
    apps_requested: appIds,
    apps_updated: appsUpdated,
    app_results: appResults,
    mor_provision: morProvision,
    errors: errors.length ? errors : undefined,
    message: errors.length
      ? "Some steps failed; see errors."
      : "Telnyx TeXML apps now point at wisecall-telnyx-inbound.",
  }, errors.length ? 502 : 200);
});
