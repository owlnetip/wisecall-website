// Service-to-service numeric sender path. Legacy webhook callers are unchanged.
export type AgentSms = { request_id: string; profile_id: string; from: string; phone: string; message: string };
export type AgentSmsLog = { outcome: string; metadata: Record<string, unknown> };
type Result = { status: number; body: Record<string, unknown> };

export function serviceSmsAuth(header: string | null, expected: string | undefined) {
  if (!expected || !header?.startsWith("Bearer ")) return false;
  const actual = header.slice(7);
  if (actual.length !== expected.length) return false;
  let difference = 0;
  for (let i = 0; i < expected.length; i++) difference |= actual.charCodeAt(i) ^ expected.charCodeAt(i);
  return difference === 0;
}

export async function verifiedServiceSmsAuth(
  header: string | null, expected: string | undefined, validate: (token: string) => Promise<boolean>,
) {
  if (serviceSmsAuth(header, expected)) return true;
  if (!header?.startsWith("Bearer ")) return false;
  const token = header.slice(7);
  try {
    const payload = token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/");
    // This is only a preliminary rejection filter, never proof of authentication.
    if (JSON.parse(atob(payload)).role !== "service_role") return false;
    return await validate(token); // Supabase must verify signature AND administrative access.
  } catch { return false; }
}

export async function agentSmsSend(
  raw: unknown,
  deps: {
    normalise(value: unknown): string;
    activeNumbers(profile: string): Promise<string[]>;
    claim(input: AgentSms): Promise<AgentSmsLog | null>;
    finish(input: AgentSms, outcome: string, providerId?: string | null): Promise<void>;
    send(input: { from: string; to: string; text: string }): Promise<{ messageId: string | null }>;
    usage(profile: string): Promise<void>;
  },
): Promise<Result> {
  const body = raw as Partial<AgentSms> | null;
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  if (!body || typeof body !== "object" || typeof body.request_id !== "string" || !uuid.test(body.request_id) ||
      typeof body.profile_id !== "string" || !uuid.test(body.profile_id) ||
      typeof body.message !== "string" || !body.message.trim() || body.message.length > 1000) {
    return { status: 422, body: { success: false, error: "request_id UUID, profile_id UUID and message required" } };
  }
  const from = deps.normalise(body.from);
  const phone = deps.normalise(body.phone);
  if (!from || !phone) return { status: 422, body: { success: false, error: "numeric_from_and_phone_required" } };
  const numbers = await deps.activeNumbers(body.profile_id);
  if (!numbers.some(n => deps.normalise(n) === from)) return { status: 422, body: { success: false, error: "sender_not_active_on_profile" } };
  const input: AgentSms = { request_id: body.request_id, profile_id: body.profile_id, from, phone, message: body.message };
  const existing = await deps.claim(input);
  if (existing) {
    const saved = existing.metadata.request as Partial<AgentSms> | undefined;
    if (existing.metadata.record_type !== "agent_sms" || !saved ||
        !Object.entries(input).every(([key, value]) => saved[key as keyof AgentSms] === value)) {
      return { status: 409, body: { success: false, error: "request_id_conflict" } };
    }
    return existing.outcome === "sms_sent"
      ? { status: 200, body: { success: true, replay: true, from, to: phone, message_id: existing.metadata.provider_message_id } }
      : { status: 409, body: { success: false, error: "send_pending_or_unknown_do_not_resend", request_id: input.request_id } };
  }
  let provider: { messageId: string | null };
  try { provider = await deps.send({ from, to: phone, text: input.message }); }
  catch {
    await deps.finish(input, "sms_unknown");
    return { status: 502, body: { success: false, error: "send_outcome_unknown_do_not_resend", request_id: input.request_id } };
  }
  await deps.finish(input, "sms_sent", provider.messageId);
  try { await deps.usage(input.profile_id); } catch { /* Sending already succeeded; no resend for a usage failure. */ }
  return { status: 200, body: { success: true, from, to: phone, message_id: provider.messageId, request_id: input.request_id } };
}
