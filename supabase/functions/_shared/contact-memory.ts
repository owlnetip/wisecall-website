// Shared contact memory helpers for Supabase edge functions (Deno).

const CHANNEL_LABELS: Record<string, string> = {
  phone: "Phone",
  email: "Email",
  sms: "SMS",
  whatsapp: "WhatsApp",
  chat: "Web chat",
};

export function normalisePhone(raw: unknown): string | null {
  if (!raw || typeof raw !== "string") return null;
  const digits = raw.replace(/[^\d+]/g, "");
  return digits || null;
}

export function normaliseEmail(raw: unknown): string | null {
  if (!raw || typeof raw !== "string") return null;
  const email = raw.trim().toLowerCase();
  return email.includes("@") ? email : null;
}

function channelFromLog(row: Record<string, unknown>): string {
  const meta = (row.metadata as Record<string, unknown> | null) ?? {};
  const raw = String(meta.channel ?? "").toLowerCase();
  if (raw && CHANNEL_LABELS[raw]) return raw;
  if (String(meta.source ?? "") === "wisecall-live-chat") return "chat";
  const outcome = String(row.outcome ?? "").toLowerCase();
  if (outcome.includes("email")) return "email";
  if (outcome.includes("sms")) return "sms";
  if (outcome.includes("whatsapp")) return "whatsapp";
  if (outcome.startsWith("live_chat")) return "chat";
  return "phone";
}

function formatLogLine(row: Record<string, unknown>): string {
  const channel = CHANNEL_LABELS[channelFromLog(row)] ?? "Conversation";
  const date = (row.started_at || row.created_at) as string | undefined;
  const when = date
    ? new Date(date).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })
    : "Unknown date";
  const summary = String(row.summary || row.ai_insight_summary || "No summary").slice(0, 160);
  const outcome = row.outcome ? ` · ${row.outcome}` : "";
  return `- ${when} · ${channel} · ${summary}${outcome}`;
}

async function fetchRecentInteractions(
  supabase: any,
  profileId: string,
  opts: { contactId?: string | null; phone?: string | null; email?: string | null; limit?: number },
) {
  const limit = opts.limit ?? 8;
  if (opts.contactId) {
    const { data } = await supabase
      .from("wisecall_call_logs")
      .select("id, summary, outcome, started_at, created_at, metadata, ai_insight_summary")
      .eq("profile_id", profileId)
      .eq("contact_id", opts.contactId)
      .order("created_at", { ascending: false })
      .limit(limit);
    return data ?? [];
  }

  const filters: string[] = [];
  if (opts.phone) filters.push(`caller_id.eq.${opts.phone}`);
  if (opts.email) filters.push(`caller_id.ilike.${opts.email}`);
  if (!filters.length) return [];

  const { data } = await supabase
    .from("wisecall_call_logs")
    .select("id, summary, outcome, started_at, created_at, metadata, ai_insight_summary, caller_id")
    .eq("profile_id", profileId)
    .or(filters.join(","))
    .order("created_at", { ascending: false })
    .limit(limit);

  return data ?? [];
}

async function fetchOpenFollowUps(supabase: any, contactId: string) {
  const { data } = await supabase
    .from("wisecall_follow_ups")
    .select("id, title, description, created_at")
    .eq("contact_id", contactId)
    .eq("status", "open")
    .order("created_at", { ascending: false })
    .limit(5);
  return data ?? [];
}

export async function resolveContact(
  supabase: any,
  profileId: string,
  opts: { phone?: string | null; email?: string | null },
) {
  const phone = normalisePhone(opts.phone);
  const email = normaliseEmail(opts.email);

  let byPhone: Record<string, unknown> | null = null;
  let byEmail: Record<string, unknown> | null = null;

  if (phone) {
    const { data } = await supabase
      .from("wisecall_contacts")
      .select("id, name, phone, email, call_count, email_count, last_seen, ai_summary, notes, metadata")
      .eq("profile_id", profileId)
      .eq("phone", phone)
      .maybeSingle();
    byPhone = data ?? null;
  }

  if (email) {
    const { data } = await supabase
      .from("wisecall_contacts")
      .select("id, name, phone, email, call_count, email_count, last_seen, ai_summary, notes, metadata")
      .eq("profile_id", profileId)
      .eq("email", email)
      .maybeSingle();
    byEmail = data ?? null;
  }

  if (byPhone && byEmail && byPhone.id !== byEmail.id) {
    if (!byPhone.email) {
      try {
        await supabase
          .from("wisecall_contacts")
          .update({ email, updated_at: new Date().toISOString() })
          .eq("id", byPhone.id);
        byPhone.email = email;
      } catch {
        /* best-effort */
      }
    }
    return byPhone;
  }

  const contact = byPhone || byEmail;
  if (!contact) return null;

  const patch: Record<string, unknown> = {};
  if (phone && !contact.phone) patch.phone = phone;
  if (email && !contact.email) patch.email = email;
  if (Object.keys(patch).length) {
    patch.updated_at = new Date().toISOString();
    try {
      await supabase.from("wisecall_contacts").update(patch).eq("id", contact.id);
      Object.assign(contact, patch);
    } catch {
      /* best-effort */
    }
  }

  return contact;
}

export async function loadContactContext(
  supabase: any,
  profileId: string,
  opts: { phone?: string | null; email?: string | null },
) {
  const contact = await resolveContact(supabase, profileId, opts);
  const recentLogs = await fetchRecentInteractions(supabase, profileId, {
    contactId: contact?.id as string | undefined,
    phone: normalisePhone(opts.phone),
    email: normaliseEmail(opts.email),
  });
  const openFollowUps = contact?.id
    ? await fetchOpenFollowUps(supabase, contact.id as string)
    : [];

  return { contact, recentLogs, openFollowUps };
}

export function buildMemoryBlock(context: {
  contact?: Record<string, unknown> | null;
  recentLogs?: Record<string, unknown>[];
  openFollowUps?: Record<string, unknown>[];
}): string {
  const contact = context.contact;
  if (!contact && !(context.recentLogs?.length ?? 0)) return "";

  const meta = (contact?.metadata as Record<string, unknown> | null) ?? {};
  const lines: string[] = ["[CONTACT MEMORY: you have dealt with this person before]"];

  if (contact?.name) lines.push(`Name: ${contact.name}`);
  if (contact?.phone) lines.push(`Phone: ${contact.phone}`);
  if (contact?.email) lines.push(`Email: ${contact.email}`);
  if (meta.company) lines.push(`Company: ${meta.company}`);

  if (contact) {
    lines.push(
      `Previous interactions: ${contact.call_count ?? 0} call(s), ${contact.email_count ?? 0} email(s)`,
    );
  }

  const recentLogs = context.recentLogs ?? [];
  if (recentLogs.length) {
    lines.push("", "Recent conversations (newest first, all channels):");
    for (const row of recentLogs) lines.push(formatLogLine(row));
  } else if (contact?.ai_summary) {
    lines.push(`History: ${contact.ai_summary}`);
  }

  const openFollowUps = context.openFollowUps ?? [];
  if (openFollowUps.length) {
    lines.push("", "Open follow-ups from prior interactions:");
    for (const item of openFollowUps) {
      lines.push(
        `- ${item.title}${item.description ? `: ${String(item.description).slice(0, 120)}` : ""}`,
      );
    }
  }

  if (contact?.notes) lines.push("", `Staff notes: ${contact.notes}`);

  lines.push(
    "",
    "Guidance:",
    "- Reference prior conversations naturally when the topic may relate.",
    "- If this sounds like a prior issue, ask briefly whether it's the same matter or something new.",
    "- Do not re-ask for details already captured above.",
  );

  return lines.join("\n");
}

function normalizePortalBase(raw: string | undefined): string {
  const value = (raw || "").trim().replace(/\/+$/, "");
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function getPortalWebhookUrl(): string {
  const base = normalizePortalBase(
    Deno.env.get("WISECALL_PORTAL_URL") ||
      Deno.env.get("PORTAL_URL") ||
      Deno.env.get("PORTAL_DOMAIN") ||
      Deno.env.get("SITE_URL") ||
      "",
  );
  if (!base) return "";
  return `${base}/api/webhooks/call-completed`;
}

function getPortalWebhookSecret(): string {
  return (
    Deno.env.get("WISECALL_WEBHOOK_SECRET") ||
    Deno.env.get("WISECALL_TRIAL_REMINDER_SECRET") ||
    Deno.env.get("WISECALL_POOL_REPLENISH_SECRET") ||
    ""
  );
}

export async function triggerPortalAnalysis(callLogId: string): Promise<void> {
  const portalUrl = getPortalWebhookUrl();
  const secret = getPortalWebhookSecret();
  if (!portalUrl || !secret || !callLogId) return;

  try {
    await fetch(portalUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-wisecall-secret": secret,
      },
      body: JSON.stringify({ call_id: callLogId }),
    });
  } catch (err) {
    console.error("[portalWebhook] trigger failed:", (err as Error).message);
  }
}
