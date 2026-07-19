import assert from "node:assert/strict";
import { test } from "node:test";
import { scheduleFollowUpAt } from "./outreach-email";

test("schedules day 3 on the calendar morning regardless of initial send time", () => {
  assert.equal(scheduleFollowUpAt("2026-07-16T20:30:00.000Z", 3), "2026-07-19T09:00:00.000Z");
  assert.equal(scheduleFollowUpAt("2026-07-16T08:15:00.000Z", 3), "2026-07-19T09:00:00.000Z");
});

test("handles month boundaries when scheduling follow-ups", () => {
  assert.equal(scheduleFollowUpAt("2026-07-29T14:00:00.000Z", 3), "2026-08-01T09:00:00.000Z");
});
