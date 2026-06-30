import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseConfig } from "@/lib/env";

let serviceClient: SupabaseClient | null = null;

export function getServiceSupabase() {
  const config = getSupabaseConfig();

  if (!config) {
    return null;
  }

  if (!serviceClient) {
    serviceClient = createClient(config.url, config.serviceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    });
  }

  return serviceClient;
}
