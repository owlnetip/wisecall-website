import assert from "node:assert/strict";
import { test } from "node:test";
import { parseDirectSendBody, postReplyToSalesforce, salesforceObjectForId } from "./salesforce-sms-direct";

const PROFILE = "b3b2374c-ddc6-4e66-87a8-c60703ac89f9";

test("record ids map to Lead, Contact or Account only", () => {
  assert.equal(salesforceObjectForId("00QQ100000SLbZ7MAL"), "Lead");
  assert.equal(salesforceObjectForId("003Q100000f6c0CIAQ"), "Contact");
  assert.equal(salesforceObjectForId("001Q100000eKrhOIAS"), "Account");
  assert.equal(salesforceObjectForId("005Q100000GGM0CIAX"), null);
  assert.equal(salesforceObjectForId("not-an-id"), null);
});

test("send body is validated and normalised", () => {
  const ok = parseDirectSendBody(
    { profile_id: PROFILE, record_id: "00QQ100000SLbZ7MAL", phone: "07700 900123", text: " Hi Jane " },
    "key-1",
  );
  assert.ok(ok.ok);
  if (ok.ok) {
    assert.equal(ok.value.to, "+447700900123");
    assert.equal(ok.value.text, "Hi Jane");
    assert.equal(ok.value.object, "Lead");
    assert.equal(ok.value.idempotencyKey, "key-1");
  }
  assert.equal(parseDirectSendBody({ profile_id: PROFILE, record_id: "005Q100000GGM0CIAX", phone: "07700900123", text: "x" }).ok, false);
  assert.equal(parseDirectSendBody({ profile_id: PROFILE, record_id: "00QQ100000SLbZ7MAL", phone: "abc", text: "x" }).ok, false);
  assert.equal(parseDirectSendBody({ profile_id: PROFILE, record_id: "00QQ100000SLbZ7MAL", phone: "07700900123", text: "x".repeat(1001) }).ok, false);
  assert.equal(parseDirectSendBody(null).ok, false);
});

test("reply is posted to the Salesforce Apex REST endpoint", async () => {
  let url = "";
  let sent: Record<string, unknown> = {};
  const outcome = await postReplyToSalesforce({
    access: { instanceUrl: "https://example.my.salesforce.com", accessToken: "tok" } as never,
    phone: "+447700900123", content: "Yes Thursday", recordId: "00QQ100000SLbZ7MAL", messageId: "m1",
    fetchImpl: async (input, init) => {
      url = String(input);
      sent = JSON.parse(String(init?.body));
      return new Response(JSON.stringify({ ok: true, match_type: "record", record_id: "00QQ100000SLbZ7MAL", task_id: "00T1" }), { status: 200 });
    },
  });
  assert.equal(url, "https://example.my.salesforce.com/services/apexrest/wisecall/sms/reply");
  assert.deepEqual(sent, { phone: "+447700900123", content: "Yes Thursday", record_id: "00QQ100000SLbZ7MAL", message_id: "m1" });
  assert.equal(outcome.delivered, true);
  assert.equal(outcome.taskId, "00T1");
});

test("an unmatched reply handled by the fallback email counts as delivered; errors do not", async () => {
  const unmatched = await postReplyToSalesforce({
    access: { instanceUrl: "https://example.my.salesforce.com", accessToken: "tok" } as never,
    phone: "+447700900123", content: "Hi", recordId: null, messageId: "m2",
    fetchImpl: async () => new Response(JSON.stringify({ ok: true, match_type: "none", fallback_email_sent: true }), { status: 200 }),
  });
  assert.equal(unmatched.delivered, true);
  assert.equal(unmatched.fallbackEmailSent, true);
  const failed = await postReplyToSalesforce({
    access: { instanceUrl: "https://example.my.salesforce.com", accessToken: "tok" } as never,
    phone: "+447700900123", content: "Hi", recordId: null, messageId: "m3",
    fetchImpl: async () => new Response(JSON.stringify({ ok: false, error: "boom" }), { status: 500 }),
  });
  assert.equal(failed.delivered, false);
  assert.equal(failed.error, "boom");
});
