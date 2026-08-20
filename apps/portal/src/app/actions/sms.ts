"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { isAdmin } from "@/lib/admin";

export type SmsProvisionResult =
  | { ok: true; smsNumber: string }
  | { ok: false; error: string };

async function callProvisionSms(
  profileId: string,
  repairOnly: boolean,
): Promise<SmsProvisionResult> {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  // Verify access: the signed-in user must own this profile, or be an admin.
  // Mirrors updateAgent, fetch by id, then check owner_id, so admins (and the
  // admin viewing another customer's agents) aren't blocked. A combined
  // .eq("metadata->>owner_id", user.id) query would 404 for those cases.
  const { data: profile } = await service
    .from("wisecall_profiles")
    .select("id, metadata")
    .eq("id", profileId)
    .maybeSingle();
  if (!profile) return { ok: false, error: "Agent not found." };

  const ownerId = (profile.metadata as Record<string, unknown> | null)?.owner_id;
  if (ownerId !== user.id && !isAdmin(user)) {
    return { ok: false, error: "You don't have access to this agent." };
  }

  const supabaseUrl = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? process.env.SUPABASE_URL ?? "").replace(/\/+$/, "");
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
  if (!supabaseUrl || !serviceKey) return { ok: false, error: "Server not configured." };

  const headers: Record<string, string> = {
    Authorization: `Bearer ${serviceKey}`,
    apikey: serviceKey,
    "Content-Type": "application/json",
  };
  const provisionSecret = process.env.WISECALL_PROVISION_SECRET?.trim();
  if (provisionSecret) headers["x-wisecall-provision-secret"] = provisionSecret;

  const res = await fetch(`${supabaseUrl}/functions/v1/wisecall-provision-sms`, {
    method: "POST",
    headers,
    body: JSON.stringify({ profile_id: profileId, repair_only: repairOnly }),
  });

  const data = (await res.json()) as { ok: boolean; sms_number?: string; error?: string };
  if (!data.ok || !data.sms_number) {
    return { ok: false, error: data.error ?? "Provisioning failed." };
  }

  return { ok: true, smsNumber: data.sms_number };
}

export async function provisionSmsNumber(profileId: string): Promise<SmsProvisionResult> {
  try {
    return await callProvisionSms(profileId, false);
  } catch (err) {
    console.error("[provisionSmsNumber]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Failed to provision SMS number, please try again." };
  }
}

/** Re-point Vonage inbound webhook. Never searches or buys a number. */
export async function repairSmsInbound(profileId: string): Promise<SmsProvisionResult> {
  try {
    return await callProvisionSms(profileId, true);
  } catch (err) {
    console.error("[repairSmsInbound]", err instanceof Error ? err.message : err);
    return { ok: false, error: "Failed to repair SMS inbound." };
  }
}
