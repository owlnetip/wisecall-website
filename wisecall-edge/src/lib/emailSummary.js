// Best-effort delivery of the standard WiseCall call summary email.

const DEFAULT_TIMEOUT_MS = 8000;
const EMAIL_SUMMARY_PATH = "/functions/v1/wisecall-email-summary";

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function getEmailSummaryUrl(env = process.env) {
  const explicit = (env.WISECALL_EMAIL_SUMMARY_URL || "").trim();
  if (explicit) return explicit;

  const supabaseUrl = (env.SUPABASE_URL || "").trim().replace(/\/+$/, "");
  if (!supabaseUrl) return "";
  return `${supabaseUrl}${EMAIL_SUMMARY_PATH}`;
}

function transcriptFromHistory(history) {
  if (!Array.isArray(history)) return "";

  return history
    .filter((entry) => entry?.type === "conversation" && entry.content)
    .map((entry) => {
      const role = entry.role === "assistant" ? "assistant" : "user";
      return `${role}: ${entry.content}`;
    })
    .join("\n");
}

function buildEmailSummaryPayload(profile, context, call) {
  const metadata = isPlainObject(call.metadata) ? call.metadata : {};
  const collected = isPlainObject(metadata.collected) ? metadata.collected : metadata;
  const transcript = call.transcript || transcriptFromHistory(metadata.history);
  const transferRouteKey =
    collected.transfer_route_key || metadata.transfer_route_key || call.transferRouteKey || "";
  const transferLabel =
    collected.transfer_label || metadata.transfer_label || call.transferLabel || "";

  return {
    profile: {
      id: profile.id,
      slug: profile.slug,
      profile_name: profile.profile_name,
      business_name: profile.business_name || profile.clinic_name,
      receptionist_name: profile.receptionist_name,
    },
    session: {
      call_id: context.callId,
      caller_id: context.callerId,
      started_at: call.startedAt,
      last_activity: call.finishedAt,
      collected,
    },
    extra: {
      summary: call.summary || "",
      transcript,
      reason: call.outcome || "",
      duration_seconds: collected.duration_seconds || collected.call_duration_seconds || undefined,
      transfer: transferRouteKey
        ? {
            route_key: transferRouteKey,
            label: transferLabel,
          }
        : undefined,
    },
  };
}

async function sendCallEmailSummary(profile, context, call) {
  const url = getEmailSummaryUrl();
  if (!url) return { ok: false, skipped: "missing_email_summary_url" };
  if (!profile?.slug) return { ok: false, skipped: "missing_profile_slug" };

  const headers = { "Content-Type": "application/json", Accept: "application/json" };
  const secret = (process.env.WISECALL_EMAIL_WEBHOOK_SECRET || "").trim();
  if (secret) headers["x-wisecall-secret"] = secret;

  const res = await fetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify(buildEmailSummaryPayload(profile, context, call)),
    signal: AbortSignal.timeout(DEFAULT_TIMEOUT_MS),
  });
  const text = await res.text().catch(() => "");
  let body = text;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    // keep raw text
  }

  return { ok: res.ok, status: res.status, body };
}

module.exports = {
  buildEmailSummaryPayload,
  getEmailSummaryUrl,
  sendCallEmailSummary,
};
