"use server";

import { revalidatePath } from "next/cache";
import { isAdmin } from "@/lib/admin";
import { getServiceSupabase } from "@/lib/supabase";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { renderObjective } from "@/lib/csv";

// Server actions for AI outbound call blasts (service-only v1). Mirrors the
// access/service-role pattern in knowledge-base.ts: all DB work uses the service
// client, and per-agent actions verify ownership via getAccessibleProfile.

export type OutboundTemplate = {
  id: string;
  name: string;
  purpose: string;
  category: string;
  objectiveTemplate: string;
  isSystem: boolean;
};

export type OutboundRecipientInput = {
  toNumber: string;
  contactName?: string;
  mergeFields?: Record<string, string>;
};

export type OutboundCallRow = {
  id: string;
  toNumber: string;
  contactName: string | null;
  status: string;
  attempts: number;
  outcome: Record<string, unknown>;
  lastAttemptAt: string | null;
};

export type OutboundBlast = {
  id: string;
  name: string;
  status: string;
  templateId: string | null;
  scheduledAt: string | null;
  createdAt: string;
  stats: Record<string, unknown>;
};

export type DncEntry = { id: string; number: string; reason: string | null; createdAt: string };

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

type ProfileRow = { id: string; metadata: Record<string, unknown> | null };

async function readUser() {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  return user;
}

async function getAccessibleProfile(
  agentId: string,
): Promise<{ ok: true; ownerId: string } | { ok: false; error: string }> {
  const user = await readUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data, error } = await service
    .from("wisecall_profiles")
    .select("id, metadata")
    .eq("id", agentId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!data) return { ok: false, error: "Agent not found." };

  const row = data as ProfileRow;
  const ownerId = (row.metadata?.owner_id as string | undefined) ?? "";
  if (ownerId !== user.id && !isAdmin(user)) {
    return { ok: false, error: "You don't have access to this agent." };
  }
  return { ok: true, ownerId: ownerId || user.id };
}

// ---- Templates -----------------------------------------------------------
export async function listOutboundTemplates(): Promise<Result<OutboundTemplate[]>> {
  const user = await readUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data, error } = await service
    .from("wisecall_outbound_templates")
    .select("id, name, purpose, category, objective_template, is_system, owner_id")
    .or(`is_system.eq.true,owner_id.eq.${user.id}`)
    .order("is_system", { ascending: false })
    .order("name", { ascending: true });
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.id as string,
      name: (r.name as string) ?? "",
      purpose: (r.purpose as string) ?? "custom",
      category: (r.category as string) ?? "service",
      objectiveTemplate: (r.objective_template as string) ?? "",
      isSystem: Boolean(r.is_system),
    })),
  };
}

export async function saveOutboundTemplate(input: {
  id?: string;
  name: string;
  purpose?: string;
  objectiveTemplate: string;
}): Promise<Result<{ id: string }>> {
  const user = await readUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const name = input.name.trim();
  const objective = input.objectiveTemplate.trim();
  if (!name || objective.length < 10) {
    return { ok: false, error: "Give the template a name and an objective." };
  }
  const purpose = ["reminder", "service_notice", "renewal", "custom"].includes(input.purpose || "")
    ? input.purpose
    : "custom";

  if (input.id) {
    // Only the owner's own (non-system) templates are editable.
    const { data: existing } = await service
      .from("wisecall_outbound_templates")
      .select("owner_id, is_system")
      .eq("id", input.id)
      .maybeSingle();
    if (!existing || existing.is_system || existing.owner_id !== user.id) {
      return { ok: false, error: "You can't edit that template (clone it instead)." };
    }
    const { error } = await service
      .from("wisecall_outbound_templates")
      .update({ name, purpose, objective_template: objective })
      .eq("id", input.id);
    if (error) return { ok: false, error: error.message };
    revalidatePath("/dashboard");
    return { ok: true, data: { id: input.id } };
  }

  const { data, error } = await service
    .from("wisecall_outbound_templates")
    .insert({ owner_id: user.id, name, purpose, objective_template: objective, is_system: false })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard");
  return { ok: true, data: { id: data.id as string } };
}

export async function deleteOutboundTemplate(id: string): Promise<Result<null>> {
  const user = await readUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };
  const { error } = await service
    .from("wisecall_outbound_templates")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id)
    .eq("is_system", false);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard");
  return { ok: true, data: null };
}

// ---- Blasts --------------------------------------------------------------
export async function createBlast(input: {
  agentId: string;
  name: string;
  templateId?: string;
  objective: string; // resolved template body (may include {{tokens}})
  scheduledAt?: string | null; // ISO; null/absent = run now
  quietHoursStart?: number;
  quietHoursEnd?: number;
  maxAttempts?: number;
  recipients: OutboundRecipientInput[];
}): Promise<Result<{ blastId: string; queued: number }>> {
  const access = await getAccessibleProfile(input.agentId);
  if (!access.ok) return access;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const recipients = (input.recipients || []).filter((r) => (r.toNumber || "").trim());
  if (!recipients.length) return { ok: false, error: "Add at least one recipient." };
  if (input.objective.trim().length < 10) return { ok: false, error: "The objective looks empty." };

  const { data: blast, error: blastErr } = await service
    .from("wisecall_outbound_blasts")
    .insert({
      profile_id: input.agentId,
      template_id: input.templateId ?? null,
      name: input.name.trim() || "Outbound blast",
      status: "scheduled",
      scheduled_at: input.scheduledAt ?? new Date().toISOString(),
      quiet_hours_start: input.quietHoursStart ?? 8,
      quiet_hours_end: input.quietHoursEnd ?? 21,
      max_attempts: input.maxAttempts ?? 2,
      created_by: access.ownerId,
    })
    .select("id")
    .single();
  if (blastErr) return { ok: false, error: blastErr.message };

  const blastId = blast.id as string;
  const rows = recipients.map((r) => {
    const fields = { ...(r.mergeFields || {}), name: r.contactName || r.mergeFields?.name || "" };
    return {
      blast_id: blastId,
      profile_id: input.agentId,
      to_number: r.toNumber.trim(),
      contact_name: r.contactName || null,
      merge_fields: fields,
      rendered_objective: renderObjective(input.objective, fields),
      status: "queued",
    };
  });

  // Insert in chunks to stay well under payload limits on large lists.
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await service.from("wisecall_outbound_calls").insert(rows.slice(i, i + 500));
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/dashboard");
  return { ok: true, data: { blastId, queued: rows.length } };
}

export async function listBlasts(agentId: string): Promise<Result<OutboundBlast[]>> {
  const access = await getAccessibleProfile(agentId);
  if (!access.ok) return access;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data, error } = await service
    .from("wisecall_outbound_blasts")
    .select("id, name, status, template_id, scheduled_at, created_at, stats")
    .eq("profile_id", agentId)
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.id as string,
      name: (r.name as string) ?? "",
      status: (r.status as string) ?? "draft",
      templateId: (r.template_id as string) ?? null,
      scheduledAt: (r.scheduled_at as string) ?? null,
      createdAt: (r.created_at as string) ?? "",
      stats: (r.stats as Record<string, unknown>) ?? {},
    })),
  };
}

export async function getBlastResults(blastId: string): Promise<Result<OutboundCallRow[]>> {
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data: blast } = await service
    .from("wisecall_outbound_blasts")
    .select("profile_id")
    .eq("id", blastId)
    .maybeSingle();
  if (!blast) return { ok: false, error: "Blast not found." };
  const access = await getAccessibleProfile(blast.profile_id as string);
  if (!access.ok) return access;

  const { data, error } = await service
    .from("wisecall_outbound_calls")
    .select("id, to_number, contact_name, status, attempts, outcome, last_attempt_at")
    .eq("blast_id", blastId)
    .order("created_at", { ascending: true });
  if (error) return { ok: false, error: error.message };

  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.id as string,
      toNumber: (r.to_number as string) ?? "",
      contactName: (r.contact_name as string) ?? null,
      status: (r.status as string) ?? "queued",
      attempts: (r.attempts as number) ?? 0,
      outcome: (r.outcome as Record<string, unknown>) ?? {},
      lastAttemptAt: (r.last_attempt_at as string) ?? null,
    })),
  };
}

export async function cancelBlast(blastId: string): Promise<Result<null>> {
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };
  const { data: blast } = await service
    .from("wisecall_outbound_blasts")
    .select("profile_id")
    .eq("id", blastId)
    .maybeSingle();
  if (!blast) return { ok: false, error: "Blast not found." };
  const access = await getAccessibleProfile(blast.profile_id as string);
  if (!access.ok) return access;

  await service.from("wisecall_outbound_blasts").update({ status: "cancelled" }).eq("id", blastId);
  // Stop anything not already dialled.
  await service
    .from("wisecall_outbound_calls")
    .update({ status: "cancelled" })
    .eq("blast_id", blastId)
    .eq("status", "queued");
  revalidatePath("/dashboard");
  return { ok: true, data: null };
}

// ---- Do-not-call ---------------------------------------------------------
export async function listDnc(): Promise<Result<DncEntry[]>> {
  const user = await readUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };
  const { data, error } = await service
    .from("wisecall_outbound_dnc")
    .select("id, number, reason, created_at")
    .eq("owner_id", user.id)
    .order("created_at", { ascending: false });
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    data: (data ?? []).map((r) => ({
      id: r.id as string,
      number: (r.number as string) ?? "",
      reason: (r.reason as string) ?? null,
      createdAt: (r.created_at as string) ?? "",
    })),
  };
}

export async function addDnc(number: string, reason?: string): Promise<Result<null>> {
  const user = await readUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };
  const n = number.trim();
  if (!n) return { ok: false, error: "Enter a number." };
  const { error } = await service
    .from("wisecall_outbound_dnc")
    .upsert({ owner_id: user.id, number: n, reason: reason || null }, { onConflict: "owner_id,number" });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard");
  return { ok: true, data: null };
}

export async function removeDnc(id: string): Promise<Result<null>> {
  const user = await readUser();
  if (!user) return { ok: false, error: "Not signed in." };
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };
  const { error } = await service
    .from("wisecall_outbound_dnc")
    .delete()
    .eq("id", id)
    .eq("owner_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/dashboard");
  return { ok: true, data: null };
}
