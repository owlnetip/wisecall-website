import { NextResponse } from "next/server";
import { analyseMissedRecentCalls } from "@/lib/call-analysis";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/**
 * Every-5-minutes catch-up: analyses (and so emails) any phone call from the
 * last two hours that the runtime's call-completed trigger missed.
 *
 * Scheduled by Supabase pg_cron (job "wisecall-post-call-catchup") with
 * x-wisecall-secret: WISECALL_WEBHOOK_SECRET, the same secret the voice
 * runtimes use for /api/webhooks/call-completed. Bearer CRON_SECRET also works.
 */
async function handle(request: Request) {
  const accepted = [process.env.WISECALL_WEBHOOK_SECRET, process.env.CRON_SECRET]
    .map((value) => value?.trim())
    .filter((value): value is string => Boolean(value));
  if (accepted.length === 0) {
    return NextResponse.json({ ok: false, error: "Not configured" }, { status: 503 });
  }

  const provided =
    request.headers.get("x-wisecall-secret") ||
    request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ||
    "";
  if (!accepted.includes(provided)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await analyseMissedRecentCalls();
    if (result.analysed || result.errors) {
      console.log("post-call-catchup:", JSON.stringify(result));
    }
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("/api/cron/post-call-catchup failed:", error);
    return NextResponse.json({ ok: false, error: "Catch-up failed." }, { status: 500 });
  }
}

export const GET = handle;
export const POST = handle;
