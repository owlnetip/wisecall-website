// SMS conversation threads, for agents with metadata.sms_conversation_threads.
// Texts from the same number join one call log while the thread is open, so the
// agent sees the conversation so far and the team gets one email once it has
// gone quiet (the portal's catch-up picks it up after SMS_THREAD_IDLE_MS).
// Keep the outcome and idle window in sync with apps/portal/src/lib/call-analysis.ts.

export const SMS_THREAD_OUTCOME = "SMS conversation";
export const SMS_THREAD_IDLE_MS = 10 * 60_000;

export function threadsEnabled(metadata: unknown): boolean {
  return Boolean(metadata) && typeof metadata === "object" &&
    (metadata as Record<string, unknown>).sms_conversation_threads === true;
}

// A thread stays open until it is analysed (emailed) or goes quiet.
export function isOpenThread(
  row: { analysed_at?: string | null; metadata?: Record<string, unknown> | null },
  now = Date.now(),
): boolean {
  if (row.analysed_at) return false;
  const last = Date.parse(String(row.metadata?.last_message_at ?? ""));
  return Number.isFinite(last) && now - last < SMS_THREAD_IDLE_MS;
}

export function appendTurn(transcript: string, text: string, reply: string): string {
  const turn = `user: ${text}\nassistant: ${reply}`;
  return transcript.trim() ? `${transcript.trim()}\n${turn}` : turn;
}

export function threadUserMessage(fromNumber: string, history: string, text: string): string {
  if (!history.trim()) return `The customer (${fromNumber}) sent an SMS:\n\n${text}`;
  return [
    `SMS conversation so far with ${fromNumber} (user = them, assistant = you):`,
    history.trim(),
    "",
    `They have just sent:\n\n${text}`,
    "",
    "Reply to this latest text, carrying on from the conversation. Don't repeat questions they've already answered.",
  ].join("\n");
}
