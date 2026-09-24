export type ReplyBinding = { id: string; salesforce_record_id: string };

export function replyPhoneDigits(raw: string): string {
  let number = raw.trim().replace(/[\s().-]/g, "");
  if (number.startsWith("00")) number = number.slice(2);
  if (number.startsWith("+")) number = number.slice(1);
  if (/^0\d{10}$/.test(number)) number = `44${number.slice(1)}`;
  return /^[1-9]\d{7,14}$/.test(number) ? number : "";
}

/** Only an explicit absence of a binding permits the receptionist to run.
 * Lookup, callback, and durable-log failures must never turn into AI replies.
 */
export async function routeConfirmedSalesforceReply(input: {
  fromNumber: string;
  findBinding: (digits: string) => Promise<ReplyBinding | null>;
  deliver: () => Promise<{ delivered: boolean; status: number }>;
  recordFailure: (binding: ReplyBinding, digits: string, reason: string) => Promise<void>;
}): Promise<boolean> {
  const digits = replyPhoneDigits(input.fromNumber);
  if (!digits) throw new Error("Invalid inbound Salesforce phone number");
  const binding = await input.findBinding(digits);
  if (!binding) return false;
  let reason: string | null = null;
  try {
    const result = await input.deliver();
    if (!result.delivered) reason = `delivery_unconfirmed_http_${result.status}`;
  } catch {
    // Do not persist network error strings that could contain credentials.
    reason = "callback_failed";
  }
  if (reason) await input.recordFailure(binding, digits, reason);
  return true;
}
