import { NextResponse } from "next/server";
import { analyzeAndStoreCall, isAnalysisConfigured } from "@/lib/call-analysis";
import { sendPostCallEmailForLog } from "@/lib/follow-ups-sync";
import { sendGuestHangupSignupSms } from "@/lib/guest-hangup-sms";
import { getServiceSupabase } from "@/lib/supabase";

// ─────────────────────────────────────────────────────────────────────────────
// AFTER-CALL AI ANALYSIS TRIGGER
//
// This is the integration point for the existing call pipeline. When the phone
// runtime finishes a call and has written the row to wisecall_call_logs (with its
// transcript + summary), it should POST that call's id here. We then run the
// after-call AI analysis (lib/call-analysis.ts) and store the structured result
// on the same row, which is what powers the AI Insights dashboard.
//
//   POST /api/webhooks/call-completed
//   Header:  x-wisecall-secret: <WISECALL_WEBHOOK_SECRET>
//   Body:    { "call_id": "<wisecall_call_logs.id>" }
//
// Auth: a shared secret (NOT a user session) because the caller is a backend
// service, not a browser. The prompt + API key stay entirely server-side.
//
// If you prefer to fire-and-forget from the runtime, this is safe to call
// repeatedly: a call with no transcript is skipped, and re-posting simply
// re-analyses and overwrites the stored result.
// ─────────────────────────────────────────────────────────────────────────────
function getAcceptedWebhookSecrets(): string[] {
  return [
    process.env.WISECALL_WEBHOOK_SECRET,
    process.env.WISECALL_TRIAL_REMINDER_SECRET,
    process.env.WISECALL_POOL_REPLENISH_SECRET,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

export async function POST(request: Request) {
  const secrets = getAcceptedWebhookSecrets();
  if (secrets.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Webhook not configured." },
      { status: 503 },
    );
  }

  const provided =
    request.headers.get("x-wisecall-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (!secrets.includes(provided)) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  let callId: string | undefined;
  try {
    const body = await request.json();
    callId = typeof body?.call_id === "string" ? body.call_id : undefined;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  if (!callId) {
    return NextResponse.json({ ok: false, error: "Missing call_id." }, { status: 400 });
  }
  const completedCallId = callId;

  const sendSummaryEmail = () =>
    sendPostCallEmailForLog(completedCallId).catch((error) => {
      console.error(
        "call-completed: summary email failed:",
        error instanceof Error ? error.message : error,
      );
      return { ok: false as const, error: "summary email failed" };
    });

  const sendGuestSignupSms = async () => {
    try {
      const service = getServiceSupabase();
      if (!service) return { ok: true as const, skipped: "supabase not configured" };
      const { data: log } = await service
        .from("wisecall_call_logs")
        .select("id, profile_id, caller_id, outcome, summary, transcript")
        .eq("id", completedCallId)
        .maybeSingle();
      if (!log?.profile_id) return { ok: true as const, skipped: "no call log" };
      const { data: profile } = await service
        .from("wisecall_profiles")
        .select("id, slug, profile_name, business_name, clinic_name, metadata")
        .eq("id", log.profile_id)
        .maybeSingle();
      if (!profile) return { ok: true as const, skipped: "no profile" };
      return await sendGuestHangupSignupSms({
        profileId: profile.id,
        profileSlug: profile.slug,
        profileName: profile.profile_name,
        businessName: profile.business_name || profile.clinic_name,
        metadata: profile.metadata,
        callId: log.id,
        callerId: log.caller_id,
        outcome: log.outcome,
        summary: log.summary,
        transcript: log.transcript,
      });
    } catch (error) {
      console.error(
        "call-completed: guest hangup SMS failed:",
        error instanceof Error ? error.message : error,
      );
      return { ok: false as const, error: "guest hangup SMS failed" };
    }
  };

  // Record the call against the owner's monthly allowance (fire-and-forget, never
  // block the response on billing; a failure here is logged but doesn't fail the call).
  void (async () => {
    try {
      const service = getServiceSupabase();
      if (service) {
        // Resolve profile_id from call log
        const { data: log } = await service
          .from("wisecall_call_logs")
          .select("profile_id")
          .eq("id", callId)
          .maybeSingle();
        if (log?.profile_id) {
          const { data } = await service.rpc("wisecall_record_ai_call", {
            p_profile_id: log.profile_id,
          });
          console.log("wisecall_record_ai_call:", JSON.stringify(data));
        }
      }
    } catch (err) {
      console.error("call-completed: usage recording failed:", err instanceof Error ? err.message : err);
    }
  })();

  const guestSms = await sendGuestSignupSms();
  if (!guestSms.ok) {
    console.error("call-completed: guest hangup SMS:", guestSms);
  }

  // Taken-message / post-call email still goes out when Claude is off. Analysis
  // is what fills next actions; without it the email omits that block.
  if (!isAnalysisConfigured()) {
    const email = await sendSummaryEmail();
    return NextResponse.json({
      ok: true,
      skipped: "analysis not configured",
      email,
    });
  }

  try {
    const analysis = await analyzeAndStoreCall(callId);
    // Successful analysis already emails from persistAnalysis (with next actions).
    if (!analysis) {
      const email = await sendSummaryEmail();
      return NextResponse.json({
        ok: true,
        skipped: "no usable transcript",
        email,
      });
    }
    return NextResponse.json({ ok: true, analysed: true });
  } catch (error) {
    console.error("/api/webhooks/call-completed failed:", error);
    const email = await sendSummaryEmail();
    return NextResponse.json(
      { ok: false, error: "Analysis failed.", email },
      { status: 500 },
    );
  }
}
