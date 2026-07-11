import { NextResponse } from "next/server";
import { detectKnowledgeGapsForAllAgents } from "@/lib/agent-memory";

export const dynamic = "force-dynamic";
// Detection clusters recent calls per agent via Claude, so give it room.
export const maxDuration = 300;

/**
 * Daily cron: continuous knowledge-gap learning for opted-in agents
 * (metadata.learning_enabled = true). Vercel Cron invokes this via GET and
 * injects Authorization: Bearer CRON_SECRET; POST is accepted too for manual
 * triggering. Only the graceful handling behaviour is auto-applied — never
 * factual answers.
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

  const result = await detectKnowledgeGapsForAllAgents();
  return NextResponse.json(result, { status: result.ok ? 200 : 207 });
}

export const GET = handle;
export const POST = handle;
