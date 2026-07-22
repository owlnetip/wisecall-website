import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Hourly-ish cron proxy → wisecall-viewing-reminders edge function.
 * Sends day-before "still ok?" + day-of SMS for confirmed viewings.
 *
 * Vercel Cron: Authorization Bearer CRON_SECRET
 */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const trigger =
    process.env.WISECALL_POOL_REPLENISH_SECRET || process.env.CRON_SECRET || "";
  if (!supabaseUrl) {
    return NextResponse.json({ ok: false, error: "SUPABASE_URL not configured" }, { status: 503 });
  }

  const res = await fetch(`${supabaseUrl.replace(/\/$/, "")}/functions/v1/wisecall-viewing-reminders`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-trigger-secret": trigger,
      Authorization: `Bearer ${secret}`,
    },
    body: "{}",
  });

  const body = await res.json().catch(() => ({}));
  return NextResponse.json(body, { status: res.ok ? 200 : res.status });
}

export const GET = handle;
export const POST = handle;
