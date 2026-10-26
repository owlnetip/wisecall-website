// Shared Vonage SMS helpers for inbound parsing, number matching, and send.

export function normaliseE164(value: string): string {
  const digits = String(value || "").replace(/\D/g, "");
  if (!digits) return "";
  return `+${digits}`;
}

export function digitsOnly(value: string): string {
  return String(value || "").replace(/\D/g, "");
}

/** Lookup keys Vonage may send for the same UK number. */
export function smsLookupKeys(raw: string): string[] {
  const digits = digitsOnly(raw);
  if (!digits) return [];
  const keys = new Set<string>([normaliseE164(digits), digits]);
  if (digits.startsWith("44") && digits.length === 12) {
    keys.add(`0${digits.slice(2)}`);
    keys.add(`+${digits}`);
  }
  if (digits.startsWith("0") && digits.length === 11) {
    keys.add(`44${digits.slice(1)}`);
    keys.add(`+44${digits.slice(1)}`);
  }
  return [...keys];
}

function asString(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return "";
}

function numberFromUnknown(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string" || typeof value === "number") return asString(value);
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return asString(obj.number) || asString(obj.msisdn) || asString(obj.id);
  }
  return "";
}

function textFromUnknown(value: unknown): string {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return (
      asString(obj.text) ||
      asString(obj.body) ||
      asString(obj.Body) ||
      textFromUnknown(obj.content)
    );
  }
  return "";
}

export type InboundSms = {
  from: string;
  to: string;
  text: string;
  messageId: string;
};

/** Pull from / to / text out of Vonage SMS, Messages API, and nested JSON. */
export function extractInboundSms(params: Record<string, unknown>): InboundSms | null {
  const message = (params.message && typeof params.message === "object")
    ? params.message as Record<string, unknown>
    : params;

  const from =
    numberFromUnknown(params.msisdn) ||
    numberFromUnknown(params.from) ||
    numberFromUnknown(params.From) ||
    numberFromUnknown(message.from) ||
    numberFromUnknown((message.originator as Record<string, unknown> | undefined));

  const to =
    numberFromUnknown(params.to) ||
    numberFromUnknown(params.To) ||
    numberFromUnknown(message.to) ||
    numberFromUnknown((message.recipient as Record<string, unknown> | undefined));

  const text =
    asString(params.text) ||
    asString(params.Body) ||
    asString(params.body) ||
    textFromUnknown(message) ||
    textFromUnknown(params.content);

  const messageId =
    asString(params.messageId) ||
    asString(params["message-uuid"]) ||
    asString(params.message_uuid) ||
    asString(message.message_uuid) ||
    asString(message.messageId);

  if (!from || !to || !text) return null;
  return { from, to, text, messageId };
}

export function inboundWebhookUrl(supabaseUrl: string, anonKey = ""): string {
  const base = `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/wisecall-sms-inbound`;
  if (!anonKey) return base;
  const url = new URL(base);
  url.searchParams.set("apikey", anonKey);
  return url.toString();
}

export async function sendSmsViaVonage(input: {
  apiKey: string;
  apiSecret: string;
  from: string;
  to: string;
  text: string;
}): Promise<void> {
  const from = digitsOnly(input.from);
  const to = digitsOnly(input.to);
  if (!from || !to) throw new Error("SMS from/to missing");

  const smsRes = await fetch("https://rest.nexmo.com/sms/json", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      api_key: input.apiKey,
      api_secret: input.apiSecret,
      from,
      to,
      text: input.text,
      type: "unicode",
    }),
  });
  const smsBody = await smsRes.text().catch(() => "");
  if (smsRes.ok) {
    try {
      const parsed = JSON.parse(smsBody) as {
        messages?: { status?: string; "error-text"?: string }[];
      };
      const status = parsed.messages?.[0]?.status;
      if (status === "0") return;
      throw new Error(parsed.messages?.[0]?.["error-text"] || `SMS status ${status}`);
    } catch (err) {
      if (err instanceof SyntaxError) {
        // Non-JSON 200 is unexpected; fall through to Messages API.
      } else {
        throw err;
      }
    }
  }

  const credentials = btoa(`${input.apiKey}:${input.apiSecret}`);
  const msgRes = await fetch("https://api.nexmo.com/v1/messages", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: "sms",
      message_type: "text",
      to,
      from,
      text: input.text,
    }),
  });
  if (!msgRes.ok) {
    const body = await msgRes.text().catch(() => "");
    throw new Error(`Vonage send ${msgRes.status}: ${body.slice(0, 300) || smsBody.slice(0, 300)}`);
  }
}

export function waitUntil(task: Promise<unknown>): void {
  const runtime = (globalThis as { EdgeRuntime?: { waitUntil?: (p: Promise<unknown>) => void } })
    .EdgeRuntime;
  if (runtime?.waitUntil) {
    runtime.waitUntil(task);
    return;
  }
  // Local / tests: run in the background without blocking the HTTP response
  // when the platform supports it; callers still await when waitUntil is absent.
  void task;
}

export function canWaitUntil(): boolean {
  return typeof (globalThis as { EdgeRuntime?: { waitUntil?: unknown } }).EdgeRuntime?.waitUntil ===
    "function";
}
