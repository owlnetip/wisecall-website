import { getServiceSupabase } from "@/lib/supabase";
import { TRIAL_CALL_CAP } from "@/lib/stripe";

export type Billing = {
  userId: string;
  stripeCustomerId: string | null;
  subscriptionId: string | null;
  plan: string | null;
  status: string | null;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  trialCallCap: number;
};

type BillingRow = {
  user_id: string;
  stripe_customer_id: string | null;
  subscription_id: string | null;
  plan: string | null;
  status: string | null;
  trial_end: string | null;
  current_period_end: string | null;
  trial_call_cap: number | null;
};

function mapBilling(row: BillingRow): Billing {
  return {
    userId: row.user_id,
    stripeCustomerId: row.stripe_customer_id,
    subscriptionId: row.subscription_id,
    plan: row.plan,
    status: row.status,
    trialEnd: row.trial_end,
    currentPeriodEnd: row.current_period_end,
    trialCallCap: row.trial_call_cap ?? TRIAL_CALL_CAP,
  };
}

// Reads the billing record for a customer. Returns null when there's no record
// yet (user hasn't started a trial) or Supabase isn't configured.
export async function getBillingForUser(userId: string): Promise<Billing | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("wisecall_billing")
    .select(
      "user_id, stripe_customer_id, subscription_id, plan, status, trial_end, current_period_end, trial_call_cap",
    )
    .eq("user_id", userId)
    .maybeSingle();

  if (error) {
    console.error("getBillingForUser failed:", error.message);
    return null;
  }
  return data ? mapBilling(data as BillingRow) : null;
}

// A customer can reach the dashboard / configure agents while trialing or active.
export function hasActiveAccess(billing: Billing | null): boolean {
  return billing?.status === "trialing" || billing?.status === "active";
}

export type TrialUsage = { used: number; cap: number; blocked: boolean };

// How many AI calls a trialing customer has used, against their cap. Counts every
// call log across the agents they own (same ownership scoping as getCallLogsForUser).
export async function getTrialUsage(
  userId: string,
  billing: Billing | null,
): Promise<TrialUsage | null> {
  if (billing?.status !== "trialing") return null;

  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const { data: owned } = await supabase
    .from("wisecall_profiles")
    .select("id")
    .eq("metadata->>owner_id", userId);

  const ids = (owned ?? []).map((row) => row.id as string);
  const cap = billing.trialCallCap;
  if (ids.length === 0) return { used: 0, cap, blocked: false };

  const { count } = await supabase
    .from("wisecall_call_logs")
    .select("id", { count: "exact", head: true })
    .in("profile_id", ids);

  const used = count ?? 0;
  return { used, cap, blocked: used >= cap };
}
