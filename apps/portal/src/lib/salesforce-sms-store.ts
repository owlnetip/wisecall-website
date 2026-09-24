import type { SupabaseClient } from "@supabase/supabase-js";
import {
  numericSenderDigits,
  type ResolvedReplyRoute,
  type SalesforceObjectType,
  type StoredSmsBinding,
} from "@/lib/salesforce-sms";

type BindingRow = {
  id: string;
  profile_id: string;
  phone_digits: string;
  salesforce_record_id: string;
  salesforce_object: SalesforceObjectType;
  record_name: string | null;
  reply_recipient_type: "owner" | "user";
  reply_recipient_id: string;
  reply_recipient_name: string | null;
  reply_recipient_email: string | null;
  confirmed_candidate_ids: unknown;
};

export function bindingFromRow(row: BindingRow): StoredSmsBinding {
  const ids = Array.isArray(row.confirmed_candidate_ids)
    ? row.confirmed_candidate_ids.filter((id): id is string => typeof id === "string")
    : [];
  const replyRoute: ResolvedReplyRoute = {
    type: row.reply_recipient_type,
    recipientId: row.reply_recipient_id,
    recipientName: row.reply_recipient_name,
    recipientEmail: row.reply_recipient_email,
  };
  return {
    id: row.id,
    profileId: row.profile_id,
    phoneDigits: row.phone_digits,
    salesforceRecordId: row.salesforce_record_id,
    salesforceObject: row.salesforce_object,
    recordName: row.record_name,
    replyRoute,
    confirmedCandidateIds: ids,
  };
}

export async function loadSmsBinding(
  supabase: SupabaseClient,
  profileId: string,
  phoneDigits: string,
): Promise<StoredSmsBinding | null> {
  const { data, error } = await supabase
    .from("wisecall_salesforce_sms_bindings")
    .select(
      "id, profile_id, phone_digits, salesforce_record_id, salesforce_object, record_name, reply_recipient_type, reply_recipient_id, reply_recipient_name, reply_recipient_email, confirmed_candidate_ids",
    )
    .eq("profile_id", profileId)
    .eq("phone_digits", phoneDigits)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  return bindingFromRow(data as BindingRow);
}

export async function saveSmsBinding(
  supabase: SupabaseClient,
  binding: StoredSmsBinding,
): Promise<{ id: string }> {
  const { data, error } = await supabase
    .from("wisecall_salesforce_sms_bindings")
    .upsert(
      {
        profile_id: binding.profileId,
        phone_digits: binding.phoneDigits,
        salesforce_record_id: binding.salesforceRecordId,
        salesforce_object: binding.salesforceObject,
        record_name: binding.recordName,
        reply_recipient_type: binding.replyRoute.type,
        reply_recipient_id: binding.replyRoute.recipientId,
        reply_recipient_name: binding.replyRoute.recipientName,
        reply_recipient_email: binding.replyRoute.recipientEmail,
        confirmed_candidate_ids: binding.confirmedCandidateIds,
        confirmed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "profile_id,phone_digits" },
    )
    .select("id")
    .single();
  if (error || !data?.id) throw new Error(error?.message || "Could not store the Salesforce SMS mapping.");
  return { id: data.id as string };
}

export async function findSentSms(
  supabase: SupabaseClient,
  profileId: string,
  idempotencyKey: string,
): Promise<{ body: Record<string, unknown> } | null> {
  const { data, error } = await supabase
    .from("wisecall_salesforce_sms_messages")
    .select("status, detail")
    .eq("profile_id", profileId)
    .eq("idempotency_key", idempotencyKey)
    .eq("status", "sent")
    .maybeSingle();
  if (error) throw new Error(error.message);
  const detail = data?.detail;
  if (!detail || typeof detail !== "object" || Array.isArray(detail)) return null;
  return { body: detail as Record<string, unknown> };
}

export class SmsMessageDuplicateError extends Error {
  constructor() {
    super("Salesforce SMS message already recorded.");
    this.name = "SmsMessageDuplicateError";
  }
}

export async function saveSmsMessage(
  supabase: SupabaseClient,
  row: {
    profileId: string;
    bindingId: string | null;
    direction: "outbound" | "inbound";
    phoneDigits: string;
    body: string;
    status: string;
    salesforceRecordId: string | null;
    salesforceTaskId: string | null;
    providerMessageId: string | null;
    idempotencyKey: string | null;
    detail: Record<string, unknown>;
  },
): Promise<void> {
  const { error } = await supabase.from("wisecall_salesforce_sms_messages").insert({
    profile_id: row.profileId,
    binding_id: row.bindingId,
    direction: row.direction,
    phone_digits: row.phoneDigits,
    body: row.body,
    status: row.status,
    salesforce_record_id: row.salesforceRecordId,
    salesforce_task_id: row.salesforceTaskId,
    provider: row.direction === "outbound" ? "vonage" : "salesforce",
    provider_message_id: row.providerMessageId,
    idempotency_key: row.idempotencyKey,
    detail: row.detail,
  });
  if (error?.code === "23505") throw new SmsMessageDuplicateError();
  if (error) throw new Error(error.message);
}

export async function resolveAgentSmsNumber(
  supabase: SupabaseClient,
  profileId: string,
  requestedFrom?: string | null,
): Promise<{ ok: true; from: string } | { ok: false; message: string }> {
  const { data, error } = await supabase
    .from("wisecall_sms_numbers")
    .select("sms_number")
    .eq("profile_id", profileId)
    .eq("status", "active")
    .order("created_at", { ascending: true });
  if (error) throw new Error(error.message);

  const numbers = (data || [])
    .map((row) => (typeof row.sms_number === "string" ? row.sms_number.trim() : ""))
    .map((value) => numericSenderDigits(value))
    .filter((digits): digits is string => Boolean(digits));

  if (requestedFrom) {
    const wanted = numericSenderDigits(requestedFrom);
    if (!wanted || !numbers.includes(wanted)) {
      return {
        ok: false,
        message:
          "That number is not an active SMS number on this agent. The message is sent from that phone number, not the WiseCall name.",
      };
    }
    return { ok: true, from: `+${wanted}` };
  }

  if (numbers.length === 1) return { ok: true, from: `+${numbers[0]}` };
  if (numbers.length === 0) {
    return {
      ok: false,
      message: "This agent has no SMS phone number. Add the number the message should come from before sending.",
    };
  }
  return {
    ok: false,
    message: "This agent has more than one SMS number. Pass from with the phone number the message should come from.",
  };
}
