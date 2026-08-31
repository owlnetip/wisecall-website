// Create (or reuse) yearly Stripe prices at 15% off the live monthly plans.
//
// Usage (from apps/portal):
//   npx tsx scripts/ensure-annual-stripe-prices.ts          # dry-run
//   npx tsx scripts/ensure-annual-stripe-prices.ts --apply  # create if missing
//
// Requires STRIPE_SECRET_KEY (live or test). Reuses an existing yearly price
// on the same product when the amount already matches, so it is safe to re-run.

import Stripe from "stripe";
import {
  BUSINESS_PRICE,
  PLAN_ANNUAL_GBP,
  PLAN_ANNUAL_PENCE,
  PROFESSIONAL_PRICE,
  STARTER_PRICE,
  type PlanId,
} from "../src/lib/stripe.ts";

const apply = process.argv.includes("--apply");

const DASHBOARD_STEPS = `
No STRIPE_SECRET_KEY in this environment.

Create the yearly prices in Stripe Dashboard (live mode, same products as the monthly plans):

  Starter       monthly price_1TmcN7F6ZlidDG7dL2VOwz61  →  £1,009.80 / year  (100980 pence)
  Professional  monthly price_1TmcN8F6ZlidDG7dq22YymbJ  →  £2,029.80 / year  (202980 pence)
  Business      monthly price_1TmcN9F6ZlidDG7d5abmEf41  →  £4,069.80 / year  (406980 pence)

Each price: Recurring → Yearly → GBP → amount above. Nickname e.g. "Starter annual (15% off)".

Then set these on the portal (app.wisecall.io Vercel env, Production + Preview)
and as defaults in src/lib/stripe.ts:

  STRIPE_STARTER_ANNUAL_PRICE=price_...
  STRIPE_PROFESSIONAL_ANNUAL_PRICE=price_...
  STRIPE_BUSINESS_ANNUAL_PRICE=price_...

Or paste STRIPE_SECRET_KEY into this environment and re-run:
  npx tsx scripts/ensure-annual-stripe-prices.ts --apply
`.trim();

const key = process.env.STRIPE_SECRET_KEY;
if (!key) {
  console.error(DASHBOARD_STEPS);
  process.exit(1);
}

const stripe = new Stripe(key);

const PLANS: { id: PlanId; monthlyPriceId: string; nickname: string }[] = [
  { id: "starter", monthlyPriceId: STARTER_PRICE, nickname: "Starter annual (15% off)" },
  { id: "professional", monthlyPriceId: PROFESSIONAL_PRICE, nickname: "Professional annual (15% off)" },
  { id: "business", monthlyPriceId: BUSINESS_PRICE, nickname: "Business annual (15% off)" },
];

function productId(price: Stripe.Price): string {
  return typeof price.product === "string" ? price.product : price.product.id;
}

async function findExistingYearly(product: string, unitAmount: number): Promise<Stripe.Price | null> {
  const listed = await stripe.prices.list({
    product,
    active: true,
    type: "recurring",
    limit: 100,
  });
  return (
    listed.data.find(
      (price) =>
        price.recurring?.interval === "year" &&
        price.currency === "gbp" &&
        price.unit_amount === unitAmount,
    ) ?? null
  );
}

async function main() {
  const results: Record<string, string> = {};

  for (const plan of PLANS) {
    const monthly = await stripe.prices.retrieve(plan.monthlyPriceId, { expand: ["product"] });
    const product = productId(monthly);
    const unitAmount = PLAN_ANNUAL_PENCE[plan.id];
    const existing = await findExistingYearly(product, unitAmount);

    if (existing) {
      console.log(
        `${plan.id}: already has yearly ${existing.id} (£${PLAN_ANNUAL_GBP[plan.id]}/year) on ${product}`,
      );
      results[`STRIPE_${plan.id.toUpperCase()}_ANNUAL_PRICE`] = existing.id;
      continue;
    }

    console.log(
      `${plan.id}: no yearly price yet. Would create £${PLAN_ANNUAL_GBP[plan.id]}/year on ${product}` +
        (monthly.unit_amount != null ? ` (monthly is £${(monthly.unit_amount / 100).toFixed(2)})` : ""),
    );

    if (!apply) continue;

    const created = await stripe.prices.create({
      product,
      currency: "gbp",
      unit_amount: unitAmount,
      recurring: { interval: "year" },
      nickname: plan.nickname,
      metadata: { plan: plan.id, interval: "year", discount: "15" },
    });
    console.log(`${plan.id}: created ${created.id}`);
    results[`STRIPE_${plan.id.toUpperCase()}_ANNUAL_PRICE`] = created.id;
  }

  if (!apply) {
    console.log("\nDry-run only. Re-run with --apply to create missing prices.");
    return;
  }

  console.log("\nSet these on the portal (Vercel env + stripe.ts defaults):");
  for (const [name, id] of Object.entries(results)) {
    console.log(`${name}=${id}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
