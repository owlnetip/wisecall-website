// Catalogue plan copy and prices. Safe to import from client components.
// Keep Stripe SDK imports in stripe.ts so /billing does not bundle the server SDK.

export type PlanId = "starter" | "professional" | "business";
export type LegacyPlanId = "core" | "growth" | "pro";
export type BillingInterval = "month" | "year";

export const TRIAL_DAYS = 7;
export const TRIAL_CALL_CAP = 20;

export const PLAN_MONTHLY_GBP: Record<PlanId, number> = {
  starter: 99,
  professional: 199,
  business: 399,
};

export const PLAN_ANNUAL_MONTHLY_GBP: Record<PlanId, number> = {
  starter: 84.15,
  professional: 169.15,
  business: 339.15,
};

export const PLAN_ANNUAL_GBP: Record<PlanId, number> = {
  starter: 1009.8,
  professional: 2029.8,
  business: 4069.8,
};

export const PLAN_ANNUAL_PENCE: Record<PlanId, number> = {
  starter: 100980,
  professional: 202980,
  business: 406980,
};

export const PLAN_CALLS_INCLUDED: Record<PlanId, number> = {
  starter: 100,
  professional: 300,
  business: 750,
};

export const PLAN_EMAIL_INCLUDED: Record<PlanId, number> = {
  starter: 100,
  professional: 500,
  business: 2000,
};

export const PLAN_WHATSAPP_INCLUDED: Record<PlanId, number> = {
  starter: 250,
  professional: 500,
  business: 2000,
};

export const PLAN_LIVECHAT_INCLUDED: Record<PlanId, number> = {
  starter: 100,
  professional: 500,
  business: 2000,
};

export const PLAN_SMS_INCLUDED: Record<PlanId, number> = {
  starter: 100,
  professional: 500,
  business: 2000,
};

export const PLAN_OVERAGE_RATE_GBP: Record<PlanId, number> = {
  starter: 0.65,
  professional: 0.55,
  business: 0.45,
};

export function isPlanId(value: string): value is PlanId {
  return value === "starter" || value === "professional" || value === "business";
}

export function isBillingInterval(value: string): value is BillingInterval {
  return value === "month" || value === "year";
}

export function planCallsIncluded(plan: string | null | undefined): number {
  return PLAN_CALLS_INCLUDED[plan as PlanId] ?? 0;
}

export function planEmailIncluded(plan: string | null | undefined): number {
  return PLAN_EMAIL_INCLUDED[plan as PlanId] ?? 0;
}

export function planWhatsappIncluded(plan: string | null | undefined): number {
  return PLAN_WHATSAPP_INCLUDED[plan as PlanId] ?? 0;
}

export function planLivechatIncluded(plan: string | null | undefined): number {
  return PLAN_LIVECHAT_INCLUDED[plan as PlanId] ?? 0;
}

export function planSmsIncluded(plan: string | null | undefined): number {
  return PLAN_SMS_INCLUDED[plan as PlanId] ?? 0;
}

export function planOverageRateGbp(plan: string | null | undefined): number {
  return PLAN_OVERAGE_RATE_GBP[plan as PlanId] ?? 0.65;
}

export function planDisplayName(plan: string | null | undefined): string {
  switch (plan) {
    case "starter":
      return "Starter";
    case "professional":
      return "Professional";
    case "business":
      return "Business";
    case "core":
      return "Core (legacy)";
    case "growth":
      return "Growth (legacy)";
    case "pro":
      return "Pro (legacy)";
    case "payg":
      return "Pay As You Go (legacy)";
    case "managed":
      return "Managed";
    default:
      return plan ?? "a plan";
  }
}
