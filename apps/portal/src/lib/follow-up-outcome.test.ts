import assert from "node:assert/strict";
import { test } from "node:test";
import { nextStepLabel } from "./conversation-email";
import {
  CALLBACK_FOLLOW_UP,
  URGENT_FOLLOW_UP,
  callbackPromisedOrRequested,
  ensureFollowUpActions,
} from "./follow-up-outcome";

test("urgent call with no explicit callback still needs a follow-up", () => {
  const items = ensureFollowUpActions({
    actionItems: [],
    urgency: "high",
    summary: "Locked out of the login system. Blocking all access.",
    transcript: "Caller: I cannot log in at all.",
    recommendedFollowUp: "",
    outcome: "resolved",
  });
  assert.deepEqual(items, [URGENT_FOLLOW_UP]);
  assert.equal(nextStepLabel(items), "1 follow-up needed");
  assert.notEqual(nextStepLabel(items), "No follow-up needed");
});

test("callback promised at normal priority still needs a follow-up", () => {
  const items = ensureFollowUpActions({
    actionItems: [],
    urgency: "low",
    summary: "Callback promised as soon as possible.",
    transcript: "Agent: I'll have someone call you back as soon as possible.",
    outcome: "completed",
  });
  assert.deepEqual(items, [CALLBACK_FOLLOW_UP]);
  assert.equal(nextStepLabel(items), "1 follow-up needed");
});

test("a genuine resolved call stays no follow-up needed", () => {
  const transcript = [
    "Agent: Is that the best number to call you back on?",
    "Caller: Yes.",
    "Agent: We're open 9 until 5.",
    "Caller: Thanks, that's all I needed.",
  ].join("\n");
  const items = ensureFollowUpActions({
    actionItems: [],
    urgency: "low",
    summary: "Asked for Saturday opening hours and was told 9am to 1pm. Resolved on the call.",
    transcript,
    recommendedFollowUp: "",
    outcome: "resolved",
  });
  assert.deepEqual(items, []);
  assert.equal(nextStepLabel(items), "No follow-up needed");
  assert.equal(callbackPromisedOrRequested(transcript), false);
});

test("priority written on the summary card counts as urgent", () => {
  const items = ensureFollowUpActions({
    actionItems: [],
    urgency: "low",
    summary: "Priority: Urgent. Issue: locked out of the login system, blocking all access.",
  });
  assert.deepEqual(items, [URGENT_FOLLOW_UP]);
});

test("does not treat a refused callback or the caller-id check as a promise", () => {
  assert.equal(
    callbackPromisedOrRequested("No callback needed. Don't call me back."),
    false,
  );
  assert.equal(
    callbackPromisedOrRequested("Is that the best number to call you back on? The callback number is 07700900123."),
    false,
  );
});

test("keeps concrete action items the model already returned", () => {
  const items = ensureFollowUpActions({
    actionItems: ["Reset the login and call Zamia back"],
    urgency: "high",
    summary: "Callback promised as soon as possible.",
  });
  assert.deepEqual(items, ["Reset the login and call Zamia back"]);
});
