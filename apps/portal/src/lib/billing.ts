import { getServiceSupabase } from "@/lib/supabase";
import {
  TRIAL_CALL_CAP,
  EMAIL_INCLUDED_REPLIES,
  EMAIL_OVERAGE_GBP,
  EMAIL_CHANNEL_MONTHLY_GBP,
  getStripe,
  isEmailChannelSubscription,
  planCallsIncluded,
  planOverageRateGbp,
} from "@/lib/stripe";

export type Billing = {
  userId: string;
  stripeCustomerId: string | null;
  subscriptionId: string | null;
  plan: string | null;
  status: string | null;
  trialEnd: string | null;
  currentPeriodEnd: string | null;
  trialCallCap: number;
  emailChannelEnabled: boolean;
  emailChannelStatus: string | null;
  emailMonthlyAllowance: number;
  emailUsedPeriod: number;
  emailOveragePeriod: number;
  emailPeriodEnd: string | null;
  callsMonthlyAllowance: number;
  callsUsedPeriod: number;
  callsOveragePeriod: number;
  callsPeriodEnd: string | null;
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
  email_channel_enabled: boolean | null;
  email_channel_status: string | null;
  email_monthly_allowance: number | null;
  email_used_period: number | null;
  email_overage_period: number | null;
  email_period_end: string | null;
  calls_monthly_allowance: number | null;
  calls_used_period: number | null;
  calls_overage_period: number | null;
  calls_period_end: string | null;
};

const BILLING_SELECT =
  "user_id, stripe_customer_id, subscription_id, plan, status, trial_end, current_period_end, trial_call_cap, email_channel_enabled, email_channel_status, email_monthly_allowance, email_used_period, email_overage_period, email_period_end, calls_monthly_allowance, calls_used_period, calls_overage_period, calls_period_end";

function mapBilling(row: BillingRow): Billing {
  const plan = row.plan ?? null;
  return {
    userId: row.user_id,
    stripeCustomerId: row.stripe_customer_id,
    subscriptionId: row.subscription_id,
    plan,
    status: row.status,
    trialEnd: row.trial_end,
    currentPeriodEnd: row.current_period_end,
    trialCallCap: row.trial_call_cap ?? TRIAL_CALL_CAP,
    emailChannelEnabled: row.email_channel_enabled === true,
    emailChannelStatus: row.email_channel_status,
    emailMonthlyAllowance: row.email_monthly_allowance ?? EMAIL_INCLUDED_REPLIES,
    emailUsedPeriod: row.email_used_period ?? 0,
    emailOveragePeriod: row.email_overage_period ?? 0,
    emailPeriodEnd: row.email_period_end,
    callsMonthlyAllowance: row.calls_monthly_allowance ?? planCallsIncluded(plan),
    callsUsedPeriod: row.calls_used_period ?? 0,
    callsOveragePeriod: row.calls_overage_period ?? 0,
    callsPeriodEnd: row.calls_period_end,
  };
}

// Reads the billing record for a customer. Returns null when there's no record
// yet (user hasn't started a trial) or Supabase isn't configured.
export async function getBillingForUser(userId: string): Promise<Billing | null> {
  const supabase = getServiceSupabase();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("wisecall_billing")
    .select(BILLING_SELECT)
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

// Fallback for when the Stripe webhook hasn't synced the subscription yet (or
// failed to deliver). startCheckout pre-creates a billing row with the customer
// id + plan but no status; the webhook is supposed to fill in status/
// subscription_id afterwards. If it doesn't, the customer is stuck on /billing
// forever even though they have a live subscription. This reads the truth from
// Stripe and writes it back, so signup works regardless of webhook timing/health.
// Returns the (possibly refreshed) billing record.
export async function reconcileBillingFromStripe(
  userId: string,
  billing: Billing | null,
): Promise<Billing | null> {
  if (hasActiveAccess(billing)) return billing; // already good — no work needed
  const customerId = billing?.stripeCustomerId;
  if (!customerId) return billing; // never started checkout — nothing to reconcile

  const stripe = getStripe();
  const service = getServiceSupabase();
  if (!stripe || !service) return billing;

  try {
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 10,
    });
    // Newest plan subscription (not the email-channel add-on) that grants access.
    const planSub = subs.data
      .filter((s) => !isEmailChannelSubscription(s.metadata))
      .filter((s) => s.status === "trialing" || s.status === "active")
      .sort((a, b) => b.created - a.created)[0];
    if (!planSub) return billing;

    const item = planSub.items?.data?.[0] as { current_period_end?: number } | undefined;
    const top = (planSub as unknown as { current_period_end?: number }).current_period_end;
    const periodEndSecs = item?.current_period_end ?? top;

    await service.from("wisecall_billing").upsert(
      {
        user_id: userId,
        stripe_customer_id: customerId,
        subscription_id: planSub.id,
        plan: planSub.metadata?.plan ?? billing?.plan ?? "core",
        status: planSub.status,
        trial_end:
          typeof planSub.trial_end === "number"
            ? new Date(planSub.trial_end * 1000).toISOString()
            : null,
        current_period_end:
          typeof periodEndSecs === "number"
            ? new Date(periodEndSecs * 1000).toISOString()
            : null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
    return await getBillingForUser(userId);
  } catch (err) {
    console.error("reconcileBillingFromStripe failed:", (err as Error).message);
    return billing;
  }
}

export function hasEmailChannelAccess(billing: Billing | null): boolean {
  return (
    billing?.emailChannelEnabled === true &&
    billing.emailChannelStatus === "active"
  );
}

export type EmailChannelUsage = {
  enabled: boolean;
  used: number;
  allowance: number;
  overage: number;
  monthlyPriceGbp: number;
  overagePriceGbp: number;
  canPurchase: boolean;
};

export function getEmailChannelUsage(
  billing: Billing | null,
  hasPlan: boolean,
): EmailChannelUsage {
  const allowance = billing?.emailMonthlyAllowance ?? EMAIL_INCLUDED_REPLIES;
  return {
    enabled: hasEmailChannelAccess(billing),
    used: billing?.emailUsedPeriod ?? 0,
    allowance,
    overage: billing?.emailOveragePeriod ?? 0,
    monthlyPriceGbp: EMAIL_CHANNEL_MONTHLY_GBP,
    overagePriceGbp: EMAIL_OVERAGE_GBP,
    canPurchase: hasPlan && !hasEmailChannelAccess(billing),
  };
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

export type CallUsage = {
  used: number;
  allowance: number;
  overage: number;
  overagePriceGbp: number;
};

export function getCallUsage(billing: Billing | null): CallUsage {
  const plan = billing?.plan ?? null;
  return {
    used: billing?.callsUsedPeriod ?? 0,
    allowance: billing?.callsMonthlyAllowance ?? planCallsIncluded(plan),
    overage: billing?.callsOveragePeriod ?? 0,
    overagePriceGbp: planOverageRateGbp(plan),
  };
}

// Mirror email_channel_enabled onto every agent profile for the owner (runtime reads metadata).
export async function syncEmailChannelProfiles(ownerId: string, enabled: boolean): Promise<void> {
  const supabase = getServiceSupabase();
  if (!supabase) return;

  const { data: profiles } = await supabase
    .from("wisecall_profiles")
    .select("id, metadata")
    .eq("metadata->>owner_id", ownerId);

  for (const row of profiles ?? []) {
    const metadata = (row.metadata as Record<string, unknown> | null) ?? {};
    await supabase
      .from("wisecall_profiles")
      .update({
        metadata: { ...metadata, email_channel_enabled: enabled },
      })
      .eq("id", row.id as string);
  }
}
