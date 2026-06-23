import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getSlackInstallUrl } from "@/lib/slack";
import { hasActiveAccess, getBillingForUser } from "@/lib/billing";
import { isAdmin } from "@/lib/admin";

const STATE_COOKIE = "wisecall_slack_oauth_state";

export async function GET(request: Request) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.redirect(new URL("/?redirect=/dashboard", request.url));
  }

  if (!isAdmin(user) && !hasActiveAccess(await getBillingForUser(user.id))) {
    return NextResponse.redirect(new URL("/billing", request.url));
  }

  if (!process.env.SLACK_CLIENT_ID || !process.env.SLACK_CLIENT_SECRET) {
    return NextResponse.redirect(new URL("/dashboard?slack_error=not_configured", request.url));
  }

  const url = new URL(request.url);
  const profileId = url.searchParams.get("profile_id") || "";

  const state = crypto.randomUUID();
  const payload = Buffer.from(
    JSON.stringify({ state, userId: user.id, profileId, ts: Date.now() }),
  ).toString("base64url");

  const cookieStore = await cookies();
  cookieStore.set(STATE_COOKIE, state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: 600,
    path: "/",
  });

  return NextResponse.redirect(getSlackInstallUrl(payload));
}
