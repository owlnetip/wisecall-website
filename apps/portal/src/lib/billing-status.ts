// Rules for what a Stripe subscription status means for portal and agent access.

type SubscriptionLike = {
  status: string;
  collection_method?: string | null;
};

// An invoice customer goes past_due as soon as an invoice passes its due date.
// That is a late payment to chase, not a failed card, so it must not lock them
// out of the portal or stop their agent. Card customers keep the real status.
export function effectiveSubscriptionStatus(sub: SubscriptionLike): string {
  if (sub.status === "past_due" && sub.collection_method === "send_invoice") {
    return "active";
  }
  return sub.status;
}

// Contracted accounts on a bespoke agreement. They have no self-serve plan to
// pick, and starting a checkout would cancel their contracted subscription.
export function isBespokePlan(plan: string | null | undefined): boolean {
  return plan === "custom" || plan === "managed";
}
