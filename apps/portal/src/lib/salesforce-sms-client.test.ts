import assert from "node:assert/strict";
import { test } from "node:test";
import {
  createSalesforceSmsTask,
  requestSalesforceToken,
  resetSalesforceTokenCache,
} from "./salesforce-sms-client";
import { lookupSalesforceByPhone, sendSalesforceReplyNotification } from "./salesforce-sms-client";
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
  assert.match(sosl, /FIND \{447700900123 OR 07700900123 OR 00447700900123\} IN PHONE FIELDS/);
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
  assert.equal(task.Subject, "SMS received: Yes Thursday works");
  assert.equal(task.Status, "Completed");
  assert.match(String(task.Description), /^SMS received from \+447700900123/);
  assert.match(String(task.Description), /Yes Thursday works/);
  assert.equal(result.taskId, "00T000000000001AAA");
});

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("reply notification targets the record and the routed user", async () => {
  const calls: Array<{ url: string; body: unknown }> = [];
  const result = await sendSalesforceReplyNotification({
    access: { instanceUrl: "https://example.my.salesforce.com", accessToken: "tok" } as never,
    recipientId: "005000000000002AAA",
    targetId: "001000000000009AAA",
    recordName: "Jane Smith",
    text: "Yes   Thursday works",
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), body: init?.body ? JSON.parse(String(init.body)) : null });
      if (String(url).includes("/query")) return jsonResponse({ records: [{ Id: "0MLxx0000000001" }] });
      return jsonResponse([{ isSuccess: true }]);
    },
  });
  assert.equal(result.sent, true);
  const input = (calls[1].body as { inputs: Array<Record<string, unknown>> }).inputs[0];
  assert.equal(input.customNotifTypeId, "0MLxx0000000001");
  assert.deepEqual(input.recipientIds, ["005000000000002AAA"]);
  assert.equal(input.targetId, "001000000000009AAA");
  assert.equal(input.title, "SMS reply from Jane Smith");
  assert.equal(input.body, "Yes Thursday works");
});

test("reply notification failure is reported, not thrown", async () => {
  const result = await sendSalesforceReplyNotification({
    access: { instanceUrl: "https://example.my.salesforce.com", accessToken: "tok" } as never,
    recipientId: "005", targetId: "003", recordName: "X", text: "hi",
    fetchImpl: async () => { throw new Error("network down"); },
  });
  assert.equal(result.sent, false);
  assert.equal(result.error, "network down");
});
