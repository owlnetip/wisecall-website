// Which inbound channel a wisecall_call_logs row arrived on. Phone is the
// default for historical/voice logs that predate per-channel tagging.
//
// Writers that stamp metadata.channel (keep this list in tests if you add one):
//   phone     — wisecall-edge saveCallLog
//   whatsapp  — supabase/functions/wisecall-whatsapp-inbound
//   sms       — supabase/functions/wisecall-sms-inbound
//   email     — supabase/functions/wisecall-email-inbound
//   chat      — supabase/functions/wisecall-live-chat (also source=wisecall-live-chat)

export const CALL_CHANNELS = ["phone", "whatsapp", "sms", "email", "chat"] as const;
export type CallChannel = (typeof CALL_CHANNELS)[number];

export const CHANNEL_LOG_MATRIX: ReadonlyArray<{
  channel: CallChannel;
  writer: string;
  metadataChannel: CallChannel;
  fallback?: string;
}> = [
  {
    channel: "phone",
    writer: "wisecall-edge/src/saveCallLog.js",
    metadataChannel: "phone",
  },
  {
    channel: "whatsapp",
    writer: "supabase/functions/wisecall-whatsapp-inbound",
    metadataChannel: "whatsapp",
    fallback: "outcome/summary contains 'whatsapp'",
  },
  {
    channel: "sms",
    writer: "supabase/functions/wisecall-sms-inbound",
    metadataChannel: "sms",
    fallback: "outcome/summary contains 'sms'",
  },
  {
    channel: "email",
    writer: "supabase/functions/wisecall-email-inbound",
    metadataChannel: "email",
    fallback: "outcome/summary contains 'email'",
  },
  {
    channel: "chat",
    writer: "supabase/functions/wisecall-live-chat",
    metadataChannel: "chat",
    fallback: "metadata.source = wisecall-live-chat or outcome starts with live_chat",
  },
];

export function channelFromLog(row: {
  outcome?: string | null;
  summary?: string | null;
  metadata?: Record<string, unknown> | null;
}): CallChannel {
  const meta = row.metadata ?? {};
  const raw = String(meta.channel ?? "").toLowerCase();
  if (raw === "whatsapp" || raw === "sms" || raw === "email" || raw === "chat") return raw;
  if (raw === "phone") return "phone";

  // Fallback for rows logged before metadata.channel existed (or when the
  // column isn't persisted), infer from the outcome/summary the edge functions write.
  const outcome = String(row.outcome ?? "").toLowerCase();
  const summary = String(row.summary ?? "").toLowerCase();
  if (outcome.includes("whatsapp") || summary.startsWith("whatsapp:")) return "whatsapp";
  if (outcome.includes("sms") || summary.startsWith("sms:")) return "sms";
  if (outcome.includes("email") || summary.startsWith("email:")) return "email";

  // Website live chat predates per-channel tagging; it tags itself via the
  // edge-function source and a "live_chat" outcome instead of metadata.channel.
  if (String(meta.source ?? "") === "wisecall-live-chat") return "chat";
  if (outcome.startsWith("live_chat")) return "chat";
  return "phone";
}
