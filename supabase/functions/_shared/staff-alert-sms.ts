// Staff-alert SMS after a call. Numbers: metadata.staff_alert_sms, else mobiles
// on routing contacts with notify=true. Gated by wisecall_profiles.sms_enabled.

import type { CallerIdentity } from "./caller-identity.ts";

const UK_MOBILE = /^(?:\+?44|0)7\d{9}$/;
const E164 = /^\+[1-9]\d{7,14}$/;

export function toE164(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim().replace(/[\s()-]/g, "");
  if (!value) return null;
  if (value.startsWith("00")) value = `+${value.slice(2)}`;
  if (UK_MOBILE.test(value)) {
    const national = value.replace(/^\+?44/, "0");
    return `+44${national.slice(1)}`;
  }
  if (E164.test(value)) return value;
  return null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function uniqueE164(raw: unknown[]): string[] {
  const unique = new Set<string>();
  for (const item of raw) {
    const e164 = toE164(item);
    if (e164) unique.add(e164);
  }
  return [...unique];
}

function routingNotifyMobiles(metadata: Record<string, unknown>): string[] {
  const raw = metadata.routing_contacts;
  if (!Array.isArray(raw)) return [];
  const phones: unknown[] = [];
  for (const item of raw) {
    if (!isPlainObject(item) || item.notify !== true) continue;
    phones.push(item.phone);
  }
  return uniqueE164(phones);
}

/** Destinations for a hangup staff-alert, or [] when SMS is off / not configured. */
export function staffAlertNumbers(
  metadata: Record<string, unknown> | null | undefined,
  smsEnabled: unknown,
): string[] {
  if (smsEnabled === false) return [];
  const meta = isPlainObject(metadata) ? metadata : {};
  const cfg = isPlainObject(meta.staff_alert_sms) ? meta.staff_alert_sms : null;
  if (cfg?.enabled === false) return [];

  const configured = uniqueE164(Array.isArray(cfg?.numbers) ? cfg.numbers : []);
  const numbers = configured.length ? configured : routingNotifyMobiles(meta);
  if (cfg?.mode === "first") return numbers.slice(0, 1);
  return numbers;
}

export type StaffAlertSmsInput = {
  businessName: string;
  callerId: string;
  callerName?: string;
  company?: string;
  summary: string;
  actionItems?: string[];
};

function callerPhrase(input: StaffAlertSmsInput): string {
  const phone = (input.callerId || "Unknown").trim() || "Unknown";
  const name = (input.callerName || "").trim();
  const company = (input.company || "").trim();
  if (name && company) return `${name} at ${company} called from ${phone}`;
  if (company) return `${company} called from ${phone}`;
  if (name) return `${name} called from ${phone}`;
  return `call from ${phone}`;
}

/** Compact staff text — business + caller company first, no transcript. */
export function buildStaffAlertSms(input: StaffAlertSmsInput): string {
  const business = (input.businessName || "WiseCall").trim().slice(0, 40) || "WiseCall";
  const followUp = (input.actionItems ?? [])
    .map((item) => item.trim())
    .filter(Boolean)[0];
  const summary = input.summary.trim().replace(/\s+/g, " ");
  const parts = [`${business}: ${callerPhrase(input)}.`];
  if (followUp) parts.push(followUp.replace(/\s+/g, " "));
  if (summary) parts.push(summary);
  return parts.join(" ").slice(0, 480);
}

export function staffAlertFromIdentity(
  businessName: string,
  identity: CallerIdentity,
  summary: string,
  actionItems?: string[],
): string {
  return buildStaffAlertSms({
    businessName,
    callerId: identity.callerId,
    callerName: identity.callerName,
    company: identity.company,
    summary,
    actionItems,
  });
}

export async function sendStaffAlertSms(opts: {
  phones: string[];
  message: string;
  profileId: string;
  profileSlug: string | null;
  callId: string | null;
}): Promise<{ sent: string[]; error?: string }> {
  if (!opts.phones.length) return { sent: [] };
  const expectedSecret = Deno.env.get("WISECALL_SMS_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!expectedSecret || !supabaseUrl) {
    return { sent: [], error: "SMS helper not configured" };
  }
  const sent: string[] = [];
  let lastError = "";
  const linkType = `staff-alert-${(opts.callId || opts.profileId).slice(0, 12)}`;
  for (const phone of opts.phones) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/wisecall-send-sms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-WiseCall-SMS-Secret": expectedSecret,
        },
        body: JSON.stringify({
          phone,
          message: opts.message,
          link_type: linkType,
          call_id: opts.callId,
          profile_id: opts.profileId,
          profile_slug: opts.profileSlug,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.success) {
        sent.push(phone);
      } else {
        lastError = String(result.error || `SMS ${res.status}`);
        console.error("[staff-alert-sms] failed:", phone, lastError);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error("[staff-alert-sms] error:", phone, lastError);
    }
  }
  return { sent, error: sent.length ? undefined : lastError || "SMS send failed" };
}
