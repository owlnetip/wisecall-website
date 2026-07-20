"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { defaultSnoozeUntil } from "@/lib/follow-up-priority";
import type { FollowUpStatus } from "@/lib/follow-ups";

async function assertOwnsFollowUp(followUpId: string, userId: string): Promise<boolean> {
  const supabase = getServiceSupabase();
  if (!supabase) return false;

  const { data: row } = await supabase
    .from("wisecall_follow_ups")
    .select("profile_id")
    .eq("id", followUpId)
    .maybeSingle();

  if (!row?.profile_id) return false;

  const { data: profile } = await supabase
    .from("wisecall_profiles")
    .select("metadata")
    .eq("id", row.profile_id)
    .maybeSingle();

  const ownerId =
    profile?.metadata && typeof profile.metadata === "object"
      ? (profile.metadata as Record<string, unknown>).owner_id
      : null;
  return ownerId === userId;
}

export async function updateFollowUpStatus(
  followUpId: string,
  status: FollowUpStatus,
  options?: { snoozedUntil?: string | null },
): Promise<{ ok: boolean; error?: string }> {
  const supabaseAuth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabaseAuth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const allowed = await assertOwnsFollowUp(followUpId, user.id);
  if (!allowed) return { ok: false, error: "Not found." };

  const supabase = getServiceSupabase();
  if (!supabase) return { ok: false, error: "Database unavailable." };

  const patch: Record<string, unknown> = {
    status,
    updated_at: new Date().toISOString(),
    completed_at: status === "done" ? new Date().toISOString() : null,
  };

  if (status === "snoozed") {
    patch.snoozed_until = options?.snoozedUntil || defaultSnoozeUntil(24);
  } else {
    patch.snoozed_until = null;
  }

  const { error } = await supabase.from("wisecall_follow_ups").update(patch).eq("id", followUpId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/dashboard");
  return { ok: true };
}
