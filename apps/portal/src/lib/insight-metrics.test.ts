import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateConversionRate } from "./insight-metrics";

test("counts a call with both lead and booking signals once", () => {
  assert.equal(
    calculateConversionRate([
      { lead: true, booking: true },
      { lead: false, booking: false },
    ]),
    50,
  );
});

test("keeps conversion between zero and one hundred percent", () => {
  assert.equal(calculateConversionRate([]), 0);
  assert.equal(calculateConversionRate([{ lead: false, booking: false }]), 0);
  assert.equal(calculateConversionRate([{ lead: true, booking: true }]), 100);
});
