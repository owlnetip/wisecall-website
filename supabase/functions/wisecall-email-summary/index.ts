// wisecall-email-summary — hangup post-call team email + staff-alert SMS.
//
// Called from the voice runtime on every hangup. Portal may send the email
// again after analysis with next actions; email/SMS dedup is on the call log
// metadata. Staff mobiles come from metadata.staff_alert_sms, gated by
// wisecall_profiles.sms_enabled.

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  buildPostCallEmailHtml,
  buildPostCallEmailText,
  emailActionItems,
  nextActionsFromAnalysisJson,
  nextActionsFromFollowUpTitles,
  portalNextActions,
  postCallEmailSubject,
} from "../_shared/conversation-email.ts";
import {
  asEmailList,
  callSummaryRecipients,
  type TransferHint,
} from "../_shared/notification-recipients.ts";
import {
  buildStaffAlertSms,
  staffAlertNumbers,
} from "../_shared/staff-alert-sms.ts";
import { buildAiCallInsights } from "../_shared/call-insights.ts";

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

function recipients(metadata: Record<string, unknown>, transfer?: TransferHint | null): string[] {
  const configured = callSummaryRecipients(metadata, transfer);
  if (configured.length) return configured;
  return asEmailList(Deno.env.get("WISECALL_EMAIL_TO") || "info@owlnet.io");
}

function storedInsightUrgency(logMeta: Record<string, unknown>): string {
  const raw = isPlainObject(logMeta.ai_email_insights) ? logMeta.ai_email_insights : null;
  return raw && typeof raw.urgency === "string" ? raw.urgency.trim() : "";
}

/** Routine must not mask a later analysis flag of high/urgent. */
function followUpUrgency(value: string): string | undefined {
  const normalised = value.trim().toLowerCase();
  if (normalised === "emergency" || normalised === "urgent" || normalised === "high") {
    return normalised;
  }
  return undefined;
}

async function sendStaffAlertSms(opts: {
  phones: string[];
  message: string;
  profileId: string;
  profileSlug: string | null;
  callId: string | null;
}): Promise<{ sent: string[]; error?: string }> {
  if (!opts.phones.length) return { sent: [] };
  const expectedSecret = Deno.env.get("WISECALL_SMS_WEBHOOK_SECRET");
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  if (!expectedSecret || !supabaseUrl) {
    return { sent: [], error: "SMS helper not configured" };
  }
  const sent: string[] = [];
  let lastError = "";
  const linkType = `staff-alert-${(opts.callId || opts.profileId).slice(0, 12)}`;
  for (const phone of opts.phones) {
    try {
      const res = await fetch(`${supabaseUrl}/functions/v1/wisecall-send-sms`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-WiseCall-SMS-Secret": expectedSecret,
        },
        body: JSON.stringify({
          phone,
          message: opts.message,
          link_type: linkType,
          call_id: opts.callId,
          profile_id: opts.profileId,
          profile_slug: opts.profileSlug,
        }),
      });
      const result = await res.json().catch(() => ({}));
      if (res.ok && result.success) {
        sent.push(phone);
      } else {
        lastError = String(result.error || `SMS ${res.status}`);
        console.error("[wisecall-email-summary] staff sms failed:", phone, lastError);
      }
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      console.error("[wisecall-email-summary] staff sms error:", phone, lastError);
    }
  }
  return { sent, error: sent.length ? undefined : lastError || "SMS send failed" };
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
    .select("id, slug, profile_name, business_name, clinic_name, sms_enabled, metadata");
  profileQuery = profileId
    ? profileQuery.eq("id", profileId)
    : profileQuery.eq("slug", profileSlug);
  const { data: profile } = await profileQuery.maybeSingle();
  if (!profile) return json({ ok: false, error: "Profile not found" }, 404);

  const metadata = isPlainObject(profile.metadata) ? profile.metadata : {};
  const to = recipients(metadata, transferFromBody(body));
  const smsPhones = staffAlertNumbers(metadata, profile.sms_enabled);

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

  const baseSummary = (
    callLog?.ai_insight_summary ||
    payloadSummary ||
    callLog?.summary ||
    ""
  ).trim();
  const transcript = (payloadTranscript || callLog?.transcript || "").trim();
  const outcomeText = outcome || callLog?.outcome || "";
  const rememberedUrgency = followUpUrgency(storedInsightUrgency(logMeta));
  // Staff SMS keeps the live action list: analysis items, else open follow-ups.
  // The follow-up guarantee below is for the email only.
  const fromAnalysis = nextActionsFromAnalysisJson(callLog?.ai_analysis_json);
  const smsActionItems = fromAnalysis.length
    ? fromAnalysis
    : nextActionsFromFollowUpTitles(followUpTitles);

  let actionItems = portalNextActions({
    analysisJson: callLog?.ai_analysis_json,
    followUpTitles,
    summary: baseSummary,
    transcript,
    outcome: outcomeText,
    urgency: rememberedUrgency,
  });

  if (baseSummary.length < 3 && transcript.length < 10 && !actionItems.length) {
    return json({ ok: true, skipped: "no_content" });
  }

  const businessName =
    profile.business_name ||
    profile.clinic_name ||
    profile.profile_name ||
    "Your business";

  const emailAlreadySentPrelim =
    logMeta.summary_email_sent === true &&
    (!actionItems.length || logMeta.summary_email_included_next_actions === true);
  const smsAlreadySent = logMeta.summary_sms_sent === true;

  // The runtime summary stitches speech fragments together and echoes the
  // calling line back as the caller's number, so Claude rewrites it and pulls
  // the caller's own details out of the transcript. Only when something is
  // actually about to send, and never when analysis has already written one.
  const willEmail = !emailAlreadySentPrelim && to.length > 0 && Boolean(resendKey);
  const willSms = smsPhones.length > 0 && !smsAlreadySent;
  const insights =
    metadata.ai_call_summary === true && !callLog?.ai_insight_summary && (willEmail || willSms)
      ? await buildAiCallInsights(transcript)
      : null;
  const summary = insights?.summary || baseSummary;
  const urgency = followUpUrgency(insights?.urgency || "") || rememberedUrgency;

  actionItems = portalNextActions({
    analysisJson: callLog?.ai_analysis_json,
    followUpTitles,
    summary,
    transcript,
    outcome: outcomeText,
    urgency,
  });

  const analysisRecord =
    callLog?.ai_analysis_json && typeof callLog.ai_analysis_json === "object"
      ? (callLog.ai_analysis_json as Record<string, unknown>)
      : null;
  const analysisCompany = typeof analysisRecord?.company === "string" ? analysisRecord.company : "";
  const analysisStatus =
    typeof analysisRecord?.company_status === "string" ? analysisRecord.company_status : "";
  const analysisCaller =
    typeof analysisRecord?.caller_name === "string" ? analysisRecord.caller_name : "";

  let smsSent: string[] = Array.isArray(logMeta.summary_sms_to)
    ? logMeta.summary_sms_to.filter((item): item is string => typeof item === "string")
    : [];
  let smsError: string | undefined;
  if (smsPhones.length && !smsAlreadySent) {
    const sms = await sendStaffAlertSms({
      phones: smsPhones,
      message: buildStaffAlertSms({
        businessName,
        callerId,
        summary,
        actionItems: smsActionItems,
      }),
      profileId: profile.id,
      profileSlug: profile.slug || null,
      callId: callId || callLog?.id || null,
    });
    smsSent = sms.sent;
    smsError = sms.error;
  }

  const emailInput = {
    businessName,
    callerId,
    summary,
    transcript,
    outcome: outcomeText || "Conversation recorded",
    startedAt: startedAt || callLog?.started_at || null,
    actionItems,
    agentName: callLog?.profile_name || profile.profile_name || "WiseCall",
    callerName: insights?.callerName || analysisCaller || null,
    company: analysisStatus ? analysisCompany : (insights?.company || ""),
    companyStatus: analysisStatus,
    callbackNumber: insights?.callbackNumber || null,
    urgency: insights?.urgency || null,
  };
  const renderedItems = emailActionItems(emailInput);
  emailInput.actionItems = renderedItems;
  const emailAlreadySent =
    logMeta.summary_email_sent === true &&
    (!renderedItems.length || logMeta.summary_email_included_next_actions === true);

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
    const html = buildPostCallEmailHtml(emailInput);
    const text = buildPostCallEmailText(emailInput);
    const subject = postCallEmailSubject(emailInput);

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${resendKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ from, to, subject, html, text }),
    });

    if (!res.ok) {
      emailError = "Send failed";
      console.error("wisecall-email-summary resend failed:", res.status, await res.text());
    } else {
      emailSent = to.length;
    }
  }

  const nextMeta: Record<string, unknown> = { ...logMeta };
  if (insights) {
    // analysed_at stays null so the portal's fuller analysis still runs later.
    nextMeta.ai_email_insights = {
      caller_name: insights.callerName || null,
      company: insights.company || null,
      callback_number: insights.callbackNumber || null,
      urgency: insights.urgency || null,
      at: new Date().toISOString(),
    };
  }
  if (emailSent && !emailAlreadySent) {
    nextMeta.summary_email_sent = true;
    nextMeta.summary_email_sent_at = new Date().toISOString();
    nextMeta.summary_email_to = to;
    nextMeta.summary_email_included_next_actions = renderedItems.length > 0;
  }
  if (smsSent.length && !smsAlreadySent) {
    nextMeta.summary_sms_sent = true;
    nextMeta.summary_sms_sent_at = new Date().toISOString();
    nextMeta.summary_sms_to = smsSent;
  }
  if (
    callLog?.id &&
    ((emailSent && !emailAlreadySent) || (smsSent.length && !smsAlreadySent) || insights)
  ) {
    const update: Record<string, unknown> = { metadata: nextMeta };
    if (insights) update.ai_insight_summary = insights.summary;
    await supabase.from("wisecall_call_logs").update(update).eq("id", callLog.id);
  }

  const ok = Boolean(emailSent || smsSent.length || emailSkipped === "already_sent");
  return json({
    ok,
    sent: emailSent,
    sms_sent: smsSent.length,
    next_actions: renderedItems.length,
    skipped: emailSkipped,
    error: emailError || smsError,
  }, ok || emailSkipped ? 200 : 502);
});
