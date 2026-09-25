import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildPostCallEmailHtml,
  buildPostCallEmailText,
  portalNextActions,
} from "../_shared/conversation-email.ts";
import {
  asEmailList,
  callSummaryRecipients,
} from "../_shared/notification-recipients.ts";
import { formatCallerDisplay, resolveCallerIdentity } from "../_shared/caller-identity.ts";
import {
  sendStaffAlertSms,
  staffAlertFromIdentity,
  staffAlertNumbers,
} from "../_shared/staff-alert-sms.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function recipients(metadata: Record<string, unknown>): string[] {
  const configured = callSummaryRecipients(metadata);
  if (configured.length) return configured;
  return asEmailList(Deno.env.get("WISECALL_EMAIL_TO") || "info@owlnet.io");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const resendKey = Deno.env.get("RESEND_API_KEY");
  const from =
    Deno.env.get("RESEND_FROM_EMAIL") ||
    Deno.env.get("WISECALL_EMAIL_FROM") ||
    "WiseCall <hello@wisecall.io>";

  if (!supabaseUrl || !serviceKey) return json({ error: "Supabase not configured" }, 500);

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON" }, 400);
  }

  const profileId = String(body.profile_id || "");
  const callLogId = String(body.call_log_id || "");
  const callerId = String(body.caller_id || "Unknown");
  const bodyItems = stringList(body.action_items);
  const managerSummary = typeof body.manager_summary === "string" ? body.manager_summary : "";
  const bodyTranscript = typeof body.transcript === "string" ? body.transcript : "";
  const bodyOutcome = typeof body.outcome === "string" ? body.outcome : "";
  const startedAt = typeof body.started_at === "string" ? body.started_at : "";
  const agentName = typeof body.agent_name === "string" ? body.agent_name : "";

  if (!profileId) return json({ ok: true, skipped: "missing_profile" });

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: profile } = await supabase
    .from("wisecall_profiles")
    .select("id, slug, profile_name, business_name, clinic_name, sms_enabled, metadata")
    .eq("id", profileId)
    .maybeSingle();

  if (!profile) return json({ ok: false, error: "Profile not found" }, 404);

  const businessName =
    profile.business_name || profile.clinic_name || profile.profile_name || "Your business";
  const metadata = (profile.metadata as Record<string, unknown>) ?? {};
  const to = recipients(metadata);
  const smsPhones = staffAlertNumbers(metadata, profile.sms_enabled);

  let analysisJson: unknown = null;
  let followUpTitles: string[] = [];
  let logSummary = "";
  let logTranscript = "";
  let logOutcome = "";
  let logStartedAt = "";
  let logAgentName = "";
  let logCallId = "";
  let logMeta: Record<string, unknown> = {};

  if (callLogId) {
    const { data: log } = await supabase
      .from("wisecall_call_logs")
      .select(
        "id, call_id, summary, transcript, outcome, started_at, profile_name, metadata, ai_insight_summary, ai_analysis_json",
      )
      .eq("id", callLogId)
      .maybeSingle();
    if (log) {
      analysisJson = log.ai_analysis_json;
      logSummary = String(log.ai_insight_summary || log.summary || "");
      logTranscript = String(log.transcript || "");
      logOutcome = String(log.outcome || "");
      logStartedAt = String(log.started_at || "");
      logAgentName = String(log.profile_name || "");
      logCallId = String(log.call_id || "");
      logMeta = isPlainObject(log.metadata) ? log.metadata : {};
    }
    const { data: followUps } = await supabase
      .from("wisecall_follow_ups")
      .select("title")
      .eq("call_log_id", callLogId)
      .eq("status", "open");
    followUpTitles = (followUps ?? []).map((row) => String(row.title || ""));
  }

  const actionItems = bodyItems.length
    ? bodyItems.slice(0, 5)
    : portalNextActions({ analysisJson, followUpTitles });

  const summary = (managerSummary || logSummary).trim();
  const transcript = (bodyTranscript || logTranscript).trim();
  const outcome = (bodyOutcome || logOutcome).trim();
  if (summary.length < 3 && transcript.length < 10 && !actionItems.length) {
    return json({ ok: true, skipped: "no_content" });
  }

  const collected = isPlainObject(logMeta.collected) ? logMeta.collected : logMeta;
  const identity = resolveCallerIdentity({
    callerId,
    collected,
    analysis: analysisJson,
    summary,
    transcript,
  });
  const callerLabel = formatCallerDisplay(identity);

  const emailAlreadySent =
    logMeta.summary_email_sent === true &&
    (!actionItems.length || logMeta.summary_email_included_next_actions === true);
  const smsAlreadySent = logMeta.summary_sms_sent === true;

  let smsSent: string[] = Array.isArray(logMeta.summary_sms_to)
    ? logMeta.summary_sms_to.filter((item): item is string => typeof item === "string")
    : [];
  let smsError: string | undefined;
  if (smsPhones.length && !smsAlreadySent) {
    const sms = await sendStaffAlertSms({
      phones: smsPhones,
      message: staffAlertFromIdentity(businessName, identity, summary, actionItems),
      profileId: profile.id,
      profileSlug: profile.slug || null,
      callId: logCallId || callLogId || null,
    });
    smsSent = sms.sent;
    smsError = sms.error;
  }

  let emailSent = emailAlreadySent ? to.length : 0;
  let emailError: string | undefined;
  let emailSkipped: string | undefined;
  if (emailAlreadySent) {
    emailSkipped = "already_sent";
  } else if (!to.length) {
    emailSkipped = "no_recipients";
  } else if (!resendKey) {
    emailSkipped = "missing_resend";
  } else {
    const emailInput = {
      businessName,
      callerId,
      callerName: identity.callerName,
      company: identity.company,
      summary,
      transcript,
      outcome: outcome || "Conversation recorded",
      startedAt: startedAt || logStartedAt || null,
      actionItems,
      agentName: agentName || logAgentName || "WiseCall",
    };
    const html = buildPostCallEmailHtml(emailInput);
    const text = buildPostCallEmailText(emailInput);
    const subject = actionItems.length
      ? `Follow-up needed · ${callerLabel} · ${businessName}`
      : `Message from ${callerLabel} · ${businessName}`;

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from,
        to,
        subject,
        html,
        text,
      }),
    });

    if (!res.ok) {
      emailError = "Send failed";
      console.error("wisecall-action-items-email resend failed:", res.status, await res.text());
    } else {
      emailSent = to.length;
    }
  }

  const nextMeta: Record<string, unknown> = { ...logMeta };
  if (emailSent && !emailAlreadySent) {
    nextMeta.summary_email_sent = true;
    nextMeta.summary_email_sent_at = new Date().toISOString();
    nextMeta.summary_email_to = to;
    nextMeta.summary_email_included_next_actions = actionItems.length > 0;
  }
  if (smsSent.length && !smsAlreadySent) {
    nextMeta.summary_sms_sent = true;
    nextMeta.summary_sms_sent_at = new Date().toISOString();
    nextMeta.summary_sms_to = smsSent;
  }
  if (callLogId && ((emailSent && !emailAlreadySent) || (smsSent.length && !smsAlreadySent))) {
    await supabase.from("wisecall_call_logs").update({ metadata: nextMeta }).eq("id", callLogId);
  }

  const ok = Boolean(emailSent || smsSent.length || emailSkipped === "already_sent");
  return json({
    ok,
    sent: emailSent,
    sms_sent: smsSent.length,
    next_actions: actionItems.length,
    skipped: emailSkipped,
    error: emailError || smsError,
  }, ok || emailSkipped ? 200 : 502);
});
