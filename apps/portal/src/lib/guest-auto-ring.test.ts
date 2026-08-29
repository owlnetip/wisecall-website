import assert from "node:assert/strict";
import { test } from "node:test";
import {
  guestAutoRingKey,
  parseSetupEmail,
  parseSetupPhone,
  shouldAutoRingGuest,
} from "./guest-auto-ring";

const ready = {
  callPlaced: false,
  ringing: false,
  draftReady: true,
  website: "https://northwind.example/",
  scannedWebsite: "https://northwind.example/",
  phone: "07700 900123",
};

test("auto-rings only when the draft matches the pasted site and the mobile is complete", () => {
  assert.equal(shouldAutoRingGuest(ready), true);
  assert.equal(shouldAutoRingGuest({ ...ready, phone: "07700 900" }), false);
  assert.equal(shouldAutoRingGuest({ ...ready, phone: "" }), false);
  assert.equal(shouldAutoRingGuest({ ...ready, draftReady: false }), false);
  assert.equal(
    shouldAutoRingGuest({ ...ready, website: "https://other.example/" }),
    false,
  );
  assert.equal(shouldAutoRingGuest({ ...ready, callPlaced: true }), false);
  assert.equal(shouldAutoRingGuest({ ...ready, ringing: true }), false);
});

test("auto-ring key is per number and website so a new draft can call again", () => {
  assert.equal(
    guestAutoRingKey("07700 900123", "https://northwind.example/"),
    "+447700900123:https://northwind.example/",
  );
  assert.equal(guestAutoRingKey("07700 900", "https://northwind.example/"), null);
  assert.equal(guestAutoRingKey("07700 900123", ""), null);
});

test("setup query prefills only a real UK mobile and a plausible email", () => {
  assert.equal(parseSetupPhone("07700 900123"), "07700 900123");
  assert.equal(parseSetupPhone("+447700900123"), "+447700900123");
  assert.equal(parseSetupPhone("0113 522 2277"), "");
  assert.equal(parseSetupPhone(""), "");
  assert.equal(parseSetupEmail("you@northwind.example"), "you@northwind.example");
  assert.equal(parseSetupEmail("not-an-email"), "");
});
