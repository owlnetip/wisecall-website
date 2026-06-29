// Provision a Vonage UK SMS number for a WiseCall agent.
// Called from the Next.js portal server action with service-role auth.
//
// POST { profile_id } → search Vonage for a UK mobile-lvn → buy it →
// set moHttpUrl webhook → insert into wisecall_sms_numbers → return { sms_number }.
//
// Uses VONAGE_API_KEY and VONAGE_API_SECRET from Supabase secrets (already set).
// Deploy with --no-verify-jwt; the function validates the caller via service-role key.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const VONAGE_REST = "https://rest.nexmo.com";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function vonageCreds() {
  const key = Deno.env.get("VONAGE_API_KEY");
  const secret = Deno.env.get("VONAGE_API_SECRET");
  if (!key || !secret) throw new Error("Vonage credentials not configured");
  return { key, secret };
}

async function searchUkNumber(): Promise<string | null> {
  const { key, secret } = vonageCreds();
  const params = new URLSearchParams({
    api_key: key,
    api_secret: secret,
    country: "GB",
    type: "mobile-lvn",
    features: "SMS",
    size: "1",
  });
  const res = await fetch(`${VONAGE_REST}/number/search?${params}`);
  if (!res.ok) throw new Error(`Vonage search ${res.status}: ${await res.text()}`);
  const data = (await res.json()) as { numbers?: { msisdn: string }[] };
  return data.numbers?.[0]?.msisdn ?? null;
}

async function buyNumber(msisdn: string): Promise<void> {
  const { key, secret } = vonageCreds();
  const res = await fetch(`${VONAGE_REST}/number/buy`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_key: key, api_secret: secret, country: "GB", msisdn }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vonage buy ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function setWebhook(msisdn: string, moHttpUrl: string): Promise<void> {
  const { key, secret } = vonageCreds();
  const res = await fetch(`${VONAGE_REST}/number/update`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_key: key, api_secret: secret, country: "GB", msisdn, moHttpUrl }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vonage webhook set ${res.status}: ${text.slice(0, 200)}`);
  }
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  // Validate caller is using the service-role key (not anon).
  const authHeader = req.headers.get("Authorization") ?? "";
  const callerKey = authHeader.replace(/^Bearer\s+/i, "");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey || callerKey !== serviceKey) {
    return json({ error: "Unauthorized" }, 401);
  }

  let profileId: string;
  try {
    const body = (await req.json()) as { profile_id?: string };
    profileId = body.profile_id ?? "";
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!profileId) return json({ error: "profile_id required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    serviceKey,
  );

  // Return existing number if already provisioned.
  const { data: existing } = await supabase
    .from("wisecall_sms_numbers")
    .select("sms_number")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (existing) return json({ ok: true, sms_number: existing.sms_number });

  try {
    const msisdn = await searchUkNumber();
    if (!msisdn) return json({ ok: false, error: "No UK SMS numbers available — try again shortly." }, 503);

    await buyNumber(msisdn);

    const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
    const moHttpUrl = `${supabaseUrl}/functions/v1/wisecall-sms-inbound`;
    await setWebhook(msisdn, moHttpUrl);

    const e164 = msisdn.startsWith("+") ? msisdn : `+${msisdn}`;

    const { error: insertError } = await supabase.from("wisecall_sms_numbers").insert({
      profile_id: profileId,
      sms_number: e164,
      vonage_number_id: msisdn,
      status: "active",
    });
    if (insertError) throw new Error(insertError.message);

    return json({ ok: true, sms_number: e164 });
  } catch (err) {
    console.error("[wisecall-provision-sms]", (err as Error).message);
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
