"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  listStatusFlagsForProfile,
  type StatusFlag,
  type StatusPolicy,
} from "@/lib/status-flags";

export async function getStatusFlagsForAgent(
  profileId: string,
): Promise<{ ok: boolean; flags?: StatusFlag[]; error?: string }> {
  const supabaseAuth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const allowed = await assertOwnsProfile(profileId, user.id);
  if (!allowed) return { ok: false, error: "Not found." };

  const flags = await listStatusFlagsForProfile(profileId);
  return { ok: true, flags };
}

async function assertOwnsProfile(profileId: string, userId: string): Promise<boolean> {
  const supabase = getServiceSupabase();
  if (!supabase) return false;
  const { data } = await supabase
    .from("wisecall_profiles")
    .select("metadata")
    .eq("id", profileId)
    .maybeSingle();
  const ownerId =
    data?.metadata && typeof data.metadata === "object"
      ? (data.metadata as Record<string, unknown>).owner_id
      : null;
  return ownerId === userId;
}

export async function createStatusFlag(input: {
  profileId: string;
  matchPhone?: string;
  matchEmail?: string;
  matchCompany?: string;
  flagKey: string;
  label: string;
  policy: StatusPolicy;
  agentMessage: string;
  transferRouteKey?: string;
  appliesWhen?: string[];
}): Promise<{ ok: boolean; error?: string; id?: string }> {
  const supabaseAuth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const allowed = await assertOwnsProfile(input.profileId, user.id);
  if (!allowed) return { ok: false, error: "Not found." };

  const flagKey = input.flagKey.trim().toLowerCase().replace(/\s+/g, "_");
  const label = input.label.trim();
  if (!flagKey || !label) return { ok: false, error: "Flag key and label are required." };
  if (!input.matchPhone?.trim() && !input.matchEmail?.trim() && !input.matchCompany?.trim()) {
    return { ok: false, error: "Match on phone, email, or company." };
  }

  const supabase = getServiceSupabase();
  if (!supabase) return { ok: false, error: "Database unavailable." };

  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("wisecall_status_flags")
    .insert({
      profile_id: input.profileId,
      match_phone: input.matchPhone?.trim() || null,
      match_email: input.matchEmail?.trim().toLowerCase() || null,
      match_company: input.matchCompany?.trim() || null,
      flag_key: flagKey.slice(0, 64),
      label: label.slice(0, 120),
      policy: input.policy,
      agent_message: (input.agentMessage || "").slice(0, 500),
      transfer_route_key: input.transferRouteKey?.trim() || null,
      applies_when: input.appliesWhen?.length ? input.appliesWhen : ["all"],
      active: true,
      source: "manual",
      created_at: now,
      updated_at: now,
    })
    .select("id")
    .single();

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard");
  return { ok: true, id: data.id as string };
}

export async function setStatusFlagActive(
  flagId: string,
  active: boolean,
): Promise<{ ok: boolean; error?: string }> {
  const supabaseAuth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = getServiceSupabase();
  if (!supabase) return { ok: false, error: "Database unavailable." };

  const { data: row } = await supabase
    .from("wisecall_status_flags")
    .select("profile_id")
    .eq("id", flagId)
    .maybeSingle();
  if (!row?.profile_id) return { ok: false, error: "Not found." };

  const allowed = await assertOwnsProfile(row.profile_id as string, user.id);
  if (!allowed) return { ok: false, error: "Not found." };

  const { error } = await supabase
    .from("wisecall_status_flags")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", flagId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function deleteStatusFlag(
  flagId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabaseAuth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const supabase = getServiceSupabase();
  if (!supabase) return { ok: false, error: "Database unavailable." };

  const { data: row } = await supabase
    .from("wisecall_status_flags")
    .select("profile_id")
    .eq("id", flagId)
    .maybeSingle();
  if (!row?.profile_id) return { ok: false, error: "Not found." };

  const allowed = await assertOwnsProfile(row.profile_id as string, user.id);
  if (!allowed) return { ok: false, error: "Not found." };

  const { error } = await supabase.from("wisecall_status_flags").delete().eq("id", flagId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateOpsDigestSettings(input: {
  profileId: string;
  enabled: boolean;
  morning: boolean;
  afternoon: boolean;
}): Promise<{ ok: boolean; error?: string }> {
  const supabaseAuth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const allowed = await assertOwnsProfile(input.profileId, user.id);
  if (!allowed) return { ok: false, error: "Not found." };

  const supabase = getServiceSupabase();
  if (!supabase) return { ok: false, error: "Database unavailable." };

  const { data: profile } = await supabase
    .from("wisecall_profiles")
    .select("metadata")
    .eq("id", input.profileId)
    .maybeSingle();

  const metadata =
    profile?.metadata && typeof profile.metadata === "object"
      ? { ...(profile.metadata as Record<string, unknown>) }
      : {};

  const existing =
    metadata.ops_digest && typeof metadata.ops_digest === "object"
      ? (metadata.ops_digest as Record<string, unknown>)
      : {};

  metadata.ops_digest = {
    ...existing,
    enabled: input.enabled,
    morning: input.morning,
    afternoon: input.afternoon,
  };

  const { error } = await supabase
    .from("wisecall_profiles")
    .update({ metadata })
    .eq("id", input.profileId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function updateStatusCheckSettings(input: {
  profileId: string;
  enabled: boolean;
  webhookUrl: string;
  webhookSecret: string;
}): Promise<{ ok: boolean; error?: string }> {
  const supabaseAuth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const allowed = await assertOwnsProfile(input.profileId, user.id);
  if (!allowed) return { ok: false, error: "Not found." };

  const url = input.webhookUrl.trim();
  if (input.enabled && url) {
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:") {
        return { ok: false, error: "Status check webhook must use HTTPS." };
      }
    } catch {
      return { ok: false, error: "Enter a valid webhook URL." };
    }
  }

  const supabase = getServiceSupabase();
  if (!supabase) return { ok: false, error: "Database unavailable." };

  const { data: profile } = await supabase
    .from("wisecall_profiles")
    .select("metadata")
    .eq("id", input.profileId)
    .maybeSingle();

  const metadata =
    profile?.metadata && typeof profile.metadata === "object"
      ? { ...(profile.metadata as Record<string, unknown>) }
      : {};

  metadata.status_check = {
    enabled: input.enabled,
    webhook_url: url,
    webhook_secret: input.webhookSecret.trim(),
    timeout_ms: 2000,
  };

  const { error } = await supabase
    .from("wisecall_profiles")
    .update({ metadata })
    .eq("id", input.profileId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard");
  return { ok: true };
}
