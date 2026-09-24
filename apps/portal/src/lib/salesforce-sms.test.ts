import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  buildPhoneSosl,
  canonicalSmsDigits,
  decideSalesforceSms,
  executeSalesforceOutbound,
  normaliseSmsDestination,
  parseOutboundSmsBody,
  parseSalesforceSearchRecords,
  planInboundSalesforceReply,
  readSalesforceSmsEnv,
  type SalesforceSmsDeps,
  type SalesforceSmsRecord,
  type StoredSmsBinding,
} from "./salesforce-sms";

const PROFILE = "11111111-1111-4111-8111-111111111111";
const PHONE = "+447700900123";
const OWNER = "005000000000001AAA";
const OTHER_USER = "005000000000002AAA";

function contact(overrides: Partial<SalesforceSmsRecord> = {}): SalesforceSmsRecord {
  return {
    id: "003000000000001AAA",
    objectType: "Contact",
    name: "Ada Lovelace",
    phones: ["07700 900123"],
    ownerId: OWNER,
    ownerName: "Luke",
    ownerEmail: "luke@example.com",
    ...overrides,
  };
}

function lead(overrides: Partial<SalesforceSmsRecord> = {}): SalesforceSmsRecord {
  return contact({
    id: "00Q000000000001AAA",
    objectType: "Lead",
    name: "Grace Hopper",
    ...overrides,
  });
}

function binding(overrides: Partial<StoredSmsBinding> = {}): StoredSmsBinding {
  return {
    id: "binding-1",
    profileId: PROFILE,
    phoneDigits: "447700900123",
    salesforceRecordId: "003000000000001AAA",
    salesforceObject: "Contact",
    recordName: "Ada Lovelace",
    replyRoute: {
      type: "owner",
      recipientId: OWNER,
      recipientName: "Luke",
      recipientEmail: "luke@example.com",
    },
    confirmedCandidateIds: ["003000000000001AAA"],
    ...overrides,
  };
}

test("normalises UK local, 00, and bare country-code numbers to the same digits", () => {
  assert.equal(normaliseSmsDestination("07700 900123"), PHONE);
  assert.equal(normaliseSmsDestination("00447700900123"), PHONE);
  assert.equal(normaliseSmsDestination("447700900123"), PHONE);
  assert.equal(canonicalSmsDigits("+44 (0)7700 900123".replace("(0)", "")), "447700900123");
  assert.equal(canonicalSmsDigits("07700900123"), "447700900123");
  assert.equal(normaliseSmsDestination("123"), null);
});

test("builds a digit-only Salesforce phone lookup", () => {
  const sosl = buildPhoneSosl("447700900123");
  assert.match(sosl, /FIND \{447700900123 OR 07700900123 OR 00447700900123\} IN PHONE FIELDS/);
  assert.match(sosl, /IsConverted = false/);
  assert.throws(() => buildPhoneSosl("07700 900123"), /8 to 15 digit/);
});

test("keeps only records whose phone fields match the destination", () => {
  const records = parseSalesforceSearchRecords(
    {
      searchRecords: [
        {
          attributes: { type: "Contact" },
          Id: "003000000000001AAA",
          Name: "Ada Lovelace",
          Phone: "07700 900123",
          MobilePhone: null,
          OwnerId: OWNER,
          Owner: { Name: "Luke", Email: "luke@example.com" },
        },
        {
          attributes: { type: "Contact" },
          Id: "003000000000009AAA",
          Name: "Someone else",
          Phone: "07700 900999",
          OwnerId: OWNER,
        },
        {
          attributes: { type: "Lead" },
          Id: "00Q000000000001AAA",
          Name: "Grace Hopper",
          MobilePhone: "+447700900123",
          OwnerId: OTHER_USER,
          Owner: { Name: "Nick", Email: "nick@example.com" },
        },
      ],
    },
    "447700900123",
  );
  assert.deepEqual(
    records.map((record) => record.id),
    ["003000000000001AAA", "00Q000000000001AAA"],
  );
  assert.equal(records[0].ownerEmail, "luke@example.com");
});

test("a single match still waits for reply-route confirmation and does not imply the owner", () => {
  const decision = decideSalesforceSms({ matches: [contact()] });
  assert.equal(decision.status, "confirm_reply_route");
  if (decision.status !== "confirm_reply_route") return;
  assert.equal(decision.record.id, "003000000000001AAA");
  assert.equal(decision.suggestedReplyRoute?.recipientId, OWNER);
  assert.equal(decision.suggestedReplyRoute?.type, "owner");
});

test("duplicate numbers are not mapped until the record is confirmed", () => {
  const decision = decideSalesforceSms({ matches: [contact(), lead()] });
  assert.equal(decision.status, "confirm_duplicate");
  if (decision.status !== "confirm_duplicate") return;
  assert.equal(decision.candidates.length, 2);
  assert.deepEqual(
    decision.candidates.map((record) => record.name),
    ["Ada Lovelace", "Grace Hopper"],
  );
});

test("confirming one duplicate still asks who receives replies", () => {
  const decision = decideSalesforceSms({
    matches: [contact(), lead()],
    confirmRecordId: "00Q000000000001AAA",
  });
  assert.equal(decision.status, "confirm_reply_route");
  if (decision.status !== "confirm_reply_route") return;
  assert.equal(decision.record.name, "Grace Hopper");
  assert.equal(decision.suggestedReplyRoute?.recipientId, OWNER);
});

test("a confirm id outside the lookup is rejected", () => {
  const decision = decideSalesforceSms({
    matches: [contact(), lead()],
    confirmRecordId: "003000000000099AAA",
    confirmReplyRoute: { type: "owner" },
  });
  assert.equal(decision.status, "reject");
});

test("owner confirmation cannot redirect replies to a different user", () => {
  const decision = decideSalesforceSms({
    matches: [contact()],
    confirmReplyRoute: { type: "owner", recipientId: OTHER_USER },
  });
  assert.equal(decision.status, "reject");
});

test("user reply routing requires an explicit Salesforce user id", () => {
  const missing = decideSalesforceSms({
    matches: [contact()],
    confirmReplyRoute: { type: "user" },
  });
  assert.equal(missing.status, "reject");

  const confirmed = decideSalesforceSms({
    matches: [contact()],
    confirmReplyRoute: { type: "user", recipientId: OTHER_USER },
  });
  assert.equal(confirmed.status, "send");
  if (confirmed.status !== "send") return;
  assert.equal(confirmed.replyRoute.recipientId, OTHER_USER);
  assert.equal(confirmed.reusedConfirmation, false);
});

test("an unchanged confirmed mapping is reused for later texts", () => {
  const decision = decideSalesforceSms({
    matches: [contact(), lead()],
    binding: binding({
      confirmedCandidateIds: ["003000000000001AAA", "00Q000000000001AAA"],
    }),
  });
  assert.equal(decision.status, "send");
  if (decision.status !== "send") return;
  assert.equal(decision.reusedConfirmation, true);
  assert.equal(decision.record.id, "003000000000001AAA");
  assert.equal(decision.replyRoute.recipientId, OWNER);
});

test("a new duplicate invalidates the previous mapping", () => {
  const decision = decideSalesforceSms({
    matches: [contact(), lead()],
    binding: binding(),
  });
  assert.equal(decision.status, "confirm_duplicate");
});

test("no Salesforce match sends nothing", () => {
  assert.equal(decideSalesforceSms({ matches: [] }).status, "no_match");
});

test("inbound replies follow the confirmed recipient and otherwise pass through", () => {
  assert.deepEqual(planInboundSalesforceReply(null), { status: "passthrough" });
  const routed = planInboundSalesforceReply(
    binding({
      replyRoute: {
        type: "user",
        recipientId: OTHER_USER,
        recipientName: null,
        recipientEmail: null,
      },
    }),
  );
  assert.equal(routed.status, "route");
  if (routed.status !== "route") return;
  assert.equal(routed.binding.replyRoute.recipientId, OTHER_USER);
  assert.equal(routed.binding.salesforceRecordId, "003000000000001AAA");
});

test("outbound execution does not send while confirmation is outstanding", async () => {
  let sends = 0;
  const deps = fakeDeps({
    matches: [contact(), lead()],
    sendSms: async () => {
      sends += 1;
      return { messageId: "should-not-send" };
    },
  });

  const duplicate = await executeSalesforceOutbound(
    { profileId: PROFILE, to: PHONE, text: "Hello" },
    deps,
  );
  assert.equal(duplicate.httpStatus, 409);
  assert.equal(duplicate.body.status, "confirm_duplicate");

  const needsRoute = await executeSalesforceOutbound(
    { profileId: PROFILE, to: PHONE, text: "Hello", confirmRecordId: "003000000000001AAA" },
    deps,
  );
  assert.equal(needsRoute.httpStatus, 409);
  assert.equal(needsRoute.body.status, "confirm_reply_route");
  assert.equal(sends, 0);
  assert.equal(deps.savedBindings.length, 0);
});

test("a confirmed send goes out once and stores the mapping and recipient", async () => {
  const deps = fakeDeps({ matches: [contact()] });
  const result = await executeSalesforceOutbound(
    {
      profileId: PROFILE,
      to: "07700900123",
      text: "Your viewing is confirmed",
      confirmReplyRoute: { type: "owner" },
      idempotencyKey: "lead-ada-1",
    },
    deps,
  );
  assert.equal(result.httpStatus, 200);
  assert.equal(result.body.status, "sent");
  assert.equal(result.body.provider, "vonage");
  assert.equal(deps.sends.length, 1);
  assert.equal(deps.sends[0].from, "+447700900000");
  assert.equal(deps.sends[0].to, PHONE);
  assert.equal(deps.savedBindings[0].salesforceRecordId, "003000000000001AAA");
  assert.equal(deps.savedBindings[0].replyRoute.recipientId, OWNER);
  assert.deepEqual(deps.savedBindings[0].confirmedCandidateIds, ["003000000000001AAA"]);
  assert.equal(deps.tasks[0].direction, "outbound");
  assert.equal(deps.tasks[0].replyRoute.recipientId, OWNER);

  const replay = await executeSalesforceOutbound(
    {
      profileId: PROFILE,
      to: PHONE,
      text: "Your viewing is confirmed",
      confirmReplyRoute: { type: "owner" },
      idempotencyKey: "lead-ada-1",
    },
    deps,
  );
  assert.equal(replay.body.idempotent_replay, true);
  assert.equal(deps.sends.length, 1);
});

test("reply mapping is persisted before the SMS can be sent", async () => {
  const deps = fakeDeps({ matches: [contact()] });
  const order: string[] = [];
  deps.saveBinding = async () => { order.push("binding"); return { id: "binding-1" }; };
  deps.sendSms = async () => { order.push("send"); return { messageId: "sms-1" }; };
  const result = await executeSalesforceOutbound({ profileId: PROFILE, to: PHONE, text: "Hello", confirmReplyRoute: { type: "owner" } }, deps);
  assert.equal(result.httpStatus, 200);
  assert.deepEqual(order, ["binding", "send"]);
});

test("failed reply mapping prevents any SMS or Task", async () => {
  const deps = fakeDeps({ matches: [contact()] });
  deps.saveBinding = async () => { throw new Error("database unavailable"); };
  const result = await executeSalesforceOutbound({ profileId: PROFILE, to: PHONE, text: "Hello", confirmReplyRoute: { type: "owner" } }, deps);
  assert.equal(result.httpStatus, 503);
  assert.equal(result.body.status, "binding_unavailable");
  assert.equal(deps.sends.length, 0);
  assert.equal(deps.tasks.length, 0);
});

test("inbound lookup failure cannot fall through to the AI receptionist", () => {
  const source = readFileSync(new URL("../../../../supabase/functions/wisecall-sms-inbound/index.ts", import.meta.url), "utf8");
  assert.match(source, /salesforce binding lookup:[\s\S]*?throw new Error\("Salesforce binding lookup unavailable"\)/);
  assert.match(source, /salesforce route:[\s\S]*?return new Response\("Reply routing temporarily unavailable", \{ status: 503 \}\)/);
});

test("parse accepts the Salesforce flow payload and rejects a missing reply type", () => {
  const parsed = parseOutboundSmsBody(
    {
      profile_id: PROFILE,
      to: "07700900123",
      text: "Hello",
      confirm_record_id: "003000000000001AAA",
      confirm_reply_route: { type: "owner" },
    },
    "idem-key-1",
  );
  assert.equal(parsed.ok, true);
  if (!parsed.ok) return;
  assert.equal(parsed.value.confirmReplyRoute?.type, "owner");
  assert.equal(parsed.value.idempotencyKey, "idem-key-1");

  const bad = parseOutboundSmsBody({ profile_id: PROFILE, to: PHONE, text: "Hi", confirm_reply_route: { type: "queue" } });
  assert.equal(bad.ok, false);

  const namedSender = parseOutboundSmsBody({ profile_id: PROFILE, to: PHONE, text: "Hi", from: "WiseCall" });
  assert.equal(namedSender.ok, false);
  if (namedSender.ok) return;
  assert.match(namedSender.error, /phone number/);

  const numberedSender = parseOutboundSmsBody({ profile_id: PROFILE, to: PHONE, text: "Hi", from: "07700900000" });
  assert.equal(numberedSender.ok, true);
  if (!numberedSender.ok) return;
  assert.equal(numberedSender.value.from, "+447700900000");
});

test("Salesforce SMS stays disabled until the staging secret, agent, and org are set", () => {
  const missing = readSalesforceSmsEnv({});
  assert.equal(missing.ok, false);

  const badHost = readSalesforceSmsEnv({
    WISECALL_SALESFORCE_SMS_SECRET: "staging-secret",
    WISECALL_SALESFORCE_SMS_PROFILE_IDS: PROFILE,
    SALESFORCE_INSTANCE_URL: "https://example.com",
    SALESFORCE_CLIENT_ID: "client",
    SALESFORCE_CLIENT_SECRET: "secret",
  });
  assert.equal(badHost.ok, false);

  const ready = readSalesforceSmsEnv({
    WISECALL_SALESFORCE_SMS_SECRET: "staging-secret",
    WISECALL_SALESFORCE_SMS_PROFILE_IDS: PROFILE,
    SALESFORCE_INSTANCE_URL: "https://wisecall.my.salesforce.com/",
    SALESFORCE_CLIENT_ID: "client",
    SALESFORCE_CLIENT_SECRET: "secret",
  });
  assert.equal(ready.ok, true);
  if (!ready.ok) return;
  assert.equal(ready.config.instanceUrl, "https://wisecall.my.salesforce.com");
  assert.deepEqual(ready.config.profileIds, [PROFILE]);
});

function fakeDeps(options: {
  matches: SalesforceSmsRecord[];
  sendSms?: SalesforceSmsDeps["sendSms"];
}): SalesforceSmsDeps & { sends: Array<{ from: string; to: string; text: string }>; savedBindings: StoredSmsBinding[]; tasks: Array<{ direction: string; replyRoute: { recipientId: string } }> } {
  const sent = new Map<string, Record<string, unknown>>();
  const deps = {
    sends: [] as Array<{ from: string; to: string; text: string }>,
    savedBindings: [] as StoredSmsBinding[],
    tasks: [] as Array<{ direction: string; replyRoute: { recipientId: string } }>,
    lookup: async () => options.matches,
    loadBinding: async () => null,
    saveBinding: async (row: StoredSmsBinding) => {
      deps.savedBindings.push(row);
      return { id: "binding-1" };
    },
    findSent: async (_profileId: string, key: string) => {
      const body = sent.get(key);
      return body ? { body } : null;
    },
    saveMessage: async (row: { idempotencyKey: string | null; detail: Record<string, unknown> }) => {
      if (row.idempotencyKey) sent.set(row.idempotencyKey, row.detail);
    },
    sendSms: options.sendSms ?? (async (input: { from: string; to: string; text: string }) => {
      deps.sends.push(input);
      return { messageId: "vonage-1" };
    }),
    logSalesforceTask: async (input: { direction: "outbound" | "inbound"; replyRoute: { recipientId: string } }) => {
      deps.tasks.push(input);
      return { taskId: "00T000000000001AAA", error: null };
    },
    recordUsage: async () => undefined,
    resolveFromNumber: async () => ({ ok: true as const, from: "+447700900000" }),
  };
  return deps;
}
