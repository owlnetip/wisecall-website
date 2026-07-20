import { getServiceSupabase } from "@/lib/supabase";

export type StatusPolicy = "warn" | "soft_block" | "hard_route" | "allow_with_note";
export type StatusFlagSource = "manual" | "csv" | "webhook";

export type StatusFlag = {
  id: string;
  profileId: string;
  contactId: string | null;
  matchPhone: string;
  matchEmail: string;
  matchCompany: string;
  flagKey: string;
  label: string;
  policy: StatusPolicy;
  agentMessage: string;
  transferRouteKey: string;
  appliesWhen: string[];
  active: boolean;
  source: StatusFlagSource;
  externalRef: string;
  expiresAt: string | null;
  createdAt: string;
};

export type StatusCheckSettings = {
  enabled: boolean;
  webhookUrl: string;
  webhookSecret: string;
  timeoutMs: number;
};

export type ResolvedStatusFlag = {
  flagKey: string;
  label: string;
  policy: StatusPolicy;
  agentMessage: string;
  transferRouteKey: string;
  appliesWhen: string[];
  source: StatusFlagSource;
};

type FlagRow = {
  id: string;
  profile_id: string;
  contact_id: string | null;
  match_phone: string | null;
  match_email: string | null;
  match_company: string | null;
  flag_key: string;
  label: string;
  policy: string;
  agent_message: string | null;
  transfer_route_key: string | null;
  applies_when: string[] | null;
  active: boolean;
  source: string;
  external_ref: string | null;
  expires_at: string | null;
  created_at: string;
};

const DEFAULT_STATUS_CHECK: StatusCheckSettings = {
  enabled: false,
  webhookUrl: "",
  webhookSecret: "",
  timeoutMs: 2000,
};

export function readStatusCheckSettings(
  metadata: Record<string, unknown> | null | undefined,
): StatusCheckSettings {
  const raw = metadata?.status_check;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_STATUS_CHECK };
  const r = raw as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    webhookUrl: typeof r.webhook_url === "string" ? r.webhook_url : "",
    webhookSecret: typeof r.webhook_secret === "string" ? r.webhook_secret : "",
    timeoutMs:
      typeof r.timeout_ms === "number" && r.timeout_ms >= 500 && r.timeout_ms <= 8000
        ? r.timeout_ms
        : DEFAULT_STATUS_CHECK.timeoutMs,
  };
}

function asPolicy(value: string): StatusPolicy {
  if (
    value === "warn" ||
    value === "soft_block" ||
    value === "hard_route" ||
    value === "allow_with_note"
  ) {
    return value;
  }
  return "warn";
}

function asSource(value: string): StatusFlagSource {
  if (value === "csv" || value === "webhook" || value === "manual") return value;
  return "manual";
}

function mapFlag(row: FlagRow): StatusFlag {
  return {
    id: row.id,
    profileId: row.profile_id,
    contactId: row.contact_id,
    matchPhone: row.match_phone ?? "",
    matchEmail: row.match_email ?? "",
    matchCompany: row.match_company ?? "",
    flagKey: row.flag_key,
    label: row.label,
    policy: asPolicy(row.policy),
    agentMessage: row.agent_message ?? "",
    transferRouteKey: row.transfer_route_key ?? "",
    appliesWhen: Array.isArray(row.applies_when) && row.applies_when.length
      ? row.applies_when
      : ["all"],
    active: row.active !== false,
    source: asSource(row.source),
    externalRef: row.external_ref ?? "",
    expiresAt: row.expires_at,
    createdAt: row.created_at,
  };
}

function normalisePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, "");
  return digits || null;
}

function normaliseEmail(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const email = raw.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

export async function listStatusFlagsForProfile(profileId: string): Promise<StatusFlag[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("wisecall_status_flags")
    .select(
      "id, profile_id, contact_id, match_phone, match_email, match_company, flag_key, label, policy, agent_message, transfer_route_key, applies_when, active, source, external_ref, expires_at, created_at",
    )
    .eq("profile_id", profileId)
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) {
    console.error("listStatusFlagsForProfile:", error.message);
    return [];
  }
  return ((data ?? []) as FlagRow[]).map(mapFlag);
}

export async function lookupLocalStatusFlags(input: {
  profileId: string;
  contactId?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
}): Promise<ResolvedStatusFlag[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const phone = normalisePhone(input.phone);
  const email = normaliseEmail(input.email);
  const company = (input.company || "").trim().toLowerCase();

  const { data, error } = await supabase
    .from("wisecall_status_flags")
    .select(
      "id, profile_id, contact_id, match_phone, match_email, match_company, flag_key, label, policy, agent_message, transfer_route_key, applies_when, active, source, external_ref, expires_at, created_at",
    )
    .eq("profile_id", input.profileId)
    .eq("active", true)
    .limit(100);

  if (error) {
    console.error("lookupLocalStatusFlags:", error.message);
    return [];
  }

  const now = Date.now();
  const matched: ResolvedStatusFlag[] = [];

  for (const row of (data ?? []) as FlagRow[]) {
    if (row.expires_at && new Date(row.expires_at).getTime() <= now) continue;

    const phoneMatch =
      phone && row.match_phone && normalisePhone(row.match_phone) === phone;
    const emailMatch =
      email && row.match_email && normaliseEmail(row.match_email) === email;
    const companyMatch =
      company &&
      row.match_company &&
      row.match_company.trim().toLowerCase() === company;
    const contactMatch =
      input.contactId && row.contact_id && row.contact_id === input.contactId;

    if (!(phoneMatch || emailMatch || companyMatch || contactMatch)) continue;

    matched.push({
      flagKey: row.flag_key,
      label: row.label,
      policy: asPolicy(row.policy),
      agentMessage: row.agent_message || defaultMessage(row.label, asPolicy(row.policy)),
      transferRouteKey: row.transfer_route_key ?? "",
      appliesWhen: Array.isArray(row.applies_when) && row.applies_when.length
        ? row.applies_when
        : ["all"],
      source: asSource(row.source),
    });
  }

  return matched;
}

function defaultMessage(label: string, policy: StatusPolicy): string {
  switch (policy) {
    case "hard_route":
      return `This caller has a ${label} flag. Transfer them to the configured team before continuing.`;
    case "soft_block":
      return `This caller has a ${label} flag. Do not place orders or put them through to support until they speak to the accounts team.`;
    case "allow_with_note":
      return `Note: this caller has a ${label} flag. Proceed carefully and mention it if relevant.`;
    default:
      return `This caller has a ${label} flag. Mention it politely if relevant before continuing.`;
  }
}

/** Live webhook lookup (v2). Fail-open: errors return []. */
export async function lookupWebhookStatusFlags(input: {
  settings: StatusCheckSettings;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  contactName?: string | null;
}): Promise<ResolvedStatusFlag[]> {
  if (!input.settings.enabled || !input.settings.webhookUrl) return [];

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.settings.timeoutMs);

  try {
    const res = await fetch(input.settings.webhookUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        ...(input.settings.webhookSecret
          ? { Authorization: `Bearer ${input.settings.webhookSecret}` }
          : {}),
      },
      body: JSON.stringify({
        phone: input.phone || null,
        email: input.email || null,
        company: input.company || null,
        name: input.contactName || null,
      }),
      signal: controller.signal,
    });
    if (!res.ok) return [];
    const body = (await res.json()) as { flags?: unknown };
    if (!Array.isArray(body.flags)) return [];

    return body.flags
      .map((raw): ResolvedStatusFlag | null => {
        if (!raw || typeof raw !== "object") return null;
        const f = raw as Record<string, unknown>;
        const flagKey = typeof f.flag_key === "string" ? f.flag_key : "";
        const label = typeof f.label === "string" ? f.label : flagKey;
        if (!flagKey || !label) return null;
        const policy = asPolicy(typeof f.policy === "string" ? f.policy : "warn");
        return {
          flagKey,
          label,
          policy,
          agentMessage:
            typeof f.agent_message === "string" && f.agent_message
              ? f.agent_message
              : defaultMessage(label, policy),
          transferRouteKey:
            typeof f.transfer_route_key === "string" ? f.transfer_route_key : "",
          appliesWhen: Array.isArray(f.applies_when)
            ? f.applies_when.filter((v): v is string => typeof v === "string")
            : ["all"],
          source: "webhook",
        };
      })
      .filter((f): f is ResolvedStatusFlag => Boolean(f));
  } catch (err) {
    console.error(
      "lookupWebhookStatusFlags:",
      err instanceof Error ? err.message : err,
    );
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function buildStatusBlock(flags: ResolvedStatusFlag[]): string | null {
  if (!flags.length) return null;

  const lines = ["[CALLER STATUS FLAGS]"];
  lines.push(
    "Active account/status checks for this caller. Follow the policy before placing orders, booking, or transferring to support.",
  );

  for (const flag of flags) {
    lines.push("");
    lines.push(`Flag: ${flag.label} (${flag.flagKey})`);
    lines.push(`Policy: ${flag.policy}`);
    lines.push(`Applies when: ${flag.appliesWhen.join(", ") || "all"}`);
    if (flag.transferRouteKey) {
      lines.push(`Transfer route key: ${flag.transferRouteKey}`);
    }
    lines.push(`What to say / do: ${flag.agentMessage}`);
  }

  lines.push("");
  lines.push("Guidance:");
  lines.push("- For hard_route: transfer to the route above after a brief explanation.");
  lines.push(
    "- For soft_block: do not proceed with orders/support handoff; direct them to accounts/the flagged team.",
  );
  lines.push("- For warn / allow_with_note: continue, but acknowledge the flag when relevant.");
  lines.push("- Do not invent balances or overdue amounts not provided in the flag message.");

  return lines.join("\n");
}

export async function resolveCallerStatusFlags(input: {
  profileId: string;
  metadata: Record<string, unknown> | null | undefined;
  contactId?: string | null;
  phone?: string | null;
  email?: string | null;
  company?: string | null;
  contactName?: string | null;
}): Promise<{ flags: ResolvedStatusFlag[]; block: string | null }> {
  const settings = readStatusCheckSettings(input.metadata);
  const local = await lookupLocalStatusFlags({
    profileId: input.profileId,
    contactId: input.contactId,
    phone: input.phone,
    email: input.email,
    company: input.company,
  });

  const remote = settings.enabled
    ? await lookupWebhookStatusFlags({
        settings,
        phone: input.phone,
        email: input.email,
        company: input.company,
        contactName: input.contactName,
      })
    : [];

  const byKey = new Map<string, ResolvedStatusFlag>();
  for (const flag of [...local, ...remote]) {
    byKey.set(`${flag.flagKey}:${flag.policy}`, flag);
  }
  const flags = [...byKey.values()];
  return { flags, block: buildStatusBlock(flags) };
}
