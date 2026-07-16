"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { isAdmin } from "@/lib/admin";
import { IMPERSONATE_AGENT_COOKIE, IMPERSONATE_COOKIE } from "@/lib/impersonation";

function impersonateCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax" as const,
    path: "/",
    maxAge: 60 * 60 * 4, // 4 hours
  };
}

function cleanId(value: FormDataEntryValue | null | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

async function setImpersonationCookies(targetUserId: string, profileId?: string) {
  const store = await cookies();
  store.set(IMPERSONATE_COOKIE, targetUserId, impersonateCookieOptions());
  if (profileId) {
    store.set(IMPERSONATE_AGENT_COOKIE, profileId, impersonateCookieOptions());
  } else {
    store.delete(IMPERSONATE_AGENT_COOKIE);
  }
}

// Admin "view as customer" / impersonation. The admin stays authenticated as
// themselves (auditable, reversible); we just store the target user's id in a
// httpOnly cookie. The dashboard ONLY honours this cookie when the real signed-in
// user is an admin, so a forged cookie does nothing for a normal user.
// When profileId is passed, inbox/calls/contacts are scoped to that agent only.
export async function impersonateUser(targetUserId: string, profileId?: string) {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user || !isAdmin(user) || !targetUserId) {
    redirect("/admin");
  }

  const scopedProfileId = profileId?.trim() || undefined;
  if (scopedProfileId) {
    const svc = getServiceSupabase();
    if (!svc) redirect("/admin");

    const { data: profile } = await svc
      .from("wisecall_profiles")
      .select("metadata")
      .eq("id", scopedProfileId)
      .maybeSingle();
    const ownerId = (profile?.metadata as { owner_id?: string } | null)?.owner_id;
    if (!ownerId || ownerId.toLowerCase() !== targetUserId.toLowerCase()) {
      redirect("/admin");
    }
  }

  await setImpersonationCookies(targetUserId, scopedProfileId);
  redirect("/dashboard");
}

// Form-friendly entry point for the admin "Login as" button (hidden fields, no bind).
export async function impersonateCustomerForm(formData: FormData) {
  const targetUserId = cleanId(formData.get("ownerId"));
  const profileId = cleanId(formData.get("profileId")) || undefined;
  await impersonateUser(targetUserId, profileId);
}

export async function stopImpersonating() {
  const store = await cookies();
  store.delete(IMPERSONATE_COOKIE);
  store.delete(IMPERSONATE_AGENT_COOKIE);
  redirect("/admin");
}
