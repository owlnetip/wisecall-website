import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSalesforceSmsTask,
  requestSalesforceToken,
  resetSalesforceTokenCache,
  sendVonageSms,
} from "./salesforce-sms-client";
import { lookupSalesforceByPhone } from "./salesforce-sms-client";
import type { SalesforceSmsEnv, SalesforceSmsRecord } from "./salesforce-sms";

const config: SalesforceSmsEnv = {
  secret: "staging-secret",
  profileIds: ["11111111-1111-4111-8111-111111111111"],
  instanceUrl: "https://wisecall.my.salesforce.com",
  clientId: "client",
  clientSecret: "secret",
  refreshToken: null,
};

const record: SalesforceSmsRecord = {
  id: "003000000000001AAA",
  objectType: "Contact",
  name: "Ada Lovelace",
  phones: ["+447700900123"],
  ownerId: "005000000000001AAA",
  ownerName: "Luke",
  ownerEmail: "luke@example.com",
};

test("token request uses the client-credentials grant against the Salesforce host", async () => {
  resetSalesforceTokenCache();
  let posted = "";
  const access = await requestSalesforceToken(config, async (url, init) => {
    posted = String(init?.body || "");
    assert.equal(String(url), "https://wisecall.my.salesforce.com/services/oauth2/token");
    return jsonResponse({
      access_token: "token-1",
      instance_url: "https://wisecall.my.salesforce.com",
    });
  });
  assert.match(posted, /grant_type=client_credentials/);
  assert.equal(access.accessToken, "token-1");
});

test("number lookup queries Salesforce phone fields and drops non-matches", async () => {
  let sosl = "";
  const matches = await lookupSalesforceByPhone({
    access: { accessToken: "token-1", instanceUrl: "https://wisecall.my.salesforce.com" },
    digits: "447700900123",
    fetchImpl: async (url) => {
      sosl = new URL(String(url)).searchParams.get("q") || "";
      return jsonResponse({
        searchRecords: [
          {
            attributes: { type: "Contact" },
            Id: "003000000000001AAA",
            Name: "Ada Lovelace",
            Phone: "07700 900123",
            OwnerId: "005000000000001AAA",
          },
          {
            attributes: { type: "Lead" },
            Id: "00Q000000000009AAA",
            Name: "Wrong number",
            Phone: "07700900999",
            OwnerId: "005000000000001AAA",
          },
        ],
      });
    },
  });
  assert.match(sosl, /FIND \{447700900123\} IN PHONE FIELDS/);
  assert.deepEqual(matches.map((match) => match.name), ["Ada Lovelace"]);
});

test("reply tasks are assigned to the confirmed recipient on the confirmed record", async () => {
  let task: Record<string, unknown> = {};
  const result = await createSalesforceSmsTask({
    access: { accessToken: "token-1", instanceUrl: "https://wisecall.my.salesforce.com" },
    record,
    replyRoute: {
      type: "user",
      recipientId: "005000000000002AAA",
      recipientName: null,
      recipientEmail: null,
    },
    phone: "+447700900123",
    text: "Yes Thursday works",
    direction: "inbound",
    fetchImpl: async (_url, init) => {
      task = JSON.parse(String(init?.body || "{}"));
      return jsonResponse({ id: "00T000000000001AAA", success: true });
    },
  });
  assert.equal(task.WhoId, "003000000000001AAA");
  assert.equal(task.OwnerId, "005000000000002AAA");
  assert.equal(task.Subject, "SMS reply");
  assert.match(String(task.Description), /Yes Thursday works/);
  assert.equal(result.taskId, "00T000000000001AAA");
});

test("Vonage send uses the SMS phone number and surfaces provider errors", async () => {
  let posted: Record<string, unknown> = {};
  const sent = await sendVonageSms({
    apiKey: "key",
    apiSecret: "secret",
    from: "+447700900000",
    to: "+447700900123",
    text: "Hello",
    fetchImpl: async (_url, init) => {
      posted = JSON.parse(String(init?.body || "{}"));
      return jsonResponse({ messages: [{ status: "0", "message-id": "abc" }] });
    },
  });
  assert.equal(sent.messageId, "abc");
  assert.equal(posted.from, "447700900000");
  assert.equal(posted.to, "447700900123");

  await assert.rejects(
    () =>
      sendVonageSms({
        apiKey: "key",
        apiSecret: "secret",
        from: "WiseCall",
        to: "+447700900123",
        text: "Hello",
        fetchImpl: async () => jsonResponse({ messages: [{ status: "0", "message-id": "nope" }] }),
      }),
    /phone number/,
  );

  await assert.rejects(
    () =>
      sendVonageSms({
        apiKey: "key",
        apiSecret: "secret",
        from: "447700900000",
        to: "447700900123",
        text: "Hello",
        fetchImpl: async () => jsonResponse({ messages: [{ status: "1", "error-text": "Missing from param" }] }),
      }),
    /Missing from param/,
  );
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
