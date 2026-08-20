// Provision a Vonage UK SMS number for a WiseCall agent.
// Called from the Next.js portal server action with service-role auth.
//
// POST { profile_id } → search Vonage for a UK mobile-lvn → buy it →
// set moHttpUrl webhook → insert into wisecall_sms_numbers → return { sms_number }.
//
// Uses VONAGE_API_KEY and VONAGE_API_SECRET from Supabase secrets (already set).
// Deploy with --no-verify-jwt; the function validates the caller via the shared
// WISECALL_PROVISION_SECRET (same scheme as wisecall-provision-mor-agent), which
// is robust to Supabase service-role key rotations.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { inboundWebhookUrl } from "../_shared/vonage-sms.ts";

const VONAGE_REST = "https://rest.nexmo.com";

// SHA-256 of the shared provision secret, baked in so the function authenticates
// the portal even when WISECALL_PROVISION_SECRET isn't set as a Supabase secret.
// Matches the default in wisecall-provision-mor-agent.
const PROVISION_SECRET_SHA256_DEFAULT =
  "aaf533c44f417d85b4d813e30c046290a6ec444cc765cd5ee303e9c1d0dd7ed3";

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function sha256(message: string): Promise<string> {
  const data = new TextEncoder().encode(message);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

// Authorise the caller: either the service-role key (apikey/bearer) or the shared
// provision secret header. Mirrors wisecall-provision-mor-agent.
async function isAuthorised(req: Request): Promise<boolean> {
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const provisionSecret = Deno.env.get("WISECALL_PROVISION_SECRET")?.trim() ?? "";
  const provisionSecretSha256 =
    Deno.env.get("WISECALL_PROVISION_SECRET_SHA256")?.trim() || PROVISION_SECRET_SHA256_DEFAULT;

  const authHeader = (req.headers.get("authorization") || "").trim();
  const bearerKey = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  const providedKey = (req.headers.get("apikey") || bearerKey).trim();
  const providedSecret = (req.headers.get("x-wisecall-provision-secret") || "").trim();

  if (serviceKey && providedKey === serviceKey) return true;
  if (provisionSecret && providedSecret === provisionSecret) return true;
  if (providedSecret && provisionSecretSha256 && (await sha256(providedSecret)) === provisionSecretSha256) {
    return true;
  }
  return false;
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

function inboundUrl(): string {
  // JWT is off for this function. A bare URL avoids Vonage failing the
  // health-check GET when the anon/publishable key format changes.
  return inboundWebhookUrl(Deno.env.get("SUPABASE_URL") ?? "");
}

async function setWebhook(msisdn: string, moHttpUrl: string): Promise<void> {
  const { key, secret } = vonageCreds();
  let lastError = "Vonage webhook set failed";
  // Vonage GETs the URL and requires 200 before saving it. Cold starts can miss
  // the first attempt, so retry rather than leaving a number with no inbound hook.
  const bodies = [
    { api_key: key, api_secret: secret, country: "GB", msisdn, moHttpUrl, moHttpMethod: "POST" },
    { api_key: key, api_secret: secret, country: "GB", msisdn, moHttpUrl },
  ];
  for (let attempt = 0; attempt < 3; attempt++) {
    const body = bodies[Math.min(attempt, bodies.length - 1)];
    const res = await fetch(`${VONAGE_REST}/number/update`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams(body),
    });
    if (res.ok) return;
    lastError = `Vonage webhook set ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`;
    await new Promise((resolve) => setTimeout(resolve, 400 * (attempt + 1)));
  }
  throw new Error(lastError);
}

function msisdnFromStored(smsNumber?: string | null, vonageNumberId?: string | null): string {
  const raw = (vonageNumberId || smsNumber || "").replace(/\D/g, "");
  return raw;
}

async function readNumberWebhook(msisdn: string): Promise<{ msisdn: string; moHttpUrl: string | null } | null> {
  const { key, secret } = vonageCreds();
  const params = new URLSearchParams({
    api_key: key,
    api_secret: secret,
    pattern: msisdn,
  });
  const res = await fetch(`${VONAGE_REST}/account/numbers?${params}`);
  if (!res.ok) return null;
  const data = (await res.json()) as {
    numbers?: { msisdn?: string; moHttpUrl?: string }[];
  };
  const match =
    data.numbers?.find((row) => String(row.msisdn || "").replace(/\D/g, "") === msisdn) ??
    data.numbers?.[0];
  if (!match?.msisdn) return null;
  return {
    msisdn: String(match.msisdn),
    moHttpUrl: match.moHttpUrl ? String(match.moHttpUrl) : null,
  };
}

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "POST only" }, 405);

  if (!(await isAuthorised(req))) {
    return json({ error: "Unauthorized" }, 401);
  }

  let profileId: string;
  let repairOnly = false;
  try {
    const body = (await req.json()) as { profile_id?: string; repair_only?: boolean };
    profileId = body.profile_id ?? "";
    repairOnly = body.repair_only === true;
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }
  if (!profileId) return json({ error: "profile_id required" }, 400);

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Existing numbers: re-assert inbound webhook only. Never search or buy.
  const { data: existing } = await supabase
    .from("wisecall_sms_numbers")
    .select("sms_number, vonage_number_id")
    .eq("profile_id", profileId)
    .maybeSingle();
  if (existing?.sms_number) {
    const expectedUrl = inboundUrl();
    try {
      const msisdn = msisdnFromStored(existing.sms_number, existing.vonage_number_id);
      if (msisdn) await setWebhook(msisdn, expectedUrl);
      const vonage = msisdn ? await readNumberWebhook(msisdn).catch(() => null) : null;
      return json({
        ok: true,
        sms_number: existing.sms_number,
        webhook_url: expectedUrl,
        vonage_mo_http_url: vonage?.moHttpUrl ?? null,
      });
    } catch (err) {
      console.error("[wisecall-provision-sms] repair webhook:", (err as Error).message);
      if (repairOnly) {
        return json({ ok: false, error: (err as Error).message }, 500);
      }
    }
    return json({ ok: true, sms_number: existing.sms_number, webhook_url: expectedUrl });
  }

  if (repairOnly) {
    return json({ ok: false, error: "No SMS number assigned to this agent." }, 404);
  }

  try {
    const msisdn = await searchUkNumber();
    if (!msisdn) return json({ ok: false, error: "No UK SMS numbers available, try again shortly." }, 503);

    await buyNumber(msisdn);
    await setWebhook(msisdn, inboundUrl());

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
