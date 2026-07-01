"use server";

import { revalidatePath } from "next/cache";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { isAdmin } from "@/lib/admin";
import { getAppBaseUrl } from "@/lib/env";

export type CreatePartnerResult =
  | { ok: true; referralCode: string; invited: boolean }
  | { ok: false; error: string };

function slugifyCode(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
}

async function findUserByEmail(
  service: NonNullable<ReturnType<typeof getServiceSupabase>>,
  email: string,
): Promise<string | null> {
  const target = email.trim().toLowerCase();
  // listUsers is paginated; one page of 1000 is plenty for this scale.
  const { data } = await service.auth.admin.listUsers({ perPage: 1000 });
  const found = (data?.users ?? []).find((u) => u.email?.toLowerCase() === target);
  return found?.id ?? null;
}

// Admin-only: mint a partner. Creates/invites the partner's login, stamps the
// `partner` role, and inserts their wisecall_partners row with a referral code.
export async function createPartner(formData: FormData): Promise<CreatePartnerResult> {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user || !isAdmin(user)) return { ok: false, error: "Admins only." };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const name = String(formData.get("name") ?? "").trim();
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const rawCode = String(formData.get("referral_code") ?? "").trim();
  const rawRate = String(formData.get("commission_rate") ?? "").trim();

  if (!name || !email) return { ok: false, error: "Name and email are required." };

  // Commission rate: accept a percentage (e.g. "30") or a fraction (e.g. "0.3").
  let rate = 0.3;
  if (rawRate) {
    const n = Number(rawRate);
    if (!Number.isNaN(n) && n > 0) rate = n > 1 ? n / 100 : n;
  }

  // Referral code: provided, else derived from name. Ensure uniqueness.
  let code = slugifyCode(rawCode || name);
  if (!code) return { ok: false, error: "Could not derive a referral code - set one explicitly." };
  for (let i = 0; i < 5; i++) {
    const { data: clash } = await service
      .from("wisecall_partners")
      .select("id")
      .eq("referral_code", code)
      .maybeSingle();
    if (!clash) break;
    code = `${slugifyCode(rawCode || name)}-${Math.random().toString(36).slice(2, 5)}`;
  }

  // Find or invite the partner's login.
  let userId = await findUserByEmail(service, email);
  let invited = false;
  if (!userId) {
    const { data: invite, error: inviteError } = await service.auth.admin.inviteUserByEmail(email, {
      data: { role: "partner" },
      redirectTo: `${getAppBaseUrl().replace(/\/$/, "")}/auth/confirm?next=/partner`,
    });
    if (inviteError || !invite?.user?.id) {
      return { ok: false, error: inviteError?.message ?? "Could not invite partner." };
    }
    userId = invite.user.id;
    invited = true;
  }

  // Stamp the partner role in app_metadata (authoritative for isPartner).
  const { error: roleError } = await service.auth.admin.updateUserById(userId, {
    app_metadata: { role: "partner" },
  });
  if (roleError) return { ok: false, error: `Role assignment failed: ${roleError.message}` };

  // Insert the partner profile.
  const { error: insertError } = await service.from("wisecall_partners").insert({
    user_id: userId,
    name,
    referral_code: code,
    commission_rate: rate,
    contact_email: email,
    status: "active",
  });
  if (insertError) {
    // Unique violation on user_id → this login is already a partner.
    if (insertError.code === "23505") {
      return { ok: false, error: "That email is already a partner." };
    }
    return { ok: false, error: insertError.message };
  }

  revalidatePath("/admin/partners");
  return { ok: true, referralCode: code, invited };
}

export type PayoutResult =
  | { ok: true; count: number; totalGbp: number }
  | { ok: false; error: string };

// Admin-only: mark all of a partner's pending commissions as paid (i.e. record
// a payout run). Returns how many lines were settled and the total amount.
export async function markPartnerCommissionsPaid(partnerId: string): Promise<PayoutResult> {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user || !isAdmin(user)) return { ok: false, error: "Admins only." };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };
  if (!partnerId) return { ok: false, error: "Missing partner." };

  // Read pending lines first so we can report the settled total.
  const { data: pending, error: readError } = await service
    .from("wisecall_partner_commissions")
    .select("id, commission_pence")
    .eq("partner_id", partnerId)
    .eq("status", "pending");
  if (readError) return { ok: false, error: readError.message };

  const rows = (pending ?? []) as { id: string; commission_pence: number }[];
  if (rows.length === 0) return { ok: true, count: 0, totalGbp: 0 };

  const totalPence = rows.reduce((sum, r) => sum + r.commission_pence, 0);

  const { error: updateError } = await service
    .from("wisecall_partner_commissions")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("partner_id", partnerId)
    .eq("status", "pending");
  if (updateError) return { ok: false, error: updateError.message };

  revalidatePath("/admin/partners");
  return { ok: true, count: rows.length, totalGbp: totalPence / 100 };
}

export type StatusResult = { ok: true; status: string } | { ok: false; error: string };

// Admin-only: pause/activate a partner. A paused partner's referral code stops
// attributing new signups (resolvePartnerByCode filters on status = active);
// existing referrals and their commissions are unaffected.
export async function setPartnerStatus(partnerId: string, status: "active" | "paused"): Promise<StatusResult> {
  const auth = await createSupabaseServerClient();
  const { data: { user } } = await auth.auth.getUser();
  if (!user || !isAdmin(user)) return { ok: false, error: "Admins only." };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };
  if (!partnerId) return { ok: false, error: "Missing partner." };

  const { error } = await service
    .from("wisecall_partners")
    .update({ status, updated_at: new Date().toISOString() })
    .eq("id", partnerId);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/admin/partners");
  return { ok: true, status };
}
