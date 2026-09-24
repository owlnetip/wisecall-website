import assert from "node:assert/strict";
import { test } from "node:test";
import { agentSmsSend, serviceSmsAuth, verifiedServiceSmsAuth, type AgentSmsLog } from "../../../../supabase/functions/_shared/agent-sms-send";
import { smsPhoneDigits } from "../../../../supabase/functions/_shared/vonage-messages";

const input = { request_id: "11111111-1111-4111-8111-111111111111", profile_id: "22222222-2222-4222-8222-222222222222",
  from: "447451273985", phone: "447700900123", message: "Test" };
function fixture() {
  let log: AgentSmsLog | null = null;
  const sends: unknown[] = [];
  const deps: Parameters<typeof agentSmsSend>[1] = {
    normalise: smsPhoneDigits, activeNumbers: async () => ["+447451273985"],
    claim: async value => { if (log) return log; log = { outcome: "sms_pending", metadata: { record_type: "agent_sms", request: value } }; return null; },
    finish: async (_input, outcome, providerId) => { log!.outcome = outcome; log!.metadata.provider_message_id = providerId; },
    send: async value => { sends.push(value); return { messageId: "mock-id" }; }, usage: async () => {},
  };
  return { deps, sends };
}
test("agent SMS sends once from owned numeric number and replays request ID", async () => {
  const { deps, sends } = fixture();
  const result = await agentSmsSend(input, deps);
  assert.equal(result.status, 200);
  assert.deepEqual(sends, [{ from: input.from, to: input.phone, text: input.message }]);
  assert.equal((await agentSmsSend(input, deps)).body.replay, true);
  assert.equal(sends.length, 1);
});
test("agent SMS has no alphabetic, foreign-number or absent sender fallback", async () => {
  for (const from of ["WiseCall", "447451273986", "", undefined]) {
    const { deps, sends } = fixture();
    assert.equal((await agentSmsSend({ ...input, from }, deps)).status, 422);
    assert.equal(sends.length, 0);
  }
});
test("service caller must present the exact nonempty service-role bearer", () => {
  assert.equal(serviceSmsAuth("Bearer private-service-key", "private-service-key"), true);
  assert.equal(serviceSmsAuth("Bearer private-service-key", "other-key"), false);
  assert.equal(serviceSmsAuth(null, "private-service-key"), false);
  assert.equal(serviceSmsAuth("Bearer ", ""), false);
});
test("uncertain provider result never causes an automatic resend", async () => {
  const { deps } = fixture();
  let attempts = 0;
  deps.send = async () => { attempts++; throw new Error("timeout"); };
  assert.equal((await agentSmsSend(input, deps)).status, 502);
  assert.equal((await agentSmsSend(input, deps)).status, 409);
  assert.equal(attempts, 1);
});
test("storage failures fail closed and request ID conflicts cannot send", async () => {
  const { deps, sends } = fixture();
  await agentSmsSend(input, deps);
  assert.equal((await agentSmsSend({ ...input, message: "changed" }, deps)).status, 409);
  deps.claim = async () => { throw new Error("db unavailable"); };
  await assert.rejects(agentSmsSend(input, deps));
  assert.equal(sends.length, 1);
});

test("different legacy service tokens require server-verified admin access; decoded claims alone never suffice", async () => {
  const token = `header.${btoa(JSON.stringify({ role: "service_role" }))}.signature`;
  assert.equal(await verifiedServiceSmsAuth(`Bearer ${token}`, "different-key", async () => false), false);
  assert.equal(await verifiedServiceSmsAuth(`Bearer ${token}`, "different-key", async () => true), true);
  assert.equal(await verifiedServiceSmsAuth(`Bearer ${token}`, "different-key", async () => { throw new Error("offline"); }), false);
  const userToken = `header.${btoa(JSON.stringify({ role: "authenticated" }))}.signature`;
  assert.equal(await verifiedServiceSmsAuth(`Bearer ${userToken}`, "different-key", async () => true), false);
});
