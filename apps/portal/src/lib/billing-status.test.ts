import assert from "node:assert/strict";
import { test } from "node:test";
import { effectiveSubscriptionStatus, isBespokePlan } from "./billing-status";

test("an overdue invoice customer keeps access", () => {
  assert.equal(
    effectiveSubscriptionStatus({ status: "past_due", collection_method: "send_invoice" }),
    "active",
  );
});

test("a failed card payment stays past_due", () => {
  assert.equal(
    effectiveSubscriptionStatus({ status: "past_due", collection_method: "charge_automatically" }),
    "past_due",
  );
});

test("other statuses pass through for invoice customers", () => {
  for (const status of ["active", "trialing", "canceled", "unpaid"]) {
    assert.equal(effectiveSubscriptionStatus({ status, collection_method: "send_invoice" }), status);
  }
});

test("only contracted plans are bespoke", () => {
  assert.equal(isBespokePlan("custom"), true);
  assert.equal(isBespokePlan("managed"), true);
  for (const plan of ["starter", "professional", "business", "core", null, undefined]) {
    assert.equal(isBespokePlan(plan), false);
  }
});
