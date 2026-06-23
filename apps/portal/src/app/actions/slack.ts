"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { hasActiveAccess, getBillingForUser } from "@/lib/billing";
import { isAdmin } from "@/lib/admin";

export type SlackActionResult = { ok: boolean; error?: string };

async function requireUser() {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in." };

  if (!isAdmin(user) && !hasActiveAccess(await getBillingForUser(user.id))) {
    return { ok: false as const, error: "Start your free trial first." };
  }

  return { ok: true as const, user };
}

export async function updateSlackConnectionProfile(profileId: string): Promise<SlackActionResult> {
  const gate = await requireUser();
  if (!gate.ok) return gate;

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data: profile, error: profileError } = await service
    .from("wisecall_profiles")
    .select("id")
    .eq("id", profileId)
    .eq("metadata->>owner_id", gate.user.id)
    .maybeSingle();

  if (profileError) return { ok: false, error: profileError.message };
  if (!profile) return { ok: false, error: "Agent not found." };

  const { error } = await service
    .from("wisecall_messaging_connections")
    .update({ profile_id: profileId, updated_at: new Date().toISOString() })
    .eq("owner_id", gate.user.id)
    .eq("provider", "slack")
    .eq("status", "connected");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard");
  return { ok: true };
}

export async function disconnectSlack(): Promise<SlackActionResult> {
  const gate = await requireUser();
  if (!gate.ok) return gate;

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { error } = await service
    .from("wisecall_messaging_connections")
    .update({ status: "revoked", updated_at: new Date().toISOString() })
    .eq("owner_id", gate.user.id)
    .eq("provider", "slack");

  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard");
  return { ok: true };
}
