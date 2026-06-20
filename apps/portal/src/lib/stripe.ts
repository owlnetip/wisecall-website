import Stripe from "stripe";

// Server-only Stripe client. The secret key never reaches the browser.
// Returns null when unconfigured so callers can degrade gracefully (mirrors the
// getServiceSupabase() / getSupabaseConfig() pattern in this codebase).
let client: Stripe | null = null;

export function getStripe(): Stripe | null {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) return null;
  if (!client) {
    client = new Stripe(key);
  }
  return client;
}

export function getStripeWebhookSecret(): string | null {
  return process.env.STRIPE_WEBHOOK_SECRET || null;
}

// ── WiseCall live billing config (account acct_1TiwraF6ZlidDG7d, GBP) ──────────
// All plans: 7-day free trial (20 AI-call cap in-app), then monthly subscription.
// Override via env for test-mode duplicates during local development.
export const VAT_RATE = process.env.STRIPE_VAT_RATE || "txr_1Tj5YzF6ZlidDG7dypciEivC";

export const TRIAL_DAYS = 7;
export const TRIAL_CALL_CAP = 20;

// Monthly subscription plans (£/mo). Override via env for test-mode duplicates.
export const CORE_PRICE = process.env.STRIPE_CORE_PRICE || "price_1Tj5TaF6ZlidDG7dJc4YYOEu"; // £249/mo
export const GROWTH_PRICE = process.env.STRIPE_GROWTH_PRICE || "price_1Tj5TbF6ZlidDG7dVqVvOiV4"; // £399/mo
export const PRO_PRICE = process.env.STRIPE_PRO_PRICE || "price_1Tj5TdF6ZlidDG7d4Asvpqsa"; // £699/mo

// Email channel add-on — £79/mo, 100 AI replies included, £0.75 overage (tracked in-app).
export const EMAIL_CHANNEL_PRICE =
  process.env.STRIPE_EMAIL_CHANNEL_PRICE || "price_REPLACE_WITH_LIVE_EMAIL_CHANNEL";
export const EMAIL_CHANNEL_MONTHLY_GBP = 79;
export const EMAIL_INCLUDED_REPLIES = 100;
export const EMAIL_OVERAGE_GBP = 0.75;

export type PlanId = "core" | "growth" | "pro";

const PLAN_PRICE: Record<PlanId, string> = {
  core: CORE_PRICE,
  growth: GROWTH_PRICE,
  pro: PRO_PRICE,
};

export function isPlanId(value: string): value is PlanId {
  return value === "core" || value === "growth" || value === "pro";
}

// Every plan starts with the same 7-day free trial (call cap enforced in-app).
export function planHasTrial(_plan: PlanId): boolean {
  return true;
}

export function planDisplayName(plan: string | null | undefined): string {
  switch (plan) {
    case "core":
      return "Core";
    case "growth":
      return "Growth";
    case "pro":
      return "Pro";
    case "payg":
      return "Pay As You Go (legacy)";
    default:
      return plan ?? "a plan";
  }
}

// Checkout line items for a plan — a single licensed price with manual 20% VAT.
export function lineItemsForPlan(plan: PlanId): Stripe.Checkout.SessionCreateParams.LineItem[] {
  return [{ price: PLAN_PRICE[plan], quantity: 1, tax_rates: [VAT_RATE] }];
}

export function lineItemsForEmailChannel(): Stripe.Checkout.SessionCreateParams.LineItem[] {
  return [{ price: EMAIL_CHANNEL_PRICE, quantity: 1, tax_rates: [VAT_RATE] }];
}

export function isEmailChannelSubscription(metadata: Stripe.Metadata | null | undefined): boolean {
  return metadata?.addon === "email_channel";
}
