import { getServiceSupabase } from "@/lib/supabase";

export type FollowUpStatus = "open" | "done" | "snoozed";
export type FollowUpSource = "ai" | "manual";

export type FollowUp = {
  id: string;
  profileId: string;
  agentName: string;
  contactId: string | null;
  callLogId: string | null;
  title: string;
  description: string;
  source: FollowUpSource;
  status: FollowUpStatus;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  caller: string;
};

type FollowUpRow = {
  id: string;
  profile_id: string;
  contact_id: string | null;
  call_log_id: string | null;
  title: string;
  description: string | null;
  source: string;
  status: string;
  due_at: string | null;
  completed_at: string | null;
  created_at: string;
  wisecall_call_logs:
    | { caller_id: string | null; profile_name: string | null }
    | { caller_id: string | null; profile_name: string | null }[]
    | null;
};

function callLogMeta(row: FollowUpRow) {
  const rel = row.wisecall_call_logs;
  if (Array.isArray(rel)) return rel[0] ?? null;
  return rel;
}

function mapFollowUp(row: FollowUpRow, agentName: string): FollowUp {
  const log = callLogMeta(row);
  return {
    id: row.id,
    profileId: row.profile_id,
    agentName,
    contactId: row.contact_id,
    callLogId: row.call_log_id,
    title: row.title,
    description: row.description ?? "",
    source: row.source === "manual" ? "manual" : "ai",
    status:
      row.status === "done" || row.status === "snoozed"
        ? row.status
        : "open",
    dueAt: row.due_at,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    caller: log?.caller_id ?? "Unknown",
  };
}

export async function getFollowUpsForUser(userId: string): Promise<FollowUp[]> {
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Follow-up data is not configured.");

  const { data: profiles, error: profileError } = await supabase
    .from("wisecall_profiles")
    .select("id, business_name, clinic_name, profile_name, receptionist_name")
    .eq("metadata->>owner_id", userId);
  if (profileError) {
    console.error("getFollowUpsForUser profiles failed:", profileError.message);
    throw new Error("Could not load follow-up ownership.");
  }

  const profileIds = (profiles ?? []).map((p) => p.id as string);
  if (profileIds.length === 0) return [];

  const nameById: Record<string, string> = {};
  for (const p of profiles ?? []) {
    nameById[p.id as string] =
      ((p.business_name || p.clinic_name || p.profile_name || p.receptionist_name || "Agent") as string);
  }

  const { data, error } = await supabase
    .from("wisecall_follow_ups")
    .select(
      "id, profile_id, contact_id, call_log_id, title, description, source, status, due_at, completed_at, created_at, wisecall_call_logs(caller_id, profile_name)",
    )
    .in("profile_id", profileIds)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("getFollowUpsForUser failed:", error.message);
    throw new Error("Could not load follow-ups.");
  }

  return (data as FollowUpRow[]).map((row) =>
    mapFollowUp(row, nameById[row.profile_id] ?? callLogMeta(row)?.profile_name ?? "Agent"),
  );
}

export async function getOpenFollowUpCountForProfiles(profileIds: string[]): Promise<number> {
  const supabase = getServiceSupabase();
  if (!supabase || profileIds.length === 0) return 0;

  const { count, error } = await supabase
    .from("wisecall_follow_ups")
    .select("id", { count: "exact", head: true })
    .in("profile_id", profileIds)
    .eq("status", "open");

  if (error) {
    console.error("getOpenFollowUpCountForProfiles failed:", error.message);
    return 0;
  }
  return count ?? 0;
}
