import Anthropic from "@anthropic-ai/sdk";
import { getServiceSupabase } from "@/lib/supabase";

// Weekly agent learning: aggregate recent call analyses into actionable
// suggestions the customer can approve (applied to the agent) or dismiss.

const CLAUDE_MODEL = "claude-sonnet-4-6";

export type LearningSuggestionKind = "knowledge" | "prompt" | "routing" | "faq";
export type LearningSuggestionTarget =
  | "business_context"
  | "system_prompt"
  | "routing_note";

export type LearningSuggestion = {
  id: string;
  kind: LearningSuggestionKind;
  title: string;
  rationale: string;
  proposed_text: string;
  target: LearningSuggestionTarget;
  confidence: "high" | "medium" | "low";
};

export type AgentLearningReview = {
  id: string;
  profileId: string;
  agentName: string;
  ownerId: string;
  weekStart: string;
  status: "pending" | "approved" | "dismissed" | "applied";
  summary: string;
  callsAnalysed: number;
  suggestions: LearningSuggestion[];
  createdAt: string;
  reviewedAt: string | null;
  appliedAt: string | null;
};

function getApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_WISECASE || null;
}

export function isLearningConfigured(): boolean {
  return Boolean(getApiKey());
}

/** Monday (UTC) of the ISO week containing `date`. */
export function weekStartUtc(date = new Date()): string {
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const day = d.getUTCDay(); // 0 Sun … 6 Sat
  const diff = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + diff);
  return d.toISOString().slice(0, 10);
}

function strList(value: unknown, max = 8): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max);
}

function normaliseSuggestions(raw: unknown): LearningSuggestion[] {
  if (!Array.isArray(raw)) return [];
  const kinds: LearningSuggestionKind[] = ["knowledge", "prompt", "routing", "faq"];
  const targets: LearningSuggestionTarget[] = [
    "business_context",
    "system_prompt",
    "routing_note",
  ];
  const confidences = ["high", "medium", "low"] as const;

  return raw
    .slice(0, 8)
    .map((item, index) => {
      const r = (item ?? {}) as Record<string, unknown>;
      const kind = kinds.includes(r.kind as LearningSuggestionKind)
        ? (r.kind as LearningSuggestionKind)
        : "knowledge";
      const target = targets.includes(r.target as LearningSuggestionTarget)
        ? (r.target as LearningSuggestionTarget)
        : kind === "prompt"
          ? "system_prompt"
          : kind === "routing"
            ? "routing_note"
            : "business_context";
      const confidence = confidences.includes(r.confidence as (typeof confidences)[number])
        ? (r.confidence as (typeof confidences)[number])
        : "medium";
      const title =
        typeof r.title === "string" && r.title.trim()
          ? r.title.trim().slice(0, 120)
          : `Suggestion ${index + 1}`;
      const rationale =
        typeof r.rationale === "string" ? r.rationale.trim().slice(0, 500) : "";
      const proposed =
        typeof r.proposed_text === "string" ? r.proposed_text.trim().slice(0, 1200) : "";
      if (!proposed) return null;
      return {
        id:
          typeof r.id === "string" && r.id
            ? r.id
            : `sug-${index + 1}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 24)}`,
        kind,
        title,
        rationale,
        proposed_text: proposed,
        target,
        confidence,
      } satisfies LearningSuggestion;
    })
    .filter((s): s is LearningSuggestion => Boolean(s));
}

type CallRow = {
  id: string;
  summary: string | null;
  intent_category: string | null;
  unanswered_question: string | null;
  ai_insight_summary: string | null;
  ai_analysis_json: Record<string, unknown> | null;
  complaint_detected: boolean | null;
  lead_detected: boolean | null;
  booking_detected: boolean | null;
};

function compactCalls(rows: CallRow[]): string {
  return rows
    .slice(0, 40)
    .map((row, i) => {
      const a = row.ai_analysis_json ?? {};
      const unanswered = strList(a.unanswered_questions, 3);
      const missed = strList(a.missed_opportunities, 3);
      const intent =
        (typeof a.caller_intent === "string" && a.caller_intent) ||
        row.intent_category ||
        "unknown";
      const bits = [
        `#${i + 1}`,
        `intent=${intent}`,
        row.complaint_detected ? "complaint" : null,
        row.lead_detected ? "lead" : null,
        row.booking_detected ? "booking" : null,
        row.ai_insight_summary || row.summary
          ? `summary=${(row.ai_insight_summary || row.summary || "").slice(0, 180)}`
          : null,
        unanswered.length ? `unanswered=${unanswered.join("; ")}` : null,
        missed.length ? `missed=${missed.join("; ")}` : null,
        row.unanswered_question ? `q=${row.unanswered_question}` : null,
      ].filter(Boolean);
      return bits.join(" | ");
    })
    .join("\n");
}

async function generateSuggestions(input: {
  businessName: string;
  systemPrompt: string;
  knowledge: string;
  callDigest: string;
  callCount: number;
}): Promise<{ summary: string; suggestions: LearningSuggestion[] }> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("AI learning is not configured (missing Claude API key).");

  const anthropic = new Anthropic({ apiKey });
  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 2000,
    thinking: { type: "disabled" },
    tool_choice: { type: "tool", name: "emit_weekly_learning" },
    tools: [
      {
        name: "emit_weekly_learning",
        description:
          "Return a weekly improvement review for a UK small-business AI receptionist, based on recent call analyses.",
        input_schema: {
          type: "object",
          properties: {
            summary: {
              type: "string",
              description:
                "2–3 sentences for the business owner: what the agent handled well and where to improve.",
            },
            suggestions: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  id: { type: "string" },
                  kind: {
                    type: "string",
                    enum: ["knowledge", "prompt", "routing", "faq"],
                  },
                  title: { type: "string" },
                  rationale: { type: "string" },
                  proposed_text: {
                    type: "string",
                    description:
                      "Concrete text to add to knowledge, prompt, or a routing note. Ready to apply as-is.",
                  },
                  target: {
                    type: "string",
                    enum: ["business_context", "system_prompt", "routing_note"],
                  },
                  confidence: {
                    type: "string",
                    enum: ["high", "medium", "low"],
                  },
                },
                required: [
                  "kind",
                  "title",
                  "rationale",
                  "proposed_text",
                  "target",
                  "confidence",
                ],
              },
            },
          },
          required: ["summary", "suggestions"],
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: `You are reviewing ${input.callCount} analysed calls for "${input.businessName}" to improve their AI receptionist.

Current system prompt (excerpt):
${(input.systemPrompt || "(empty)").slice(0, 2500)}

Current business knowledge (excerpt):
${(input.knowledge || "(empty)").slice(0, 2500)}

Call digest (one line per call):
${input.callDigest}

Rules:
- Suggest only improvements grounded in repeated patterns (unanswered questions, missed opportunities, weak knowledge).
- Prefer knowledge/FAQ additions over rewriting the whole prompt.
- routing_note suggestions should describe screening/transfer behaviour changes in plain English (sales, spam, named-person put-through).
- Do not invent facts about the business. If knowledge is missing, propose a short FAQ the owner can fill in, or a prompt line that tells the agent to take a message when unsure.
- Max 5 high-quality suggestions. Skip low-value fluff.
- Write for a non-technical UK business owner.`,
      },
    ],
  });

  const tool = message.content.find((b) => b.type === "tool_use");
  if (!tool || tool.type !== "tool_use") {
    throw new Error("The AI did not return a weekly learning review.");
  }
  const inputObj = tool.input as Record<string, unknown>;
  const summary =
    typeof inputObj.summary === "string" && inputObj.summary.trim()
      ? inputObj.summary.trim().slice(0, 800)
      : `Reviewed ${input.callCount} calls and found ways to improve the agent.`;
  return {
    summary,
    suggestions: normaliseSuggestions(inputObj.suggestions),
  };
}

type ProfileLite = {
  id: string;
  owner_id: string;
  business_name: string;
  system_prompt: string;
  business_context: string;
  agent_name: string;
};

function mapReview(
  row: {
    id: string;
    profile_id: string;
    owner_id: string;
    week_start: string;
    status: string;
    summary: string | null;
    calls_analysed: number;
    suggestions: unknown;
    created_at: string;
    reviewed_at: string | null;
    applied_at: string | null;
  },
  agentName: string,
): AgentLearningReview {
  const status =
    row.status === "approved" ||
    row.status === "dismissed" ||
    row.status === "applied"
      ? row.status
      : "pending";
  return {
    id: row.id,
    profileId: row.profile_id,
    agentName,
    ownerId: row.owner_id,
    weekStart: row.week_start,
    status,
    summary: row.summary ?? "",
    callsAnalysed: row.calls_analysed ?? 0,
    suggestions: normaliseSuggestions(row.suggestions),
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    appliedAt: row.applied_at,
  };
}

export async function getPendingLearningForUser(
  userId: string,
): Promise<AgentLearningReview[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const { data: profiles } = await supabase
    .from("wisecall_profiles")
    .select("id, business_name, clinic_name, profile_name, receptionist_name")
    .eq("metadata->>owner_id", userId);

  const nameById: Record<string, string> = {};
  for (const p of profiles ?? []) {
    nameById[p.id as string] =
      (p.business_name as string) ||
      (p.clinic_name as string) ||
      (p.profile_name as string) ||
      (p.receptionist_name as string) ||
      "Agent";
  }

  const { data, error } = await supabase
    .from("wisecall_agent_learning")
    .select(
      "id, profile_id, owner_id, week_start, status, summary, calls_analysed, suggestions, created_at, reviewed_at, applied_at",
    )
    .eq("owner_id", userId)
    .eq("status", "pending")
    .order("created_at", { ascending: false })
    .limit(20);

  if (error) {
    console.error("getPendingLearningForUser failed:", error.message);
    return [];
  }

  return (data ?? []).map((row) =>
    mapReview(row as Parameters<typeof mapReview>[0], nameById[row.profile_id] || "Agent"),
  );
}

async function loadActiveProfiles(): Promise<ProfileLite[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("wisecall_profiles")
    .select(
      "id, system_prompt, business_context, business_name, clinic_name, profile_name, receptionist_name, metadata",
    )
    .eq("is_active", true)
    .limit(500);

  if (error) {
    console.error("loadActiveProfiles failed:", error.message);
    return [];
  }

  return (data ?? [])
    .map((row) => {
      const meta = (row.metadata ?? {}) as Record<string, unknown>;
      const ownerId = typeof meta.owner_id === "string" ? meta.owner_id : "";
      if (!ownerId) return null;
      return {
        id: row.id as string,
        owner_id: ownerId,
        business_name:
          (row.business_name as string) ||
          (row.clinic_name as string) ||
          (row.profile_name as string) ||
          "Business",
        system_prompt: (row.system_prompt as string) || "",
        business_context: (row.business_context as string) || "",
        agent_name:
          (row.receptionist_name as string) ||
          (row.profile_name as string) ||
          "Agent",
      } satisfies ProfileLite;
    })
    .filter((p): p is ProfileLite => Boolean(p));
}

/** Run weekly learning for one profile. Skips if a review already exists for this week. */
export async function runWeeklyLearningForProfile(
  profile: ProfileLite,
  options?: { weekStart?: string; lookbackDays?: number; force?: boolean },
): Promise<{ ok: boolean; skipped?: string; reviewId?: string; error?: string }> {
  const supabase = getServiceSupabase();
  if (!supabase) return { ok: false, error: "Server not configured." };
  if (!isLearningConfigured()) return { ok: false, error: "AI learning is not configured." };

  const weekStart = options?.weekStart ?? weekStartUtc();
  const lookbackDays = options?.lookbackDays ?? 7;

  if (!options?.force) {
    const { data: existing } = await supabase
      .from("wisecall_agent_learning")
      .select("id")
      .eq("profile_id", profile.id)
      .eq("week_start", weekStart)
      .maybeSingle();
    if (existing?.id) {
      return { ok: true, skipped: "already_exists", reviewId: existing.id as string };
    }
  }

  const since = new Date();
  since.setUTCDate(since.getUTCDate() - lookbackDays);

  const { data: calls, error: callErr } = await supabase
    .from("wisecall_call_logs")
    .select(
      "id, summary, intent_category, unanswered_question, ai_insight_summary, ai_analysis_json, complaint_detected, lead_detected, booking_detected, analysed_at, created_at",
    )
    .eq("profile_id", profile.id)
    .not("analysed_at", "is", null)
    .gte("created_at", since.toISOString())
    .order("created_at", { ascending: false })
    .limit(40);

  if (callErr) return { ok: false, error: callErr.message };

  const rows = (calls ?? []) as CallRow[];
  if (rows.length < 3) {
    return { ok: true, skipped: "not_enough_calls" };
  }

  let generated: { summary: string; suggestions: LearningSuggestion[] };
  try {
    generated = await generateSuggestions({
      businessName: profile.business_name,
      systemPrompt: profile.system_prompt,
      knowledge: profile.business_context,
      callDigest: compactCalls(rows),
      callCount: rows.length,
    });
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Learning generation failed.",
    };
  }

  if (generated.suggestions.length === 0) {
    return { ok: true, skipped: "no_suggestions" };
  }

  const payload = {
    profile_id: profile.id,
    owner_id: profile.owner_id,
    week_start: weekStart,
    status: "pending",
    summary: generated.summary,
    calls_analysed: rows.length,
    suggestions: generated.suggestions,
  };

  const { data, error } = options?.force
    ? await supabase
        .from("wisecall_agent_learning")
        .upsert(payload, { onConflict: "profile_id,week_start" })
        .select("id")
        .single()
    : await supabase.from("wisecall_agent_learning").insert(payload).select("id").single();

  if (error) return { ok: false, error: error.message };
  return { ok: true, reviewId: data.id as string };
}

export async function runWeeklyLearningForAllAgents(): Promise<{
  ok: boolean;
  processed: number;
  created: number;
  skipped: number;
  errors: string[];
}> {
  const profiles = await loadActiveProfiles();
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const profile of profiles) {
    const result = await runWeeklyLearningForProfile(profile);
    if (!result.ok) {
      errors.push(`${profile.id}: ${result.error || "failed"}`);
      continue;
    }
    if (result.skipped) skipped += 1;
    else if (result.reviewId) created += 1;
  }

  return {
    ok: errors.length === 0,
    processed: profiles.length,
    created,
    skipped,
    errors,
  };
}

/** Apply approved suggestions onto the agent profile (append knowledge / prompt). */
export async function applyLearningReview(
  reviewId: string,
  userId: string,
  options?: { isAdmin?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getServiceSupabase();
  if (!supabase) return { ok: false, error: "Server not configured." };

  const { data: review, error } = await supabase
    .from("wisecall_agent_learning")
    .select(
      "id, profile_id, owner_id, status, suggestions, summary",
    )
    .eq("id", reviewId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!review) return { ok: false, error: "Review not found." };
  if (review.owner_id !== userId && !options?.isAdmin) {
    return { ok: false, error: "You don't have access to this review." };
  }
  if (review.status !== "pending") {
    return { ok: false, error: "This review has already been handled." };
  }

  const { data: profile, error: profileErr } = await supabase
    .from("wisecall_profiles")
    .select("id, system_prompt, business_context, metadata")
    .eq("id", review.profile_id)
    .maybeSingle();

  if (profileErr || !profile) {
    return { ok: false, error: profileErr?.message || "Agent not found." };
  }

  const suggestions = normaliseSuggestions(review.suggestions);
  const knowledgeAdds = suggestions
    .filter((s) => s.target === "business_context")
    .map((s) => s.proposed_text.trim())
    .filter(Boolean);
  const promptAdds = suggestions
    .filter((s) => s.target === "system_prompt")
    .map((s) => s.proposed_text.trim())
    .filter(Boolean);
  const routingNotes = suggestions
    .filter((s) => s.target === "routing_note")
    .map((s) => s.proposed_text.trim())
    .filter(Boolean);

  const meta = {
    ...((profile.metadata ?? {}) as Record<string, unknown>),
  };
  const learningMeta = {
    last_applied_at: new Date().toISOString(),
    last_review_id: reviewId,
    routing_notes: [
      ...((Array.isArray((meta.learning as { routing_notes?: string[] } | undefined)?.routing_notes)
        ? (meta.learning as { routing_notes: string[] }).routing_notes
        : []) as string[]),
      ...routingNotes,
    ].slice(-20),
  };
  meta.learning = learningMeta;

  // Append applied routing notes into business context so the voice agent sees them
  // until the customer edits routing settings explicitly.
  const routingBlock =
    routingNotes.length > 0
      ? `\n\n[Learned routing notes]\n${routingNotes.map((n) => `• ${n}`).join("\n")}`
      : "";

  const nextKnowledge = [
    (profile.business_context as string) || "",
    knowledgeAdds.length
      ? `\n\n[Learned from recent calls]\n${knowledgeAdds.map((n) => `• ${n}`).join("\n")}`
      : "",
    routingBlock,
  ]
    .join("")
    .trim();

  const nextPrompt = [
    (profile.system_prompt as string) || "",
    promptAdds.length
      ? `\n\n[Learned behaviour from recent calls]\n${promptAdds.map((n) => `• ${n}`).join("\n")}`
      : "",
  ]
    .join("")
    .trim();

  const { error: updErr } = await supabase
    .from("wisecall_profiles")
    .update({
      business_context: nextKnowledge,
      system_prompt: nextPrompt,
      metadata: {
        ...meta,
        knowledge: nextKnowledge,
      },
    })
    .eq("id", review.profile_id);

  if (updErr) return { ok: false, error: updErr.message };

  const now = new Date().toISOString();
  const { error: statusErr } = await supabase
    .from("wisecall_agent_learning")
    .update({ status: "applied", reviewed_at: now, applied_at: now })
    .eq("id", reviewId);

  if (statusErr) return { ok: false, error: statusErr.message };
  return { ok: true };
}

export async function dismissLearningReview(
  reviewId: string,
  userId: string,
  options?: { isAdmin?: boolean },
): Promise<{ ok: boolean; error?: string }> {
  const supabase = getServiceSupabase();
  if (!supabase) return { ok: false, error: "Server not configured." };

  const { data: review, error } = await supabase
    .from("wisecall_agent_learning")
    .select("id, owner_id, status")
    .eq("id", reviewId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!review) return { ok: false, error: "Review not found." };
  if (review.owner_id !== userId && !options?.isAdmin) {
    return { ok: false, error: "You don't have access to this review." };
  }
  if (review.status !== "pending") {
    return { ok: false, error: "This review has already been handled." };
  }

  const { error: updErr } = await supabase
    .from("wisecall_agent_learning")
    .update({ status: "dismissed", reviewed_at: new Date().toISOString() })
    .eq("id", reviewId);

  if (updErr) return { ok: false, error: updErr.message };
  return { ok: true };
}
