"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { isAdmin } from "@/lib/admin";

export async function updateContactNotes(contactId: string, notes: string) {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  // Verify the contact belongs to one of this user's agents (or admin bypasses)
  if (!isAdmin(user)) {
    const { data: contact } = await service
      .from("wisecall_contacts")
      .select("profile_id")
      .eq("id", contactId)
      .maybeSingle();

    if (!contact) return { ok: false, error: "Contact not found." };

    const { data: profile } = await service
      .from("wisecall_profiles")
      .select("id")
      .eq("id", contact.profile_id)
      .eq("metadata->>owner_id", user.id)
      .maybeSingle();

    if (!profile) return { ok: false, error: "Not your contact." };
  }

  const { error } = await service
    .from("wisecall_contacts")
    .update({ notes, updated_at: new Date().toISOString() })
    .eq("id", contactId);

  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Persist names and caller details inferred from call transcripts. */
export async function backfillInferredContactNames(
  updates: {
    id: string;
    name?: string;
    company?: string;
    callbackPhone?: string;
  }[],
) {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const admin = isAdmin(user);
  let written = 0;

  for (const update of updates) {
    const name = update.name?.trim();
    const company = update.company?.trim();
    const callbackPhone = update.callbackPhone?.trim();
    if (!name && !company && !callbackPhone) continue;

    const { data: contact } = await service
      .from("wisecall_contacts")
      .select("profile_id, name, metadata")
      .eq("id", update.id)
      .maybeSingle();

    if (!contact) continue;

    if (!admin) {
      const { data: profile } = await service
        .from("wisecall_profiles")
        .select("id")
        .eq("id", contact.profile_id)
        .eq("metadata->>owner_id", user.id)
        .maybeSingle();

      if (!profile) continue;
    }

    const patch: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (name && !(contact.name ?? "").trim()) patch.name = name;

    const meta =
      contact.metadata && typeof contact.metadata === "object"
        ? { ...(contact.metadata as Record<string, unknown>) }
        : {};
    if (company && !meta.company) meta.company = company;
    if (callbackPhone) meta.callback_phone = callbackPhone;
    if (company || callbackPhone) patch.metadata = meta;

    const { error } = await service
      .from("wisecall_contacts")
      .update(patch)
      .eq("id", update.id);

    if (!error) written += 1;
  }

  if (written > 0) revalidatePath("/dashboard");
  return { ok: true, written };
}
