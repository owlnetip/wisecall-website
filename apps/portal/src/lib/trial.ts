import { dashboardSetupPath } from "./setup-website";
import { TRIAL_CALL_CAP } from "./stripe";

// Self-serve path used by homepage "Try it now" / Facebook ads: 20 inbound AI
// calls with no card. Distinct from the sales-led 7-day Stripe pilot on /billing.
export const NO_CARD_TRIAL = "calls";

export type BillingTrialFields = {
  status: string | null;
  subscriptionId: string | null;
};

export function isNoCardTrialRequest(trial: string | null | undefined): boolean {
  return trial === NO_CARD_TRIAL;
}

export function signupRedirectForTrial(
  trial: string | null | undefined,
  website?: unknown,
): string {
  return isNoCardTrialRequest(trial) ? dashboardSetupPath(website) : "/billing";
}

// In-app 20-call trial that never created a Stripe subscription. Stripe Checkout
// on /billing is what turns this into a paid plan (card collected then).
export function isNoCardTrial(billing: BillingTrialFields | null | undefined): boolean {
  return billing?.status === "trialing" && !billing.subscriptionId;
}

// Sales-led first checkout still gets the 7-day Stripe trial (card required).
// Someone already on the no-card 20-call trial has used that free usage — Stripe
// should start a paid subscription, not another trial.
export function checkoutIncludesStripeTrial(
  billing: BillingTrialFields | null | undefined,
): boolean {
  return !isNoCardTrial(billing);
}

export function canStartNoCardTrial(
  billing: { status: string | null } | null | undefined,
): "grant" | "already_has_access" | "must_subscribe" {
  if (!billing || billing.status == null || billing.status === "") return "grant";
  if (billing.status === "trialing" || billing.status === "active") {
    return "already_has_access";
  }
  return "must_subscribe";
}

export function noCardTrialBillingRow(userId: string, now = new Date()): Record<string, unknown> {
  return {
    user_id: userId,
    status: "trialing",
    trial_call_cap: TRIAL_CALL_CAP,
    trial_end: null,
    email_channel_enabled: true,
    email_channel_status: "trialing",
    updated_at: now.toISOString(),
  };
}
