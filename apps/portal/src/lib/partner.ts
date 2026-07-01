import type { User } from "@supabase/supabase-js";
import { getServiceSupabase } from "@/lib/supabase";

// Who counts as a partner (reseller). Mirrors isAdmin: primary signal is a role
// stamped on the auth user (app_metadata.role / user_metadata.role === "partner").
export function isPartner(user: User | null): boolean {
  if (!user) return false;
  const appRole = (user.app_metadata as Record<string, unknown> | null)?.role;
  const userRole = (user.user_metadata as Record<string, unknown> | null)?.role;
  return appRole === "partner" || userRole === "partner";
}

export type Partner = {
  id: string;
  userId: string;
  name: string;
  referralCode: string;
  commissionRate: number; // 0.30 = 30%
  contactEmail: string | null;
  status: string;
};

// Monthly list price (ex-VAT, £) per plan - used to estimate referred MRR for
// the partner dashboard. Mirrors the price constants in lib/stripe.ts. The
// authoritative commission figure comes from the ledger, not this estimate.
const PLAN_MRR_GBP: Record<string, number> = {
  starter: 99,
  professional: 199,
  business: 399,
  // Legacy plans - existing subscribers
  core: 249,
  growth: 399,
  pro: 699,
};

export function planMrrGbp(plan: string | null | undefined): number {
  return PLAN_MRR_GBP[(plan ?? "").toLowerCase()] ?? 0;
}

type PartnerRow = {
  id: string;
  user_id: string;
  name: string;
  referral_code: string;
  commission_rate: number | string;
  contact_email: string | null;
  status: string;
};

function mapPartner(row: PartnerRow): Partner {
  return {
    id: row.id,
    userId: row.user_id,
    name: row.name,
    referralCode: row.referral_code,
    commissionRate: Number(row.commission_rate),
    contactEmail: row.contact_email,
    status: row.status,
  };
}

// Resolve the partner profile for a signed-in partner login. Service-role read;
// callers must gate on isPartner first.
export async function getPartnerByUserId(userId: string): Promise<Partner | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;
  const { data } = await supabase
    .from("wisecall_partners")
    .select("id, user_id, name, referral_code, commission_rate, contact_email, status")
    .eq("user_id", userId)
    .maybeSingle();
  return data ? mapPartner(data as PartnerRow) : null;
}

// Resolve a partner by referral code (case-insensitive). Used at signup to
// attribute the new customer. Returns null for unknown/paused codes.
export async function resolvePartnerByCode(code: string): Promise<Partner | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;
  const normalised = code.trim().toLowerCase();
  if (!normalised) return null;
  const { data } = await supabase
    .from("wisecall_partners")
    .select("id, user_id, name, referral_code, commission_rate, contact_email, status")
    .eq("referral_code", normalised)
    .eq("status", "active")
    .maybeSingle();
  return data ? mapPartner(data as PartnerRow) : null;
}

// Admin view: all partners with a headline referral + commission tally.
export type PartnerSummary = Partner & {
  referred: number;
  commissionAccruedGbp: number;
  commissionPaidGbp: number;
};

export async function getAllPartners(): Promise<PartnerSummary[]> {
  const supabase = getServiceSupabase();
  if (!supabase) return [];

  const { data: partners } = await supabase
    .from("wisecall_partners")
    .select("id, user_id, name, referral_code, commission_rate, contact_email, status")
    .order("created_at", { ascending: false });

  const rows = (partners ?? []) as PartnerRow[];
  if (!rows.length) return [];

  // Tally referrals per partner from billing attributions.
  const { data: billing } = await supabase
    .from("wisecall_billing")
    .select("partner_id");
  const referredBy: Record<string, number> = {};
  for (const b of (billing ?? []) as { partner_id: string | null }[]) {
    if (b.partner_id) referredBy[b.partner_id] = (referredBy[b.partner_id] ?? 0) + 1;
  }

  // Tally accrued (pending) and paid commission per partner.
  const { data: commissions } = await supabase
    .from("wisecall_partner_commissions")
    .select("partner_id, commission_pence, status");
  const accruedBy: Record<string, number> = {};
  const paidBy: Record<string, number> = {};
  for (const c of (commissions ?? []) as { partner_id: string; commission_pence: number; status: string }[]) {
    if (c.status === "paid") paidBy[c.partner_id] = (paidBy[c.partner_id] ?? 0) + c.commission_pence;
    else accruedBy[c.partner_id] = (accruedBy[c.partner_id] ?? 0) + c.commission_pence;
  }

  return rows.map((r) => ({
    ...mapPartner(r),
    referred: referredBy[r.id] ?? 0,
    commissionAccruedGbp: (accruedBy[r.id] ?? 0) / 100,
    commissionPaidGbp: (paidBy[r.id] ?? 0) / 100,
  }));
}

export type ReferredCustomer = {
  userId: string;
  email: string;
  plan: string | null;
  status: string | null; // trialing | active | canceled | …
  mrrGbp: number;
  since: string | null;
};

export type PartnerOverview = {
  partner: Partner;
  customers: ReferredCustomer[];
  stats: {
    referred: number;
    live: number; // active or trialing
    estMrrGbp: number; // sum of live customers' plan MRR
    commissionAccruedGbp: number; // pending commissions
    commissionPaidGbp: number; // paid commissions
  };
};

// Builds the partner's read-only book of business: referred customers (from
// billing rows attributed to this partner) + commission totals from the ledger.
export async function getPartnerOverview(userId: string): Promise<PartnerOverview | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const partner = await getPartnerByUserId(userId);
  if (!partner) return null;

  // Referred customers via attributed billing rows.
  const { data: billingRows } = await supabase
    .from("wisecall_billing")
    .select("user_id, plan, status, created_at")
    .eq("partner_id", partner.id);

  const rows = (billingRows ?? []) as {
    user_id: string;
    plan: string | null;
    status: string | null;
    created_at: string | null;
  }[];

  // Resolve customer emails from the auth users list.
  const emailById: Record<string, string> = {};
  try {
    const { data } = await supabase.auth.admin.listUsers({ perPage: 1000 });
    for (const u of data?.users ?? []) {
      if (u.id && u.email) emailById[u.id] = u.email;
    }
  } catch (err) {
    console.error("getPartnerOverview listUsers failed:", err);
  }

  const customers: ReferredCustomer[] = rows.map((r) => {
    const live = r.status === "active" || r.status === "trialing";
    return {
      userId: r.user_id,
      email: emailById[r.user_id] ?? "-",
      plan: r.plan,
      status: r.status,
      mrrGbp: live ? planMrrGbp(r.plan) : 0,
      since: r.created_at,
    };
  });

  // Commission totals from the ledger.
  const { data: commissions } = await supabase
    .from("wisecall_partner_commissions")
    .select("commission_pence, status")
    .eq("partner_id", partner.id);

  let accruedPence = 0;
  let paidPence = 0;
  for (const c of (commissions ?? []) as { commission_pence: number; status: string }[]) {
    if (c.status === "paid") paidPence += c.commission_pence;
    else accruedPence += c.commission_pence;
  }

  const live = customers.filter((c) => c.status === "active" || c.status === "trialing").length;

  return {
    partner,
    customers: customers.sort((a, b) => (b.since ?? "").localeCompare(a.since ?? "")),
    stats: {
      referred: customers.length,
      live,
      estMrrGbp: customers.reduce((sum, c) => sum + c.mrrGbp, 0),
      commissionAccruedGbp: accruedPence / 100,
      commissionPaidGbp: paidPence / 100,
    },
  };
}
