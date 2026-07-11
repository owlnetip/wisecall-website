import Anthropic from "@anthropic-ai/sdk";
import { getServiceSupabase } from "@/lib/supabase";

// Continuous, autonomous agent learning (slice 1: knowledge gaps).
//
// The agent notices questions callers repeatedly ask that it could not answer,
// then — without being asked — starts handling them gracefully (take a message,
// offer a callback, never guess) and surfaces a one-tap "add the answer" gap to
// the owner. The wisecall_agent_memory rows are the source of truth; the prompt's
// learned block is REBUILT from them each sync (bounded + deduped, never
// append-forever), so it's fully reversible.
//
// Hard safety rule: the graceful *handling* line is auto-applied, because it can
// only tell the agent NOT to guess. The *answer* (a factual claim) is only ever
// written by the owner — never by AI.

const CLAUDE_MODEL = "claude-sonnet-4-6";

// A topic must recur in at least this many distinct calls before the agent
// adopts a handling line for it — so one odd call can never move behaviour.
export const MIN_DISTINCT_CALLS = 2;
// Active gaps not reinforced in this many days are retired (kept if answered).
export const STALE_AFTER_DAYS = 45;
// Cap on learned lines injected into the prompt, to keep it bounded.
export const MAX_LEARNED_LINES = 15;

export const LEARNED_START = "〈── Learned from your recent calls (auto-updated) ──〉";
export const LEARNED_END = "〈── end learned ──〉";

export type MemoryStatus = "active" | "answered" | "retired";

export type AgentMemoryEntry = {
  id: string;
  profileId: string;
  topic: string;
  questionExamples: string[];
  handling: string | null;
  answer: string | null;
  status: MemoryStatus;
  distinctCalls: number;
  timesSeen: number;
  lastSeenAt: string;
};

// ── Pure helpers (no I/O — unit tested) ────────────────────────────────────

/** Normalise a topic label for stable dedup/upsert keys. */
export function normaliseTopic(topic: string): string {
  return topic.trim().replace(/\s+/g, " ").slice(0, 120);
}

/** Remove any previously-synced learned block so sync is idempotent. */
export function stripLearnedBlock(businessContext: string): string {
  if (!businessContext) return "";
  const start = businessContext.indexOf(LEARNED_START);
  if (start === -1) return businessContext.trim();
  const endMarker = businessContext.indexOf(LEARNED_END, start);
  const end = endMarker === -1 ? businessContext.length : endMarker + LEARNED_END.length;
  return (businessContext.slice(0, start) + businessContext.slice(end)).trim();
}

/**
 * Rank + cap active/answered entries into the lines the agent will follow.
 * Answered gaps become factual knowledge (owner-provided); still-open gaps
 * become graceful-handling behaviour.
 */
export function buildLearnedBlock(entries: AgentMemoryEntry[]): string {
  const usable = entries
    .filter((e) => e.status === "answered" || e.status === "active")
    .filter((e) => (e.status === "answered" ? Boolean(e.answer?.trim()) : Boolean(e.handling?.trim())));

  const ranked = usable
    .map((e) => ({
      e,
      // answered first, then most-recently-reinforced and most-frequent.
      score:
        (e.status === "answered" ? 1e9 : 0) +
        new Date(e.lastSeenAt).getTime() / 1e6 +
        e.distinctCalls,
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, MAX_LEARNED_LINES)
    .map(({ e }) => e);

  const lines = ranked
    .map((e) =>
      e.status === "answered" && e.answer?.trim()
        ? `• ${normaliseTopic(e.topic)}: ${e.answer.trim()}`
        : e.handling?.trim()
          ? `• ${e.handling.trim()}`
          : null,
    )
    .filter((l): l is string => Boolean(l));

  return lines.join("\n");
}

/**
 * Compose the field the runtime reads: the owner's knowledge with a freshly
 * regenerated learned block appended. Idempotent — strips the old block first.
 */
export function composeBusinessContext(currentBusinessContext: string, learnedBlock: string): string {
  const owner = stripLearnedBlock(currentBusinessContext || "");
  if (!learnedBlock.trim()) return owner;
  return `${owner}${owner ? "\n\n" : ""}${LEARNED_START}\n${learnedBlock.trim()}\n${LEARNED_END}`;
}

type ClusterInput = { callId: string; question: string };
export type TopicCluster = {
  topic: string;
  examples: string[];
  handling: string;
  callIds: string[];
};

/**
 * Convert Claude's grouping (topics + source indices) into clusters with the
 * distinct source call IDs resolved. Pure so it can be unit tested.
 */
export function resolveClusters(
  inputs: ClusterInput[],
  groups: { topic?: unknown; examples?: unknown; handling?: unknown; source_indices?: unknown }[],
): TopicCluster[] {
  const out: TopicCluster[] = [];
  for (const g of groups) {
    const topic = typeof g.topic === "string" ? normaliseTopic(g.topic) : "";
    const handling = typeof g.handling === "string" ? g.handling.trim().slice(0, 400) : "";
    if (!topic || !handling) continue;
    const idxs = Array.isArray(g.source_indices) ? g.source_indices : [];
    const callIds = new Set<string>();
    for (const idx of idxs) {
      const n = typeof idx === "number" ? idx : parseInt(String(idx), 10);
      const row = Number.isInteger(n) ? inputs[n] : undefined;
      if (row) callIds.add(row.callId);
    }
    const examples = (Array.isArray(g.examples) ? g.examples : [])
      .filter((x): x is string => typeof x === "string")
      .map((x) => x.trim())
      .filter(Boolean)
      .slice(0, 3);
    out.push({ topic, examples, handling, callIds: [...callIds] });
  }
  return out;
}

// ── Claude clustering ──────────────────────────────────────────────────────

function getApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_WISECASE || null;
}

export function isMemoryConfigured(): boolean {
  return Boolean(getApiKey());
}

export async function clusterUnansweredQuestions(
  businessName: string,
  inputs: ClusterInput[],
): Promise<TopicCluster[]> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("Agent learning is not configured (missing Claude API key).");

  const numbered = inputs.map((it, i) => `${i}. ${it.question}`).join("\n");
  const anthropic = new Anthropic({ apiKey });
  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1500,
    thinking: { type: "disabled" },
    tool_choice: { type: "tool", name: "emit_knowledge_gaps" },
    tools: [
      {
        name: "emit_knowledge_gaps",
        description:
          "Group caller questions the AI receptionist could not answer into recurring topics, and for each give a graceful handling instruction.",
        input_schema: {
          type: "object",
          properties: {
            groups: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  topic: {
                    type: "string",
                    description: "Short topic label, e.g. 'Upcoming fixtures & ticket prices'.",
                  },
                  examples: {
                    type: "array",
                    items: { type: "string" },
                    description: "1–3 representative caller phrasings from the list.",
                  },
                  source_indices: {
                    type: "array",
                    items: { type: "integer" },
                    description: "The list numbers of every question belonging to this topic.",
                  },
                  handling: {
                    type: "string",
                    description:
                      "One instruction for how the agent should handle this WITHOUT inventing facts: acknowledge, take a message / offer a callback, point to the website if relevant. NEVER include specific answers (dates, prices, availability) — those change and must not be guessed.",
                  },
                },
                required: ["topic", "examples", "source_indices", "handling"],
              },
            },
          },
          required: ["groups"],
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: `These are questions callers asked "${businessName}"'s AI receptionist that it could NOT answer. Group them into recurring topics (merge different phrasings of the same thing). For each topic write a graceful handling instruction.

Hard rule: the handling must NOT contain any factual answer (no dates, prices, availability, names) — the agent doesn't know them and must not guess. Handling = how to respond helpfully anyway (acknowledge, take a message, offer a callback, or point to the website).

Questions:
${numbered}`,
      },
    ],
  });

  const tool = message.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") return [];
  const groups = (tool.input as { groups?: unknown }).groups;
  return resolveClusters(inputs, Array.isArray(groups) ? (groups as never[]) : []);
}

// ── DB: detect, reinforce, decay, sync ─────────────────────────────────────

type ProfileLite = {
  id: string;
  ownerId: string;
  businessName: string;
  businessContext: string;
};

async function loadProfile(profileId: string): Promise<ProfileLite | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("wisecall_profiles")
    .select("id, business_name, clinic_name, profile_name, business_context, metadata")
    .eq("id", profileId)
    .maybeSingle();
  if (!data) return null;
  const meta = (data.metadata ?? {}) as Record<string, unknown>;
  const ownerId = typeof meta.owner_id === "string" ? meta.owner_id : "";
  if (!ownerId) return null;
  return {
    id: data.id as string,
    ownerId,
    businessName:
      (data.business_name as string) || (data.clinic_name as string) || (data.profile_name as string) || "Business",
    businessContext: (data.business_context as string) || "",
  };
}

/** Detect + reinforce knowledge gaps for one profile from its recent calls. */
export async function detectKnowledgeGapsForProfile(
  profileId: string,
  options?: { lookbackDays?: number },
): Promise<{ ok: boolean; created?: number; reinforced?: number; skipped?: string; error?: string }> {
  const supabase = getServiceSupabase();
  if (!supabase) return { ok: false, error: "Server not configured." };
  if (!isMemoryConfigured()) return { ok: false, error: "Agent learning is not configured." };

  const profile = await loadProfile(profileId);
  if (!profile) return { ok: false, error: "Agent not found." };

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - (options?.lookbackDays ?? 30));

  const { data: calls, error: callErr } = await supabase
    .from("wisecall_call_logs")
    .select("id, ai_analysis_json, created_at")
    .eq("profile_id", profileId)
    .not("analysed_at", "is", null)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(200);
  if (callErr) return { ok: false, error: callErr.message };

  const inputs: ClusterInput[] = [];
  for (const c of calls ?? []) {
    const a = (c.ai_analysis_json ?? {}) as Record<string, unknown>;
    const qs = Array.isArray(a.unanswered_questions) ? a.unanswered_questions : [];
    for (const q of qs) {
      if (typeof q === "string" && q.trim()) inputs.push({ callId: c.id as string, question: q.trim() });
    }
  }
  if (inputs.length < MIN_DISTINCT_CALLS) return { ok: true, skipped: "not_enough_signal" };

  let clusters: TopicCluster[];
  try {
    clusters = await clusterUnansweredQuestions(profile.businessName, inputs);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Clustering failed." };
  }

  const now = new Date().toISOString();
  let created = 0;
  let reinforced = 0;

  for (const cluster of clusters) {
    if (cluster.callIds.length < MIN_DISTINCT_CALLS) continue;

    const { data: existing } = await supabase
      .from("wisecall_agent_memory")
      .select("id, status, question_examples, distinct_calls, times_seen, source_call_ids")
      .eq("profile_id", profileId)
      .eq("topic", cluster.topic)
      .maybeSingle();

    if (existing) {
      // Reinforce. Never overwrite an owner-provided answer or a retired choice.
      const mergedExamples = Array.from(
        new Set([...(existing.question_examples as string[] | null ?? []), ...cluster.examples]),
      ).slice(0, 5);
      const mergedCalls = Array.from(
        new Set([...((existing.source_call_ids as string[] | null) ?? []), ...cluster.callIds]),
      ).slice(-50);
      const patch: Record<string, unknown> = {
        question_examples: mergedExamples,
        distinct_calls: Math.max(existing.distinct_calls ?? 0, cluster.callIds.length),
        times_seen: (existing.times_seen ?? 0) + cluster.callIds.length,
        source_call_ids: mergedCalls,
        last_seen_at: now,
        updated_at: now,
      };
      // Re-activate a stale gap that recurs; leave 'answered' as-is.
      if (existing.status === "retired") patch.status = "active";
      if (existing.status !== "answered") patch.handling = cluster.handling;
      await supabase.from("wisecall_agent_memory").update(patch).eq("id", existing.id);
      reinforced += 1;
    } else {
      await supabase.from("wisecall_agent_memory").insert({
        profile_id: profileId,
        owner_id: profile.ownerId,
        kind: "knowledge_gap",
        topic: cluster.topic,
        question_examples: cluster.examples,
        handling: cluster.handling,
        status: "active",
        confidence: cluster.callIds.length >= 4 ? "high" : "medium",
        distinct_calls: cluster.callIds.length,
        times_seen: cluster.callIds.length,
        source_call_ids: cluster.callIds.slice(-50),
        first_seen_at: now,
        last_seen_at: now,
      });
      created += 1;
    }
  }

  // Decay: retire still-open gaps not reinforced recently (answered gaps stay).
  const staleCutoff = new Date();
  staleCutoff.setUTCDate(staleCutoff.getUTCDate() - STALE_AFTER_DAYS);
  await supabase
    .from("wisecall_agent_memory")
    .update({ status: "retired", updated_at: now })
    .eq("profile_id", profileId)
    .eq("status", "active")
    .lt("last_seen_at", staleCutoff.toISOString());

  await syncLearnedKnowledgeForProfile(profileId);
  return { ok: true, created, reinforced };
}

/** Rebuild the learned block from active/answered memory and write it into the
 *  profile's business_context (idempotent). The live runtime reads this field. */
export async function syncLearnedKnowledgeForProfile(
  profileId: string,
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getServiceSupabase();
  if (!supabase) return { ok: false, error: "Server not configured." };

  const { data: rows, error } = await supabase
    .from("wisecall_agent_memory")
    .select("id, profile_id, topic, question_examples, handling, answer, status, distinct_calls, times_seen, last_seen_at")
    .eq("profile_id", profileId)
    .in("status", ["active", "answered"]);
  if (error) return { ok: false, error: error.message };

  const entries: AgentMemoryEntry[] = (rows ?? []).map((r) => ({
    id: r.id as string,
    profileId: r.profile_id as string,
    topic: r.topic as string,
    questionExamples: (r.question_examples as string[] | null) ?? [],
    handling: (r.handling as string | null) ?? null,
    answer: (r.answer as string | null) ?? null,
    status: r.status as MemoryStatus,
    distinctCalls: (r.distinct_calls as number) ?? 0,
    timesSeen: (r.times_seen as number) ?? 0,
    lastSeenAt: (r.last_seen_at as string) ?? new Date().toISOString(),
  }));

  const { data: profileRow } = await supabase
    .from("wisecall_profiles")
    .select("business_context")
    .eq("id", profileId)
    .maybeSingle();

  const block = buildLearnedBlock(entries);
  const next = composeBusinessContext((profileRow?.business_context as string) || "", block);

  const { error: updErr } = await supabase
    .from("wisecall_profiles")
    .update({ business_context: next })
    .eq("id", profileId);
  if (updErr) return { ok: false, error: updErr.message };
  return { ok: true };
}

/** Run detection across all active agents (called from the daily cron). */
export async function detectKnowledgeGapsForAllAgents(): Promise<{
  ok: boolean;
  processed: number;
  created: number;
  reinforced: number;
  errors: string[];
}> {
  const supabase = getServiceSupabase();
  if (!supabase) return { ok: false, processed: 0, created: 0, reinforced: 0, errors: ["no supabase"] };

  const { data: profiles } = await supabase
    .from("wisecall_profiles")
    .select("id, metadata")
    .eq("is_active", true)
    .limit(500);

  let created = 0;
  let reinforced = 0;
  const errors: string[] = [];
  let processed = 0;

  for (const p of profiles ?? []) {
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    if (typeof meta.owner_id !== "string") continue;
    processed += 1;
    const res = await detectKnowledgeGapsForProfile(p.id as string);
    if (!res.ok) errors.push(`${p.id}: ${res.error}`);
    else {
      created += res.created ?? 0;
      reinforced += res.reinforced ?? 0;
    }
  }

  return { ok: errors.length === 0, processed, created, reinforced, errors };
}
