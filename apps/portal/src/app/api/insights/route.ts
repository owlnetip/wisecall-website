import { NextResponse } from "next/server";
import { getEffectiveUser } from "@/lib/session";
import { getInsightsForUser, parseRange } from "@/lib/insights";

// Authenticated dashboard insights endpoint.
//
// GET /api/insights?range=today|7d|30d
//
// Returns the AI Insights roll-up for the signed-in tenant only. Auth is via the
// Supabase session cookie; data is scoped server-side to the user's own agents
// (see getInsightsForUser), so it can never leak another tenant's calls. All
// aggregation is server-side, the client just renders the JSON.
export async function GET(request: Request) {
  const session = await getEffectiveUser();
  if (!session) {
    return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
  }

  const range = parseRange(new URL(request.url).searchParams.get("range"));

  try {
    const insights = await getInsightsForUser(
      session.effectiveUserId,
      range,
      session.impersonateAgentId,
    );
    return NextResponse.json({ ok: true, insights });
  } catch (error) {
    console.error("/api/insights failed:", error);
    return NextResponse.json(
      { ok: false, error: "Could not load insights." },
      { status: 500 },
    );
  }
}
