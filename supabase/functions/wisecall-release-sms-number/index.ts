// wisecall-release-sms-number - cancels the Vonage SMS number assigned to a
// WiseCall agent and removes the wisecall_sms_numbers row.
//
// Called from the deleteAgent server action. Vonage credentials (VONAGE_API_KEY,
// VONAGE_API_SECRET) are Supabase secrets, so the work is done here rather than
// in the Next.js route.
//
// POST { profile_id } → look up wisecall_sms_numbers → cancel Vonage number →
//   delete row → return { ok, cancelledNumber }.
//
// Auth: same scheme as wisecall-provision-sms (service-role key or
// WISECALL_PROVISION_SECRET with baked-in SHA256 fallback).
// Deploy with --no-verify-jwt.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const VONAGE_REST = "https://rest.nexmo.com";

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
  if (
    providedSecret &&
    provisionSecretSha256 &&
    (await sha256(providedSecret)) === provisionSecretSha256
  ) {
    return true;
  }
  return false;
}

async function cancelVonageNumber(msisdn: string): Promise<void> {
  const key = Deno.env.get("VONAGE_API_KEY");
  const secret = Deno.env.get("VONAGE_API_SECRET");
  if (!key || !secret) throw new Error("Vonage credentials not configured");

  const res = await fetch(`${VONAGE_REST}/number/cancel`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ api_key: key, api_secret: secret, country: "GB", msisdn }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Vonage cancel ${res.status}: ${text.slice(0, 200)}`);
  }
}

Deno.serve(async (req) => {
  if (!(await isAuthorised(req))) return json({ error: "Unauthorized" }, 401);
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

  const { data: row, error: lookupError } = await supabase
    .from("wisecall_sms_numbers")
    .select("id, sms_number, vonage_number_id")
    .eq("profile_id", profileId)
    .maybeSingle();

  if (lookupError) return json({ ok: false, error: lookupError.message }, 500);

  // No SMS number assigned to this agent - nothing to do.
  if (!row) return json({ ok: true, cancelledNumber: null });

  const msisdn = (row.vonage_number_id as string) || (row.sms_number as string).replace(/\D/g, "");
  const e164 = row.sms_number as string;

  const warnings: string[] = [];

  try {
    await cancelVonageNumber(msisdn);
  } catch (err) {
    // Non-fatal: Vonage may already have released the number (e.g. non-payment).
    // Still delete the local row so the agent is cleanly removed.
    warnings.push(`Vonage cancel: ${(err as Error).message}`);
    console.warn("[wisecall-release-sms-number] Vonage cancel failed:", (err as Error).message);
  }

  const { error: deleteError } = await supabase
    .from("wisecall_sms_numbers")
    .delete()
    .eq("id", row.id);

  if (deleteError) {
    return json({ ok: false, error: `DB delete failed: ${deleteError.message}`, warnings }, 500);
  }

  console.log("[wisecall-release-sms-number] released", e164, "for profile", profileId);
  return json({ ok: true, cancelledNumber: e164, warnings });
});
