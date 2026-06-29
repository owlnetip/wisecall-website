"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";

const VONAGE_REST = "https://rest.nexmo.com";
const VONAGE_MESSAGES = "https://api.nexmo.com";
void VONAGE_MESSAGES; // referenced by wisecall-sms-inbound, kept here for documentation

function vonageCredentials() {
  const key = process.env.VONAGE_API_KEY;
  const secret = process.env.VONAGE_API_SECRET;
  if (!key || !secret) throw new Error("Vonage credentials not configured");
  return { key, secret };
}

async function searchUkSmsNumber(): Promise<string | null> {
  const { key, secret } = vonageCredentials();
  const params = new URLSearchParams({
    api_key: key,
    api_secret: secret,
    country: "GB",
    type: "mobile-lvn",
    features: "SMS",
    size: "1",
  });
  const res = await fetch(`${VONAGE_REST}/number/search?${params}`);
  if (!res.ok) throw new Error(`Vonage number search ${res.status}`);
  const data = (await res.json()) as { numbers?: { msisdn: string }[] };
  return data.numbers?.[0]?.msisdn ?? null;
}

async function buyVonageNumber(msisdn: string): Promise<void> {
  const { key, secret } = vonageCredentials();
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

async function setVonageInboundWebhook(msisdn: string, moHttpUrl: string): Promise<void> {
  const { key, secret } = vonageCredentials();
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

export type SmsProvisionResult =
  | { ok: true; smsNumber: string }
  | { ok: false; error: string };

export async function provisionSmsNumber(profileId: string): Promise<SmsProvisionResult> {
  try {
    const auth = await createSupabaseServerClient();
    const { data: { user } } = await auth.auth.getUser();
    if (!user) return { ok: false, error: "Not signed in." };

    const service = getServiceSupabase();
    if (!service) return { ok: false, error: "Server not configured." };

    // Verify the user owns this profile.
    const { data: profile } = await service
      .from("wisecall_profiles")
      .select("id")
      .eq("id", profileId)
      .eq("metadata->>owner_id", user.id)
      .maybeSingle();
    if (!profile) return { ok: false, error: "Agent not found." };

    // Return existing number if already assigned.
    const { data: existing } = await service
      .from("wisecall_sms_numbers")
      .select("sms_number")
      .eq("profile_id", profileId)
      .maybeSingle();
    if (existing) return { ok: true, smsNumber: existing.sms_number };

    // Find and buy a UK virtual mobile number.
    const msisdn = await searchUkSmsNumber();
    if (!msisdn) {
      return { ok: false, error: "No UK SMS numbers available right now — please try again shortly." };
    }
    await buyVonageNumber(msisdn);

    // Point inbound messages to wisecall-sms-inbound.
    const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? "").replace(/\/+$/, "");
    const moHttpUrl = `${supabaseUrl}/functions/v1/wisecall-sms-inbound`;
    await setVonageInboundWebhook(msisdn, moHttpUrl);

    // Normalise to E.164 and persist.
    const e164 = msisdn.startsWith("+") ? msisdn : `+${msisdn}`;
    const { error: insertError } = await service.from("wisecall_sms_numbers").insert({
      profile_id: profileId,
      sms_number: e164,
      vonage_number_id: msisdn,
      status: "active",
    });
    if (insertError) throw new Error(insertError.message);

    return { ok: true, smsNumber: e164 };
  } catch (err) {
    console.error("[provisionSmsNumber]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Failed to provision SMS number — please try again." };
  }
}
