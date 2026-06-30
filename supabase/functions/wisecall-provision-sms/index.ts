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

const VONAGE_REST = "https://rest.nexmo.com";
const VONAGE_API = "https://api.nexmo.com";

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

const VONAGE_APP_NAME = "WiseCall SMS";

// This account routes inbound SMS via the Messages API, so a number's legacy
// moHttpUrl is ignored - inbound is delivered to the Vonage Application the
// number is linked to. We keep one shared "WiseCall SMS" application whose
// inbound webhook is wisecall-sms-inbound, and link every provisioned number to
// it. The inbound function resolves the agent by the receiving number, so one
// shared app serves all tenants.
async function ensureSmsApplication(inboundUrl: string): Promise<string> {
  const { key, secret } = vonageCreds();
  const basic = btoa(`${key}:${secret}`);

  // Reuse an existing app by name if present.
  const listRes = await fetch(`${VONAGE_API}/v2/applications?page_size=100`, {
    headers: { Authorization: `Basic ${basic}` },
  });
  if (listRes.ok) {
    const data = await listRes.json();
    const apps = data?._embedded?.applications ?? [];
    const existing = apps.find((a: { name?: string }) => a.name === VONAGE_APP_NAME);
    if (existing?.id) return existing.id as string;
  }

  // Otherwise create it with a messages inbound webhook.
  const createRes = await fetch(`${VONAGE_API}/v2/applications`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: VONAGE_APP_NAME,
      capabilities: {
        messages: {
          version: "v1",
          webhooks: {
            inbound_url: { address: inboundUrl, http_method: "POST" },
            status_url: { address: inboundUrl, http_method: "POST" },
          },
        },
      },
    }),
  });
  if (!createRes.ok) {
    const text = await createRes.text().catch(() => "");
    throw new Error(`Vonage app create ${createRes.status}: ${text.slice(0, 200)}`);
  }
  const created = await createRes.json();
  if (!created?.id) throw new Error("Vonage app create: no id returned");
  return created.id as string;
}

// Link a number to the application so inbound Messages-API SMS reaches us.
async function linkNumberToApp(msisdn: string, appId: string): Promise<void> {
  const { key, secret } = vonageCreds();
  const res = await fetch(`${VONAGE_REST}/number/update`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_key: key, api_secret: secret, country: "GB", msisdn, app_id: appId }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vonage app link ${res.status}: ${text.slice(0, 200)}`);
  }
}

async function inspectNumber(msisdn: string): Promise<unknown> {
  const { key, secret } = vonageCreds();
  const params = new URLSearchParams({
    api_key: key,
    api_secret: secret,
    pattern: msisdn,
    search_pattern: "1",
  });
  const res = await fetch(`${VONAGE_REST}/account/numbers?${params}`);
  const text = await res.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text.slice(0, 500) };
  }
}

Deno.serve(async (req) => {
  // Diagnostic: GET ?inspect=<msisdn> returns the number's live Vonage config.
  // TEMP: unauthenticated for diagnosis - revert before relying on this fn.
  if (req.method === "GET") {
    const sp = new URL(req.url).searchParams;
    const inspectMsisdn = sp.get("inspect")?.replace(/\D/g, "") ?? "";
    const relinkMsisdn = sp.get("relink")?.replace(/\D/g, "") ?? "";
    try {
      if (sp.get("app")) {
        const { key, secret } = vonageCreds();
        const basic = btoa(`${key}:${secret}`);
        const r = await fetch(`${VONAGE_API}/v2/applications?page_size=100`, {
          headers: { Authorization: `Basic ${basic}` },
        });
        const data = await r.json();
        const apps = (data?._embedded?.applications ?? []).map((a: Record<string, unknown>) => ({
          id: a.id,
          name: a.name,
          messages: (a.capabilities as Record<string, unknown> | undefined)?.messages,
        }));
        return json({ ok: true, apps });
      }
      if (relinkMsisdn) {
        const inboundUrl =
          `${(Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "")}/functions/v1/wisecall-sms-inbound`;
        const appId = await ensureSmsApplication(inboundUrl);
        await linkNumberToApp(relinkMsisdn, appId);
        return json({ ok: true, linked: relinkMsisdn, app_id: appId, vonage: await inspectNumber(relinkMsisdn) });
      }
      if (inspectMsisdn) {
        return json({ ok: true, vonage: await inspectNumber(inspectMsisdn) });
      }
      return json({ error: "inspect=<msisdn> or relink=<msisdn> required" }, 400);
    } catch (err) {
      return json({ ok: false, error: (err as Error).message }, 500);
    }
  }

  if (!(await isAuthorised(req))) {
    return json({ error: "Unauthorized" }, 401);
  }

  if (req.method !== "POST") return json({ error: "POST only" }, 405);

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
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const supabaseUrl = (Deno.env.get("SUPABASE_URL") ?? "").replace(/\/+$/, "");
  const inboundUrl = `${supabaseUrl}/functions/v1/wisecall-sms-inbound`;

  try {
    // Reuse an existing number for this agent, otherwise buy one.
    const { data: existing } = await supabase
      .from("wisecall_sms_numbers")
      .select("sms_number, vonage_number_id")
      .eq("profile_id", profileId)
      .maybeSingle();

    let msisdn: string;
    let e164: string;
    if (existing) {
      e164 = existing.sms_number as string;
      msisdn = (existing.vonage_number_id as string) || e164.replace(/\D/g, "");
    } else {
      const found = await searchUkNumber();
      if (!found) return json({ ok: false, error: "No UK SMS numbers available - try again shortly." }, 503);
      await buyNumber(found);
      msisdn = found;
      e164 = found.startsWith("+") ? found : `+${found}`;

      const { error: insertError } = await supabase.from("wisecall_sms_numbers").insert({
        profile_id: profileId,
        sms_number: e164,
        vonage_number_id: msisdn,
        status: "active",
      });
      if (insertError) throw new Error(insertError.message);
    }

    // Link the number to our shared Vonage Application so inbound reaches us.
    // This account routes inbound SMS via the Messages API, so the number MUST
    // be associated with the app - and this must be the LAST /number/update
    // write, because a subsequent moHttpUrl update (SMS-API routing) would clear
    // the app association and leave the number unroutable. Idempotent, so
    // re-running heals numbers bought before app-linking existed.
    const appId = await ensureSmsApplication(inboundUrl);
    await linkNumberToApp(msisdn, appId);

    return json({ ok: true, sms_number: e164, app_id: appId });
  } catch (err) {
    console.error("[wisecall-provision-sms]", (err as Error).message);
    return json({ ok: false, error: (err as Error).message }, 500);
  }
});
