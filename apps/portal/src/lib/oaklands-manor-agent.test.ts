import assert from "node:assert/strict";
import { test } from "node:test";
import { findAgentTemplate, matchAgentTemplateId } from "./agent-templates";
import {
  OAKLANDS_MANOR_BUSINESS,
  OAKLANDS_MANOR_RECEPTIONIST,
  buildOaklandsManorGreeting,
  buildOaklandsManorPrompt,
  oaklandsManorContacts,
  oaklandsManorTransferRoutes,
} from "./oaklands-manor-agent";

test("Anne's greeting is the Oaklands Manor opening line", () => {
  const greeting = buildOaklandsManorGreeting();
  assert.match(greeting, /Thank you for calling Oaklands Manor Nursing Home/);
  assert.match(greeting, /I'm Anne, and I'm here to help/);
  assert.match(greeting, /general enquiries, visiting information, admissions/);
  assert.doesNotMatch(greeting, /good (morning|afternoon|evening)/i);
});

test("the call plan names the business, Anne, and the three units", () => {
  const prompt = buildOaklandsManorPrompt();
  assert.ok(prompt.includes(OAKLANDS_MANOR_BUSINESS));
  assert.ok(prompt.includes(OAKLANDS_MANOR_RECEPTIONIST));
  assert.match(prompt, /one question at a time/i);
  assert.match(prompt, /two seconds/);
  assert.match(prompt, /Autumn/);
  assert.match(prompt, /Summer/);
  assert.match(prompt, /Spring/);
  assert.match(prompt, /5202/);
  assert.match(prompt, /5201/);
  assert.match(prompt, /3336/);
  assert.match(prompt, /5204/);
  assert.match(prompt, /5205/);
  assert.match(prompt, /5206/);
  assert.match(prompt, /CQC/);
  assert.match(prompt, /Peacock Bed Enquiry/);
  assert.match(prompt, /do not have a resident directory/i);
  assert.match(prompt, /Never give clinical, medication, financial or legal advice/);
  assert.doesNotMatch(prompt, /check_availability/);
});

test("manager calls about supplies go to Peacock, not the home manager", () => {
  const prompt = buildOaklandsManorPrompt();
  assert.match(prompt, /agency staffing, recruitment, supplies, training, orders or energy contracts/);
  assert.match(prompt, /Transfer to Peacock Bed Enquiry/);
});

test("extensions are stored as internal transfer targets", () => {
  const contacts = oaklandsManorContacts();
  const byName = Object.fromEntries(contacts.map((contact) => [contact.name, contact]));
  assert.equal(byName["Home Manager"].phone, "5202");
  assert.equal(byName["Quality Manager"].phone, "5201");
  assert.equal(byName["Peacock Bed Enquiry"].phone, "3336");
  assert.equal(byName["Autumn Nurse"].phone, "5204");
  assert.equal(byName["Summer Nurse"].phone, "5205");
  assert.equal(byName["Spring Nurse"].phone, "5206");
  for (const contact of contacts) {
    assert.equal(contact.transfer, true);
    assert.equal(contact.notify, true);
    assert.ok(contact.keywords.length > 0);
  }

  const routes = oaklandsManorTransferRoutes();
  assert.equal(routes.home_manager.phone, "5202");
  assert.equal(routes.quality_manager.phone, "5201");
  assert.equal(routes.peacock_bed_enquiry.phone, "3336");
  assert.equal(routes.autumn_nurse.timeout_secs, 25);
});

test("a generic care home still uses the care home template", () => {
  assert.equal(
    matchAgentTemplateId("Care home", "residential care and respite care"),
    "care_home",
  );
  const care = findAgentTemplate("care_home");
  assert.ok(care);
  const generic = care!.buildPrompt("Northwind Ltd", "Northwind assistant");
  assert.doesNotMatch(generic, /Autumn/);
  assert.doesNotMatch(generic, /5202/);
  assert.match(generic, /show-around|show around/i);
});

test("naming Oaklands in a scan does not rewrite the shared care home template", () => {
  const care = findAgentTemplate("care_home");
  assert.ok(care);
  assert.doesNotMatch(care!.buildGreeting("Oaklands Manor", "Sam"), /I'm Anne/);
});
