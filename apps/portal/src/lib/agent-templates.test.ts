import assert from "node:assert/strict";
import { test } from "node:test";
import {
  DEFAULT_TEMPLATE_ID,
  agentTemplateCategories,
  agentTemplates,
  findAgentTemplate,
  matchAgentTemplateId,
  templateUsesCalendarBooking,
} from "./agent-templates";
import { calendarBookingToolNames } from "./calendar-booking-template";

test("template ids are unique and every template belongs to a known category", () => {
  const ids = new Set<string>();
  const categories = new Set(agentTemplateCategories.map((c) => c.id));
  for (const template of agentTemplates) {
    assert.ok(!ids.has(template.id), `duplicate template id ${template.id}`);
    ids.add(template.id);
    assert.ok(
      categories.has(template.category),
      `${template.id} has unknown category ${template.category}`,
    );
  }
});

test("every category in the picker has at least one available template", () => {
  for (const category of agentTemplateCategories) {
    const inCategory = agentTemplates.filter((t) => t.category === category.id && t.available);
    assert.ok(inCategory.length > 0, `category ${category.id} would render empty`);
  }
});

test("templates are fully described so the picker never falls back", () => {
  for (const template of agentTemplates) {
    assert.ok(template.label.trim(), `${template.id} needs a label`);
    assert.ok(template.description.trim(), `${template.id} needs a description`);
    assert.ok(template.icon.trim(), `${template.id} needs an icon name`);
    assert.ok(template.chips.length >= 2, `${template.id} needs capability chips`);
  }
});

test("prompts and greetings name the business and the assistant", () => {
  for (const template of agentTemplates) {
    const prompt = template.buildPrompt("Northwind Ltd", "Northwind assistant");
    const greeting = template.buildGreeting("Northwind Ltd", "Northwind assistant");
    assert.ok(prompt.includes("Northwind"), `${template.id} prompt drops the business name`);
    assert.ok(prompt.length > 400, `${template.id} prompt looks too thin`);
    assert.ok(greeting.includes("Northwind Ltd"), `${template.id} greeting drops the business name`);
    // Time-of-day greetings are wrong on a line answered at any hour.
    assert.doesNotMatch(greeting, /good (morning|afternoon|evening)/i);
  }
});

test("every prompt carries the shared caller-intake instructions", () => {
  for (const template of agentTemplates) {
    const prompt = template.buildPrompt("Northwind Ltd", "Northwind assistant");
    assert.match(prompt, /CALLER DETAILS/, `${template.id} is missing caller intake`);
  }
});

test("booking templates explain the diary tools they are wired with", () => {
  const booking = agentTemplates.filter((t) => t.usesCalendarBooking);
  assert.ok(booking.length >= 5, "expected a decent spread of diary-booking templates");
  for (const template of booking) {
    const prompt = template.buildPrompt("Northwind Ltd", "Northwind assistant");
    for (const tool of calendarBookingToolNames) {
      assert.match(prompt, new RegExp(tool), `${template.id} prompt never mentions ${tool}`);
    }
    assert.match(prompt, /Never invent, hold or promise a slot/);
  }
});

test("non-booking templates do not promise live diary access", () => {
  for (const template of agentTemplates) {
    if (template.usesCalendarBooking) continue;
    const prompt = template.buildPrompt("Northwind Ltd", "Northwind assistant");
    assert.doesNotMatch(
      prompt,
      /check_availability/,
      `${template.id} references a tool it is not wired with`,
    );
  }
});

test("regulated verticals keep advice out of the agent's hands", () => {
  const guardrails: [string, RegExp][] = [
    ["legal", /Never give legal advice/],
    ["clinic", /Never give clinical advice/],
    ["accountant", /Never give tax, accounting or financial advice/],
    ["veterinary", /Never give veterinary advice/],
    ["insurance", /Never advise on which cover to buy/],
    ["care_home", /Never give clinical, medication, financial or legal advice/],
    ["education", /Never discuss a pupil/],
  ];
  for (const [id, pattern] of guardrails) {
    const template = findAgentTemplate(id);
    assert.ok(template, `${id} template is missing`);
    assert.match(template!.buildPrompt("Northwind Ltd", "Northwind assistant"), pattern);
  }
});

test("website scan matching prefers the specialised vertical", () => {
  const cases: [string, string, string][] = [
    ["Dental practice", "book an appointment with our hygienist", "dentally"],
    ["Estate agent", "lettings and property management in Leeds", "estate_agent"],
    ["Veterinary surgery", "vets and animal hospital", "veterinary"],
    ["Care home", "residential care and respite care", "care_home"],
    ["Physiotherapy clinic", "physio appointments", "clinic"],
    ["Plumbing", "emergency plumber and boiler repairs", "trades"],
    ["Hair salon", "hairdressers in Bristol, book an appointment", "salon"],
    ["Garage", "MOT and car service bookings", "garage"],
    ["Solicitors", "conveyancing and family law", "legal"],
    ["Restaurant", "bistro and wine bar, book a table", "restaurant"],
    ["Consultancy", "we help b2b teams", "lead_qualifier"],
    // No vertical signal, but they clearly take appointments.
    ["Wellbeing studio", "book a consultation with us online", "booking"],
    ["Widget maker", "we make widgets", DEFAULT_TEMPLATE_ID],
  ];
  for (const [industry, context, expected] of cases) {
    assert.equal(
      matchAgentTemplateId(industry, context),
      expected,
      `"${industry}" should match ${expected}`,
    );
  }
});

test("matching only ever returns an available template id", () => {
  const available = new Set(agentTemplates.filter((t) => t.available).map((t) => t.id));
  const id = matchAgentTemplateId("Dental practice", "hygienist");
  assert.ok(available.has(id));
  assert.ok(available.has(matchAgentTemplateId("", "")));
});

test("templateUsesCalendarBooking is safe with unknown ids", () => {
  assert.equal(templateUsesCalendarBooking("booking"), true);
  assert.equal(templateUsesCalendarBooking("receptionist"), false);
  assert.equal(templateUsesCalendarBooking("nope"), false);
  assert.equal(templateUsesCalendarBooking(null), false);
});

test("seeded contacts and knowledge are usable as-is", () => {
  for (const template of agentTemplates) {
    for (const contact of template.defaultContacts?.() ?? []) {
      assert.ok(contact.id, `${template.id} seeded a contact without an id`);
      assert.ok(contact.name.trim(), `${template.id} seeded a nameless contact`);
      assert.ok(contact.keywords.length > 0, `${template.id} seeded a contact with no keywords`);
      // Seeded contacts are placeholders the customer fills in, so they must
      // either notify the shared inbox or be an explicit transfer target.
      assert.ok(contact.notify || contact.transfer, `${template.id} seeded an inert contact`);
    }
  }
});
