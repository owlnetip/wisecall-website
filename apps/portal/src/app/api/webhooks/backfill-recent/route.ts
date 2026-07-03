import { NextResponse } from "next/server";
import { backfillRecentActionItems, isAnalysisConfigured } from "@/lib/call-analysis";

function getAcceptedWebhookSecrets(): string[] {
  return [
    process.env.WISECALL_WEBHOOK_SECRET,
    process.env.WISECALL_TRIAL_REMINDER_SECRET,
    process.env.WISECALL_POOL_REPLENISH_SECRET,
  ]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
}

// Service backfill for calls analysed before action_items / follow-ups shipped.
// POST /api/webhooks/backfill-recent
// Header: x-wisecall-secret
// Body: { "limit"?: number }
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

  if (!isAnalysisConfigured()) {
    return NextResponse.json(
      { ok: false, error: "AI analysis is not configured." },
      { status: 503 },
    );
  }

  let limit = 25;
  try {
    const body = await request.json();
    if (typeof body?.limit === "number" && body.limit > 0) {
      limit = Math.min(Math.floor(body.limit), 50);
    }
  } catch {
    // default limit is fine
  }

  try {
    const result = await backfillRecentActionItems(limit);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("/api/webhooks/backfill-recent failed:", error);
    return NextResponse.json(
      { ok: false, error: "Backfill failed." },
      { status: 500 },
    );
  }
}
