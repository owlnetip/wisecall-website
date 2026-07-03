import { NextResponse } from "next/server";
import { processDueOutreachFollowUpsInternal } from "@/app/actions/outreach";

export const dynamic = "force-dynamic";

/** Daily cron: POST with Authorization: Bearer CRON_SECRET */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ ok: false, error: "CRON_SECRET not configured" }, { status: 503 });
  }

  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await processDueOutreachFollowUpsInternal();
  if (!result.ok) {
    return NextResponse.json({ ok: false, error: result.error }, { status: 500 });
  }
  return NextResponse.json({ ok: true, ...result.data });
}
