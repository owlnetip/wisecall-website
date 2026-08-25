import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isLikelyExistingSignup,
  shouldAutoConfirmNoCardSignup,
} from "./signup-session";

test("auto-confirms a new no-card trial signup that has no session yet", () => {
  assert.equal(
    shouldAutoConfirmNoCardSignup({
      noCard: true,
      hasSession: false,
      userId: "user-1",
      identities: [{ provider: "email" }],
    }),
    true,
  );
});

test("does not auto-confirm when a session already exists or it is not the trial path", () => {
  assert.equal(
    shouldAutoConfirmNoCardSignup({
      noCard: true,
      hasSession: true,
      userId: "user-1",
      identities: [{ provider: "email" }],
    }),
    false,
  );
  assert.equal(
    shouldAutoConfirmNoCardSignup({
      noCard: false,
      hasSession: false,
      userId: "user-1",
      identities: [{ provider: "email" }],
    }),
    false,
  );
});

test("does not auto-confirm the fake user Supabase returns for an existing email", () => {
  assert.equal(isLikelyExistingSignup([]), true);
  assert.equal(isLikelyExistingSignup([{ provider: "email" }]), false);
  assert.equal(
    shouldAutoConfirmNoCardSignup({
      noCard: true,
      hasSession: false,
      userId: "user-1",
      identities: [],
    }),
    false,
  );
});
