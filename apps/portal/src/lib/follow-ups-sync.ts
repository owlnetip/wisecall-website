import { getServiceSupabase } from "@/lib/supabase";
import type { CallAnalysis } from "@/lib/call-analysis";
import { friendlyOutcome } from "@/lib/agents";
import { portalNextActions } from "@/lib/conversation-email";

function actionItemsFromAnalysis(analysis: CallAnalysis): string[] {
  return portalNextActions({ analysisJson: analysis });
}

export async function syncFollowUpsFromAnalysis(
  callLogId: string,
  profileId: string,
  contactId: string | null,
  analysis: CallAnalysis,
): Promise<string[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const items = actionItemsFromAnalysis(analysis);
  if (!items.length) return [];

  // Re-analysis: replace AI-sourced items for this call only.
  await supabase
    .from("wisecall_follow_ups")
    .delete()
    .eq("call_log_id", callLogId)
    .eq("source", "ai");

  const now = new Date().toISOString();
  const rows = items.map((title) => ({
    profile_id: profileId,
    contact_id: contactId,
    call_log_id: callLogId,
    title: title.slice(0, 280),
    description: analysis.short_manager_summary?.slice(0, 500) || null,
    source: "ai",
    status: "open",
    created_at: now,
    updated_at: now,
  }));

  const { error } = await supabase.from("wisecall_follow_ups").insert(rows);
  if (error) {
    console.error("syncFollowUpsFromAnalysis failed:", error.message);
    return [];
  }

  return items;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function isLiveChatLog(log: {
  call_id?: string | null;
  metadata?: unknown;
}): boolean {
  const metadata = isPlainObject(log.metadata) ? log.metadata : {};
  const source = String(metadata.source || "");
  const channel = String(metadata.channel || "");
  const callId = String(log.call_id || "");
  return (
    source === "wisecall-live-chat" ||
    channel === "live_chat" ||
    channel === "chat" ||
    callId.startsWith("chat_")
  );
}

export async function sendActionItemsEmail(input: {
  callLogId: string;
  profileId: string;
  callerId: string;
  actionItems: string[];
  managerSummary?: string;
  transcript?: string;
  outcome?: string;
  startedAt?: string | null;
  agentName?: string;
}): Promise<void> {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceKey) return;

  const url = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/wisecall-action-items-email`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${serviceKey}`,
      },
      body: JSON.stringify({
        call_log_id: input.callLogId,
        profile_id: input.profileId,
        caller_id: input.callerId,
        action_items: input.actionItems,
        manager_summary: input.managerSummary ?? "",
        transcript: input.transcript ?? "",
        outcome: input.outcome ?? "",
        started_at: input.startedAt ?? "",
        agent_name: input.agentName ?? "",
      }),
    });
    if (!res.ok) {
      console.error("sendActionItemsEmail failed:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("sendActionItemsEmail error:", err instanceof Error ? err.message : err);
  }
}

/**
 * After-call team email using the same next actions the portal inbox shows.
 * Live chat already emails on capture; only send again if follow-ups exist.
 */
export async function sendPostCallEmailForLog(
  callLogId: string,
  extra?: {
    actionItems?: string[];
    managerSummary?: string;
  },
): Promise<{ ok: boolean; skipped?: string; error?: string }> {
  const supabase = getServiceSupabase();
  if (!supabase) return { ok: false, skipped: "missing_supabase" };

  const { data: log, error } = await supabase
    .from("wisecall_call_logs")
    .select(
      "id, call_id, profile_id, profile_name, caller_id, summary, transcript, outcome, started_at, metadata, ai_insight_summary, ai_analysis_json",
    )
    .eq("id", callLogId)
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!log) return { ok: false, skipped: "missing_call" };
  if (!log.profile_id) return { ok: false, skipped: "missing_profile" };

  const { data: followUpRows } = await supabase
    .from("wisecall_follow_ups")
    .select("title")
    .eq("call_log_id", callLogId)
    .eq("status", "open");

  const fromExtra = (extra?.actionItems ?? [])
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 5);
  const actionItems = fromExtra.length
    ? fromExtra
    : portalNextActions({
        analysisJson: log.ai_analysis_json,
        followUpTitles: (followUpRows ?? []).map((row) => String(row.title || "")),
      });

  if (isLiveChatLog(log) && !actionItems.length) {
    return { ok: true, skipped: "live_chat_no_follow_ups" };
  }

  const metadata = isPlainObject(log.metadata) ? log.metadata : {};
  if (
    metadata.summary_email_sent === true &&
    (!actionItems.length || metadata.summary_email_included_next_actions === true)
  ) {
    return { ok: true, skipped: "already_sent" };
  }

  const summary = (
    extra?.managerSummary ||
    log.ai_insight_summary ||
    log.summary ||
    ""
  ).trim();
  const transcript = (log.transcript || "").trim();
  if (summary.length < 3 && transcript.length < 10 && !actionItems.length) {
    return { ok: true, skipped: "no_content" };
  }

  await sendActionItemsEmail({
    callLogId,
    profileId: log.profile_id,
    callerId: log.caller_id ?? "Unknown",
    actionItems,
    managerSummary: summary,
    transcript,
    outcome: friendlyOutcome(log.outcome),
    startedAt: log.started_at,
    agentName: log.profile_name || "WiseCall",
  });

  return { ok: true };
}
