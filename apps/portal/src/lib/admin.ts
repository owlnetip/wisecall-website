import type { User } from "@supabase/supabase-js";
import { getServiceSupabase } from "@/lib/supabase";

// Who counts as an admin. Primary signal is a role stamped on the auth user
// (app_metadata.role / user_metadata.role === "admin"); an optional ADMIN_EMAILS
// allowlist (comma-separated) is a convenient fallback for granting access.
export function isAdmin(user: User | null): boolean {
  if (!user) return false;
  const appRole = (user.app_metadata as Record<string, unknown> | null)?.role;
  const userRole = (user.user_metadata as Record<string, unknown> | null)?.role;
  if (appRole === "admin" || userRole === "admin") return true;
  const allow = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
  return Boolean(user.email && allow.includes(user.email.toLowerCase()));
}

export type AdminAgentRow = {
  id: string;
  business: string;
  agentName: string;
  phone: string;
  status: "Live" | "Setup";
  ownerEmail: string;
  calls: number;
  createdAt: string;
};

export type AdminOverview = {
  agents: AdminAgentRow[];
  stats: {
    agents: number;
    live: number;
    customers: number;
    calls: number;
  };
};

type ProfileRow = {
  id: string;
  profile_name: string | null;
  receptionist_name: string | null;
  business_name: string | null;
  clinic_name: string | null;
  telnyx_number: string | null;
  is_active: boolean | null;
  metadata: Record<string, unknown> | null;
  created_at: string | null;
};

function phoneOf(row: ProfileRow): string {
  if (row.telnyx_number) return row.telnyx_number;
  const routing = row.metadata?.routing as Record<string, unknown> | undefined;
  if (routing && typeof routing.number === "string" && routing.number) {
    return routing.number;
  }
  return "—";
}

// Builds the full cross-customer overview for the admin console. Service-role
// only — every profile, with owner email resolved from the auth users list and
// call counts tallied per profile. Returns null when Supabase isn't configured.
export async function getAdminOverview(): Promise<AdminOverview | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const { data: profiles, error } = await supabase
    .from("wisecall_profiles")
    .select(
      "id, profile_name, receptionist_name, business_name, clinic_name, telnyx_number, is_active, metadata, created_at",
    )
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getAdminOverview profiles failed:", error.message);
    return { agents: [], stats: { agents: 0, live: 0, customers: 0, calls: 0 } };
  }

  const rows = (profiles ?? []) as ProfileRow[];

  // Tally call counts per profile in one pass.
  const counts: Record<string, number> = {};
  const { data: logs } = await supabase
    .from("wisecall_call_logs")
    .select("profile_id")
    .limit(10000);
  for (const log of (logs ?? []) as { profile_id: string | null }[]) {
    if (log.profile_id) counts[log.profile_id] = (counts[log.profile_id] ?? 0) + 1;
  }

  // Resolve owner_id → email from the auth users list.
  const emailById: Record<string, string> = {};
  try {
    const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    for (const u of data?.users ?? []) {
      if (u.id && u.email) emailById[u.id] = u.email;
    }
  } catch (err) {
    console.error("getAdminOverview listUsers failed:", err);
  }

  const owners = new Set<string>();
  const agents: AdminAgentRow[] = rows.map((row) => {
    const ownerId = (row.metadata?.owner_id as string | undefined) ?? "";
    if (ownerId) owners.add(ownerId);
    return {
      id: row.id,
      business: row.business_name || row.clinic_name || "—",
      agentName: row.receptionist_name || row.profile_name || "Assistant",
      phone: phoneOf(row),
      status: row.is_active ? "Live" : "Setup",
      ownerEmail: ownerId ? emailById[ownerId] ?? "Unassigned" : "Unassigned",
      calls: counts[row.id] ?? 0,
      createdAt: row.created_at || "",
    };
  });

  return {
    agents,
    stats: {
      agents: agents.length,
      live: agents.filter((a) => a.status === "Live").length,
      customers: owners.size,
      calls: Object.values(counts).reduce((a, b) => a + b, 0),
    },
  };
}
