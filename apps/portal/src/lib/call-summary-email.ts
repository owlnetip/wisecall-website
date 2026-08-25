import { getServiceSupabase } from "@/lib/supabase";

export function asEmailList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function uniqueEmails(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const email = value.trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function contactRouteKey(contact: { id?: string; name?: string }): string {
  const name = String(contact.name || "").trim();
  return slugify(name).replace(/-/g, "_") || String(contact.id || "");
}

export type TransferHint = {
  route_key?: string;
  label?: string;
};

export function defaultInboxEmails(metadata: Record<string, unknown>): string[] {
  return uniqueEmails([
    ...asEmailList(metadata.default_routing_email),
    ...asEmailList(metadata.notification_emails),
    ...asEmailList(metadata.fallback_email),
  ]);
}

function routingContacts(metadata: Record<string, unknown>): Array<Record<string, unknown>> {
  const raw = metadata.routing_contacts;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === "object") as Array<
    Record<string, unknown>
  >;
}

function contactNotifyEmails(
  contact: Record<string, unknown>,
  defaultInbox: string[],
): string[] {
  if (contact.notify !== true) return [];
  if (contact.useDefaultEmail === true) return defaultInbox.slice(0, 1);
  return uniqueEmails(asEmailList(contact.email));
}

function matchesTransfer(
  contact: Record<string, unknown>,
  transfer?: TransferHint | null,
): boolean {
  if (!transfer) return false;
  const routeKey = String(transfer.route_key || "").trim().toLowerCase();
  const label = String(transfer.label || "").trim().toLowerCase();
  const id = String(contact.id || "").trim().toLowerCase();
  const name = String(contact.name || "").trim().toLowerCase();
  const key = contactRouteKey({
    id: String(contact.id || ""),
    name: String(contact.name || ""),
  }).toLowerCase();
  if (routeKey && (routeKey === id || routeKey === key)) return true;
  if (label && label === name) return true;
  return false;
}

/**
 * Who should receive a taken-message / call-summary email.
 * Keep in sync with supabase/functions/_shared/notification-recipients.ts.
 */
export function callSummaryRecipients(
  metadata: Record<string, unknown>,
  transfer?: TransferHint | null,
): string[] {
  const inbox = defaultInboxEmails(metadata);
  const contacts = routingContacts(metadata);
  const matched: string[] = [];
  const notifyAll: string[] = [];

  for (const contact of contacts) {
    const emails = contactNotifyEmails(contact, inbox);
    notifyAll.push(...emails);
    if (matchesTransfer(contact, transfer)) matched.push(...emails);
  }

  const configured = uniqueEmails([...inbox, ...matched]);
  if (configured.length) return configured;
  return uniqueEmails(notifyAll);
}

export function mergeNotificationEmails(
  previousDefault: string,
  nextDefault: string,
  existing: unknown,
): string[] {
  const previous = previousDefault.trim().toLowerCase();
  const kept = asEmailList(existing).filter((email) => email.toLowerCase() !== previous);
  return uniqueEmails([nextDefault.trim(), ...kept]);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function isLiveChatLog(log: {
  call_id?: string | null;
  metadata?: Record<string, unknown> | null;
}): boolean {
  const metadata = log.metadata ?? {};
  const source = String(metadata.source || "");
  const channel = String(metadata.channel || "");
  const callId = String(log.call_id || "");
  return (
    source === "wisecall-live-chat" ||
    channel === "live_chat" ||
    callId.startsWith("chat_")
  );
}

function transferFromMetadata(metadata: Record<string, unknown>): TransferHint | null {
  const collected =
    metadata.collected && typeof metadata.collected === "object"
      ? (metadata.collected as Record<string, unknown>)
      : {};
  const routeKey = String(
    collected.transfer_route_key || metadata.transfer_route_key || "",
  ).trim();
  const label = String(collected.transfer_label || metadata.transfer_label || "").trim();
  if (!routeKey && !label) return null;
  return { route_key: routeKey || undefined, label: label || undefined };
}

export function buildCallSummaryHtml(input: {
  businessName: string;
  callerId: string;
  summary: string;
  transcript: string;
  outcome: string;
  startedAt?: string | null;
}): string {
  const when = input.startedAt
    ? new Date(input.startedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })
    : "";
  return `
    <div style="font-family:system-ui,sans-serif;color:#172929;max-width:640px;">
      <h2 style="margin:0 0 8px;font-size:20px;">New message for ${escapeHtml(input.businessName)}</h2>
      <p style="margin:0 0 16px;color:#4a5c5b;">A caller left a message with your WiseCall assistant.</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 18px;">
        <tr><td style="padding:6px 0;color:#148b8e;font-weight:700;width:120px;">Caller</td><td>${escapeHtml(input.callerId || "Unknown")}</td></tr>
        ${when ? `<tr><td style="padding:6px 0;color:#148b8e;font-weight:700;">When</td><td>${escapeHtml(when)}</td></tr>` : ""}
        ${input.outcome ? `<tr><td style="padding:6px 0;color:#148b8e;font-weight:700;">Outcome</td><td>${escapeHtml(input.outcome)}</td></tr>` : ""}
      </table>
      ${
        input.summary
          ? `<p style="margin:0 0 16px;padding:12px;background:#f0faf9;border-radius:8px;"><strong>What happened:</strong> ${escapeHtml(input.summary)}</p>`
          : ""
      }
      ${
        input.transcript
          ? `<h3 style="margin:0 0 8px;font-size:15px;">Transcript</h3><pre style="white-space:pre-wrap;background:#f7fafa;border:1px solid #d7e4e3;border-radius:8px;padding:14px;font-family:ui-monospace,monospace;line-height:1.45;">${escapeHtml(input.transcript)}</pre>`
          : ""
      }
      <p style="margin:20px 0 0;font-size:12px;color:#7a8a89;">Open the conversation in your WiseCall inbox to call back.</p>
    </div>`;
}

type SendResult = { ok: boolean; skipped?: string; sent?: number; error?: string };

async function sendViaResend(input: {
  to: string[];
  subject: string;
  html: string;
  text: string;
}): Promise<{ ok: boolean; error?: string }> {
  const apiKey = process.env.RESEND_API_KEY;
  const from =
    process.env.RESEND_FROM_EMAIL ||
    process.env.WISECALL_EMAIL_FROM ||
    "WiseCall <hello@wisecall.io>";
  if (!apiKey) return { ok: false, error: "missing_resend" };

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: input.to,
      subject: input.subject,
      html: input.html,
      text: input.text,
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    return { ok: false, error: `Resend ${res.status}: ${body.slice(0, 300)}` };
  }
  return { ok: true };
}

/**
 * Email the agent's configured inbox after a phone call. Independent of
 * action-item extraction so a taken message still arrives even when analysis
 * marks "no follow-up needed". Live chat has its own sender and is skipped.
 */
export async function sendCallSummaryForLog(
  callLogId: string,
  extra?: { managerSummary?: string },
): Promise<SendResult> {
  const supabase = getServiceSupabase();
  if (!supabase) return { ok: false, skipped: "missing_supabase" };

  const { data: log, error: logError } = await supabase
    .from("wisecall_call_logs")
    .select(
      "id, call_id, profile_id, profile_name, caller_id, summary, transcript, outcome, started_at, metadata",
    )
    .eq("id", callLogId)
    .maybeSingle();
  if (logError) return { ok: false, error: logError.message };
  if (!log) return { ok: false, skipped: "missing_call" };
  if (isLiveChatLog(log)) return { ok: true, skipped: "live_chat" };

  const metadata = (log.metadata && typeof log.metadata === "object"
    ? log.metadata
    : {}) as Record<string, unknown>;
  if (metadata.summary_email_sent === true) {
    return { ok: true, skipped: "already_sent" };
  }

  const summary = (extra?.managerSummary || log.summary || "").trim();
  const transcript = (log.transcript || "").trim();
  if (summary.length < 3 && transcript.length < 10) {
    return { ok: true, skipped: "no_content" };
  }

  if (!log.profile_id) return { ok: false, skipped: "missing_profile" };

  const { data: profile, error: profileError } = await supabase
    .from("wisecall_profiles")
    .select("id, profile_name, business_name, clinic_name, metadata")
    .eq("id", log.profile_id)
    .maybeSingle();
  if (profileError) return { ok: false, error: profileError.message };
  if (!profile) return { ok: false, skipped: "missing_profile" };

  const profileMeta = (profile.metadata && typeof profile.metadata === "object"
    ? profile.metadata
    : {}) as Record<string, unknown>;
  const to = callSummaryRecipients(profileMeta, transferFromMetadata(metadata));
  if (!to.length) return { ok: false, skipped: "no_recipients" };

  const businessName =
    profile.business_name ||
    profile.clinic_name ||
    profile.profile_name ||
    log.profile_name ||
    "Your business";
  const callerId = log.caller_id || "Unknown";
  const html = buildCallSummaryHtml({
    businessName,
    callerId,
    summary,
    transcript,
    outcome: log.outcome || "",
    startedAt: log.started_at,
  });
  const text = [
    `New message for ${businessName}`,
    `Caller: ${callerId}`,
    summary ? `What happened: ${summary}` : "",
    transcript ? `\n${transcript}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  const sent = await sendViaResend({
    to,
    subject: `Message from ${callerId} · ${businessName}`,
    html,
    text,
  });
  if (!sent.ok) {
    console.error("sendCallSummaryForLog failed:", sent.error);
    return { ok: false, error: sent.error };
  }

  const { error: flagError } = await supabase
    .from("wisecall_call_logs")
    .update({
      metadata: {
        ...metadata,
        summary_email_sent: true,
        summary_email_sent_at: new Date().toISOString(),
        summary_email_to: to,
      },
    })
    .eq("id", callLogId);
  if (flagError) {
    console.error("sendCallSummaryForLog flag failed:", flagError.message);
  }

  return { ok: true, sent: to.length };
}
