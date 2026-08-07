import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEstateAgentGreeting,
  buildEstateAgentPrompt,
  buildEstateViewingWebhook,
  buildQualifyEnquiryWebhook,
  estateAgentDefaultContacts,
  isEstateAgentTemplate,
} from "./estate-agent-template";

test("isEstateAgentTemplate only matches estate_agent", () => {
  assert.equal(isEstateAgentTemplate("estate_agent"), true);
  assert.equal(isEstateAgentTemplate("dentally"), false);
  assert.equal(isEstateAgentTemplate(undefined), false);
});

test("estate prompt covers viewing owner-confirm flow", () => {
  const prompt = buildEstateAgentPrompt("Acme Estates", "Maya");
  assert.match(prompt, /request_viewing/);
  assert.match(prompt, /owner/i);
  assert.match(prompt, /pending_owner/);
  assert.match(prompt, /log_enquiry/);
  assert.match(prompt, /DIGITAL NEGOTIATOR/);
  assert.match(prompt, /QUALIFICATION/);
});

test("estate greeting asks viewing vs valuation", () => {
  const g = buildEstateAgentGreeting("Acme Estates", "Maya");
  assert.match(g, /viewing/i);
  assert.match(g, /valuation/i);
});

test("estate contacts include viewings and maintenance", () => {
  const contacts = estateAgentDefaultContacts();
  const names = contacts.map((c) => c.name.toLowerCase()).join(" ");
  assert.match(names, /viewing/);
  assert.match(names, /maintenance/);
});

test("viewing webhook points at edge function with caller tokens", () => {
  const hook = buildEstateViewingWebhook({
    supabaseUrl: "https://example.supabase.co",
    smsSecret: "secret",
  });
  assert.equal(hook.name, "request_viewing");
  assert.equal(hook.condition, "during_call");
  assert.match(hook.url, /wisecall-viewing-request/);
  assert.ok(hook.headers.some((h) => h.key === "X-WiseCall-SMS-Secret"));
  assert.ok(hook.parameters.some((p) => p.key === "profile_id" && p.value === "{{profile_id}}"));
});

test("qualify enquiry webhook points at edge function", () => {
  const hook = buildQualifyEnquiryWebhook({
    supabaseUrl: "https://example.supabase.co",
    smsSecret: "secret",
  });
  assert.equal(hook.name, "log_enquiry");
  assert.equal(hook.condition, "during_call");
  assert.match(hook.url, /wisecall-qualify-enquiry/);
  assert.ok(hook.parameters.some((p) => p.key === "party_role"));
});
