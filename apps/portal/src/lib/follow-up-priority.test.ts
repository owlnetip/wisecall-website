import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CallAnalysis } from "@/lib/call-analysis";
import {
  classifyFollowUp,
  isEffectivelyOpen,
  sortFollowUpsByPriority,
} from "@/lib/follow-up-priority";

function analysis(partial: Partial<CallAnalysis>): CallAnalysis {
  return {
    sentiment: "neutral",
    sentiment_score: 50,
    caller_intent: "Asking about pricing",
    intent_category: "Pricing",
    outcome: "callback_required",
    conversion_type: "none",
    urgency_level: "low",
    complaint_detected: false,
    lead_detected: false,
    booking_detected: false,
    unanswered_questions: [],
    missed_opportunities: [],
    action_items: ["Call back"],
    recommended_follow_up: "Call back",
    short_manager_summary: "Caller wants a callback",
    tags: [],
    caller_name: "Sam",
    callback_phone: "",
    company: "",
    ...partial,
  };
}

describe("classifyFollowUp", () => {
  it("marks complaints as critical", () => {
    const result = classifyFollowUp(
      analysis({ complaint_detected: true, conversion_type: "complaint" }),
    );
    assert.equal(result.priority, "critical");
    assert.equal(result.category, "complaint");
  });

  it("marks leads as high", () => {
    const result = classifyFollowUp(
      analysis({ lead_detected: true, conversion_type: "lead" }),
    );
    assert.equal(result.priority, "high");
    assert.equal(result.category, "lead");
  });

  it("marks sales as high", () => {
    const result = classifyFollowUp(analysis({ conversion_type: "sales" }));
    assert.equal(result.priority, "high");
    assert.equal(result.category, "sales");
  });
});

describe("sortFollowUpsByPriority", () => {
  it("keeps critical and high above admin", () => {
    const sorted = sortFollowUpsByPriority([
      { priority: "low", createdAt: "2026-07-01T10:00:00Z" },
      { priority: "critical", createdAt: "2026-07-01T09:00:00Z" },
      { priority: "normal", createdAt: "2026-07-01T11:00:00Z" },
      { priority: "high", createdAt: "2026-07-01T08:00:00Z" },
    ]);
    assert.deepEqual(
      sorted.map((item) => item.priority),
      ["critical", "high", "normal", "low"],
    );
  });
});

describe("isEffectivelyOpen", () => {
  it("treats expired snooze as open", () => {
    assert.equal(
      isEffectivelyOpen({
        status: "snoozed",
        snoozedUntil: new Date(Date.now() - 1000).toISOString(),
      }),
      true,
    );
    assert.equal(
      isEffectivelyOpen({
        status: "snoozed",
        snoozedUntil: new Date(Date.now() + 60_000).toISOString(),
      }),
      false,
    );
  });
});
