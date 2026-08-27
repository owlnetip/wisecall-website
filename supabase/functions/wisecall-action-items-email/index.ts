import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildPostCallEmailHtml,
  buildPostCallEmailText,
  callerNameFromSources,
  portalNextActions,
  postCallEmailSubject,
} from "../_shared/conversation-email.ts";
import {
  asEmailList,
  callSummaryRecipients,
} from "../_shared/notification-recipients.ts";

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
  if (!resendKey) return json({ ok: false, skipped: "missing_resend" });

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
  const bodyCallerName = typeof body.caller_name === "string" ? body.caller_name : "";

  if (!profileId) return json({ ok: true, skipped: "missing_profile" });

  const supabase = createClient(supabaseUrl, serviceKey);
  const { data: profile } = await supabase
    .from("wisecall_profiles")
    .select("profile_name, business_name, clinic_name, metadata")
    .eq("id", profileId)
    .maybeSingle();

  if (!profile) return json({ ok: false, error: "Profile not found" }, 404);

  const businessName =
    profile.business_name || profile.clinic_name || profile.profile_name || "Your business";
  const to = recipients((profile.metadata as Record<string, unknown>) ?? {});
  if (!to.length) return json({ ok: true, skipped: "no_recipients" });

  let analysisJson: unknown = null;
  let followUpTitles: string[] = [];
  let logSummary = "";
  let logTranscript = "";
  let logOutcome = "";
  let logStartedAt = "";
  let logAgentName = "";
  let logMeta: Record<string, unknown> = {};
  let contactName = "";

  if (callLogId) {
    const { data: log } = await supabase
      .from("wisecall_call_logs")
      .select(
        "id, summary, transcript, outcome, started_at, profile_name, metadata, ai_insight_summary, ai_analysis_json, contact_id",
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
      logMeta = isPlainObject(log.metadata) ? log.metadata : {};
      if (log.contact_id) {
        const { data: contact } = await supabase
          .from("wisecall_contacts")
          .select("name")
          .eq("id", log.contact_id)
          .maybeSingle();
        contactName = String(contact?.name || "");
      }
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

  if (
    logMeta.summary_email_sent === true &&
    (!actionItems.length || logMeta.summary_email_included_next_actions === true)
  ) {
    return json({ ok: true, skipped: "already_sent" });
  }

  const collected = isPlainObject(logMeta.collected) ? logMeta.collected : {};
  const callerName = callerNameFromSources({
    callerName: bodyCallerName || contactName,
    analysisJson,
    summary,
    transcript,
    collected,
  });
  const emailInput = {
    businessName,
    callerId,
    callerName,
    summary,
    transcript,
    outcome: outcome || "Conversation recorded",
    startedAt: startedAt || logStartedAt || null,
    actionItems,
    agentName: agentName || logAgentName || "WiseCall",
  };
  const html = buildPostCallEmailHtml(emailInput);
  const text = buildPostCallEmailText(emailInput);
  const subject = postCallEmailSubject(emailInput);

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
    console.error("wisecall-action-items-email resend failed:", res.status, await res.text());
    return json({ ok: false, error: "Send failed" }, 502);
  }

  if (callLogId) {
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
      .eq("id", callLogId);
  }

  return json({ ok: true, sent: to.length, next_actions: actionItems.length });
});
