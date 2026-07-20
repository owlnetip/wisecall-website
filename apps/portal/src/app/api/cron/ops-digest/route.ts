import { NextResponse } from "next/server";
import { processOpsDigests } from "@/lib/ops-digest";

export const dynamic = "force-dynamic";
export const maxDuration = 120;

/**
 * Hourly cron: morning/afternoon outstanding-work digests per agent timezone.
 * Quiet when nothing is open. Auth via Authorization: Bearer CRON_SECRET.
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

  const result = await processOpsDigests();
  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}

export const GET = handle;
export const POST = handle;
