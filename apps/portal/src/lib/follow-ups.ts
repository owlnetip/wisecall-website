import { getServiceSupabase } from "@/lib/supabase";
import {
  isEffectivelyOpen,
  sortFollowUpsByPriority,
  type FollowUpCategory,
  type FollowUpPriority,
} from "@/lib/follow-up-priority";

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
  priority: FollowUpPriority;
  category: FollowUpCategory;
  dueAt: string | null;
  snoozedUntil: string | null;
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
  priority?: string | null;
  category?: string | null;
  due_at: string | null;
  snoozed_until?: string | null;
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

function asPriority(value: string | null | undefined): FollowUpPriority {
  if (value === "critical" || value === "high" || value === "normal" || value === "low") {
    return value;
  }
  return "normal";
}

function asCategory(value: string | null | undefined): FollowUpCategory {
  if (
    value === "lead" ||
    value === "sales" ||
    value === "complaint" ||
    value === "booking" ||
    value === "callback" ||
    value === "admin"
  ) {
    return value;
  }
  return "admin";
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
    priority: asPriority(row.priority),
    category: asCategory(row.category),
    dueAt: row.due_at,
    snoozedUntil: row.snoozed_until ?? null,
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

  const fullSelect =
    "id, profile_id, contact_id, call_log_id, title, description, source, status, priority, category, due_at, snoozed_until, completed_at, created_at, wisecall_call_logs(caller_id, profile_name)";
  const legacySelect =
    "id, profile_id, contact_id, call_log_id, title, description, source, status, due_at, completed_at, created_at, wisecall_call_logs(caller_id, profile_name)";

  let { data, error } = await supabase
    .from("wisecall_follow_ups")
    .select(fullSelect)
    .in("profile_id", profileIds)
    .order("created_at", { ascending: false })
    .limit(200);

  // Pre-migration environments may not have priority/category/snoozed_until yet.
  if (error && /priority|category|snoozed_until/i.test(error.message)) {
    ({ data, error } = await supabase
      .from("wisecall_follow_ups")
      .select(legacySelect)
      .in("profile_id", profileIds)
      .order("created_at", { ascending: false })
      .limit(200));
  }

  if (error) {
    console.error("getFollowUpsForUser failed:", error.message);
    throw new Error("Could not load follow-ups.");
  }

  const mapped = (data as FollowUpRow[]).map((row) =>
    mapFollowUp(row, nameById[row.profile_id] ?? callLogMeta(row)?.profile_name ?? "Agent"),
  );

  return sortFollowUpsByPriority(mapped);
}

export function getActionableFollowUps(followUps: FollowUp[]): FollowUp[] {
  return sortFollowUpsByPriority(followUps.filter(isEffectivelyOpen));
}

export async function getOpenFollowUpCountForProfiles(profileIds: string[]): Promise<number> {
  const supabase = getServiceSupabase();
  if (!supabase || profileIds.length === 0) return 0;

  const { data, error } = await supabase
    .from("wisecall_follow_ups")
    .select("id, status, snoozed_until")
    .in("profile_id", profileIds)
    .in("status", ["open", "snoozed"])
    .limit(500);

  if (error) {
    console.error("getOpenFollowUpCountForProfiles failed:", error.message);
    return 0;
  }

  return (data ?? []).filter((row) =>
    isEffectivelyOpen({
      status: String(row.status),
      snoozedUntil: (row.snoozed_until as string | null) ?? null,
    }),
  ).length;
}
