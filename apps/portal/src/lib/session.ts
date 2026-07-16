import { cookies } from "next/headers";
import type { User } from "@supabase/supabase-js";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { IMPERSONATE_AGENT_COOKIE, IMPERSONATE_COOKIE } from "@/lib/impersonation";

// Resolves the user whose data should be shown. Mirrors the dashboard page:
// the real signed-in user, unless they are an admin "viewing as" a customer
// (a forged impersonation cookie does nothing for a non-admin). Returns null
// when nobody is signed in.
export async function getEffectiveUser(): Promise<{
  user: User;
  effectiveUserId: string;
  isAdminUser: boolean;
  impersonateAgentId?: string;
} | null> {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const isAdminUser = isAdmin(user);
  const store = await cookies();
  const impersonateId = isAdminUser ? store.get(IMPERSONATE_COOKIE)?.value : undefined;
  const impersonateAgentId =
    isAdminUser && impersonateId ? store.get(IMPERSONATE_AGENT_COOKIE)?.value : undefined;

  return {
    user,
    effectiveUserId: impersonateId || user.id,
    isAdminUser,
    impersonateAgentId,
  };
}
