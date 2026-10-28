import assert from "node:assert/strict";
import { test } from "node:test";
import { isSmsThreadLog, SMS_THREAD_IDLE_MS, smsThreadIsIdle } from "./call-analysis";

test("only rows marked sms_thread are threads", () => {
  assert.equal(isSmsThreadLog({ metadata: { channel: "sms", sms_thread: true } }), true);
  assert.equal(isSmsThreadLog({ metadata: { channel: "sms" } }), false);
  assert.equal(isSmsThreadLog({ metadata: null }), false);
});

test("a thread is emailed once nobody has texted for the idle window", () => {
  const now = Date.parse("2026-10-28T15:00:00Z");
  const at = (ms: number) => ({ metadata: { sms_thread: true, last_message_at: new Date(now - ms).toISOString() } });
  assert.equal(smsThreadIsIdle(at(60_000), now), false);
  assert.equal(smsThreadIsIdle(at(SMS_THREAD_IDLE_MS), now), true);
  assert.equal(smsThreadIsIdle({ metadata: { sms_thread: true } }, now), false);
});
