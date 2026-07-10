import { getServiceSupabase } from "@/lib/supabase";

export type Contact = {
  id: string;
  profileId: string;
  agentName: string;
  phone: string;
  email: string;
  name: string;
  company: string;
  callbackPhone: string;
  firstSeen: string; // ISO
  lastSeen: string;  // ISO
  callCount: number;
  emailCount: number;
  aiSummary: string;
  notes: string;
};

type ContactRow = {
  id: string;
  profile_id: string;
  phone: string | null;
  email: string | null;
  name: string | null;
  first_seen: string;
  last_seen: string;
  call_count: number;
  email_count: number;
  ai_summary: string | null;
  notes: string | null;
  metadata: Record<string, unknown> | null;
};

function readMetaString(metadata: Record<string, unknown> | null, key: string): string {
  const value = metadata?.[key];
  return typeof value === "string" ? value : "";
}

function mapContact(row: ContactRow, agentName: string): Contact {
  return {
    id: row.id,
    profileId: row.profile_id,
    agentName,
    phone: row.phone ?? "",
    email: row.email ?? "",
    name: row.name ?? "",
    company: readMetaString(row.metadata, "company"),
    callbackPhone: readMetaString(row.metadata, "callback_phone"),
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
    callCount: row.call_count,
    emailCount: row.email_count,
    aiSummary: row.ai_summary ?? "",
    notes: row.notes ?? "",
  };
}

export async function getContactsForUser(userId: string): Promise<Contact[]> {
  const supabase = getServiceSupabase();
  if (!supabase) throw new Error("Contact data is not configured.");

  const { data: profiles, error: profileError } = await supabase
    .from("wisecall_profiles")
    .select("id, receptionist_name, business_name, clinic_name")
    .eq("metadata->>owner_id", userId);
  if (profileError) {
    console.error("getContactsForUser profiles failed:", profileError.message);
    throw new Error("Could not load contact ownership.");
  }

  const profileIds = (profiles ?? []).map((p) => p.id as string);
  if (profileIds.length === 0) return [];

  const nameById: Record<string, string> = {};
  for (const p of profiles ?? []) {
    nameById[p.id as string] =
      ((p.business_name || p.clinic_name || p.receptionist_name || "Agent") as string);
  }

  const { data, error } = await supabase
    .from("wisecall_contacts")
    .select(
      "id, profile_id, phone, email, name, first_seen, last_seen, call_count, email_count, ai_summary, notes, metadata",
    )
    .in("profile_id", profileIds)
    .order("last_seen", { ascending: false })
    .limit(500);

  if (error) {
    console.error("getContactsForUser failed:", error.message);
    throw new Error("Could not load contacts.");
  }

  return (data as ContactRow[]).map((row) =>
    mapContact(row, nameById[row.profile_id] ?? "Agent"),
  );
}
