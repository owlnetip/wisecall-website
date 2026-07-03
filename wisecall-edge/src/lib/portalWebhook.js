// Fire-and-forget: trigger portal AI analysis + follow-up extraction after a call log is saved.

const DEFAULT_TIMEOUT_MS = 15000;

function normalizePortalBase(raw) {
  const value = String(raw || "")
    .trim()
    .replace(/\/+$/, "");
  if (!value) return "";
  if (/^https?:\/\//i.test(value)) return value;
  return `https://${value}`;
}

function getPortalWebhookUrl(env = process.env) {
  const base = normalizePortalBase(
    env.WISECALL_PORTAL_URL ||
      env.PORTAL_URL ||
      env.PORTAL_DOMAIN ||
      env.SITE_URL,
  );
  if (!base) return "";
  return `${base}/api/webhooks/call-completed`;
}

function getPortalWebhookSecret(env = process.env) {
  return (
    (env.WISECALL_WEBHOOK_SECRET || "").trim() ||
    (env.WISECALL_TRIAL_REMINDER_SECRET || "").trim() ||
    (env.WISECALL_POOL_REPLENISH_SECRET || "").trim()
  );
}

async function triggerPortalAnalysis(callLogId, env = process.env) {
  const url = getPortalWebhookUrl(env);
  const secret = getPortalWebhookSecret(env);
  if (!url || !secret || !callLogId) {
    return { ok: false, skipped: "missing_portal_webhook_config" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        "x-wisecall-secret": secret,
      },
      body: JSON.stringify({ call_id: callLogId }),
      signal: controller.signal,
    });
    const body = await res.text().catch(() => "");
    return { ok: res.ok, status: res.status, body };
  } catch (err) {
    console.error("[portalWebhook] trigger failed:", err.message);
    return { ok: false, error: err.message };
  } finally {
    clearTimeout(timer);
  }
}

module.exports = {
  triggerPortalAnalysis,
  getPortalWebhookUrl,
  getPortalWebhookSecret,
  normalizePortalBase,
};
