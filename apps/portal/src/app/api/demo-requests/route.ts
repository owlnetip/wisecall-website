import { NextResponse } from "next/server";
import { createDemoRequest } from "@/lib/demo-store";
import { demoRequestSchema } from "@/lib/validation";
import { isAdmin } from "@/lib/admin";
import { createSupabaseServerClient } from "@/lib/supabase/server";

export async function POST(request: Request) {
  try {
    const supabase = await createSupabaseServerClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return NextResponse.json({ ok: false, error: "Not signed in." }, { status: 401 });
    }
    if (!isAdmin(user)) {
      return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
    }

    const payload = await request.json();
    const parsed = demoRequestSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        {
          ok: false,
          error: parsed.error.issues[0]?.message || "Invalid demo request.",
        },
        { status: 400 },
      );
    }

    const result = await createDemoRequest(parsed.data);

    return NextResponse.json({
      ok: true,
      ...result,
      message: result.smsQueued
        ? "Demo created and SMS queued."
        : "Demo created. Configure the SMS webhook to text this link automatically.",
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        error:
          error instanceof Error
            ? error.message
            : "Could not create the demo request.",
      },
      { status: 500 },
    );
  }
}
