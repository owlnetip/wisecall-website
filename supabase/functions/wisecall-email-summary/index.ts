// wisecall-email-summary — send the standard after-call message email.
//
// Called from the voice runtime on hangup (wisecall-edge/src/lib/emailSummary.js)
// with the call payload. Looks up the live profile so the portal "Default
// routing inbox" / notify contacts are used, not stale copies on the payload.
//
// Auth: x-wisecall-secret matching WISECALL_EMAIL_WEBHOOK_SECRET or the shared
// portal webhook secrets, OR Authorization Bearer <service role>.
// JWT verification is off (config.toml) because the voice runtime is not a
// logged-in Supabase user.
//
// Payload (from buildEmailSummaryPayload):
//   profile: { id, slug, ... }
//   session: { call_id, caller_id, started_at, last_activity, collected }
//   extra: { summary, transcript, reason, duration_seconds, transfer }

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  callSummaryRecipients,
  type TransferHint,
} from "../_shared/notification-recipients.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-wisecall-secret",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function authorised(req: Request): boolean {
  const provided =
    req.headers.get("x-wisecall-secret") ||
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    req.headers.get("apikey") ||
    "";
  const accepted = [
    Deno.env.get("WISECALL_EMAIL_WEBHOOK_SECRET"),
    Deno.env.get("WISECALL_WEBHOOK_SECRET"),
    Deno.env.get("WISECALL_TRIAL_REMINDER_SECRET"),
    Deno.env.get("WISECALL_POOL_REPLENISH_SECRET"),
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY"),
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  return Boolean(provided) && accepted.includes(provided);
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function transferFromBody(body: Record<string, unknown>): TransferHint | null {
  const extra = isPlainObject(body.extra) ? body.extra : {};
  const session = isPlainObject(body.session) ? body.session : {};
  const collected = isPlainObject(session.collected) ? session.collected : {};
  const transfer = isPlainObject(extra.transfer) ? extra.transfer : {};
  const routeKey = String(
    transfer.route_key || collected.transfer_route_key || "",
  ).trim();
  const label = String(transfer.label || collected.transfer_label || "").trim();
  if (!routeKey && !label) return null;
  return { route_key: routeKey || undefined, label: label || undefined };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!authorised(req)) return json({ error: "Unauthorized" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from =
    Deno.env.get("RESEND_FROM_EMAIL") ||
    Deno.env.get("WISECALL_EMAIL_FROM") ||
    "WiseCall <hello@wisecall.io>";

  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase not configured" }, 500);
  if (!resendKey) return json({ ok: false, skipped: "missing_resend" });

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const profilePayload = isPlainObject(body.profile) ? body.profile : {};
  const session = isPlainObject(body.session) ? body.session : {};
  const extra = isPlainObject(body.extra) ? body.extra : {};
  const profileId = String(profilePayload.id || body.profile_id || "").trim();
  const profileSlug = String(profilePayload.slug || body.profile_slug || "").trim();
  const callId = String(session.call_id || body.call_id || "").trim();
  const callerId = String(session.caller_id || body.caller_id || "Unknown");
  const summary = String(extra.summary || body.summary || "").trim();
  const transcript = String(extra.transcript || body.transcript || "").trim();
  const outcome = String(extra.reason || body.outcome || "").trim();
  const startedAt = String(session.started_at || "").trim();

  if (!profileId && !profileSlug) return json({ error: "Missing profile" }, 400);
  if (summary.length < 3 && transcript.length < 10) {
    return json({ ok: true, skipped: "no_content" });
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  let profileQuery = supabase
    .from("wisecall_profiles")
    .select("id, slug, profile_name, business_name, clinic_name, metadata");
  profileQuery = profileId
    ? profileQuery.eq("id", profileId)
    : profileQuery.eq("slug", profileSlug);
  const { data: profile } = await profileQuery.maybeSingle();
  if (!profile) return json({ ok: false, error: "Profile not found" }, 404);

  const metadata = isPlainObject(profile.metadata) ? profile.metadata : {};
  const to = callSummaryRecipients(metadata, transferFromBody(body));
  if (!to.length) return json({ ok: true, skipped: "no_recipients" });

  let callLog:
    | { id: string; metadata: Record<string, unknown> | null }
    | null = null;
  if (callId) {
    const { data } = await supabase
      .from("wisecall_call_logs")
      .select("id, metadata")
      .eq("call_id", callId)
      .maybeSingle();
    callLog = data;
    const logMeta = isPlainObject(data?.metadata) ? data.metadata : {};
    if (logMeta.summary_email_sent === true) {
      return json({ ok: true, skipped: "already_sent" });
    }
  }

  const businessName =
    profile.business_name ||
    profile.clinic_name ||
    profile.profile_name ||
    "Your business";
  const when = startedAt
    ? new Date(startedAt).toLocaleString("en-GB", { timeZone: "Europe/London" })
    : "";
  const html = `
    <div style="font-family:system-ui,sans-serif;color:#172929;max-width:640px;">
      <h2 style="margin:0 0 8px;font-size:20px;">New message for ${escapeHtml(businessName)}</h2>
      <p style="margin:0 0 16px;color:#4a5c5b;">A caller left a message with your WiseCall assistant.</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 18px;">
        <tr><td style="padding:6px 0;color:#148b8e;font-weight:700;width:120px;">Caller</td><td>${escapeHtml(callerId)}</td></tr>
        ${when ? `<tr><td style="padding:6px 0;color:#148b8e;font-weight:700;">When</td><td>${escapeHtml(when)}</td></tr>` : ""}
        ${outcome ? `<tr><td style="padding:6px 0;color:#148b8e;font-weight:700;">Outcome</td><td>${escapeHtml(outcome)}</td></tr>` : ""}
      </table>
      ${
        summary
          ? `<p style="margin:0 0 16px;padding:12px;background:#f0faf9;border-radius:8px;"><strong>What happened:</strong> ${escapeHtml(summary)}</p>`
          : ""
      }
      ${
        transcript
          ? `<h3 style="margin:0 0 8px;font-size:15px;">Transcript</h3><pre style="white-space:pre-wrap;background:#f7fafa;border:1px solid #d7e4e3;border-radius:8px;padding:14px;font-family:ui-monospace,monospace;line-height:1.45;">${escapeHtml(transcript)}</pre>`
          : ""
      }
      <p style="margin:20px 0 0;font-size:12px;color:#7a8a89;">Open the conversation in your WiseCall inbox to call back.</p>
    </div>`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to,
      subject: `Message from ${callerId} · ${businessName}`,
      html,
    }),
  });

  if (!res.ok) {
    console.error("wisecall-email-summary resend failed:", res.status, await res.text());
    return json({ ok: false, error: "Send failed" }, 502);
  }

  if (callLog?.id) {
    const logMeta = isPlainObject(callLog.metadata) ? callLog.metadata : {};
    await supabase
      .from("wisecall_call_logs")
      .update({
        metadata: {
          ...logMeta,
          summary_email_sent: true,
          summary_email_sent_at: new Date().toISOString(),
          summary_email_to: to,
        },
      })
      .eq("id", callLog.id);
  }

  return json({ ok: true, sent: to.length });
});
