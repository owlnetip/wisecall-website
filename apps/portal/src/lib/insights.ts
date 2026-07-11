import { getServiceSupabase } from "@/lib/supabase";
import type { CallAnalysis, Sentiment } from "@/lib/call-analysis";
import { calculateConversionRate } from "@/lib/insight-metrics";

// ─────────────────────────────────────────────────────────────────────────────
// WiseCall AI Insights aggregation
//
// Reads the per-call analysis fields (written by lib/call-analysis.ts) and rolls
// them up into the numbers the dashboard shows. This is the ONLY place the
// dashboard gets its data, and every query is tenant-scoped: we resolve the
// signed-in user's owned profile ids first, then only ever read call rows under
// those ids. A customer can never see another tenant's calls.
//
// All aggregation happens server-side; the client just renders the result.
// ─────────────────────────────────────────────────────────────────────────────

export type InsightsRange = "today" | "7d" | "30d";

export const RANGE_LABELS: Record<InsightsRange, string> = {
  today: "Today",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

export function parseRange(value: string | null | undefined): InsightsRange {
  if (value === "today" || value === "7d" || value === "30d") return value;
  return "7d";
}

function rangeStart(range: InsightsRange): Date {
  const now = new Date();
  if (range === "today") {
    const start = new Date(now);
    start.setHours(0, 0, 0, 0);
    return start;
  }
  const days = range === "7d" ? 7 : 30;
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

export type AttentionKind = "complaint" | "urgent" | "unanswered";

export type AttentionItem = {
  callId: string;
  caller: string;
  kind: AttentionKind;
  detail: string;
  startedAt: string;
};

export type LabelCount = { label: string; count: number };

export type CallReference = {
  callId: string;
  caller: string;
  detail: string;
  startedAt: string;
};

export type DashboardInsights = {
  range: InsightsRange;
  generatedAt: string;
  hasAnyCalls: boolean; // any calls ever (across all time), to distinguish "new" vs "quiet range"
  totalCalls: number;
  analysedCalls: number;
  pendingAnalysis: number; // calls in range with a transcript but no analysis yet
  missedOrEscalated: number;
  sentiment: { positive: number; neutral: number; negative: number };
  urgentCount: number;
  complaintCount: number;
  leadCount: number;
  bookingCount: number;
  conversionRate: number; // 0..100, unique calls with a booking or lead signal
  handledByAi: number; // analysed calls where the AI fully resolved without human help
  handledByAiRate: number; // 0..100, handledByAi / analysedCalls
  topReasons: LabelCount[];
  unansweredQuestions: CallReference[];
  opportunities: CallReference[];
  attention: AttentionItem[];
  summary: string; // plain-English "what changed this week" roll-up
};

type InsightRow = {
  id: string;
  caller_id: string | null;
  summary: string | null;
  outcome: string | null;
  started_at: string | null;
  created_at: string | null;
  transcript: string | null;
  sentiment: string | null;
  sentiment_score: number | null;
  intent_category: string | null;
  urgency: string | null;
  complaint_detected: boolean | null;
  lead_detected: boolean | null;
  booking_detected: boolean | null;
  unanswered_question: string | null;
  ai_insight_summary: string | null;
  ai_analysis_json: CallAnalysis | null;
  analysed_at: string | null;
};

const INSIGHT_SELECT =
  "id, caller_id, summary, outcome, started_at, created_at, transcript, sentiment, sentiment_score, intent_category, urgency, complaint_detected, lead_detected, booking_detected, unanswered_question, ai_insight_summary, ai_analysis_json, analysed_at";

export function emptyInsights(range: InsightsRange, hasAnyCalls: boolean): DashboardInsights {
  return {
    range,
    generatedAt: new Date().toISOString(),
    hasAnyCalls,
    totalCalls: 0,
    analysedCalls: 0,
    pendingAnalysis: 0,
    missedOrEscalated: 0,
    sentiment: { positive: 0, neutral: 0, negative: 0 },
    urgentCount: 0,
    complaintCount: 0,
    leadCount: 0,
    bookingCount: 0,
    conversionRate: 0,
    handledByAi: 0,
    handledByAiRate: 0,
    topReasons: [],
    unansweredQuestions: [],
    opportunities: [],
    attention: [],
    summary: hasAnyCalls
      ? "No calls in this period yet. Try a longer date range."
      : "Once your AI agent has handled calls, insights will appear here.",
  };
}

// Fully handled by the AI — no transfer, callback, or escalation needed.
function isHandledByAi(row: InsightRow): boolean {
  return row.ai_analysis_json?.outcome === "resolved";
}

// "Missed / escalated" = the agent could not fully resolve it for the caller.
// Prefer the AI's outcome; fall back to the runtime's free-text outcome.
function isMissedOrEscalated(row: InsightRow): boolean {
  const aiOutcome = row.ai_analysis_json?.outcome;
  if (aiOutcome && aiOutcome !== "resolved" && aiOutcome !== "unknown") return true;
  const text = (row.outcome || "").toLowerCase();
  return /miss|escalat|transfer|callback|call back|failed|voicemail|no answer|unresolved/.test(
    text,
  );
}

function callerLabel(row: InsightRow): string {
  return row.caller_id || "Unknown caller";
}

function buildSummary(i: DashboardInsights): string {
  if (i.totalCalls === 0) return i.summary;
  const parts: string[] = [];
  parts.push(
    `Your AI agent handled ${i.totalCalls} call${i.totalCalls === 1 ? "" : "s"} in this period.`,
  );

  const conversions = i.bookingCount + i.leadCount;
  if (conversions > 0) {
    const bits: string[] = [];
    if (i.bookingCount > 0)
      bits.push(`${i.bookingCount} booking${i.bookingCount === 1 ? "" : "s"}`);
    if (i.leadCount > 0) bits.push(`${i.leadCount} new lead${i.leadCount === 1 ? "" : "s"}`);
    parts.push(`It captured ${bits.join(" and ")} (${i.conversionRate}% conversion).`);
  }

  if (i.analysedCalls > 0) {
    parts.push(
      `It fully handled ${i.handledByAiRate}% of calls without needing you (${i.handledByAi} of ${i.analysedCalls}).`,
    );
  }

  const needsAttention = i.complaintCount + i.urgentCount + i.unansweredQuestions.length;
  if (needsAttention > 0) {
    const bits: string[] = [];
    if (i.complaintCount > 0)
      bits.push(`${i.complaintCount} complaint${i.complaintCount === 1 ? "" : "s"}`);
    if (i.urgentCount > 0) bits.push(`${i.urgentCount} urgent`);
    if (i.unansweredQuestions.length > 0)
      bits.push(`${i.unansweredQuestions.length} unanswered question${i.unansweredQuestions.length === 1 ? "" : "s"}`);
    parts.push(`Needs a look: ${bits.join(", ")}.`);
  } else if (i.analysedCalls > 0) {
    parts.push("Nothing urgent needs your attention.");
  }

  if (i.topReasons[0]) {
    parts.push(`Most people called about ${i.topReasons[0].label.toLowerCase()}.`);
  }

  return parts.join(" ");
}

// Resolves the profile ids owned by this user. Empty array means "no agents".
async function ownedProfileIds(userId: string): Promise<string[]> {
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Insight data is not configured.");
  const { data, error } = await supabase
    .from("wisecall_profiles")
    .select("id")
    .eq("metadata->>owner_id", userId);
  if (error) {
    console.error("getInsightsForUser profiles failed:", error.message);
    throw new Error("Could not load insight ownership.");
  }
  return (data ?? []).map((r) => r.id as string);
}

export async function getInsightsForUser(
  userId: string,
  range: InsightsRange,
): Promise<DashboardInsights> {
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Insight data is not configured.");

  const ids = await ownedProfileIds(userId);
  if (ids.length === 0) return emptyInsights(range, false);

  // Is there any call at all (across all time)? Lets the UI tell "brand new
  // account" apart from "quiet date range".
  const { count: lifetimeCount, error: lifetimeError } = await supabase
    .from("wisecall_call_logs")
    .select("id", { count: "exact", head: true })
    .in("profile_id", ids);
  if (lifetimeError) {
    console.error("getInsightsForUser lifetime count failed:", lifetimeError.message);
    throw new Error("Could not load insight history.");
  }
  const hasAnyCalls = (lifetimeCount ?? 0) > 0;

  const since = rangeStart(range).toISOString();
  const { data, error } = await supabase
    .from("wisecall_call_logs")
    .select(INSIGHT_SELECT)
    .in("profile_id", ids)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(2000);

  if (error) {
    console.error("getInsightsForUser failed:", error.message);
    throw new Error("Could not load insights.");
  }

  const rows = (data as InsightRow[]) ?? [];
  if (rows.length === 0) return emptyInsights(range, hasAnyCalls);

  const result = emptyInsights(range, hasAnyCalls);
  result.totalCalls = rows.length;

  const reasons = new Map<string, number>();

  for (const row of rows) {
    const analysed = Boolean(row.analysed_at);
    const pending = !analysed && Boolean((row.transcript ?? "").trim());
    if (analysed) result.analysedCalls += 1;
    if (pending) result.pendingAnalysis += 1;

    if (isMissedOrEscalated(row)) result.missedOrEscalated += 1;

    const sentiment = (row.sentiment as Sentiment | null) ?? null;
    if (sentiment === "positive") result.sentiment.positive += 1;
    else if (sentiment === "negative") result.sentiment.negative += 1;
    else if (sentiment === "neutral") result.sentiment.neutral += 1;

    if (row.urgency === "high") result.urgentCount += 1;
    if (row.complaint_detected) result.complaintCount += 1;
    if (row.lead_detected) result.leadCount += 1;
    if (row.booking_detected) result.bookingCount += 1;
    if (isHandledByAi(row)) result.handledByAi += 1;

    const reason = (row.intent_category || "").trim();
    if (reason) reasons.set(reason, (reasons.get(reason) ?? 0) + 1);

    if (row.unanswered_question && row.unanswered_question.trim()) {
      result.unansweredQuestions.push({
        callId: row.id,
        caller: callerLabel(row),
        detail: row.unanswered_question.trim(),
        startedAt: row.started_at || row.created_at || "",
      });
    }

    const opportunities = row.ai_analysis_json?.missed_opportunities ?? [];
    for (const opp of opportunities) {
      result.opportunities.push({
        callId: row.id,
        caller: callerLabel(row),
        detail: opp,
        startedAt: row.started_at || row.created_at || "",
      });
    }

    // "Needs attention" prioritises complaints, then urgent, then unanswered.
    if (row.complaint_detected) {
      result.attention.push({
        callId: row.id,
        caller: callerLabel(row),
        kind: "complaint",
        detail: row.ai_insight_summary || row.summary || "Complaint detected.",
        startedAt: row.started_at || row.created_at || "",
      });
    } else if (row.urgency === "high") {
      result.attention.push({
        callId: row.id,
        caller: callerLabel(row),
        kind: "urgent",
        detail: row.ai_insight_summary || row.summary || "Marked urgent.",
        startedAt: row.started_at || row.created_at || "",
      });
    } else if (row.unanswered_question && row.unanswered_question.trim()) {
      result.attention.push({
        callId: row.id,
        caller: callerLabel(row),
        kind: "unanswered",
        detail: row.unanswered_question.trim(),
        startedAt: row.started_at || row.created_at || "",
      });
    }
  }

  result.topReasons = [...reasons.entries()]
    .map(([label, count]) => ({ label, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  result.unansweredQuestions = result.unansweredQuestions.slice(0, 10);
  result.opportunities = result.opportunities.slice(0, 10);
  result.attention = result.attention.slice(0, 12);

  result.conversionRate = calculateConversionRate(
    rows.map((row) => ({ lead: row.lead_detected, booking: row.booking_detected })),
  );
  result.handledByAiRate =
    result.analysedCalls > 0
      ? Math.round((result.handledByAi / result.analysedCalls) * 100)
      : 0;

  result.summary = buildSummary(result);
  return result;
}
