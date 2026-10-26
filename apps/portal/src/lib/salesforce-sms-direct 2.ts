import type { SupabaseClient } from "@supabase/supabase-js";
import type { SalesforceAccess } from "@/lib/salesforce-sms-client";
import { canonicalSmsDigits, normaliseSmsDestination } from "@/lib/salesforce-sms";

// Salesforce-driven SMS (BetterMove architecture, 25 Sep 2026).
// Salesforce owns templates, matching and Tasks. WiseCall sends the text,
// remembers which record a number was texted about, and hands replies to
// Salesforce's /services/apexrest/wisecall/sms/reply.

export type DirectSalesforceObject = "Lead" | "Contact" | "Account";

export function salesforceObjectForId(id: string): DirectSalesforceObject | null {
  if (!/^[a-zA-Z0-9]{15}(?:[a-zA-Z0-9]{3})?$/.test(id)) return null;
  const prefix = id.slice(0, 3);
  if (prefix === "00Q") return "Lead";
  if (prefix === "003") return "Contact";
  if (prefix === "001") return "Account";
  return null;
}

export type DirectSendRequest = {
  profileId: string;
  recordId: string;
  object: DirectSalesforceObject;
  to: string;
  from: string | null;
  text: string;
  idempotencyKey: string | null;
};

export function parseDirectSendBody(
  payload: unknown,
  idempotencyHeader?: string | null,
): { ok: true; value: DirectSendRequest } | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "JSON object body is required." };
  }
  const body = payload as Record<string, unknown>;
  const profileId = String(body.profile_id || "").trim().toLowerCase();
  const recordId = String(body.record_id || "").trim();
  const object = salesforceObjectForId(recordId);
  const to = normaliseSmsDestination(String(body.phone || body.to || ""));
  const text = String(body.text || "").trim();
  const from = typeof body.from === "string" && body.from.trim() ? body.from.trim() : null;
  const key = (idempotencyHeader || (typeof body.idempotency_key === "string" ? body.idempotency_key : "") || "").trim();

  if (!/^[0-9a-f-]{36}$/.test(profileId)) return { ok: false, error: "profile_id is required." };
  if (!object) return { ok: false, error: "record_id must be a Lead, Contact or Account id." };
  if (!to) return { ok: false, error: "phone must be a valid phone number." };
  if (!text) return { ok: false, error: "text is required." };
  if (text.length > 1000) return { ok: false, error: "text must be 1000 characters or fewer." };
  if (key.length > 200) return { ok: false, error: "Idempotency-Key must be 200 characters or fewer." };
  return { ok: true, value: { profileId, recordId, object, to, from, text, idempotencyKey: key || null } };
}

/** Remember which record this number was texted about, so replies route back to it. */
export async function saveDirectBinding(
  supabase: SupabaseClient,
  input: { profileId: string; phoneDigits: string; recordId: string; object: DirectSalesforceObject },
): Promise<string | null> {
  const now = new Date().toISOString();
  const { data, error } = await supabase
    .from("wisecall_salesforce_sms_bindings")
    .upsert(
      {
        profile_id: input.profileId,
        phone_digits: input.phoneDigits,
        salesforce_record_id: input.recordId,
        salesforce_object: input.object,
        record_name: null,
        reply_recipient_type: "salesforce",
        reply_recipient_id: null,
        reply_recipient_name: null,
        reply_recipient_email: null,
        confirmed_candidate_ids: [input.recordId],
        confirmed_at: now,
        updated_at: now,
      },
      { onConflict: "profile_id,phone_digits" },
    )
    .select("id")
    .single();
  if (error) throw new Error(`Could not store SMS thread: ${error.message}`);
  return (data?.id as string) ?? null;
}

export type SalesforceReplyOutcome = {
  delivered: boolean;
  status: number;
  matchType: string | null;
  recordId: string | null;
  taskId: string | null;
  fallbackEmailSent: boolean;
  error: string | null;
};

/** Hand a reply to Salesforce's WiseCallSmsReplyResource (runs there as the integration user). */
export async function postReplyToSalesforce(input: {
  access: SalesforceAccess;
  phone: string;
  content: string;
  recordId: string | null;
  messageId: string | null;
  fetchImpl?: typeof fetch;
}): Promise<SalesforceReplyOutcome> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${input.access.instanceUrl}/services/apexrest/wisecall/sms/reply`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.access.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      phone: input.phone,
      content: input.content,
      record_id: input.recordId,
      message_id: input.messageId,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (value: unknown) => (typeof value === "string" && value ? value : null);
  const ok = response.ok && body?.ok === true;
  return {
    // Matched (Task created) or unmatched with the fallback email handled both count as delivered.
    delivered: ok && (Boolean(str(body?.task_id)) || body?.match_type === "none"),
    status: response.status,
    matchType: str(body?.match_type),
    recordId: str(body?.record_id),
    taskId: str(body?.task_id),
    fallbackEmailSent: body?.fallback_email_sent === true,
    error: ok ? null : str(body?.error) || `Salesforce returned HTTP ${response.status}`,
  };
}

export function replyDigits(raw: string): string {
  return canonicalSmsDigits(raw);
}

/** Hand a delivery receipt to Salesforce, which updates the outbound SMS Task. */
export async function postStatusToSalesforce(input: {
  access: SalesforceAccess;
  recordId: string | null;
  messageId: string;
  status: string;
  error: string | null;
  at: string | null;
  fetchImpl?: typeof fetch;
}): Promise<{ ok: boolean; taskId: string | null; status: number; error: string | null }> {
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(`${input.access.instanceUrl}/services/apexrest/wisecall/sms/reply`, {
    method: "POST",
    headers: { Authorization: `Bearer ${input.access.accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      type: "status",
      record_id: input.recordId,
      message_id: input.messageId,
      status: input.status,
      error: input.error,
      at: input.at,
    }),
    redirect: "error",
    signal: AbortSignal.timeout(20000),
  });
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;
  const ok = response.ok && body?.ok === true;
  return {
    ok,
    taskId: typeof body?.task_id === "string" ? body.task_id : null,
    status: response.status,
    error: ok ? null : (typeof body?.error === "string" && body.error) || `Salesforce returned HTTP ${response.status}`,
  };
}
