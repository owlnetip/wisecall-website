import assert from "node:assert/strict";
import { test } from "node:test";
import { finaliseCallAnalysis, type CallAnalysis } from "./call-analysis";
import { nextStepLabel } from "./conversation-email";

function blank(overrides: Partial<CallAnalysis>): CallAnalysis {
  return {
    sentiment: "neutral",
    sentiment_score: 50,
    caller_intent: "Locked out of the login system",
    intent_category: "Support",
    outcome: "resolved",
    conversion_type: "support",
    urgency_level: "high",
    complaint_detected: false,
    lead_detected: false,
    booking_detected: false,
    unanswered_questions: [],
    missed_opportunities: [],
    action_items: [],
    recommended_follow_up: "",
    short_manager_summary:
      "Priority: Urgent. Locked out of the login system, blocking all access. Callback promised as soon as possible.",
    tags: [],
    caller_name: "Zamia Khan Jamal Rashid",
    callback_phone: "",
    company: "Jamada Restrep",
    company_status: "unconfirmed",
    ...overrides,
  };
}

test("final analysis keeps a follow-up and the confirmed name for an urgent callback", () => {
  const analysis = finaliseCallAnalysis(
    blank({}),
    {
      summary: "Priority: Urgent. Callback promised as soon as possible.",
      transcript: [
        "Agent: Who am I speaking with?",
        "Caller: Zamia Khan and Jamal Rashid needs access too.",
        "Agent: Could you spell your name?",
        "Caller: Z-A-M-I-A K-H-A-N",
        "Agent: Which company are you calling from?",
        "Caller: J-A-M-A-D-A space R-E-S-T-R-E-P-O",
      ].join("\n"),
    },
  );
  assert.equal(analysis.caller_name, "Zamia Khan");
  assert.equal(analysis.company, "Jamada Restrepo");
  assert.equal(analysis.company_status, "unconfirmed");
  assert.equal(nextStepLabel(analysis.action_items), "1 follow-up needed");
  assert.notEqual(nextStepLabel(analysis.action_items), "No follow-up needed");
});

test("final analysis stores the confirmed spelled company, not the first hearing", () => {
  const analysis = finaliseCallAnalysis(blank({ company_status: "confirmed" }), {
    transcript: [
      "Agent: And which company are you calling from?",
      "Caller: Jamada Restrep",
      "Agent: Could you spell the company?",
      "Caller: J-A-M-A-D-A space R-E-S-T-R-E-P-O",
      "Agent: Jamada Restrepo. Is that right?",
      "Caller: Yes",
    ].join("\n"),
  });
  assert.equal(analysis.company, "Jamada Restrepo");
  assert.equal(analysis.company_status, "confirmed");
});
