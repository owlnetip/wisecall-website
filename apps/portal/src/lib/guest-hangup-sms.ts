import { isGuestTestAgentMetadata } from "./guest-test-agent";
import { getSupabaseConfig } from "./env";
import { toE164UkMobile } from "./uk-callback-number";

const CONNECTED_OUTCOMES = new Set([
  "caller_stop",
  "remote_hangup",
  "agent_hangup",
  "completed",
  "hangup",
]);

const NEVER_CONNECTED_OUTCOMES = new Set([
  "no-answer",
  "no_answer",
  "busy",
  "failed",
  "canceled",
  "cancelled",
  "unanswered",
  "sms_sent",
  "sms_failed",
]);

export type GuestHangupSmsInput = {
  profileId?: string | null;
  profileSlug?: string | null;
  profileName?: string | null;
  businessName?: string | null;
  metadata?: unknown;
  callId: string;
  callerId?: string | null;
  outcome?: string | null;
  summary?: string | null;
  transcript?: string | null;
};

export function callConnectedForHangupSms(opts: {
  outcome?: string | null;
  summary?: string | null;
  transcript?: string | null;
}): boolean {
  const outcome = String(opts.outcome || "")
    .trim()
    .toLowerCase();
  if (NEVER_CONNECTED_OUTCOMES.has(outcome)) return false;
  const transcript = String(opts.transcript || "").trim();
  if (transcript.length >= 20) return true;
  const summary = String(opts.summary || "").trim();
  return CONNECTED_OUTCOMES.has(outcome) && summary.length > 0;
}

export function shouldSendGuestHangupSignupSms(input: GuestHangupSmsInput): boolean {
  if (!isGuestTestAgentMetadata(input.metadata)) return false;
  if (!toE164UkMobile(String(input.callerId || ""))) return false;
  return callConnectedForHangupSms(input);
}

export function buildDemoSmsAfterCallBody(input: GuestHangupSmsInput): Record<string, unknown> {
  return {
    event: "after_call",
    profile: {
      id: input.profileId || undefined,
      slug: input.profileSlug || undefined,
      profile_name: input.profileName || undefined,
      business_name: input.businessName || undefined,
    },
    session: {
      call_id: input.callId,
      caller_id: input.callerId || "",
    },
    extra: {
      reason: input.outcome || "",
      summary: input.summary || "",
    },
  };
}

export function getDemoSmsEndpoint(): string {
  const explicit = process.env.WISECALL_DEMO_SMS_ENDPOINT?.trim();
  if (explicit) return explicit;
  const config = getSupabaseConfig();
  if (!config) return "";
  const secret = process.env.WISECALL_DEMO_SMS_SECRET?.trim();
  const functionName = secret ? "wisecall-demo-sms" : "wisecall-guest-hangup-sms";
  return `${config.url.replace(/\/+$/, "")}/functions/v1/${functionName}`;
}

export function demoSmsRequestHeaders(): Record<string, string> | null {
  const secret = process.env.WISECALL_DEMO_SMS_SECRET?.trim();
  if (secret) {
    return {
      "Content-Type": "application/json",
      Accept: "application/json",
      "X-WiseCall-Demo-Secret": secret,
    };
  }
  const config = getSupabaseConfig();
  if (!config) return null;
  return {
    "Content-Type": "application/json",
    Accept: "application/json",
    apikey: config.serviceRoleKey,
    Authorization: `Bearer ${config.serviceRoleKey}`,
  };
}

export async function sendGuestHangupSignupSms(
  input: GuestHangupSmsInput,
): Promise<{ ok: boolean; skipped?: string; status?: number; error?: string }> {
  if (!shouldSendGuestHangupSignupSms(input)) {
    return { ok: true, skipped: "not a connected guest hangup" };
  }

  const url = getDemoSmsEndpoint();
  const headers = demoSmsRequestHeaders();
  if (!url || !headers) {
    return { ok: false, skipped: "demo sms not configured" };
  }

  const response = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(buildDemoSmsAfterCallBody(input)),
    signal: AbortSignal.timeout(8000),
  });
  const body = (await response.json().catch(() => ({}))) as {
    success?: boolean;
    skipped?: string;
    suppressed?: boolean;
    error?: string;
  };

  if (!response.ok || body.success === false) {
    return {
      ok: false,
      status: response.status,
      error: body.error || "Demo hangup SMS failed.",
    };
  }

  const skipped = body.skipped || (body.suppressed ? "rate_limited" : undefined);
  return { ok: true, status: response.status, skipped };
}
