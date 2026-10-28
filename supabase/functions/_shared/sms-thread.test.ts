import { assertEquals, assertStringIncludes } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { appendTurn, isOpenThread, SMS_THREAD_IDLE_MS, threadsEnabled, threadUserMessage } from "./sms-thread.ts";

Deno.test("threads are opt-in per agent", () => {
  assertEquals(threadsEnabled({ sms_conversation_threads: true }), true);
  assertEquals(threadsEnabled({}), false);
  assertEquals(threadsEnabled(null), false);
});

Deno.test("a thread closes once emailed or quiet", () => {
  const now = Date.parse("2026-10-28T15:00:00Z");
  const recent = { last_message_at: new Date(now - 60_000).toISOString() };
  assertEquals(isOpenThread({ metadata: recent }, now), true);
  assertEquals(isOpenThread({ metadata: recent, analysed_at: "2026-10-28T14:59:30Z" }, now), false);
  const stale = { last_message_at: new Date(now - SMS_THREAD_IDLE_MS).toISOString() };
  assertEquals(isOpenThread({ metadata: stale }, now), false);
  assertEquals(isOpenThread({ metadata: {} }, now), false);
});

Deno.test("turns append in transcript order", () => {
  const first = appendTurn("", "I'm off sick", "Sorry to hear that. What's your name?");
  assertEquals(first, "user: I'm off sick\nassistant: Sorry to hear that. What's your name?");
  assertEquals(appendTurn(first, "Jo", "Which home?").split("\n").length, 4);
});

Deno.test("the reply prompt carries the history", () => {
  assertEquals(threadUserMessage("+447700900123", "", "hi"), "The customer (+447700900123) sent an SMS:\n\nhi");
  const msg = threadUserMessage("+447700900123", "user: off sick\nassistant: Your name?", "Jo Bloggs");
  assertStringIncludes(msg, "assistant: Your name?");
  assertStringIncludes(msg, "Jo Bloggs");
});
