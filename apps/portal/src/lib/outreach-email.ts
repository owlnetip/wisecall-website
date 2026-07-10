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

/** Template family for Dentally / Exact sequence isolation. */
export function templateFamilyForSegment(segment: string): string {
  if (segment === "dentally_active") return "dentally";
  if (segment === "exact_queued") return "exact";
  return "general";
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
