import Stripe from "stripe";
import {
  PLAN_ANNUAL_PENCE,
  isPlanId,
  planCallsIncluded,
  planEmailIncluded,
  planLivechatIncluded,
  planSmsIncluded,
  planWhatsappIncluded,
  type BillingInterval,
  type PlanId,
} from "@/lib/stripe-plans";

export {
  PLAN_ANNUAL_GBP,
  PLAN_ANNUAL_MONTHLY_GBP,
  PLAN_ANNUAL_PENCE,
  PLAN_CALLS_INCLUDED,
  PLAN_EMAIL_INCLUDED,
  PLAN_LIVECHAT_INCLUDED,
  PLAN_MONTHLY_GBP,
  PLAN_OVERAGE_RATE_GBP,
  PLAN_SMS_INCLUDED,
  PLAN_WHATSAPP_INCLUDED,
  TRIAL_CALL_CAP,
  TRIAL_DAYS,
  isBillingInterval,
  isPlanId,
  planCallsIncluded,
  planDisplayName,
  planEmailIncluded,
  planLivechatIncluded,
  planOverageRateGbp,
  planSmsIncluded,
  planWhatsappIncluded,
} from "@/lib/stripe-plans";
export type { BillingInterval, LegacyPlanId, PlanId } from "@/lib/stripe-plans";

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

// Monthly subscription plans (£/mo). Override via env for test-mode duplicates.
export const STARTER_PRICE = process.env.STRIPE_STARTER_PRICE || "price_1TmcN7F6ZlidDG7dL2VOwz61"; // £99/mo
export const PROFESSIONAL_PRICE = process.env.STRIPE_PROFESSIONAL_PRICE || "price_1TmcN8F6ZlidDG7dq22YymbJ"; // £199/mo
export const BUSINESS_PRICE = process.env.STRIPE_BUSINESS_PRICE || "price_1TmcN9F6ZlidDG7d5abmEf41"; // £399/mo

// Legacy plans, kept active for existing subscribers, not offered to new signups.
export const CORE_PRICE = process.env.STRIPE_CORE_PRICE || "price_1Tj5TaF6ZlidDG7dJc4YYOEu"; // £249/mo
export const GROWTH_PRICE = process.env.STRIPE_GROWTH_PRICE || "price_1Tj5TbF6ZlidDG7dVqVvOiV4"; // £399/mo
export const PRO_PRICE = process.env.STRIPE_PRO_PRICE || "price_1Tj5TdF6ZlidDG7d4Asvpqsa"; // £699/mo

// Legacy email constants kept so older checkout/billing references compile.
// AI email is bundled into every plan through PLAN_EMAIL_INCLUDED.
export const EMAIL_CHANNEL_PRICE =
  process.env.STRIPE_EMAIL_CHANNEL_PRICE || "price_1TkWOtF6ZlidDG7dU36EdYop";
export const EMAIL_CHANNEL_MONTHLY_GBP = 0; // bundled, no separate charge
export const EMAIL_INCLUDED_REPLIES = 100;
export const EMAIL_OVERAGE_GBP = 0.75;

// Yearly prices (15% off) on the same live products as the monthly plans
// (acct_1TiwraF6ZlidDG7d). Created 2026-08-31. Checkout falls back to price_data
// if an override env is empty.
export const STARTER_ANNUAL_PRICE =
  process.env.STRIPE_STARTER_ANNUAL_PRICE || "price_1UAZxnF6ZlidDG7daiSu6CTd"; // £1,009.80/year
export const PROFESSIONAL_ANNUAL_PRICE =
  process.env.STRIPE_PROFESSIONAL_ANNUAL_PRICE || "price_1UAZxoF6ZlidDG7dTyfIgws5"; // £2,029.80/year
export const BUSINESS_ANNUAL_PRICE =
  process.env.STRIPE_BUSINESS_ANNUAL_PRICE || "price_1UAZxpF6ZlidDG7d9nVCXXs5"; // £4,069.80/year

export type SubscriptionDeal = {
  plan: string;
  callsAllowance: number;
  emailAllowance: number;
  whatsappAllowance: number;
  livechatAllowance: number;
  smsAllowance: number;
  includedAgents: number;
  overageWaived: boolean;
};

function metadataInt(
  metadata: Stripe.Metadata | null | undefined,
  key: string,
): number | null {
  const raw = metadata?.[key];
  if (raw == null || raw === "") return null;
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function metadataFlag(metadata: Stripe.Metadata | null | undefined, key: string): boolean {
  const raw = (metadata?.[key] ?? "").trim().toLowerCase();
  return raw === "true" || raw === "1" || raw === "yes";
}

// Sales-led / custom Stripe subscriptions (e.g. Home Cloud) store allowances on
// the subscription metadata so they are not overwritten by catalogue defaults.
export function dealFromStripeMetadata(
  metadata: Stripe.Metadata | null | undefined,
): SubscriptionDeal {
  const plan = metadata?.plan || "professional";
  const overageGbp = metadata?.overage_gbp;
  const overageWaived =
    metadataFlag(metadata, "overage_waived") || overageGbp === "0";
  return {
    plan,
    callsAllowance: metadataInt(metadata, "calls_allowance") ?? planCallsIncluded(plan),
    emailAllowance: metadataInt(metadata, "email_allowance") ?? planEmailIncluded(plan),
    whatsappAllowance:
      metadataInt(metadata, "whatsapp_allowance") ?? planWhatsappIncluded(plan),
    livechatAllowance:
      metadataInt(metadata, "livechat_allowance") ?? planLivechatIncluded(plan),
    smsAllowance: metadataInt(metadata, "sms_allowance") ?? planSmsIncluded(plan),
    includedAgents: metadataInt(metadata, "included_agents") ?? 1,
    overageWaived,
  };
}

const PLAN_PRICE: Record<PlanId, string> = {
  starter: STARTER_PRICE,
  professional: PROFESSIONAL_PRICE,
  business: BUSINESS_PRICE,
};

const PLAN_ANNUAL_PRICE: Record<PlanId, string> = {
  starter: STARTER_ANNUAL_PRICE,
  professional: PROFESSIONAL_ANNUAL_PRICE,
  business: BUSINESS_ANNUAL_PRICE,
};

// Every plan starts with the same 7-day free trial (call cap enforced in-app).
export function planHasTrial(plan: PlanId): boolean {
  void plan;
  return true;
}

// Checkout line items for a plan, a single licensed price with manual 20% VAT.
export function lineItemsForPlan(
  plan: PlanId,
  interval: BillingInterval = "month",
): Stripe.Checkout.SessionCreateParams.LineItem[] {
  if (interval === "year" && PLAN_ANNUAL_PRICE[plan]) {
    return [{ price: PLAN_ANNUAL_PRICE[plan], quantity: 1, tax_rates: [VAT_RATE] }];
  }
  return [{ price: PLAN_PRICE[plan], quantity: 1, tax_rates: [VAT_RATE] }];
}

// Annual checkout uses the dedicated yearly Stripe price when configured,
// otherwise builds a yearly price from the existing monthly product (15% off).
export async function lineItemsForPlanWithInterval(
  stripe: Stripe,
  plan: PlanId,
  interval: BillingInterval = "month",
): Promise<Stripe.Checkout.SessionCreateParams.LineItem[]> {
  if (interval !== "year") return lineItemsForPlan(plan, interval);
  if (PLAN_ANNUAL_PRICE[plan]) return lineItemsForPlan(plan, interval);

  const monthly = await stripe.prices.retrieve(PLAN_PRICE[plan]);
  const product = typeof monthly.product === "string" ? monthly.product : monthly.product.id;
  return [
    {
      price_data: {
        currency: "gbp",
        product,
        unit_amount: PLAN_ANNUAL_PENCE[plan],
        recurring: { interval: "year" },
      },
      quantity: 1,
      tax_rates: [VAT_RATE],
    },
  ];
}

export function lineItemsForEmailChannel(): Stripe.Checkout.SessionCreateParams.LineItem[] {
  return [{ price: EMAIL_CHANNEL_PRICE, quantity: 1, tax_rates: [VAT_RATE] }];
}

export function isEmailChannelSubscription(metadata: Stripe.Metadata | null | undefined): boolean {
  return metadata?.addon === "email_channel";
}
