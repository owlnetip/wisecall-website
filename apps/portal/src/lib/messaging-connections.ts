import { getServiceSupabase } from "@/lib/supabase";
import { mapSlackConnection, type SlackConnection, type SlackConnectionRow } from "@/lib/slack";

export async function getSlackConnectionForUser(userId: string): Promise<SlackConnection | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("wisecall_messaging_connections")
    .select("*")
    .eq("owner_id", userId)
    .eq("provider", "slack")
    .eq("status", "connected")
    .maybeSingle();

  if (error) {
    console.error("getSlackConnectionForUser failed:", error.message);
    return null;
  }

  if (!data) return null;
  return mapSlackConnection(data as SlackConnectionRow);
}

export async function getSlackConnectionByWorkspace(workspaceId: string): Promise<(SlackConnectionRow & { profile_id: string }) | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("wisecall_messaging_connections")
    .select("*")
    .eq("workspace_id", workspaceId)
    .eq("provider", "slack")
    .eq("status", "connected")
    .maybeSingle();

  if (error) {
    console.error("getSlackConnectionByWorkspace failed:", error.message);
    return null;
  }

  return (data as SlackConnectionRow) || null;
}
