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
  // Per-message delivery-status callback (Vonage Messages API webhook_url).
  options: { statusUrl?: string; clientRef?: string } = {},
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
    body: JSON.stringify({
      channel: "sms", message_type: "text", from, to, text: input.text,
      ...(options.statusUrl ? { webhook_url: options.statusUrl, webhook_version: "v1" } : {}),
      ...(options.clientRef ? { client_ref: options.clientRef.slice(0, 100) } : {}),
    }),
  });
  // Never expose provider response bodies (they may contain credentials or PII).
  if (!response.ok) throw new Error(`Vonage send failed (${response.status})`);
  const result = await response.json() as { message_uuid?: string };
  return { messageId: result.message_uuid ?? null };
}

// WhatsApp sends are not accepted with the account key/secret (401): they need a
// JWT signed with the Messages application's private key (RS256).
function b64url(bytes: Uint8Array | string): string {
  const raw = typeof bytes === "string" ? new TextEncoder().encode(bytes) : bytes;
  return btoa(String.fromCharCode(...raw)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export async function vonageApplicationJwt(applicationId: string, privateKeyPem: string): Promise<string> {
  const der = Uint8Array.from(
    atob(privateKeyPem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, "").replace(/\s+/g, "")),
    (c) => c.charCodeAt(0),
  );
  const key = await crypto.subtle.importKey(
    "pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"],
  );
  const iat = Math.floor(Date.now() / 1000);
  const signingInput = `${b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${
    b64url(JSON.stringify({ application_id: applicationId, iat, exp: iat + 300, jti: crypto.randomUUID() }))
  }`;
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return `${signingInput}.${b64url(new Uint8Array(sig))}`;
}

// Free-text WhatsApp reply over the Vonage Messages API. Only valid inside the
// 24h customer-service window, which holds for a reply to an inbound message.
export async function sendVonageWhatsapp(
  input: { from: string; to: string; text: string },
  credentials: { applicationId: string; privateKey: string },
  fetcher: typeof fetch = fetch,
): Promise<{ messageId: string | null }> {
  const from = smsPhoneDigits(input.from);
  const to = smsPhoneDigits(input.to);
  if (!from || !to) throw new Error("Numeric WhatsApp sender and destination required");
  if (!credentials.applicationId || !credentials.privateKey) throw new Error("Vonage WhatsApp application key not configured");
  const response = await fetcher("https://api.nexmo.com/v1/messages", {
    method: "POST",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
    headers: {
      Authorization: `Bearer ${await vonageApplicationJwt(credentials.applicationId, credentials.privateKey)}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ channel: "whatsapp", message_type: "text", from, to, text: input.text }),
  });
  if (!response.ok) {
    let reason = "";
    try {
      const err = await response.json() as { title?: string; detail?: string };
      reason = [err.title, err.detail].filter(Boolean).join(": ").slice(0, 200);
    } catch { /* body not JSON */ }
    throw new Error(`Vonage WhatsApp send failed (${response.status})${reason ? ` ${reason}` : ""}`);
  }
  const result = await response.json() as { message_uuid?: string };
  return { messageId: result.message_uuid ?? null };
}
