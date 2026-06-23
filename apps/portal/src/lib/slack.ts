export const SLACK_BOT_SCOPES = [
  "app_mentions:read",
  "chat:write",
  "im:history",
  "im:read",
  "im:write",
  "users:read",
  "users:read.email",
].join(",");

export type SlackConnectionRow = {
  id: string;
  owner_id: string;
  profile_id: string;
  provider: string;
  workspace_id: string;
  workspace_name: string | null;
  bot_token: string;
  bot_user_id: string | null;
  installer_user_id: string | null;
  scopes: string | null;
  status: string;
  last_error: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type SlackConnection = {
  id: string;
  profileId: string;
  workspaceId: string;
  workspaceName: string;
  status: string;
  botUserId?: string;
};

export function getSlackOAuthRedirectUri(): string {
  const base = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
  return `${base.replace(/\/$/, "")}/api/slack/oauth/callback`;
}

export function getSlackInstallUrl(state: string): string {
  const clientId = process.env.SLACK_CLIENT_ID;
  if (!clientId) throw new Error("SLACK_CLIENT_ID is not configured");

  const params = new URLSearchParams({
    client_id: clientId,
    scope: SLACK_BOT_SCOPES,
    redirect_uri: getSlackOAuthRedirectUri(),
    state,
  });

  return `https://slack.com/oauth/v2/authorize?${params.toString()}`;
}

export function mapSlackConnection(row: SlackConnectionRow): SlackConnection {
  return {
    id: row.id,
    profileId: row.profile_id,
    workspaceId: row.workspace_id,
    workspaceName: row.workspace_name || row.workspace_id,
    status: row.status,
    botUserId: row.bot_user_id || undefined,
  };
}
