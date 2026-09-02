import { NextResponse } from "next/server";
import { demoCallbackHttpResponse, placeAvaDemoCallback } from "@/lib/place-demo-callback";
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

    const result = await placeAvaDemoCallback({
      phone: parsed.data.phone,
      source: parsed.data.source,
      headers: request.headers,
    });
    return demoCallbackHttpResponse(result);
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
