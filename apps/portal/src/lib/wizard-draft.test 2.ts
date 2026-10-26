import assert from "node:assert/strict";
import { test } from "node:test";
import { parseWizardDraft } from "./wizard-draft";

test("accepts a finished receptionist draft", () => {
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
      defaultEmail: "hello@northwind.example",
      contacts: [{ id: "c1", name: "Sam", phone: "", email: "", keywords: [], transfer: false, notify: true, useDefaultEmail: true }],
      calcomApiKey: "cal_live_test",
    }),
  );
  assert.ok(draft);
  assert.equal(draft?.businessName, "Northwind Dental");
  assert.equal(draft?.officeHours.mon?.open, "09:00");
  assert.equal(draft?.calcomApiKey, "cal_live_test");
  assert.equal(draft?.contacts[0]?.name, "Sam");
});

test("rejects empty, huge, and non-object payloads", () => {
  assert.equal(parseWizardDraft(""), null);
  assert.equal(parseWizardDraft("not-json"), null);
  assert.equal(parseWizardDraft("[]"), null);
  assert.equal(parseWizardDraft(JSON.stringify({ receptionistName: "x" })), null);
  assert.equal(parseWizardDraft(`{"businessName":"${"x".repeat(201)}"}`), null);
  assert.equal(parseWizardDraft(`{"businessName":"Ok","prompt":"${"x".repeat(120001)}"}`), null);
});
