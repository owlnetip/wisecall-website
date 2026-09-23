import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PLAN_ANNUAL_GBP,
  PLAN_ANNUAL_MONTHLY_GBP,
  PLAN_ANNUAL_PENCE,
  PLAN_MONTHLY_GBP,
  dealFromStripeMetadata,
  isBillingInterval,
  lineItemsForPlan,
} from "./stripe";

test("annual prices are exactly 15% off the monthly rolling rates", () => {
  for (const plan of ["starter", "professional", "business"] as const) {
    const yearly = +(PLAN_MONTHLY_GBP[plan] * 12 * 0.85).toFixed(2);
    const monthlyEquivalent = +(yearly / 12).toFixed(2);
    assert.equal(PLAN_ANNUAL_GBP[plan], yearly);
    assert.equal(PLAN_ANNUAL_MONTHLY_GBP[plan], monthlyEquivalent);
    assert.equal(PLAN_ANNUAL_PENCE[plan], Math.round(yearly * 100));
  }
});

test("lineItemsForPlan uses the dedicated yearly Stripe price for annual checkout", () => {
  const items = lineItemsForPlan("starter", "year");
  assert.equal(items[0]?.price, process.env.STRIPE_STARTER_ANNUAL_PRICE || "price_1UAZxnF6ZlidDG7daiSu6CTd");
});

test("lineItemsForPlan stays on the monthly Stripe price for monthly checkout", () => {
  const items = lineItemsForPlan("starter", "month");
  assert.equal(items[0]?.price, process.env.STRIPE_STARTER_PRICE || "price_1TmcN7F6ZlidDG7dL2VOwz61");
});

test("isBillingInterval accepts month and year only", () => {
  assert.equal(isBillingInterval("month"), true);
  assert.equal(isBillingInterval("year"), true);
  assert.equal(isBillingInterval("week"), false);
});

test("dealFromStripeMetadata uses catalogue defaults when metadata is empty", () => {
  const deal = dealFromStripeMetadata({ plan: "business" });
  assert.equal(deal.callsAllowance, 750);
  assert.equal(deal.emailAllowance, 2000);
  assert.equal(deal.whatsappAllowance, 2000);
  assert.equal(deal.livechatAllowance, 2000);
  assert.equal(deal.smsAllowance, 2000);
  assert.equal(deal.includedAgents, 1);
  assert.equal(deal.overageWaived, false);
});

test("dealFromStripeMetadata honours Home Cloud custom allowances and two shared agents", () => {
  const deal = dealFromStripeMetadata({
    plan: "business",
    deal: "home_cloud",
    calls_allowance: "750",
    email_allowance: "2000",
    whatsapp_allowance: "2500",
    livechat_allowance: "1000",
    sms_allowance: "750",
    included_agents: "2",
    overage_waived: "true",
    overage_gbp: "0",
  });
  assert.equal(deal.plan, "business");
  assert.equal(deal.callsAllowance, 750);
  assert.equal(deal.whatsappAllowance, 2500);
  assert.equal(deal.livechatAllowance, 1000);
  assert.equal(deal.smsAllowance, 750);
  assert.equal(deal.includedAgents, 2);
  assert.equal(deal.overageWaived, true);
});

test("dealFromStripeMetadata treats overage_gbp 0 as waived", () => {
  const deal = dealFromStripeMetadata({ plan: "managed", calls_allowance: "30", overage_gbp: "0" });
  assert.equal(deal.callsAllowance, 30);
  assert.equal(deal.overageWaived, true);
});
