import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDigestCounts,
  defaultNegotiatorRules,
  formatNegotiatorRulesForPrompt,
  normaliseNegotiatorRules,
  weekendDigestWindow,
  type EnquiryRow,
} from "./digital-negotiator";

test("normaliseNegotiatorRules fills defaults", () => {
  const rules = normaliseNegotiatorRules({});
  assert.equal(rules.qualificationRequired, true);
  assert.ok(rules.requiredFields.includes("budget"));
  assert.equal(rules.outOfHoursMode, "full");
});

test("formatNegotiatorRulesForPrompt mentions log_enquiry and escalate", () => {
  const text = formatNegotiatorRulesForPrompt(defaultNegotiatorRules());
  assert.match(text, /log_enquiry/);
  assert.match(text, /DIGITAL NEGOTIATOR/);
  assert.match(text, /offer/i);
});

test("weekendDigestWindow returns Friday→Monday span", () => {
  // A Wednesday in July 2026 → previous weekend
  const wed = new Date("2026-07-29T12:00:00.000Z");
  const win = weekendDigestWindow(wed, "Europe/London");
  assert.ok(win.from.getTime() < win.to.getTime());
  assert.ok(win.to.getTime() - win.from.getTime() > 48 * 3600 * 1000);
  assert.ok(win.label.length > 0);
});

test("buildDigestCounts aggregates viewings and enquiries", () => {
  const from = new Date("2026-07-24T17:00:00.000Z");
  const to = new Date("2026-07-27T08:00:00.000Z");
  const enquiries: EnquiryRow[] = [
    {
      id: "1",
      profile_id: "p",
      contact_id: null,
      property_id: null,
      viewing_id: null,
      call_log_id: null,
      party_role: "buyer",
      status: "qualified",
      contact_name: "Alex",
      contact_phone: "+447700900123",
      contact_email: null,
      budget_min: null,
      budget_max: 350000,
      budget_text: "£350k",
      areas: ["Headingley"],
      beds_min: 3,
      property_types: [],
      move_timeline: "2 months",
      financing: "mortgage agreed",
      has_property_to_sell: false,
      chain_position: null,
      listing_interest: null,
      listing_ref: null,
      summary: "Looking in Headingley",
      needs_human: false,
      human_reason: null,
      source: "phone",
      created_at: "2026-07-25T20:00:00.000Z",
      updated_at: "2026-07-25T20:00:00.000Z",
    },
    {
      id: "2",
      profile_id: "p",
      contact_id: null,
      property_id: null,
      viewing_id: null,
      call_log_id: null,
      party_role: "vendor",
      status: "new",
      contact_name: "Sam",
      contact_phone: "+447700900999",
      contact_email: null,
      budget_min: null,
      budget_max: null,
      budget_text: null,
      areas: [],
      beds_min: null,
      property_types: [],
      move_timeline: null,
      financing: null,
      has_property_to_sell: true,
      chain_position: null,
      listing_interest: null,
      listing_ref: null,
      summary: "Wants valuation",
      needs_human: true,
      human_reason: "Wants fee discussion",
      source: "phone",
      created_at: "2026-07-26T10:00:00.000Z",
      updated_at: "2026-07-26T10:00:00.000Z",
    },
  ];
  const digest = buildDigestCounts({
    viewings: [
      { status: "confirmed", created_at: "2026-07-25T19:00:00.000Z" },
      { status: "pending_owner", created_at: "2026-07-26T11:00:00.000Z" },
      { status: "confirmed", created_at: "2026-07-20T11:00:00.000Z" },
    ],
    enquiries,
    from,
    to,
    label: "Last weekend",
  });
  assert.equal(digest.viewersBooked, 1);
  assert.equal(digest.pendingOwner, 1);
  assert.equal(digest.valuations, 1);
  assert.equal(digest.qualifiedBuyers, 1);
  assert.equal(digest.needsHuman, 1);
});
