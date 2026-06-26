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
export const STARTER_PRICE = process.env.STRIPE_STARTER_PRICE || "price_1TmcN7F6ZlidDG7dL2VOwz61"; // £99/mo
export const PROFESSIONAL_PRICE = process.env.STRIPE_PROFESSIONAL_PRICE || "price_1TmcN8F6ZlidDG7dq22YymbJ"; // £199/mo
export const BUSINESS_PRICE = process.env.STRIPE_BUSINESS_PRICE || "price_1TmcN9F6ZlidDG7d5abmEf41"; // £399/mo

// Legacy plans — kept active for existing subscribers, not offered to new signups.
export const CORE_PRICE = process.env.STRIPE_CORE_PRICE || "price_1Tj5TaF6ZlidDG7dJc4YYOEu"; // £249/mo
export const GROWTH_PRICE = process.env.STRIPE_GROWTH_PRICE || "price_1Tj5TbF6ZlidDG7dVqVvOiV4"; // £399/mo
export const PRO_PRICE = process.env.STRIPE_PRO_PRICE || "price_1Tj5TdF6ZlidDG7d4Asvpqsa"; // £699/mo

// Email channel add-on — £79/mo, 100 AI replies included, £0.75 overage (tracked in-app).
// Live product prod_Uk0P7OfRlBAgo8, price price_1TkWOtF6ZlidDG7dU36EdYop (excl. VAT).
export const EMAIL_CHANNEL_PRICE =
  process.env.STRIPE_EMAIL_CHANNEL_PRICE || "price_1TkWOtF6ZlidDG7dU36EdYop";
export const EMAIL_CHANNEL_MONTHLY_GBP = 79;
export const EMAIL_INCLUDED_REPLIES = 100;
export const EMAIL_OVERAGE_GBP = 0.75;

export type PlanId = "starter" | "professional" | "business";
export type LegacyPlanId = "core" | "growth" | "pro";

// AI calls included per plan per month, and the per-call overage rate (GBP excl. VAT).
export const PLAN_CALLS_INCLUDED: Record<PlanId, number> = {
  starter: 100,
  professional: 300,
  business: 750,
};

export const PLAN_OVERAGE_RATE_GBP: Record<PlanId, number> = {
  starter: 0.65,
  professional: 0.55,
  business: 0.45,
};

export function planCallsIncluded(plan: string | null | undefined): number {
  return PLAN_CALLS_INCLUDED[plan as PlanId] ?? 0;
}

export function planOverageRateGbp(plan: string | null | undefined): number {
  return PLAN_OVERAGE_RATE_GBP[plan as PlanId] ?? 0.65;
}

const PLAN_PRICE: Record<PlanId, string> = {
  starter: STARTER_PRICE,
  professional: PROFESSIONAL_PRICE,
  business: BUSINESS_PRICE,
};

export function isPlanId(value: string): value is PlanId {
  return value === "starter" || value === "professional" || value === "business";
}

// Every plan starts with the same 7-day free trial (call cap enforced in-app).
export function planHasTrial(_plan: PlanId): boolean {
  return true;
}

export function planDisplayName(plan: string | null | undefined): string {
  switch (plan) {
    case "starter":
      return "Starter";
    case "professional":
      return "Professional";
    case "business":
      return "Business";
    // Legacy plan names — existing subscribers
    case "core":
      return "Core (legacy)";
    case "growth":
      return "Growth (legacy)";
    case "pro":
      return "Pro (legacy)";
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
