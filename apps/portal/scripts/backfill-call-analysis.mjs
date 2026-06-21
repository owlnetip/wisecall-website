// Backfill AI analysis for calls that have a transcript but no analysis yet.
//
// Usage (from apps/portal):
//   node scripts/backfill-call-analysis.mjs [--limit=200] [--owner=<auth-user-id>]
//
// Requires the same env the app uses:
//   SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL), SUPABASE_SERVICE_ROLE_KEY,
//   ANTHROPIC_API_KEY (or CLAUDE_API_WISECASE)
//
// This is operational tooling. The dashboard also backfills on demand via
// /api/insights/backfill, but this lets you process a large history in one go.

import { createClient } from "@supabase/supabase-js";
import Anthropic from "@anthropic-ai/sdk";

const CLAUDE_MODEL = "claude-opus-4-8";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ""), true];
  }),
);
const limit = Number(args.limit) || 200;
const ownerFilter = typeof args.owner === "string" ? args.owner : null;

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = process.env.ANTHROPIC_API_KEY || process.env.CLAUDE_API_WISECASE;

if (!url || !serviceKey) {
  console.error("Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}
if (!apiKey) {
  console.error("Missing ANTHROPIC_API_KEY / CLAUDE_API_WISECASE.");
  process.exit(1);
}

const supabase = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const anthropic = new Anthropic({ apiKey });

const SENTIMENTS = ["positive", "neutral", "negative"];
const URGENCIES = ["low", "medium", "high"];
const OUTCOMES = ["resolved", "transferred", "callback_required", "failed", "unknown"];
const CONVERSIONS = ["booking", "lead", "support", "complaint", "sales", "none"];

const TOOL = {
  name: "emit_call_analysis",
  description:
    "Return a single structured analysis of one completed phone/voice call for a UK small business.",
  input_schema: {
    type: "object",
    properties: {
      sentiment: { type: "string", enum: SENTIMENTS },
      sentiment_score: { type: "integer" },
      caller_intent: { type: "string" },
      intent_category: { type: "string" },
      outcome: { type: "string", enum: OUTCOMES },
      conversion_type: { type: "string", enum: CONVERSIONS },
      urgency_level: { type: "string", enum: URGENCIES },
      complaint_detected: { type: "boolean" },
      lead_detected: { type: "boolean" },
      booking_detected: { type: "boolean" },
      unanswered_questions: { type: "array", items: { type: "string" } },
      missed_opportunities: { type: "array", items: { type: "string" } },
      recommended_follow_up: { type: "string" },
      short_manager_summary: { type: "string" },
      tags: { type: "array", items: { type: "string" } },
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
    ],
  },
};

const clamp = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 50)));
const oneOf = (v, allowed, fb) => (allowed.includes(v) ? v : fb);
const strList = (v) =>
  Array.isArray(v) ? v.filter((s) => typeof s === "string" && s.trim()).slice(0, 10) : [];

function normalise(raw) {
  return {
    sentiment: oneOf(raw.sentiment, SENTIMENTS, "neutral"),
    sentiment_score: clamp(raw.sentiment_score),
    caller_intent: String(raw.caller_intent || "").slice(0, 280),
    intent_category: String(raw.intent_category || "Other").slice(0, 60),
    outcome: oneOf(raw.outcome, OUTCOMES, "unknown"),
    conversion_type: oneOf(raw.conversion_type, CONVERSIONS, "none"),
    urgency_level: oneOf(raw.urgency_level, URGENCIES, "low"),
    complaint_detected: raw.complaint_detected === true,
    lead_detected: raw.lead_detected === true,
    booking_detected: raw.booking_detected === true,
    unanswered_questions: strList(raw.unanswered_questions),
    missed_opportunities: strList(raw.missed_opportunities),
    recommended_follow_up: String(raw.recommended_follow_up || "").slice(0, 500),
    short_manager_summary: String(raw.short_manager_summary || "").slice(0, 500),
    tags: strList(raw.tags),
  };
}

async function analyse(row) {
  const message = await anthropic.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: 1200,
    thinking: { type: "disabled" },
    tool_choice: { type: "tool", name: "emit_call_analysis" },
    tools: [TOOL],
    messages: [
      {
        role: "user",
        content: [
          `Business: ${row.profile_name || "a UK small business"}`,
          "",
          "Analyse this completed call. Be accurate and conservative.",
          row.summary ? `\nCall summary:\n${row.summary}` : "",
          "\n--- TRANSCRIPT ---",
          String(row.transcript || "").slice(0, 24000),
        ].join("\n"),
      },
    ],
  });
  const block = message.content.find((b) => b.type === "tool_use");
  if (!block) throw new Error("No structured analysis returned.");
  return normalise(block.input);
}

function toColumns(a) {
  return {
    sentiment: a.sentiment,
    sentiment_score: a.sentiment_score,
    intent_category: a.intent_category,
    urgency: a.urgency_level,
    complaint_detected: a.complaint_detected,
    lead_detected: a.lead_detected,
    booking_detected: a.booking_detected,
    unanswered_question: a.unanswered_questions[0] ?? null,
    ai_insight_summary: a.short_manager_summary,
    ai_analysis_json: a,
    analysed_at: new Date().toISOString(),
  };
}

async function main() {
  let profileIds = null;
  if (ownerFilter) {
    const { data } = await supabase
      .from("wisecall_profiles")
      .select("id")
      .eq("metadata->>owner_id", ownerFilter);
    profileIds = (data || []).map((r) => r.id);
    if (profileIds.length === 0) {
      console.log("No agents for that owner.");
      return;
    }
  }

  let query = supabase
    .from("wisecall_call_logs")
    .select("id, profile_id, profile_name, summary, transcript")
    .is("analysed_at", null)
    .not("transcript", "is", null)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (profileIds) query = query.in("profile_id", profileIds);

  const { data, error } = await query;
  if (error) {
    console.error("Query failed:", error.message);
    process.exit(1);
  }

  const rows = (data || []).filter((r) => (r.transcript || "").trim().length >= 10);
  console.log(`Found ${rows.length} call(s) to analyse.`);

  let ok = 0;
  let fail = 0;
  for (const row of rows) {
    try {
      const analysis = await analyse(row);
      const { error: updErr } = await supabase
        .from("wisecall_call_logs")
        .update(toColumns(analysis))
        .eq("id", row.id);
      if (updErr) throw new Error(updErr.message);
      ok += 1;
      process.stdout.write(`  ✓ ${row.id} (${analysis.sentiment})\n`);
    } catch (e) {
      fail += 1;
      process.stdout.write(`  ✗ ${row.id}: ${e.message}\n`);
    }
  }

  console.log(`Done. ${ok} analysed, ${fail} failed.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
