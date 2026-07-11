import { NextResponse } from "next/server";
import { runWeeklyLearningForAllAgents } from "@/lib/agent-learning";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Weekly cron: POST with Authorization: Bearer CRON_SECRET */
export async function POST(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { ok: false, error: "CRON_SECRET not configured" },
      { status: 503 },
    );
  }

  const auth = request.headers.get("authorization") ?? "";
  if (auth !== `Bearer ${secret}`) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const result = await runWeeklyLearningForAllAgents();
  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}
