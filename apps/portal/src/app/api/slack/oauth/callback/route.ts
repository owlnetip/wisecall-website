import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { createClient } from "@supabase/supabase-js";
import { getSlackOAuthRedirectUri } from "@/lib/slack";

const STATE_COOKIE = "wisecall_slack_oauth_state";

type OAuthState = {
  state: string;
  userId: string;
  profileId: string;
  ts: number;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");
  const stateParam = url.searchParams.get("state");

  const dashboard = new URL("/dashboard", request.url);
  dashboard.searchParams.set("view", "channels");

  if (error) {
    dashboard.searchParams.set("slack_error", error);
    return NextResponse.redirect(dashboard);
  }

  if (!code || !stateParam) {
    dashboard.searchParams.set("slack_error", "missing_code");
    return NextResponse.redirect(dashboard);
  }

  let parsed: OAuthState;
  try {
    parsed = JSON.parse(Buffer.from(stateParam, "base64url").toString("utf8")) as OAuthState;
  } catch {
    dashboard.searchParams.set("slack_error", "invalid_state");
    return NextResponse.redirect(dashboard);
  }

  const cookieStore = await cookies();
  const expectedState = cookieStore.get(STATE_COOKIE)?.value;
  cookieStore.delete(STATE_COOKIE);

  if (!expectedState || expectedState !== parsed.state || Date.now() - parsed.ts > 600_000) {
    dashboard.searchParams.set("slack_error", "state_mismatch");
    return NextResponse.redirect(dashboard);
  }

  const clientId = process.env.SLACK_CLIENT_ID;
  const clientSecret = process.env.SLACK_CLIENT_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!clientId || !clientSecret || !supabaseUrl || !serviceKey) {
    dashboard.searchParams.set("slack_error", "not_configured");
    return NextResponse.redirect(dashboard);
  }

  const tokenRes = await fetch("https://slack.com/api/oauth.v2.access", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: getSlackOAuthRedirectUri(),
    }),
  });

  const tokenData = await tokenRes.json();
  if (!tokenData.ok) {
    console.error("Slack OAuth error:", tokenData.error);
    dashboard.searchParams.set("slack_error", tokenData.error || "oauth_failed");
    return NextResponse.redirect(dashboard);
  }

  const supabase = createClient(supabaseUrl, serviceKey);
  const workspaceId = tokenData.team?.id as string;
  const workspaceName = (tokenData.team?.name as string) || workspaceId;
  const botToken = tokenData.access_token as string;
  const botUserId = tokenData.bot_user_id as string | undefined;
  const installerUserId = tokenData.authed_user?.id as string | undefined;
  const scopes = tokenData.scope as string | undefined;

  let profileId = parsed.profileId;
  if (profileId) {
    const { data: profile } = await supabase
      .from("wisecall_profiles")
      .select("id")
      .eq("id", profileId)
      .eq("metadata->>owner_id", parsed.userId)
      .maybeSingle();
    if (!profile) profileId = "";
  }

  if (!profileId) {
    const { data: fallback } = await supabase
      .from("wisecall_profiles")
      .select("id")
      .eq("metadata->>owner_id", parsed.userId)
      .order("created_at", { ascending: true })
      .limit(1)
      .maybeSingle();
    profileId = fallback?.id || "";
  }

  if (!profileId) {
    dashboard.searchParams.set("slack_error", "no_agent");
    return NextResponse.redirect(dashboard);
  }

  const now = new Date().toISOString();
  const row = {
    owner_id: parsed.userId,
    profile_id: profileId,
    provider: "slack",
    workspace_id: workspaceId,
    workspace_name: workspaceName,
    bot_token: botToken,
    bot_user_id: botUserId || null,
    installer_user_id: installerUserId || null,
    scopes: scopes || null,
    status: "connected",
    last_error: null,
    updated_at: now,
  };

  const { error: upsertError } = await supabase.from("wisecall_messaging_connections").upsert(row, {
    onConflict: "owner_id,provider",
  });

  if (upsertError) {
    console.error("Slack connection upsert failed:", upsertError.message);
    dashboard.searchParams.set("slack_error", "save_failed");
    return NextResponse.redirect(dashboard);
  }

  dashboard.searchParams.set("slack_connected", "1");
  return NextResponse.redirect(dashboard);
}
