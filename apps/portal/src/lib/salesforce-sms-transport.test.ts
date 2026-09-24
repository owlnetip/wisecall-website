import assert from "node:assert/strict";
import { test } from "node:test";
import { sendViaAgentSms, smsRequestId } from "./salesforce-sms-transport";

const input = { profileId: "11111111-1111-4111-8111-111111111111", requestId: smsRequestId("agent", "one"), from: "+447451273985", to: "+447700900123", text: "Hello" };

test("portal invokes the existing numeric sender, without provider credentials or footer", async () => {
  let calls = 0;
  const result = await sendViaAgentSms({ ...input, invoke: async (name, options) => {
    calls++;
    assert.equal(name, "wisecall-send-sms");
    assert.deepEqual(options.body, { request_id: input.requestId, profile_id: input.profileId, from: "447451273985", phone: "447700900123", message: "Hello" });
    return { data: { success: true, message_id: "provider-1" }, error: null };
  } });
  assert.equal(result.messageId, "provider-1");
  assert.equal(calls, 1);
});

test("a named sender is rejected before invoking the service", async () => {
  await assert.rejects(sendViaAgentSms({ ...input, from: "WiseCall", invoke: async () => { assert.fail("must not send"); } }), /phone numbers/);
});

test("failed or uncertain sends have no automatic retry or fallback", async () => {
  let calls = 0;
  await assert.rejects(sendViaAgentSms({ ...input, invoke: async () => { calls++; return { data: null, error: new Error("timeout") }; } }), /did not confirm/);
  assert.equal(calls, 1);
  await assert.rejects(sendViaAgentSms({ ...input, invoke: async () => ({ data: { success: false }, error: null }) }), /did not confirm/);
});

test("idempotency key produces a stable profile-scoped edge reservation UUID", () => {
  const id = smsRequestId("agent", "key");
  assert.equal(id, smsRequestId("agent", "key"));
  assert.notEqual(id, smsRequestId("other", "key"));
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(smsRequestId("agent"), smsRequestId("agent"));
});
