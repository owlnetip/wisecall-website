import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildGuestTestAgentInsert,
  guestTestAgentSlug,
  guestTestCallbackBody,
  GUEST_TEST_AGENT_SOURCE,
  isGuestTestAgentMetadata,
} from "./guest-test-agent";
import { parseWizardDraft } from "./wizard-draft";

const draft = parseWizardDraft(
  JSON.stringify({
    businessName: "Northwind Dental",
    receptionistName: "Northwind Dental assistant",
    industry: "Dental",
    greeting: "Hi, thanks for calling Northwind Dental.",
    prompt: "You are the receptionist.",
    knowledge: "We are in Leeds.",
    knowledgeFields: { address: "Leeds" },
    officeHours: { mon: { open: "09:00", close: "17:00" } },
    website: "https://northwind.example",
    templateId: "receptionist",
    voice: "Gemma",
    defaultEmail: "",
    contacts: [],
  }),
);

test("guest test slugs are namespaced and do not provision a DDI identity", () => {
  assert.equal(guestTestAgentSlug("Northwind Dental", "abc12345"), "guest-northwind-dental-abc12345");
  assert.match(guestTestAgentSlug("!!!", "zzzzzzzz"), /^guest-agent-zzzzzzzz$/);
});

test("insert row is a live test profile with no owner and no number", () => {
  assert.ok(draft);
  const row = buildGuestTestAgentInsert(draft, {
    slug: "guest-northwind-dental-abc12345",
    voice: { ttsProvider: "cartesia", voiceId: "voice-1", voiceName: "Gemma" },
  });
  assert.equal(row.slug, "guest-northwind-dental-abc12345");
  assert.equal(row.is_active, true);
  assert.equal(row.telnyx_number, undefined);
  assert.equal(row.system_prompt, "You are the receptionist.");
  const metadata = row.metadata as Record<string, unknown>;
  assert.equal(metadata.source, GUEST_TEST_AGENT_SOURCE);
  assert.equal(metadata.guest_test, true);
  assert.equal(metadata.owner_id, undefined);
  assert.equal(isGuestTestAgentMetadata(metadata), true);
  assert.equal(isGuestTestAgentMetadata({ source: "portal_create" }), false);
});

test("callback body uses the guest slug, not the Ava demo", () => {
  const body = guestTestCallbackBody({
    phone: "+447700900123",
    slug: "guest-northwind-dental-abc12345",
    agentName: "Northwind Dental assistant",
  });
  assert.equal(body.profile_slug, "guest-northwind-dental-abc12345");
  assert.notEqual(body.profile_slug, "wisecall");
  assert.equal(body.phone, "+447700900123");
  assert.equal(body.source, GUEST_TEST_AGENT_SOURCE);
});
