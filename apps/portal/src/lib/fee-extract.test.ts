import assert from "node:assert/strict";
import { test } from "node:test";
import { extractPublishedFeeLines, mergePricingField } from "./fee-extract";

test("extracts dental fee lines including CBCT and hygienist polish", () => {
  const text =
    "Radiographs Panoral (in treatment) £40 Radiographs Panoral (on referral) £55 CBCT £110 Hygiene services Routine hygienist appointment (scale and polish) £70";
  const lines = extractPublishedFeeLines(text);
  assert.ok(lines.some((line) => /^CBCT: £110$/i.test(line)));
  assert.ok(lines.some((line) => /hygienist.*polish.*£70/i.test(line)));
});

test("mergePricingField prefers scraped fee tables with £ figures", () => {
  const fees = extractPublishedFeeLines("CBCT £110 Routine hygienist appointment (scale and polish) £70");
  const merged = mergePricingField("[Consultation and treatment fees]", fees);
  assert.match(merged, /CBCT: £110/);
  assert.match(merged, /£70/);
});
