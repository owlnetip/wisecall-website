import { getServiceSupabase } from "@/lib/supabase";
import type {
  Assistant,
  AgentRouting,
  KnowledgeFields,
  RoutingContact,
  RoutingProvider,
  RoutingStatus,
} from "@/components/customer-agent-workspace";
import { readIntegrationWebhooks } from "@/lib/integration-webhooks";

// The subdomain the email channel listens on. Must match the edge function's
// WISECALL_EMAIL_INBOUND_DOMAIN (wisecall-email-inbound).
const EMAIL_INBOUND_DOMAIN = "in.wisecall.io";

function emailSlug(s: string): string {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

// The forwarding address for an agent's email channel. Deterministic from the
// profile id (no stored field needed); the inbound function resolves the agent by
// the trailing short id. Mirrors agentEmailAddress() in wisecall-email-inbound.
function agentEmailAddress(row: ProfileRow): string {
  const name = row.business_name || row.clinic_name || row.profile_name || "agent";
  const slug = emailSlug(name) || "agent";
  const shortId = row.id.replace(/-/g, "").slice(0, 8);
  return `${slug}-${shortId}@${EMAIL_INBOUND_DOMAIN}`;
}

type ProfileRow = {
  id: string;
  slug: string | null;
  profile_name: string | null;
  receptionist_name: string | null;
  business_name: string | null;
  clinic_name: string | null;
  telnyx_number: string | null;
  is_active: boolean | null;
  system_prompt: string | null;
  greeting: string | null;
  after_hours_message: string | null;
  business_context: string | null;
  timezone: string | null;
  metadata: Record<string, unknown> | null;
};

function meta(row: ProfileRow, key: string): string {
  const value = row.metadata?.[key];
  return typeof value === "string" ? value : "";
}

// Reads the provider-agnostic routing block from metadata.routing. Falls back to
// the legacy telnyx_number column so agents provisioned before this field still
// show as live.
function readRouting(row: ProfileRow): AgentRouting {
  const raw = row.metadata?.routing;
  if (raw && typeof raw === "object") {
    const r = raw as Record<string, unknown>;
    return {
      provider: (r.provider as RoutingProvider | null) ?? null,
      number: typeof r.number === "string" ? r.number : "",
      status: (r.status as RoutingStatus) ?? "unprovisioned",
      telnyxApplicationId:
        typeof r.telnyxApplicationId === "string" ? r.telnyxApplicationId : undefined,
      sipRoute: typeof r.sipRoute === "string" ? r.sipRoute : undefined,
      openaiVoice: typeof r.openaiVoice === "string" ? r.openaiVoice : undefined,
    };
  }
  if (row.telnyx_number) {
    return { provider: "telnyx", number: row.telnyx_number, status: "live" };
  }
  return { provider: null, number: "", status: "unprovisioned" };
}

// Reads the canonical routing_contacts list. If it isn't there yet (agents set up
// before this feature), it derives contacts from the legacy transfer_routes object
// and maintenance_keywords so existing routing shows up straight away.
function readContacts(row: ProfileRow): RoutingContact[] {
  const raw = row.metadata?.routing_contacts;
  if (Array.isArray(raw)) {
    return raw.map((item, index) => {
      const c = (item ?? {}) as Record<string, unknown>;
      return {
        id: typeof c.id === "string" && c.id ? c.id : `contact-${index}`,
        name: typeof c.name === "string" ? c.name : "",
        phone: typeof c.phone === "string" ? c.phone : "",
        email: typeof c.email === "string" ? c.email : "",
        keywords: Array.isArray(c.keywords)
          ? c.keywords.filter((k): k is string => typeof k === "string")
          : [],
        transfer: c.transfer !== false,
        notify: c.notify === true,
        useDefaultEmail: c.useDefaultEmail === true,
      };
    });
  }

  const legacy = row.metadata?.transfer_routes;
  if (legacy && typeof legacy === "object") {
    const kws = row.metadata?.maintenance_keywords;
    const keywords = Array.isArray(kws)
      ? kws.filter((k): k is string => typeof k === "string")
      : [];
    return Object.entries(legacy as Record<string, unknown>).map(([key, value], index) => {
      const v = (value ?? {}) as Record<string, unknown>;
      return {
        id: key || `contact-${index}`,
        name: typeof v.label === "string" ? v.label : key,
        phone: typeof v.phone === "string" ? v.phone : "",
        email: "",
        // Attach known keywords to the first derived contact only, so they aren't
        // duplicated across every person.
        keywords: index === 0 ? keywords : [],
        transfer: true,
        notify: false,
        useDefaultEmail: false,
      };
    });
  }

  return [];
}

// The pooled default inbox. Prefers the portal field, then falls back to the
// legacy notification_emails / fallback_email already on the profile.
function readDefaultEmail(row: ProfileRow): string {
  const explicit = row.metadata?.default_routing_email;
  if (typeof explicit === "string" && explicit) return explicit;
  const notify = row.metadata?.notification_emails;
  if (Array.isArray(notify) && typeof notify[0] === "string") return notify[0];
  return meta(row, "fallback_email");
}

// Reads the structured business-knowledge sections (metadata.knowledge_fields).
function readKnowledgeFields(row: ProfileRow): KnowledgeFields {
  const raw = row.metadata?.knowledge_fields;
  if (!raw || typeof raw !== "object") return {};
  const r = raw as Record<string, unknown>;
  const pick = (key: string): string | undefined =>
    typeof r[key] === "string" ? (r[key] as string) : undefined;
  return {
    openingHours: pick("openingHours"),
    address: pick("address"),
    services: pick("services"),
    pricing: pick("pricing"),
    payments: pick("payments"),
    other: pick("other"),
  };
}

// Website: prefer the portal field, then the live runtime's context_urls list.
function readWebsite(row: ProfileRow): string {
  const explicit = row.metadata?.website;
  if (typeof explicit === "string" && explicit) return explicit;
  const urls = row.metadata?.context_urls;
  if (Array.isArray(urls)) {
    const first = urls.find((u) => typeof u === "string" && u);
    if (typeof first === "string") return first;
  }
  return "";
}

// Per-day office hours (metadata.office_hours). Only valid open/close days kept.
function readOfficeHours(row: ProfileRow): Record<string, { open: string; close: string }> | undefined {
  const raw = row.metadata?.office_hours;
  if (!raw || typeof raw !== "object") return undefined;
  const out: Record<string, { open: string; close: string }> = {};
  for (const [day, value] of Object.entries(raw as Record<string, unknown>)) {
    const v = (value ?? {}) as Record<string, unknown>;
    if (typeof v.open === "string" && typeof v.close === "string") {
      out[day] = { open: v.open, close: v.close };
    }
  }
  return Object.keys(out).length ? out : undefined;
}

function mapProfile(row: ProfileRow): Assistant {
  const routing = readRouting(row);
  return {
    id: row.id,
    slug: row.slug || "",
    chatAccentColor: meta(row, "chat_accent_color") || undefined,
    chatBackgroundColor: meta(row, "chat_background_color") || undefined,
    name: row.receptionist_name || row.profile_name || "Assistant",
    businessName: row.business_name || row.clinic_name || "",
    industry: meta(row, "industry") || "General",
    phoneNumber: routing.number || "Number pending",
    status: row.is_active ? "Live" : "Setup",
    receptionistName: row.receptionist_name || row.profile_name || "",
    prompt: row.system_prompt || "",
    website: readWebsite(row),
    timezone: row.timezone || "Europe/London",
    fallbackEmail: meta(row, "fallback_email"),
    transferNumber: meta(row, "transfer_number"),
    defaultEmail: readDefaultEmail(row),
    contacts: readContacts(row),
    // Greeting & business knowledge are columns the live runtime reads
    // (settings.js greeting, prompt.js business_context); fall back to legacy
    // metadata for portal-created agents that only have the metadata copy.
    greeting: row.greeting || meta(row, "greeting"),
    voice: meta(row, "voice") || "Gemma",
    knowledge: row.business_context || meta(row, "knowledge") || meta(row, "company_context"),
    knowledgeFields: readKnowledgeFields(row),
    calls: 0,
    cost: "GBP 0.00",
    routing,
    officeHours: readOfficeHours(row),
    // Prefer the column the runtime reads; fall back to the legacy metadata copy.
    outOfHoursMessage: row.after_hours_message || meta(row, "out_of_hours_message") || undefined,
    emailAddress: agentEmailAddress(row),
    emailChannelEnabled: row.metadata?.email_channel_enabled === true,
    integrationWebhooks: readIntegrationWebhooks(row.metadata),
  };
}

// Returns only the agents owned by this user. Enforced server-side: we query
// with the service role but always filter by metadata->>owner_id = userId, so a
// customer can never receive another customer's rows. Ownership is stored in the
// existing `metadata` jsonb (no schema change needed). Returns null only when
// Supabase isn't configured (so the UI can fall back to demo data).
export async function getAgentsForUser(userId: string): Promise<Assistant[] | null> {
  const supabase = getServiceSupabase();
  if (!supabase) {
    return null;
  }

  const { data, error } = await supabase
    .from("wisecall_profiles")
    .select(
      "id, slug, profile_name, receptionist_name, business_name, clinic_name, telnyx_number, is_active, system_prompt, greeting, after_hours_message, business_context, timezone, metadata",
    )
    .eq("metadata->>owner_id", userId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getAgentsForUser failed:", error.message);
    return [];
  }

  return (data as ProfileRow[]).map(mapProfile);
}

export type CallLog = {
  id: string;
  profileId: string;
  agentName: string;
  caller: string;
  summary: string;
  outcome: string;
  startedAt: string; // ISO
  durationLabel: string;
  transcript: string;
};

type CallRow = {
  id: string;
  profile_id: string | null;
  profile_name: string | null;
  caller_id: string | null;
  summary: string | null;
  outcome: string | null;
  transcript: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string | null;
};

function duration(started: string | null, finished: string | null): string {
  if (!started || !finished) return "—";
  const secs = Math.max(0, Math.round((Date.parse(finished) - Date.parse(started)) / 1000));
  const m = Math.floor(secs / 60);
  const s = secs % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

// Returns the call logs for every agent this user owns. Scoped two ways: we
// resolve the user's owned profile ids first, then only fetch logs for those ids.
export async function getCallLogsForUser(userId: string): Promise<CallLog[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const { data: owned } = await supabase
    .from("wisecall_profiles")
    .select("id")
    .eq("metadata->>owner_id", userId);

  const ids = (owned ?? []).map((row) => row.id as string);
  if (ids.length === 0) return [];

  const { data, error } = await supabase
    .from("wisecall_call_logs")
    .select(
      "id, profile_id, profile_name, caller_id, summary, outcome, transcript, started_at, finished_at, created_at",
    )
    .in("profile_id", ids)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("getCallLogsForUser failed:", error.message);
    return [];
  }

  return (data as CallRow[]).map(mapCallRow);
}

function mapCallRow(row: CallRow): CallLog {
  return {
    id: row.id,
    profileId: row.profile_id || "",
    agentName: row.profile_name || "Agent",
    caller: row.caller_id || "Unknown",
    summary: row.summary || "",
    outcome: row.outcome || "",
    startedAt: row.started_at || row.created_at || "",
    durationLabel: duration(row.started_at, row.finished_at),
    transcript: row.transcript || "",
  };
}

const PROFILE_SELECT =
  "id, slug, profile_name, receptionist_name, business_name, clinic_name, telnyx_number, is_active, system_prompt, greeting, after_hours_message, business_context, timezone, metadata";

const CALL_SELECT =
  "id, profile_id, profile_name, caller_id, summary, outcome, transcript, started_at, finished_at, created_at";

// Admin only: every agent across all customers, as full editable Assistants,
// with the owner's email resolved for display. Service-role only.
export async function getAllAgents(): Promise<Assistant[] | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("wisecall_profiles")
    .select(PROFILE_SELECT)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("getAllAgents failed:", error.message);
    return [];
  }

  const emailById: Record<string, string> = {};
  try {
    const { data: users } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    for (const u of users?.users ?? []) {
      if (u.id && u.email) emailById[u.id] = u.email;
    }
  } catch (err) {
    console.error("getAllAgents listUsers failed:", err);
  }

  return (data as ProfileRow[]).map((row) => {
    const agent = mapProfile(row);
    const ownerId = row.metadata?.owner_id as string | undefined;
    return {
      ...agent,
      ownerId: ownerId ?? undefined,
      ownerEmail: ownerId ? emailById[ownerId] ?? "Unassigned" : "Unassigned",
    };
  });
}

// Admin only: recent call logs across all agents.
export async function getAllCallLogs(): Promise<CallLog[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("wisecall_call_logs")
    .select(CALL_SELECT)
    .order("created_at", { ascending: false })
    .limit(500);

  if (error) {
    console.error("getAllCallLogs failed:", error.message);
    return [];
  }

  return (data as CallRow[]).map(mapCallRow);
}
