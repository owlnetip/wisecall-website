import assert from "node:assert/strict";
import test from "node:test";
import {
  getLargeBlastConfirmation,
  isValidIdempotencyKey,
  normaliseOutboundNumber,
  prepareOutboundRecipients,
} from "./outbound-safeguards";

test("normalises supported international and UK phone formats", () => {
  assert.equal(normaliseOutboundNumber("+44 7700 900123"), "+447700900123");
  assert.equal(normaliseOutboundNumber("0044 (7700) 900-123"), "+447700900123");
  assert.equal(normaliseOutboundNumber("07700 900123"), "+447700900123");
  assert.equal(normaliseOutboundNumber("not a number"), null);
  assert.equal(normaliseOutboundNumber("12345"), null);
});

test("counts invalid and duplicate recipients using canonical numbers", () => {
  const review = prepareOutboundRecipients(
    [
      { toNumber: "07700 900123", contactName: "A" },
      { toNumber: "+44 7700 900123", contactName: "Duplicate" },
      { toNumber: "+1 202 555 0123", contactName: "B" },
      { toNumber: "invalid", contactName: "C" },
    ],
    3,
  );

  assert.equal(review.importedCount, 4);
  assert.equal(review.recipientCount, 2);
  assert.equal(review.duplicateCount, 1);
  assert.equal(review.invalidNumberCount, 1);
  assert.equal(review.estimatedCallAttempts, 6);
  assert.deepEqual(
    review.recipients.map((recipient) => recipient.toNumber),
    ["+447700900123", "+12025550123"],
  );
});

test("requires an exact typed confirmation for large sends", () => {
  assert.equal(getLargeBlastConfirmation(99), null);
  assert.equal(getLargeBlastConfirmation(100), "START 100");
  assert.equal(getLargeBlastConfirmation(500), "START 500");
});

test("accepts bounded opaque idempotency keys", () => {
  assert.equal(isValidIdempotencyKey("6bc1ec52-8584-4e7f-a394-f1818b17b493"), true);
  assert.equal(isValidIdempotencyKey("short"), false);
  assert.equal(isValidIdempotencyKey("not allowed / spaces"), false);
});
