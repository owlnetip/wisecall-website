import { NextResponse } from "next/server";
import { detectKnowledgeGapsForAllAgents } from "@/lib/agent-memory";

export const dynamic = "force-dynamic";
// Detection clusters recent calls per agent via Claude, so give it room.
export const maxDuration = 300;

/**
 * Daily cron: continuous knowledge-gap learning across all active agents.
 * POST with Authorization: Bearer CRON_SECRET.
 *
 * Each agent's recent unanswered questions are clustered; recurring topics
 * make the agent auto-adopt a graceful handling line and surface a fillable
 * gap to the owner. Only handling behaviour is auto-applied — never facts.
 */
export async function POST(request: Request) {
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
