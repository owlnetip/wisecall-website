import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createGuestWizardRateLimitKey,
  guestWizardClientIp,
  guestWizardRateLimitError,
  guestWizardRateLimitFor,
  GUEST_WIZARD_DRAFT_LIMIT,
  GUEST_WIZARD_VOICE_LIMIT,
} from "./guest-wizard-rate-limit";

test("guest wizard rate-limit keys are namespaced and do not retain the IP", () => {
  const key = createGuestWizardRateLimitKey("draft", "203.0.113.9");
  assert.match(key, /^guest-wizard:draft:[a-f0-9]{64}$/);
  assert.equal(key.includes("203.0.113.9"), false);
  assert.notEqual(
    createGuestWizardRateLimitKey("draft", "203.0.113.9"),
    createGuestWizardRateLimitKey("voice", "203.0.113.9"),
  );
});

test("drafting is tighter than voice preview", () => {
  assert.equal(guestWizardRateLimitFor("draft").limit, GUEST_WIZARD_DRAFT_LIMIT);
  assert.equal(guestWizardRateLimitFor("voice").limit, GUEST_WIZARD_VOICE_LIMIT);
  assert.ok(GUEST_WIZARD_DRAFT_LIMIT < GUEST_WIZARD_VOICE_LIMIT);
});

test("reads the forwarded client IP the same way as demo callbacks", () => {
  assert.equal(
    guestWizardClientIp(
      new Headers({ "x-forwarded-for": "198.51.100.10, 10.0.0.1" }),
    ),
    "198.51.100.10",
  );
});

test("rate-limit copy is a wait, not a signup wall", () => {
  assert.equal(
    guestWizardRateLimitError(14),
    "That was a lot of tries from this network. Wait 1 minute and try again.",
  );
  assert.equal(
    guestWizardRateLimitError(121),
    "That was a lot of tries from this network. Wait 3 minutes and try again.",
  );
});
