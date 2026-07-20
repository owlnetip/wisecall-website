import { getServiceSupabase } from "@/lib/supabase";
import { sendViaResend } from "@/lib/outreach-email";
import {
  categoryLabel,
  isEffectivelyOpen,
  priorityLabel,
  priorityRank,
  type FollowUpCategory,
  type FollowUpPriority,
} from "@/lib/follow-up-priority";

export type DigestSlot = "morning" | "afternoon";

export type OpsDigestSettings = {
  enabled: boolean;
  morning: boolean;
  afternoon: boolean;
  morningHour: number;
  afternoonHour: number;
};

const DEFAULT_DIGEST: OpsDigestSettings = {
  enabled: true,
  morning: true,
  afternoon: true,
  morningHour: 8,
  afternoonHour: 15,
};

type ProfileRow = {
  id: string;
  business_name: string | null;
  clinic_name: string | null;
  profile_name: string | null;
  timezone: string | null;
  metadata: Record<string, unknown> | null;
};

type FollowUpRow = {
  id: string;
  profile_id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string | null;
  category: string | null;
  due_at: string | null;
  snoozed_until: string | null;
  created_at: string;
  wisecall_call_logs:
    | { caller_id: string | null }
    | { caller_id: string | null }[]
    | null;
};

export function readOpsDigestSettings(
  metadata: Record<string, unknown> | null | undefined,
): OpsDigestSettings {
  const raw = metadata?.ops_digest;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_DIGEST };
  const r = raw as Record<string, unknown>;
  return {
    enabled: r.enabled !== false,
    morning: r.morning !== false,
    afternoon: r.afternoon !== false,
    morningHour:
      typeof r.morning_hour === "number" && r.morning_hour >= 0 && r.morning_hour <= 23
        ? r.morning_hour
        : DEFAULT_DIGEST.morningHour,
    afternoonHour:
      typeof r.afternoon_hour === "number" && r.afternoon_hour >= 0 && r.afternoon_hour <= 23
        ? r.afternoon_hour
        : DEFAULT_DIGEST.afternoonHour,
  };
}

export function digestRecipients(metadata: Record<string, unknown> | null | undefined): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (value: unknown) => {
    const list = Array.isArray(value)
      ? value
      : typeof value === "string"
        ? value.split(",")
        : [];
    for (const item of list) {
      const email = String(item).trim();
      const key = email.toLowerCase();
      if (!email || !email.includes("@") || seen.has(key)) continue;
      seen.add(key);
      out.push(email);
    }
  };
  push(metadata?.default_routing_email);
  push(metadata?.notification_emails);
  if (!out.length) {
    const fallback = process.env.WISECALL_EMAIL_TO || "";
    push(fallback);
  }
  return out;
}

function localParts(timeZone: string, at = new Date()) {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    hour12: false,
  });
  const parts = fmt.formatToParts(at);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const year = get("year");
  const month = get("month");
  const day = get("day");
  const hour = Number(get("hour"));
  return {
    localDate: `${year}-${month}-${day}`,
    hour: Number.isFinite(hour) ? hour : 0,
  };
}

function callerFromRow(row: FollowUpRow): string {
  const rel = row.wisecall_call_logs;
  const log = Array.isArray(rel) ? rel[0] : rel;
  return log?.caller_id || "Unknown";
}

function asPriority(value: string | null): FollowUpPriority {
  if (value === "critical" || value === "high" || value === "normal" || value === "low") {
    return value;
  }
  return "normal";
}

function asCategory(value: string | null): FollowUpCategory {
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

export function shouldSendDigestSlot(
  settings: OpsDigestSettings,
  slot: DigestSlot,
  localHour: number,
): boolean {
  if (!settings.enabled) return false;
  if (slot === "morning") {
    return settings.morning && localHour === settings.morningHour;
  }
  return settings.afternoon && localHour === settings.afternoonHour;
}

export function buildDigestHtml(input: {
  businessName: string;
  slot: DigestSlot;
  items: Array<{
    id: string;
    title: string;
    caller: string;
    priority: FollowUpPriority;
    category: FollowUpCategory;
    dueAt: string | null;
    description: string;
  }>;
  portalUrl: string;
}): { subject: string; html: string; text: string } {
  const heading = input.slot === "morning" ? "Morning overview" : "Afternoon catch-up";
  const ranked = [...input.items].sort(
    (a, b) => priorityRank(a.priority) - priorityRank(b.priority),
  );
  const doFirst = ranked.filter(
    (item) => item.priority === "critical" || item.priority === "high",
  );
  const rest = ranked.filter(
    (item) => item.priority !== "critical" && item.priority !== "high",
  );
  const shownFirst = doFirst.slice(0, 5);
  const shownRest = rest.slice(0, 8);
  const overflow = Math.max(0, input.items.length - shownFirst.length - shownRest.length);

  const renderItem = (item: (typeof input.items)[number]) => {
    const due = item.dueAt
      ? new Date(item.dueAt).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "short",
        })
      : "No due date";
    return `<li style="margin:0 0 10px;">
      <strong>${escapeHtml(item.title)}</strong><br/>
      <span style="color:#4a5c5b;font-size:13px;">
        ${escapeHtml(priorityLabel(item.priority))} · ${escapeHtml(categoryLabel(item.category))}
        · ${escapeHtml(item.caller)} · due ${escapeHtml(due)}
      </span>
      ${item.description ? `<br/><span style="color:#6a7a79;font-size:12px;">${escapeHtml(item.description.slice(0, 160))}</span>` : ""}
    </li>`;
  };

  const html = `
    <div style="font-family:system-ui,sans-serif;color:#172929;max-width:560px;">
      <h2 style="margin:0 0 8px;font-size:18px;">${escapeHtml(heading)}</h2>
      <p style="margin:0 0 16px;color:#4a5c5b;">
        ${escapeHtml(input.businessName)} · ${input.items.length} outstanding
        ${input.slot === "afternoon" ? " (still open / due)" : " to handle today"}
      </p>
      ${
        shownFirst.length
          ? `<h3 style="margin:0 0 8px;font-size:14px;">Do first</h3><ul style="padding-left:18px;margin:0 0 16px;">${shownFirst.map(renderItem).join("")}</ul>`
          : ""
      }
      ${
        shownRest.length
          ? `<h3 style="margin:0 0 8px;font-size:14px;">Still open</h3><ul style="padding-left:18px;margin:0 0 16px;">${shownRest.map(renderItem).join("")}</ul>`
          : ""
      }
      ${
        overflow
          ? `<p style="margin:0 0 16px;color:#4a5c5b;font-size:13px;">+${overflow} more in your WiseCall portal.</p>`
          : ""
      }
      <p style="margin:0;">
        <a href="${escapeHtml(input.portalUrl)}" style="color:#0e6b6e;font-weight:700;">Open follow-ups</a>
      </p>
      <p style="margin:20px 0 0;font-size:12px;color:#7a8a89;">
        Leads, sales and complaints stay at the top. Reply is not monitored — use the portal to mark items done.
      </p>
    </div>`;

  const textLines = [
    `${heading} · ${input.businessName}`,
    `${input.items.length} outstanding`,
    "",
    ...shownFirst.map(
      (item) =>
        `[${priorityLabel(item.priority)}] ${item.title} (${item.caller})`,
    ),
    ...shownRest.map(
      (item) =>
        `[${priorityLabel(item.priority)}] ${item.title} (${item.caller})`,
    ),
    overflow ? `+${overflow} more in portal` : "",
    "",
    input.portalUrl,
  ].filter(Boolean);

  return {
    subject: `${heading} · ${input.items.length} outstanding · ${input.businessName}`,
    html,
    text: textLines.join("\n"),
  };
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function alreadySent(
  profileId: string,
  slot: DigestSlot,
  localDate: string,
): Promise<boolean> {
  const supabase = getServiceSupabase();
  if (!supabase) return true;
  const { data } = await supabase
    .from("wisecall_ops_digest_sends")
    .select("id")
    .eq("profile_id", profileId)
    .eq("slot", slot)
    .eq("local_date", localDate)
    .maybeSingle();
  return Boolean(data?.id);
}

async function markSent(
  profileId: string,
  slot: DigestSlot,
  localDate: string,
  itemIds: string[],
): Promise<void> {
  const supabase = getServiceSupabase();
  if (!supabase) return;
  await supabase.from("wisecall_ops_digest_sends").upsert(
    {
      profile_id: profileId,
      slot,
      local_date: localDate,
      item_count: itemIds.length,
      item_ids: itemIds,
      sent_at: new Date().toISOString(),
    },
    { onConflict: "profile_id,slot,local_date" },
  );
}

async function loadOutstanding(profileId: string): Promise<
  Array<{
    id: string;
    title: string;
    caller: string;
    priority: FollowUpPriority;
    category: FollowUpCategory;
    dueAt: string | null;
    description: string;
  }>
> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("wisecall_follow_ups")
    .select(
      "id, profile_id, title, description, status, priority, category, due_at, snoozed_until, created_at, wisecall_call_logs(caller_id)",
    )
    .eq("profile_id", profileId)
    .in("status", ["open", "snoozed"])
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    console.error("ops digest loadOutstanding:", error.message);
    return [];
  }

  const items = ((data ?? []) as FollowUpRow[])
    .filter((row) =>
      isEffectivelyOpen({
        status: row.status,
        snoozedUntil: row.snoozed_until,
      }),
    )
    .map((row) => ({
      id: row.id,
      title: row.title,
      caller: callerFromRow(row),
      priority: asPriority(row.priority),
      category: asCategory(row.category),
      dueAt: row.due_at,
      description: row.description ?? "",
      createdAt: row.created_at,
    }))
    .sort((a, b) => {
      const rank = priorityRank(a.priority) - priorityRank(b.priority);
      if (rank !== 0) return rank;
      const aDue = a.dueAt ? new Date(a.dueAt).getTime() : Number.POSITIVE_INFINITY;
      const bDue = b.dueAt ? new Date(b.dueAt).getTime() : Number.POSITIVE_INFINITY;
      return aDue - bDue;
    });

  return items;
}

export async function processOpsDigests(now = new Date()): Promise<{
  ok: boolean;
  checked: number;
  sent: number;
  skipped: number;
  errors: string[];
}> {
  const supabase = getServiceSupabase();
  if (!supabase) {
    return { ok: false, checked: 0, sent: 0, skipped: 0, errors: ["Supabase not configured"] };
  }

  const { data: profiles, error } = await supabase
    .from("wisecall_profiles")
    .select("id, business_name, clinic_name, profile_name, timezone, metadata")
    .eq("is_active", true)
    .limit(500);

  if (error) {
    return { ok: false, checked: 0, sent: 0, skipped: 0, errors: [error.message] };
  }

  const portalBase =
    process.env.NEXT_PUBLIC_APP_URL?.replace(/\/+$/, "") || "https://app.wisecall.io";
  let sent = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const profile of (profiles ?? []) as ProfileRow[]) {
    const settings = readOpsDigestSettings(profile.metadata);
    if (!settings.enabled) {
      skipped += 1;
      continue;
    }

    const tz = profile.timezone || "Europe/London";
    const { localDate, hour } = localParts(tz, now);
    const slots: DigestSlot[] = [];
    if (shouldSendDigestSlot(settings, "morning", hour)) slots.push("morning");
    if (shouldSendDigestSlot(settings, "afternoon", hour)) slots.push("afternoon");
    if (!slots.length) {
      skipped += 1;
      continue;
    }

    const recipients = digestRecipients(profile.metadata);
    if (!recipients.length) {
      skipped += 1;
      continue;
    }

    const items = await loadOutstanding(profile.id);
    if (!items.length) {
      skipped += 1;
      continue;
    }

    const businessName =
      profile.business_name || profile.clinic_name || profile.profile_name || "Your business";

    for (const slot of slots) {
      if (await alreadySent(profile.id, slot, localDate)) {
        skipped += 1;
        continue;
      }

      const content = buildDigestHtml({
        businessName,
        slot,
        items,
        portalUrl: `${portalBase}/dashboard`,
      });

      let anyOk = false;
      for (const to of recipients) {
        const result = await sendViaResend({
          to,
          subject: content.subject,
          body: content.text,
          html: content.html,
          tags: [
            { name: "type", value: "ops_digest" },
            { name: "slot", value: slot },
          ],
        });
        if (!result.ok) {
          errors.push(`${profile.id}/${slot}/${to}: ${result.error}`);
        } else {
          anyOk = true;
        }
      }

      if (anyOk) {
        await markSent(
          profile.id,
          slot,
          localDate,
          items.map((item) => item.id),
        );
        sent += 1;
      }
    }
  }

  return {
    ok: errors.length === 0,
    checked: (profiles ?? []).length,
    sent,
    skipped,
    errors: errors.slice(0, 20),
  };
}
