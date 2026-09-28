// Secrets for edge functions: Supabase Vault first, then the function's env.
// Vault has no 100-secret limit and is encrypted at rest; public.get_app_secret
// is callable by service_role only. Moving a key: store it in Vault with the
// same name (vault.create_secret), confirm, then delete the env secret.
//
//   const key = await getSecret("GIACOM_API_PASSWORD");
//
// Values are cached per warm isolate for 5 minutes and never logged.
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2";

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { value: string | null; expires: number }>();
let client: SupabaseClient | null = null;

function serviceClient(): SupabaseClient | null {
  if (client) return client;
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!url || !key) return null;
  client = createClient(url, key, { auth: { persistSession: false } });
  return client;
}

export async function getSecret(name: string, lookup = vaultLookup): Promise<string | null> {
  const hit = cache.get(name);
  if (hit && hit.expires > Date.now()) return hit.value;
  let value: string | null = null;
  try {
    value = await lookup(name);
  } catch {
    value = null; // Vault unreachable: fall back to env below
  }
  if (!value) value = Deno.env.get(name) ?? null;
  cache.set(name, { value, expires: Date.now() + TTL_MS });
  return value;
}

async function vaultLookup(name: string): Promise<string | null> {
  const supabase = serviceClient();
  if (!supabase) return null;
  const { data, error } = await supabase.rpc("get_app_secret", { p_name: name });
  if (error) throw new Error("vault lookup failed");
  return typeof data === "string" && data ? data : null;
}

/** For tests. */
export function clearSecretCache() {
  cache.clear();
}
