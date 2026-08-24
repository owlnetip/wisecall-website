import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canStartNoCardTrial,
  checkoutIncludesStripeTrial,
  isNoCardTrial,
  isNoCardTrialRequest,
  noCardTrialBillingRow,
  signupRedirectForTrial,
} from "./trial";

test("homepage / Facebook signup is the no-card 20-call path", () => {
  assert.equal(isNoCardTrialRequest("calls"), true);
  assert.equal(isNoCardTrialRequest(null), false);
  assert.equal(signupRedirectForTrial("calls"), "/dashboard");
  assert.equal(signupRedirectForTrial(undefined), "/billing");
});

test("a trialing row with no Stripe subscription is the no-card trial", () => {
  assert.equal(isNoCardTrial({ status: "trialing", subscriptionId: null }), true);
  assert.equal(isNoCardTrial({ status: "trialing", subscriptionId: "sub_123" }), false);
  assert.equal(isNoCardTrial({ status: "active", subscriptionId: null }), false);
  assert.equal(isNoCardTrial(null), false);
});

test("Stripe Checkout includes a 7-day trial only when they have not already used the no-card 20 calls", () => {
  assert.equal(checkoutIncludesStripeTrial(null), true);
  assert.equal(
    checkoutIncludesStripeTrial({ status: "trialing", subscriptionId: "sub_abc" }),
    true,
  );
  assert.equal(
    checkoutIncludesStripeTrial({ status: "trialing", subscriptionId: null }),
    false,
  );
  assert.equal(
    checkoutIncludesStripeTrial({ status: "active", subscriptionId: "sub_paid" }),
    true,
  );
});

test("no-card trial is granted to new users and is a no-op when they already have access", () => {
  assert.equal(canStartNoCardTrial(null), "grant");
  assert.equal(canStartNoCardTrial({ status: null }), "grant");
  assert.equal(canStartNoCardTrial({ status: "" }), "grant");
  assert.equal(canStartNoCardTrial({ status: "trialing" }), "already_has_access");
  assert.equal(canStartNoCardTrial({ status: "active" }), "already_has_access");
  assert.equal(canStartNoCardTrial({ status: "canceled" }), "must_subscribe");
  assert.equal(canStartNoCardTrial({ status: "past_due" }), "must_subscribe");
  assert.equal(canStartNoCardTrial({ status: "unpaid" }), "must_subscribe");
});

test("no-card billing row is trialing with a 20-call cap and no trial end date", () => {
  const row = noCardTrialBillingRow("user-1", new Date("2026-08-24T12:00:00.000Z"));
  assert.equal(row.user_id, "user-1");
  assert.equal(row.status, "trialing");
  assert.equal(row.trial_call_cap, 20);
  assert.equal(row.trial_end, null);
  assert.equal(row.email_channel_enabled, true);
  assert.equal(row.updated_at, "2026-08-24T12:00:00.000Z");
});
