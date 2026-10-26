// Staff-alert SMS after a call. Numbers live on profile.metadata.staff_alert_sms
// and are gated by wisecall_profiles.sms_enabled.

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

/** Destinations for a hangup staff-alert, or [] when SMS is off / not configured. */
export function staffAlertNumbers(
  metadata: Record<string, unknown> | null | undefined,
  smsEnabled: unknown,
): string[] {
  if (smsEnabled === false) return [];
  const cfg = isPlainObject(metadata?.staff_alert_sms)
    ? metadata.staff_alert_sms
    : null;
  if (!cfg || cfg.enabled === false) return [];
  const raw = Array.isArray(cfg.numbers) ? cfg.numbers : [];
  const unique = new Set<string>();
  for (const item of raw) {
    const e164 = toE164(item);
    if (e164) unique.add(e164);
  }
  const numbers = [...unique];
  if (cfg.mode === "first") return numbers.slice(0, 1);
  return numbers;
}

export type StaffAlertSmsInput = {
  businessName: string;
  callerId: string;
  summary: string;
  actionItems?: string[];
};

/** Compact staff text — summary first, no transcript. */
export function buildStaffAlertSms(input: StaffAlertSmsInput): string {
  const business = (input.businessName || "WiseCall").trim().slice(0, 40) || "WiseCall";
  const caller = (input.callerId || "Unknown").trim() || "Unknown";
  const followUp = (input.actionItems ?? [])
    .map((item) => item.trim())
    .filter(Boolean)[0];
  const summary = input.summary.trim().replace(/\s+/g, " ");
  const parts = [`${business}: call from ${caller}.`];
  if (followUp) parts.push(followUp.replace(/\s+/g, " "));
  if (summary) parts.push(summary);
  return parts.join(" ").slice(0, 480);
}
