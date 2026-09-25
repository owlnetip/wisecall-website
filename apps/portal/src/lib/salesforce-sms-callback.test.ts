import test from "node:test";
import assert from "node:assert/strict";
import { salesforceCallbackHeaders, postSalesforceCallback } from "../../../../supabase/functions/_shared/salesforce-sms-callback";

test("callback supports legacy plain secrets without a bypass", () => {
  assert.deepEqual(salesforceCallbackHeaders("shared"), { "Content-Type": "application/json", "x-wisecall-salesforce-secret": "shared" });
});
test("callback keeps SMS auth and preview bypass in separate headers", () => {
  const headers = salesforceCallbackHeaders(JSON.stringify({ secret: "shared", vercel_bypass: "bypass" }));
  assert.equal(headers["x-wisecall-salesforce-secret"], "shared");
  assert.equal(headers["x-vercel-protection-bypass"], "bypass");
});
test("malformed configuration fails closed", () => {
  for (const value of ["", "{", '{"vercel_bypass":"x"}', '{"secret":"a","vercel_bypass":3}', "secret\r\ninjected"]) {
    assert.throws(() => salesforceCallbackHeaders(value));
  }
});
test("callback never follows redirects and preserves the message", async () => {
  const payload = { text: "Exact message", profile_id: "test" };
  const result = await postSalesforceCallback("https://preview.vercel.app", "shared", payload, async (url, init) => {
    assert.equal(String(url), "https://preview.vercel.app/api/integrations/salesforce/sms/inbound");
    assert.equal(init?.redirect, "error");
    assert.deepEqual(JSON.parse(String(init?.body)), payload);
    return Response.json({ routed: true, delivered: true });
  });
  assert.equal(result.delivered, true);
});
test("successful HTTP without confirmed Task delivery remains undelivered", async () => {
  const result = await postSalesforceCallback("https://preview.vercel.app", "shared", {}, async () => Response.json({ routed: false }));
  assert.equal(result.delivered, false);
});
test("unsafe origins fail before sending credentials", async () => {
  for (const url of ["http://preview.vercel.app", "https://user:pass@preview.vercel.app", "https://preview.vercel.app?secret=x"]) {
    await assert.rejects(postSalesforceCallback(url, "shared", {}, async () => { throw new Error("must not call"); }), /Invalid SMS callback origin/);
  }
});
