import { NextResponse } from "next/server";
import { analyzeAndStoreCall, isAnalysisConfigured } from "@/lib/call-analysis";

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
export async function POST(request: Request) {
  const secret = process.env.WISECALL_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "Webhook not configured." },
      { status: 503 },
    );
  }

  const provided =
    request.headers.get("x-wisecall-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (provided !== secret) {
    return NextResponse.json({ ok: false, error: "Unauthorized." }, { status: 401 });
  }

  if (!isAnalysisConfigured()) {
    return NextResponse.json(
      { ok: false, error: "AI analysis is not configured." },
      { status: 503 },
    );
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

  try {
    const analysis = await analyzeAndStoreCall(callId);
    if (!analysis) {
      return NextResponse.json({ ok: true, skipped: "no usable transcript" });
    }
    return NextResponse.json({ ok: true, analysed: true });
  } catch (error) {
    console.error("/api/webhooks/call-completed failed:", error);
    return NextResponse.json(
      { ok: false, error: "Analysis failed." },
      { status: 500 },
    );
  }
}
