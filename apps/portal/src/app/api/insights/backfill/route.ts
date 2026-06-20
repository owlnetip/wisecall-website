import { NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/session";
import { backfillAnalysisForUser, isAnalysisConfigured } from "@/lib/call-analysis";

// Authenticated, on-demand backfill for the signed-in tenant.
//
// POST /api/insights/backfill
//
// The dashboard calls this the first time a customer opens AI Insights and there
// are calls with transcripts that have never been analysed (e.g. history from
// before this feature shipped). It analyses a small batch per request and
// reports how many remain, so the client can loop until `remaining` is 0. Bounded
// per call to keep each request fast. Tenant-safe: only touches this user's calls.
export async function POST() {
  const session = await getEffectiveUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  if (!isAnalysisConfigured()) {
    return NextResponse.json(
      { ok: false, error: "AI analysis is not configured." },
      { status: 503 },
    );
  }

  try {
    const result = await backfillAnalysisForUser(session.effectiveUserId, 8);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("/api/insights/backfill failed:", error);
    return NextResponse.json(
      { ok: false, error: "Backfill failed." },
      { status: 500 },
    );
  }
}
