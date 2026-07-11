"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import {
  detectKnowledgeGapsForProfile,
  syncLearnedKnowledgeForProfile,
} from "@/lib/agent-memory";

export type AgentGap = {
  id: string;
  profileId: string;
  agentName: string;
  topic: string;
  questionExamples: string[];
  handling: string | null;
  answer: string | null;
  status: "active" | "answered" | "retired";
  distinctCalls: number;
  lastSeenAt: string;
};

export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

async function requireUser() {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false as const, error: "Not signed in." };
  return { ok: true as const, user };
}

/** All learned knowledge gaps across the signed-in user's agents. */
export async function getAgentGaps(): Promise<Result<AgentGap[]>> {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data: profiles } = await service
    .from("wisecall_profiles")
    .select("id, business_name, clinic_name, profile_name, receptionist_name")
    .eq("metadata->>owner_id", gate.user.id);

  const nameById: Record<string, string> = {};
  for (const p of profiles ?? []) {
    nameById[p.id as string] =
      (p.business_name as string) ||
      (p.clinic_name as string) ||
      (p.profile_name as string) ||
      (p.receptionist_name as string) ||
      "Agent";
  }

  const { data, error } = await service
    .from("wisecall_agent_memory")
    .select(
      "id, profile_id, topic, question_examples, handling, answer, status, distinct_calls, last_seen_at",
    )
    .eq("owner_id", gate.user.id)
    .in("status", ["active", "answered"])
    .order("last_seen_at", { ascending: false })
    .limit(100);

  if (error) return { ok: false, error: error.message };

  const gaps: AgentGap[] = (data ?? []).map((r) => ({
    id: r.id as string,
    profileId: r.profile_id as string,
    agentName: nameById[r.profile_id as string] || "Agent",
    topic: r.topic as string,
    questionExamples: (r.question_examples as string[] | null) ?? [],
    handling: (r.handling as string | null) ?? null,
    answer: (r.answer as string | null) ?? null,
    status: (r.status as AgentGap["status"]) ?? "active",
    distinctCalls: (r.distinct_calls as number) ?? 0,
    lastSeenAt: (r.last_seen_at as string) ?? "",
  }));

  return { ok: true, data: gaps };
}

async function loadOwnedGap(userId: string, gapId: string) {
  const service = getServiceSupabase();
  if (!service) return { service: null, gap: null };
  const { data } = await service
    .from("wisecall_agent_memory")
    .select("id, owner_id, profile_id, status")
    .eq("id", gapId)
    .maybeSingle();
  if (!data || data.owner_id !== userId) return { service, gap: null };
  return { service, gap: data };
}

/** Owner supplies the real answer → becomes factual knowledge the agent states. */
export async function answerAgentGap(gapId: string, answer: string): Promise<Result<null>> {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  const clean = answer.trim();
  if (clean.length < 2) return { ok: false, error: "Add an answer first." };

  const { service, gap } = await loadOwnedGap(gate.user.id, gapId);
  if (!service || !gap) return { ok: false, error: "Not found." };

  const { error } = await service
    .from("wisecall_agent_memory")
    .update({ answer: clean.slice(0, 1500), status: "answered", updated_at: new Date().toISOString() })
    .eq("id", gapId);
  if (error) return { ok: false, error: error.message };

  await syncLearnedKnowledgeForProfile(gap.profile_id as string);
  revalidatePath("/dashboard");
  return { ok: true, data: null };
}

/** Owner dismisses a learned gap; it's removed from the agent's prompt. */
export async function retireAgentGap(gapId: string): Promise<Result<null>> {
  const gate = await requireUser();
  if (!gate.ok) return gate;

  const { service, gap } = await loadOwnedGap(gate.user.id, gapId);
  if (!service || !gap) return { ok: false, error: "Not found." };

  const { error } = await service
    .from("wisecall_agent_memory")
    .update({ status: "retired", updated_at: new Date().toISOString() })
    .eq("id", gapId);
  if (error) return { ok: false, error: error.message };

  await syncLearnedKnowledgeForProfile(gap.profile_id as string);
  revalidatePath("/dashboard");
  return { ok: true, data: null };
}

/** Manual "learn from my calls now" for one of the owner's agents. */
export async function runAgentDetectionNow(profileId: string): Promise<Result<{ created: number; reinforced: number }>> {
  const gate = await requireUser();
  if (!gate.ok) return gate;
  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data: owned } = await service
    .from("wisecall_profiles")
    .select("id")
    .eq("id", profileId)
    .eq("metadata->>owner_id", gate.user.id)
    .maybeSingle();
  if (!owned) return { ok: false, error: "Agent not found." };

  const res = await detectKnowledgeGapsForProfile(profileId);
  if (!res.ok) return { ok: false, error: res.error || "Detection failed." };
  revalidatePath("/dashboard");
  return { ok: true, data: { created: res.created ?? 0, reinforced: res.reinforced ?? 0 } };
}
