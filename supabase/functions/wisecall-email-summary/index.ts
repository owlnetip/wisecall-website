// wisecall-email-summary — hangup fallback for the after-call team email.
//
// Called from the voice runtime (wisecall-edge/src/lib/emailSummary.js). When
// the portal call-completed webhook is configured, the runtime skips this and
// the portal sends after analysis so next actions are included. This function
// still looks up stored action_items / follow-ups so a hangup-only send matches
// the portal when analysis already ran.
//
// Auth: x-wisecall-secret matching WISECALL_EMAIL_WEBHOOK_SECRET or the shared
// portal webhook secrets, OR Authorization Bearer <service role>.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildPostCallEmailHtml,
  buildPostCallEmailText,
  portalNextActions,
} from "../_shared/conversation-email.ts";

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

function asEmailList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  if (typeof value === "string") return value.split(",").map((item) => item.trim()).filter(Boolean);
  return [];
}

function uniqueEmails(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const email = value.trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

function recipients(metadata: Record<string, unknown>): string[] {
  const configured = uniqueEmails([
    ...asEmailList(metadata.default_routing_email),
    ...asEmailList(metadata.notification_emails),
    ...asEmailList(metadata.fallback_email),
  ]);
  if (configured.length) return configured;
  return asEmailList(Deno.env.get("WISECALL_EMAIL_TO") || "info@owlnet.io");
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
  const payloadSummary = String(extra.summary || body.summary || "").trim();
  const payloadTranscript = String(extra.transcript || body.transcript || "").trim();
  const outcome = String(extra.reason || body.outcome || "").trim();
  const startedAt = String(session.started_at || "").trim();

  if (!profileId && !profileSlug) return json({ error: "Missing profile" }, 400);

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
  const to = recipients(metadata);
  if (!to.length) return json({ ok: true, skipped: "no_recipients" });

  let callLog:
    | {
        id: string;
        summary: string | null;
        transcript: string | null;
        outcome: string | null;
        started_at: string | null;
        profile_name: string | null;
        metadata: Record<string, unknown> | null;
        ai_insight_summary: string | null;
        ai_analysis_json: unknown;
      }
    | null = null;
  if (callId) {
    const { data } = await supabase
      .from("wisecall_call_logs")
      .select(
        "id, summary, transcript, outcome, started_at, profile_name, metadata, ai_insight_summary, ai_analysis_json",
      )
      .eq("call_id", callId)
      .maybeSingle();
    callLog = data;
  }

  const logMeta = isPlainObject(callLog?.metadata) ? callLog.metadata : {};
  let followUpTitles: string[] = [];
  if (callLog?.id) {
    const { data: followUps } = await supabase
      .from("wisecall_follow_ups")
      .select("title")
      .eq("call_log_id", callLog.id)
      .eq("status", "open");
    followUpTitles = (followUps ?? []).map((row) => String(row.title || ""));
  }

  const actionItems = portalNextActions({
    analysisJson: callLog?.ai_analysis_json,
    followUpTitles,
  });

  if (
    logMeta.summary_email_sent === true &&
    (!actionItems.length || logMeta.summary_email_included_next_actions === true)
  ) {
    return json({ ok: true, skipped: "already_sent" });
  }

  const summary = (
    callLog?.ai_insight_summary ||
    payloadSummary ||
    callLog?.summary ||
    ""
  ).trim();
  const transcript = (payloadTranscript || callLog?.transcript || "").trim();
  if (summary.length < 3 && transcript.length < 10 && !actionItems.length) {
    return json({ ok: true, skipped: "no_content" });
  }

  const businessName =
    profile.business_name ||
    profile.clinic_name ||
    profile.profile_name ||
    "Your business";
  const emailInput = {
    businessName,
    callerId,
    summary,
    transcript,
    outcome: outcome || callLog?.outcome || "Conversation recorded",
    startedAt: startedAt || callLog?.started_at || null,
    actionItems,
    agentName: callLog?.profile_name || profile.profile_name || "WiseCall",
  };
  const html = buildPostCallEmailHtml(emailInput);
  const text = buildPostCallEmailText(emailInput);
  const subject = actionItems.length
    ? `Follow-up needed · ${callerId} · ${businessName}`
    : `Message from ${callerId} · ${businessName}`;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${resendKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, html, text }),
  });

  if (!res.ok) {
    console.error("wisecall-email-summary resend failed:", res.status, await res.text());
    return json({ ok: false, error: "Send failed" }, 502);
  }

  if (callLog?.id) {
    await supabase
      .from("wisecall_call_logs")
      .update({
        metadata: {
          ...logMeta,
          summary_email_sent: true,
          summary_email_sent_at: new Date().toISOString(),
          summary_email_to: to,
          summary_email_included_next_actions: actionItems.length > 0,
        },
      })
      .eq("id", callLog.id);
  }

  return json({ ok: true, sent: to.length, next_actions: actionItems.length });
});
