"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isAdmin } from "@/lib/admin";
import { IMPERSONATE_COOKIE } from "@/lib/impersonation";

// Admin "view as customer" / impersonation. The admin stays authenticated as
// themselves (auditable, reversible); we just store the target user's id in a
// httpOnly cookie. The dashboard ONLY honours this cookie when the real signed-in
// user is an admin, so a forged cookie does nothing for a normal user.
export async function impersonateUser(targetUserId: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user) || !targetUserId) {
    redirect("/admin");
  }

  const store = await cookies();
  store.set(IMPERSONATE_COOKIE, targetUserId, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 4, // 4 hours
  });
  redirect("/dashboard");
}

export async function stopImpersonating() {
  const store = await cookies();
  store.delete(IMPERSONATE_COOKIE);
  redirect("/admin");
}
