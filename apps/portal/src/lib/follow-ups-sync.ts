import { getServiceSupabase } from "@/lib/supabase";
import type { CallAnalysis } from "@/lib/call-analysis";

function actionItemsFromAnalysis(analysis: CallAnalysis): string[] {
  const fromList = analysis.action_items?.filter(Boolean) ?? [];
  if (fromList.length) return fromList.slice(0, 5);
  if (analysis.recommended_follow_up?.trim()) {
    return [analysis.recommended_follow_up.trim()];
  }
  return [];
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

export async function sendActionItemsEmail(input: {
  callLogId: string;
  profileId: string;
  callerId: string;
  actionItems: string[];
  managerSummary?: string;
}): Promise<void> {
  if (!input.actionItems.length) return;

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
      }),
    });
    if (!res.ok) {
      console.error("sendActionItemsEmail failed:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("sendActionItemsEmail error:", err instanceof Error ? err.message : err);
  }
}
