import { createHash, randomUUID } from "node:crypto";

type Invoke = (name: string, options: { body: Record<string, string> }) => Promise<{ data: unknown; error: unknown }>;

// One reservation id per logical send, including retries after a lost response.
export function smsRequestId(profileId: string, idempotencyKey?: string | null): string {
  if (!idempotencyKey) return randomUUID();
  const hex = createHash("sha256").update(JSON.stringify(["salesforce-sms", profileId, idempotencyKey])).digest("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export async function sendViaAgentSms(input: {
  invoke: Invoke; profileId: string; requestId: string; from: string; to: string; text: string;
}): Promise<{ messageId: string | null }> {
  // These numbers have already been normalised and checked against active inventory.
  // Do not strip arbitrary characters: an alphanumeric sender must be rejected.
  if (!/^\+?[1-9]\d{7,14}$/.test(input.from) || !/^\+?[1-9]\d{7,14}$/.test(input.to)) {
    throw new Error("SMS sender and destination must be phone numbers.");
  }
  const { data, error } = await input.invoke("wisecall-send-sms", { body: {
    request_id: input.requestId,
    profile_id: input.profileId,
    from: input.from.replace(/^\+/, ""),
    phone: input.to.replace(/^\+/, ""),
    message: input.text,
  } });
  const result = data as { success?: boolean; message_id?: string } | null;
  if (error || result?.success !== true) {
    // No retries or fallback provider here: the edge function owns reservations.
    throw new Error("SMS service did not confirm sending; retain the same request id when checking or retrying.");
  }
  return { messageId: typeof result.message_id === "string" ? result.message_id : null };
}
