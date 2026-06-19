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
// Pay As You Go: £10/mo base + £0.85/call metered, 20% UK VAT (exclusive).
// Override via env for test-mode duplicates during local development.
export const VAT_RATE = process.env.STRIPE_VAT_RATE || "txr_1Tj5YzF6ZlidDG7dypciEivC";

export const PAYG_BASE_PRICE =
  process.env.STRIPE_PAYG_BASE_PRICE || "price_1Tj5TeF6ZlidDG7d7Xl9hOa2"; // £10/mo
export const PAYG_PER_CALL_PRICE =
  process.env.STRIPE_PAYG_PER_CALL_PRICE || "price_1Tk3vkF6ZlidDG7d4FA1utES"; // £0.85/call (metered, "WiseCall AI Call Usage" product). Was 65p price_1Tjhy9F6ZlidDG7dgukgaTRc.

export const TRIAL_DAYS = 7;
export const TRIAL_CALL_CAP = 20;

// Monthly subscription plans (£/mo). Override via env for test-mode duplicates.
export const CORE_PRICE = process.env.STRIPE_CORE_PRICE || "price_1Tj5TaF6ZlidDG7dJc4YYOEu"; // £249/mo
export const GROWTH_PRICE = process.env.STRIPE_GROWTH_PRICE || "price_1Tj5TbF6ZlidDG7dVqVvOiV4"; // £399/mo
export const PRO_PRICE = process.env.STRIPE_PRO_PRICE || "price_1Tj5TdF6ZlidDG7d4Asvpqsa"; // £699/mo

export type PlanId = "payg" | "core" | "growth" | "pro";

const PLAN_PRICE: Record<Exclude<PlanId, "payg">, string> = {
  core: CORE_PRICE,
  growth: GROWTH_PRICE,
  pro: PRO_PRICE,
};

export function isPlanId(value: string): value is PlanId {
  return value === "payg" || value === "core" || value === "growth" || value === "pro";
}

// Only PAYG starts with the 7-day free trial; Core/Growth/Pro charge immediately.
export function planHasTrial(plan: PlanId): boolean {
  return plan === "payg";
}

// Checkout line items for a plan. PAYG = £10/mo base + metered per-call (metered
// prices must NOT carry a quantity); the monthly plans = a single licensed price.
// All lines carry the manual 20% VAT rate.
export function lineItemsForPlan(plan: PlanId): Stripe.Checkout.SessionCreateParams.LineItem[] {
  if (plan === "payg") {
    return [
      { price: PAYG_BASE_PRICE, quantity: 1, tax_rates: [VAT_RATE] },
      { price: PAYG_PER_CALL_PRICE, tax_rates: [VAT_RATE] },
    ];
  }
  return [{ price: PLAN_PRICE[plan], quantity: 1, tax_rates: [VAT_RATE] }];
}
