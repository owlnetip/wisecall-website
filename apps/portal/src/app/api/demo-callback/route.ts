import { NextResponse } from "next/server";
import { getDemoCallbackEndpoint } from "@/lib/env";
import { callbackSchema } from "@/lib/validation";

export async function POST(request: Request) {
  try {
    const payload = await request.json();
    const parsed = callbackSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: parsed.error.issues[0]?.message || "Invalid callback request.",
        },
        { status: 400 },
      );
    }

    const response = await fetch(getDemoCallbackEndpoint(), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        phone: parsed.data.phone,
        profile_slug: "wisecall",
        agent_name: "WiseCall Website Assistant",
        source: parsed.data.source,
      }),
    });
    const result = await response.json().catch(() => ({}));

    if (!response.ok || result.ok === false) {
      return NextResponse.json(
        {
          ok: false,
          error: result.error || "Could not start the demo call.",
        },
        { status: response.status || 502 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: result.message || "The WiseCall demo agent is calling now.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not start the demo call.",
      },
      { status: 500 },
    );
  }
}
