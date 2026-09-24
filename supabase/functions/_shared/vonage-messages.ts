/** Shared by the existing SMS receptionist and the Salesforce portal integration. */
export function smsPhoneDigits(raw: unknown): string {
  if (typeof raw !== "string" || !/^\+?[\d\s().-]+$/.test(raw.trim())) return "";
  let digits = raw.replace(/\D/g, "").replace(/^00/, "");
  if (digits.startsWith("0")) digits = `44${digits.slice(1)}`;
  return /^[1-9]\d{7,14}$/.test(digits) ? digits : "";
}

export async function sendVonageSms(
  input: { from: string; to: string; text: string },
  credentials: { key: string; secret: string },
  fetcher: typeof fetch = fetch,
): Promise<{ messageId: string | null }> {
  const from = smsPhoneDigits(input.from);
  const to = smsPhoneDigits(input.to);
  if (!from || !to) throw new Error("Numeric SMS sender and destination required");
  if (!credentials.key || !credentials.secret) throw new Error("Vonage credentials not configured");
  const response = await fetcher("https://api.nexmo.com/v1/messages", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Basic ${btoa(`${credentials.key}:${credentials.secret}`)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel: "sms", message_type: "text", from, to, text: input.text }),
  });
  // Never expose provider response bodies (they may contain credentials or PII).
  if (!response.ok) throw new Error(`Vonage send failed (${response.status})`);
  const result = await response.json() as { message_uuid?: string };
  return { messageId: result.message_uuid ?? null };
}
