import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildEstateAgentGreeting,
  buildEstateAgentPrompt,
  buildEstateViewingWebhook,
  estateAgentDefaultContacts,
} from "./estate-agent-template";

test("estate prompt covers viewing owner-confirm flow", () => {
  const prompt = buildEstateAgentPrompt("Acme Estates", "Maya");
  assert.match(prompt, /request_viewing/);
  assert.match(prompt, /owner/i);
  assert.match(prompt, /pending_owner/);
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
