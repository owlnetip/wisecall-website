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
// Pay As You Go: £10/mo base + £0.65/call metered, 20% UK VAT (exclusive).
// Override via env for test-mode duplicates during local development.
export const VAT_RATE = process.env.STRIPE_VAT_RATE || "txr_1Tj5YzF6ZlidDG7dypciEivC";

export const PAYG_BASE_PRICE =
  process.env.STRIPE_PAYG_BASE_PRICE || "price_1Tj5TeF6ZlidDG7d7Xl9hOa2"; // £10/mo
export const PAYG_PER_CALL_PRICE =
  process.env.STRIPE_PAYG_PER_CALL_PRICE || "price_1Tj5X1F6ZlidDG7d9Hkjocas"; // £0.65/call (metered)

export const TRIAL_DAYS = 7;
export const TRIAL_CALL_CAP = 20;

// Checkout line items for the PAYG free-trial plan. Metered prices must NOT carry
// a quantity; both lines get the manual 20% VAT rate applied.
export function paygLineItems(): Stripe.Checkout.SessionCreateParams.LineItem[] {
  return [
    { price: PAYG_BASE_PRICE, quantity: 1, tax_rates: [VAT_RATE] },
    { price: PAYG_PER_CALL_PRICE, tax_rates: [VAT_RATE] },
  ];
}
