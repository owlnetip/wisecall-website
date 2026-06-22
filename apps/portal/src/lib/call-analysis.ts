import Anthropic from "@anthropic-ai/sdk";
import { getServiceSupabase } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────────────────────
// WiseCall after-call AI analysis
//
// Given a completed call's transcript + summary, this asks Claude for a single,
// strict-JSON verdict and stores it back on the wisecall_call_logs row. The
// dashboard "AI Insights" view then aggregates these stored fields per tenant —
// it never calls the model, so the dashboard stays fast and cheap.
//
// SECURITY: this module is server-only. The prompt and the API key never reach
// the browser. The analysis runs with the service-role Supabase client.
// ─────────────────────────────────────────────────────────────────────────────

const CLAUDE_MODEL = "claude-opus-4-8";

export type Sentiment = "positive" | "neutral" | "negative";
export type Urgency = "low" | "medium" | "high";
export type CallOutcome =
  | "resolved"
  | "transferred"
  | "callback_required"
  | "failed"
  | "unknown";
export type ConversionType =
  | "booking"
  | "lead"
  | "support"
  | "complaint"
  | "sales"
  | "none";

// The strict shape the model must return. Mirrors the "Suggested JSON shape" in
// the feature brief, plus a short normalised `intent_category` so the dashboard
// can group "top reasons people called" cleanly.
export type CallAnalysis = {
  sentiment: Sentiment;
  sentiment_score: number; // 0..100
  caller_intent: string; // free text, what the caller wanted
  intent_category: string; // short label, e.g. "booking", "pricing", "complaint"
  outcome: CallOutcome;
  conversion_type: ConversionType;
  urgency_level: Urgency;
  complaint_detected: boolean;
  lead_detected: boolean;
  booking_detected: boolean;
  unanswered_questions: string[];
  missed_opportunities: string[];
  recommended_follow_up: string;
  short_manager_summary: string;
  tags: string[];
  caller_name: string;
  callback_phone: string;
  company: string;
};

function getApiKey(): string | null {
  // Accept either name so whichever key is set in the environment works.
  return process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_WISECASE || null;
}

export function isAnalysisConfigured(): boolean {
  return Boolean(getApiKey());
}

const SENTIMENTS: Sentiment[] = ["positive", "neutral", "negative"];
const URGENCIES: Urgency[] = ["low", "medium", "high"];
const OUTCOMES: CallOutcome[] = [
  "resolved",
  "transferred",
  "callback_required",
  "failed",
  "unknown",
];
const CONVERSIONS: ConversionType[] = [
  "booking",
  "lead",
  "support",
  "complaint",
  "sales",
  "none",
];

function clampScore(n: unknown): number {
  const v = typeof n === "number" ? n : Number(n);
  if (!Number.isFinite(v)) return 50;
  return Math.max(0, Math.min(100, Math.round(v)));
}

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

function strList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function normalise(raw: Record<string, unknown>): CallAnalysis {
  const str = (k: string): string =>
    typeof raw[k] === "string" ? (raw[k] as string).trim() : "";
  return {
    sentiment: oneOf(raw.sentiment, SENTIMENTS, "neutral"),
    sentiment_score: clampScore(raw.sentiment_score),
    caller_intent: str("caller_intent").slice(0, 280),
    intent_category: (str("intent_category") || "Other").slice(0, 60),
    outcome: oneOf(raw.outcome, OUTCOMES, "unknown"),
    conversion_type: oneOf(raw.conversion_type, CONVERSIONS, "none"),
    urgency_level: oneOf(raw.urgency_level, URGENCIES, "low"),
    complaint_detected: raw.complaint_detected === true,
    lead_detected: raw.lead_detected === true,
    booking_detected: raw.booking_detected === true,
    unanswered_questions: strList(raw.unanswered_questions),
    missed_opportunities: strList(raw.missed_opportunities),
    recommended_follow_up: str("recommended_follow_up").slice(0, 500),
    short_manager_summary: str("short_manager_summary").slice(0, 500),
    tags: strList(raw.tags),
    caller_name: str("caller_name").slice(0, 80),
    callback_phone: str("callback_phone").slice(0, 24),
    company: str("company").slice(0, 80),
  };
}

// Calls Claude and returns a validated CallAnalysis. Uses a forced tool call so
// the model can only ever answer as a single strict-JSON object — there is no
// free-text channel to parse or sanitise.
export async function analyzeTranscript(input: {
  transcript: string;
  summary?: string;
  businessName?: string;
}): Promise<CallAnalysis> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error("AI analysis is not configured (missing Claude API key).");

  const transcript = (input.transcript || "").slice(0, 24000);
  if (transcript.trim().length < 10) {
    throw new Error("Transcript too short to analyse.");
  }

  const anthropic = new Anthropic({ apiKey });

  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    thinking: { type: "disabled" },
    tool_choice: { type: "tool", name: "emit_call_analysis" },
    tools: [
      {
        name: "emit_call_analysis",
        description:
          "Return a single structured analysis of one completed phone/voice call for a UK small business, for a non-technical manager dashboard.",
        input_schema: {
          type: "object",
          properties: {
            sentiment: {
              type: "string",
              enum: SENTIMENTS,
              description: "Overall caller sentiment across the call.",
            },
            sentiment_score: {
              type: "integer",
              description: "0 = very negative, 50 = neutral, 100 = very positive.",
            },
            caller_intent: {
              type: "string",
              description: "One short sentence: what the caller actually wanted.",
            },
            intent_category: {
              type: "string",
              description:
                "A short, reusable category (1-3 words) for grouping reasons people call, e.g. 'Booking', 'Pricing', 'Opening hours', 'Complaint', 'Support', 'New enquiry'. Use Title Case.",
            },
            outcome: {
              type: "string",
              enum: OUTCOMES,
              description: "How the call ended for the caller.",
            },
            conversion_type: {
              type: "string",
              enum: CONVERSIONS,
              description: "The commercial nature of the call, if any.",
            },
            urgency_level: { type: "string", enum: URGENCIES },
            complaint_detected: { type: "boolean" },
            lead_detected: {
              type: "boolean",
              description: "True if the caller is a potential new customer / sales opportunity.",
            },
            booking_detected: {
              type: "boolean",
              description: "True if an appointment/booking was requested or made.",
            },
            unanswered_questions: {
              type: "array",
              items: { type: "string" },
              description:
                "Questions the caller asked that the agent could NOT answer. Empty array if none.",
            },
            missed_opportunities: {
              type: "array",
              items: { type: "string" },
              description:
                "Plain-English notes on lost sales or opportunities the business should know about. Empty array if none.",
            },
            recommended_follow_up: {
              type: "string",
              description: "One plain-English next action for the team, or empty string.",
            },
            short_manager_summary: {
              type: "string",
              description: "One sentence a busy manager can skim. Plain English, no jargon.",
            },
            tags: {
              type: "array",
              items: { type: "string" },
              description: "Up to 5 short topic tags.",
            },
            caller_name: {
              type: "string",
              description:
                "Caller's confirmed name if they gave one, else empty string.",
            },
            callback_phone: {
              type: "string",
              description:
                "Best callback number confirmed on the call (E.164 or UK format), else empty string.",
            },
            company: {
              type: "string",
              description: "Company the caller said they are from, else empty string.",
            },
          },
          required: [
            "sentiment",
            "sentiment_score",
            "caller_intent",
            "intent_category",
            "outcome",
            "conversion_type",
            "urgency_level",
            "complaint_detected",
            "lead_detected",
            "booking_detected",
            "unanswered_questions",
            "missed_opportunities",
            "recommended_follow_up",
            "short_manager_summary",
            "tags",
            "caller_name",
            "callback_phone",
            "company",
          ],
        },
      },
    ],
    messages: [
      {
        role: "user",
        content: [
          input.businessName
            ? `Business: ${input.businessName}`
            : "Business: a UK small business",
          "",
          "Analyse this completed call. Be accurate and conservative — only flag a complaint, lead, booking or unanswered question if the transcript clearly supports it.",
          input.summary ? `\nCall summary (from the system):\n${input.summary}` : "",
          "\n--- TRANSCRIPT ---",
          transcript,
        ].join("\n"),
      },
    ],
  });

  const block = message.content.find((b) => b.type === "tool_use");
  if (!block || block.type !== "tool_use") {
    throw new Error("The AI did not return a structured analysis.");
  }
  return normalise(block.input as Record<string, unknown>);
}

// Maps a validated analysis onto the wisecall_call_logs columns added in
// migration 0008. The full object is also kept in ai_analysis_json so we never
// lose fields that don't have a dedicated column.
export function analysisToColumns(analysis: CallAnalysis): Record<string, unknown> {
  return {
    sentiment: analysis.sentiment,
    sentiment_score: analysis.sentiment_score,
    intent_category: analysis.intent_category,
    urgency: analysis.urgency_level,
    complaint_detected: analysis.complaint_detected,
    lead_detected: analysis.lead_detected,
    booking_detected: analysis.booking_detected,
    unanswered_question: analysis.unanswered_questions[0] ?? null,
    ai_insight_summary: analysis.short_manager_summary,
    ai_analysis_json: analysis,
    analysed_at: new Date().toISOString(),
  };
}

type AnalyzableRow = {
  id: string;
  profile_id: string | null;
  profile_name: string | null;
  caller_id: string | null;
  summary: string | null;
  transcript: string | null;
};

const ANALYZABLE_SELECT =
  "id, profile_id, profile_name, caller_id, summary, transcript";

async function syncContactFromAnalysis(
  row: AnalyzableRow,
  analysis: CallAnalysis,
): Promise<void> {
  const supabase = getServiceSupabase();
  if (!supabase || !row.profile_id) return;

  const phone = (row.caller_id ?? "").replace(/[^\d+]/g, "");
  if (!phone) return;

  const { data: existing } = await supabase
    .from("wisecall_contacts")
    .select("id, name, metadata")
    .eq("profile_id", row.profile_id)
    .eq("phone", phone)
    .maybeSingle();

  if (!existing) return;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (analysis.caller_name && !(existing.name ?? "").trim()) {
    patch.name = analysis.caller_name;
  }

  const meta =
    existing.metadata && typeof existing.metadata === "object"
      ? { ...(existing.metadata as Record<string, unknown>) }
      : {};
  if (analysis.company && !meta.company) meta.company = analysis.company;
  if (analysis.callback_phone) meta.callback_phone = analysis.callback_phone;
  if (analysis.company || analysis.callback_phone) patch.metadata = meta;

  if (Object.keys(patch).length <= 1) return;

  await supabase.from("wisecall_contacts").update(patch).eq("id", existing.id);
}

// Analyses one call by id and stores the result. Returns the analysis, or null
// if the call has no usable transcript. Service-role only.
export async function analyzeAndStoreCall(callId: string): Promise<CallAnalysis | null> {
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");

  const { data, error } = await supabase
    .from("wisecall_call_logs")
    .select(ANALYZABLE_SELECT)
    .eq("id", callId)
    .single();
  if (error) throw new Error(`Could not load call ${callId}: ${error.message}`);

  const row = data as AnalyzableRow;
  if (!row.transcript || row.transcript.trim().length < 10) return null;

  const analysis = await analyzeTranscript({
    transcript: row.transcript,
    summary: row.summary ?? undefined,
    businessName: row.profile_name ?? undefined,
  });

  const { error: updErr } = await supabase
    .from("wisecall_call_logs")
    .update(analysisToColumns(analysis))
    .eq("id", callId);
  if (updErr) throw new Error(`Could not store analysis for ${callId}: ${updErr.message}`);

  await syncContactFromAnalysis(row, analysis);

  return analysis;
}

export type BackfillResult = { analysed: number; remaining: number; errors: number };

// Analyses up to `limit` of a user's calls that have a transcript but no
// analysis yet. Tenant-safe: only ever touches calls under profiles owned by
// `userId`. Used to fill in history the first time a customer opens AI Insights,
// and by the standalone backfill script.
export async function backfillAnalysisForUser(
  userId: string,
  limit = 8,
): Promise<BackfillResult> {
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Supabase is not configured.");
  if (!isAnalysisConfigured()) {
    return { analysed: 0, remaining: 0, errors: 0 };
  }

  const { data: owned } = await supabase
    .from("wisecall_profiles")
    .select("id")
    .eq("metadata->>owner_id", userId);
  const ids = (owned ?? []).map((r) => r.id as string);
  if (ids.length === 0) return { analysed: 0, remaining: 0, errors: 0 };

  // Pending = has a transcript, not yet analysed. Pull one extra to tell the
  // caller whether more work remains after this batch.
  const { data, error } = await supabase
    .from("wisecall_call_logs")
    .select(ANALYZABLE_SELECT)
    .in("profile_id", ids)
    .is("analysed_at", null)
    .not("transcript", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit + 1);
  if (error) throw new Error(`Could not list pending calls: ${error.message}`);

  const rows = (data as AnalyzableRow[]).filter(
    (r) => (r.transcript ?? "").trim().length >= 10,
  );
  const batch = rows.slice(0, limit);

  let analysed = 0;
  let errors = 0;
  for (const row of batch) {
    try {
      const analysis = await analyzeTranscript({
        transcript: row.transcript ?? "",
        summary: row.summary ?? undefined,
        businessName: row.profile_name ?? undefined,
      });
      const { error: updErr } = await supabase
        .from("wisecall_call_logs")
        .update(analysisToColumns(analysis))
        .eq("id", row.id);
      if (updErr) {
        errors += 1;
        console.error(`backfill store failed for ${row.id}:`, updErr.message);
      } else {
        analysed += 1;
      }
    } catch (err) {
      errors += 1;
      console.error(`backfill analyse failed for ${row.id}:`, (err as Error).message);
    }
  }

  return { analysed, remaining: Math.max(0, rows.length - batch.length), errors };
}
