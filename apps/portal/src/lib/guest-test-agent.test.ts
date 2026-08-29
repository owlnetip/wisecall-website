import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ALWAYS_OPEN_OFFICE_HOURS,
  AVA_DEMO_SLUG,
  buildGuestTestAgentInsert,
  guestCallbackTargetError,
  guestRoutingNumber,
  guestTestAgentSlug,
  guestTestCallbackBody,
  guestTestVoiceName,
  GUEST_TEST_AGENT_SOURCE,
  isAvaDemoNumber,
  isAvaDemoSlug,
  isGuestTestAgentMetadata,
} from "./guest-test-agent";
import { parseWizardDraft } from "./wizard-draft";
import { buildGuestStreamTexml } from "./guest-callback-texml";

const draft = parseWizardDraft(
  JSON.stringify({
    businessName: "Northwind Dental",
    receptionistName: "Northwind Dental assistant",
    industry: "Dental",
    greeting: "Hi, thanks for calling Northwind Dental.",
    prompt: "You are the receptionist for Northwind Dental in Leeds.",
    knowledge: "We are in Leeds.",
    knowledgeFields: { address: "Leeds" },
    officeHours: { mon: { open: "09:00", close: "17:00" } },
    website: "https://northwind.example",
    templateId: "receptionist",
    voice: "Hugo",
    defaultEmail: "owner@northwind.example",
    contacts: [],
  }),
);

test("guest test slugs are namespaced and do not provision a DDI identity", () => {
  assert.equal(guestTestAgentSlug("Northwind Dental", "abc12345"), "guest-northwind-dental-abc12345");
  assert.match(guestTestAgentSlug("!!!", "zzzzzzzz"), /^guest-agent-zzzzzzzz$/);
  assert.equal(isAvaDemoSlug(guestTestAgentSlug("Northwind Dental", "abc12345")), false);
});

test("guest routing numbers are unique and are not Ava's DDI", () => {
  const a = guestRoutingNumber("abc12345");
  const b = guestRoutingNumber("def67890");
  assert.match(a, /^\+4455\d{9}$/);
  assert.notEqual(a, b);
  assert.equal(isAvaDemoNumber(a), false);
  assert.equal(isAvaDemoNumber("+441135222277"), true);
  assert.equal(isAvaDemoNumber("+441135221606"), true);
  assert.equal(isAvaDemoSlug("wisecall"), true);
  assert.equal(isAvaDemoSlug("guest-northwind-dental-abc12345"), false);
});

test("insert row is Gemma, 24/7, with a routing key the edge can match", () => {
  assert.ok(draft);
  const routingNumber = guestRoutingNumber("abc12345");
  const row = buildGuestTestAgentInsert(draft, {
    slug: "guest-northwind-dental-abc12345",
    routingNumber,
    voice: { ttsProvider: "cartesia", voiceId: "voice-1", voiceName: guestTestVoiceName() },
  });
  assert.equal(row.slug, "guest-northwind-dental-abc12345");
  assert.equal(row.is_active, true);
  assert.equal(row.telnyx_number, routingNumber);
  assert.equal(row.system_prompt, "You are the receptionist for Northwind Dental in Leeds.");
  const metadata = row.metadata as Record<string, unknown>;
  assert.equal(metadata.source, GUEST_TEST_AGENT_SOURCE);
  assert.equal(metadata.guest_test, true);
  assert.equal(metadata.voice, "Gemma");
  assert.deepEqual(metadata.office_hours, ALWAYS_OPEN_OFFICE_HOURS);
  assert.equal(metadata.owner_id, undefined);
  assert.equal((metadata.knowledge_fields as Record<string, string>).openingHours, "Open all the time");
  assert.equal(isGuestTestAgentMetadata(metadata), true);
  assert.equal(isGuestTestAgentMetadata({ source: "portal_create" }), false);
});

test("callback body uses the guest slug and routing number, never Ava", () => {
  const body = guestTestCallbackBody({
    phone: "+447700900123",
    slug: "guest-northwind-dental-abc12345",
    calledNumber: guestRoutingNumber("abc12345"),
    agentName: "Northwind Dental assistant",
  });
  assert.equal(body.profile_slug, "guest-northwind-dental-abc12345");
  assert.notEqual(body.profile_slug, AVA_DEMO_SLUG);
  assert.equal(body.called_number, guestRoutingNumber("abc12345"));
  assert.equal(isAvaDemoNumber(body.called_number), false);
  assert.equal(body.phone, "+447700900123");
  assert.equal(body.source, GUEST_TEST_AGENT_SOURCE);
  assert.equal(
    guestCallbackTargetError({ slug: body.profile_slug, calledNumber: body.called_number }),
    null,
  );
});

test("guest callback refuses Ava slug or Ava numbers rather than ringing her", () => {
  assert.equal(
    guestCallbackTargetError({ slug: "wisecall", calledNumber: "+4455123456789" }),
    "Could not start the test call on the receptionist we just drafted. Try again.",
  );
  assert.equal(
    guestCallbackTargetError({
      slug: "guest-northwind-dental-abc12345",
      calledNumber: "+441135222277",
    }),
    "Could not start the test call on the receptionist we just drafted. Try again.",
  );
  assert.ok(guestCallbackTargetError({ slug: "", calledNumber: "+4455123456789" }));
});

test("stream TeXML carries the guest slug and routing number, not Ava", () => {
  const texml = buildGuestStreamTexml({
    edgeBaseUrl: "https://18.132.149.25.sslip.io",
    profileSlug: "guest-northwind-dental-abc12345",
    callerId: "+447700900123",
    calledNumber: "+4455123456789",
  });
  assert.match(texml, /profile_slug=guest-northwind-dental-abc12345/);
  assert.match(texml, /called_number=%2B4455123456789/);
  assert.doesNotMatch(texml, /profile_slug=wisecall/);
  assert.doesNotMatch(texml, /441135222277/);
  assert.doesNotMatch(texml, /441135221606/);
});
