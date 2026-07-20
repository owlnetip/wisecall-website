import { getServiceSupabase } from "@/lib/supabase";
import type { CallAnalysis } from "@/lib/call-analysis";
import {
  buildKeyFacts,
  buildOpenCaseSummary,
  classifyFollowUp,
  contactPriorityScore,
  relationshipFromAnalysis,
  type FollowUpPriority,
} from "@/lib/follow-up-priority";

function actionItemsFromAnalysis(analysis: CallAnalysis): string[] {
  const fromList = analysis.action_items?.filter(Boolean) ?? [];
  if (fromList.length) return fromList.slice(0, 5);
  if (analysis.recommended_follow_up?.trim()) {
    return [analysis.recommended_follow_up.trim()];
  }
  return [];
}

export type SyncedFollowUpItem = {
  title: string;
  priority: FollowUpPriority;
};

export async function syncFollowUpsFromAnalysis(
  callLogId: string,
  profileId: string,
  contactId: string | null,
  analysis: CallAnalysis,
): Promise<SyncedFollowUpItem[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const items = actionItemsFromAnalysis(analysis);
  if (!items.length) return [];

  const classified = classifyFollowUp(analysis);

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
    priority: classified.priority,
    category: classified.category,
    due_at: classified.dueAt,
    created_at: now,
    updated_at: now,
  }));

  const { error } = await supabase.from("wisecall_follow_ups").insert(rows);
  if (error) {
    console.error("syncFollowUpsFromAnalysis failed:", error.message);
    return [];
  }

  if (contactId) {
    await syncContactCaseMemory(contactId, analysis);
  }

  return items.map((title) => ({ title, priority: classified.priority }));
}

export async function syncContactCaseMemory(
  contactId: string,
  analysis: CallAnalysis,
): Promise<void> {
  const supabase = getServiceSupabase();
  if (!supabase) return;

  const openCase = buildOpenCaseSummary(analysis);
  const keyFacts = buildKeyFacts(analysis);
  const patch: Record<string, unknown> = {
    updated_at: new Date().toISOString(),
    relationship_status: relationshipFromAnalysis(analysis),
    last_outcome: analysis.outcome,
    priority_score: contactPriorityScore(analysis),
  };
  if (openCase) patch.open_case_summary = openCase;
  if (keyFacts.length) patch.key_facts = keyFacts;

  // Clear open case when the call was fully resolved with no follow-up.
  if (
    analysis.outcome === "resolved" &&
    !analysis.action_items?.length &&
    !analysis.recommended_follow_up?.trim() &&
    !analysis.complaint_detected
  ) {
    patch.open_case_summary = null;
  }

  const { error } = await supabase.from("wisecall_contacts").update(patch).eq("id", contactId);
  if (error) {
    console.error("syncContactCaseMemory failed:", error.message);
  }
}

/** Immediate email only for critical items (complaints). Other work waits for digest. */
export async function sendActionItemsEmail(input: {
  callLogId: string;
  profileId: string;
  callerId: string;
  actionItems: string[];
  managerSummary?: string;
  priorities?: FollowUpPriority[];
}): Promise<void> {
  if (!input.actionItems.length) return;

  const priorities = input.priorities ?? [];
  const criticalItems = input.actionItems.filter((_, i) => priorities[i] === "critical");
  // Backward compatible: if priorities omitted, keep old behaviour (send all).
  const toSend = priorities.length ? criticalItems : input.actionItems;
  if (!toSend.length) return;

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
        action_items: toSend,
        manager_summary: input.managerSummary ?? "",
        critical_only: true,
      }),
    });
    if (!res.ok) {
      console.error("sendActionItemsEmail failed:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("sendActionItemsEmail error:", err instanceof Error ? err.message : err);
  }
}
