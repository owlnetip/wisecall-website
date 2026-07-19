import { renderObjective } from "@/lib/csv";

const FOLLOW_UP_DAYS: Record<string, number> = {
  follow_up_3: 3,
  follow_up_7: 7,
  follow_up_14: 14,
};

export function followUpDaysForStep(step: string): number | null {
  return FOLLOW_UP_DAYS[step] ?? null;
}

export function addDays(iso: string | Date, days: number): string {
  const d = new Date(iso);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString();
}

/** UTC hour follow-ups are scheduled for (matches the 09:00 UTC cron). */
export const FOLLOW_UP_SEND_HOUR_UTC = 9;

/**
 * Schedule a follow-up on calendar day N after the initial send, at 09:00 UTC.
 * Day 3 means "the third calendar day after send", not exactly 72 hours later,
 * so a send on the 16th is due on the morning of the 19th.
 */
export function scheduleFollowUpAt(sentAt: string | Date, days: number): string {
  const base = new Date(sentAt);
  return new Date(
    Date.UTC(
      base.getUTCFullYear(),
      base.getUTCMonth(),
      base.getUTCDate() + days,
      FOLLOW_UP_SEND_HOUR_UTC,
      0,
      0,
      0,
    ),
  ).toISOString();
}

/** Template family for Dentally / Exact / property sequence isolation. */
export function templateFamilyForSegment(segment: string): string {
  if (segment === "dentally_active") return "dentally";
  if (segment === "exact_queued") return "exact";
  if (
    segment === "property_ready" ||
    segment === "property_unknown" ||
    segment === "property_corporate_hold"
  ) {
    return "property";
  }
  return "general";
}

/** Shared inbox for dental outreach replies — never the logged-in admin address. */
export const DEFAULT_OUTREACH_REPLY_TO = "info@owlnet.io";

export function outreachReplyTo(): string {
  const fromEnv = process.env.OUTREACH_REPLY_TO?.trim();
  if (fromEnv) return fromEnv;
  const fromAddress = process.env.RESEND_FROM_EMAIL?.replace(/^.*<([^>]+)>.*$/, "$1").trim();
  if (fromAddress) return fromAddress;
  return DEFAULT_OUTREACH_REPLY_TO;
}

/** Render {{tokens}} and optional {{#contact_name}}...{{/contact_name}} blocks. */
export function renderOutreachTemplate(
  template: string,
  fields: Record<string, string>,
): string {
  let out = renderObjective(template, fields);
  const contact = (fields.contact_name || fields.name || "").trim();
  if (contact) {
    out = out.replace(/\{\{#contact_name\}\}/g, "").replace(/\{\{\/contact_name\}\}/g, "");
  } else {
    out = out.replace(/\{\{#contact_name\}\}[\s\S]*?\{\{\/contact_name\}\}/g, "");
  }
  return out.replace(/\n{3,}/g, "\n\n").trim();
}

export async function sendViaResend(input: {
  to: string;
  subject: string;
  body: string;
  /** When set, the email is sent as HTML; `body` becomes the text fallback. */
  html?: string;
  replyTo?: string;
  tags?: Array<{ name: string; value: string }>;
  headers?: Record<string, string>;
}): Promise<{ ok: true; id: string } | { ok: false; error: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM_EMAIL ?? "WiseCall <hello@wisecall.io>";
  if (!apiKey) return { ok: false, error: "RESEND_API_KEY is not configured." };

  const html = input.html?.trim();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [input.to.trim()],
      subject: input.subject.trim(),
      // Always include text as a fallback; add html when we have a rich body.
      text: input.body.trim(),
      ...(html ? { html } : {}),
      ...(input.replyTo ? { reply_to: input.replyTo } : {}),
      ...(input.tags?.length ? { tags: input.tags } : {}),
      ...(input.headers && Object.keys(input.headers).length
        ? { headers: input.headers }
        : {}),
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, error: `Resend ${res.status}: ${text.slice(0, 300)}` };
  }

  const data = (await res.json()) as { id?: string };
  return { ok: true, id: data.id ?? "sent" };
}
