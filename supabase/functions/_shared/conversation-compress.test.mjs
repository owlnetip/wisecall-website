import { test } from "node:test";
import assert from "node:assert/strict";
import {
  assembleCompressedMessages,
  buildCompressionSummaryPrompt,
  buildSummarySystemContent,
  compressionStateToMetadata,
  normaliseCompressionState,
  planConversationCompression,
  withSummaryCoveringOlder,
  DEFAULT_COMPRESS_AFTER_MESSAGES,
  DEFAULT_RECENT_MESSAGE_COUNT,
} from "./conversation-compress.ts";

function turns(n) {
  return Array.from({ length: n }, (_, i) => ({
    role: i % 2 === 0 ? "user" : "assistant",
    content: `m${i + 1}`,
  }));
}

test("short threads stay uncompressed", () => {
  const history = turns(DEFAULT_COMPRESS_AFTER_MESSAGES);
  const plan = planConversationCompression(history);
  assert.equal(plan.compressed, false);
  assert.equal(plan.pendingOlder.length, 0);
  assert.equal(plan.messages.length, history.length);
  assert.equal(plan.messages[0].role, "user");
  assert.equal(plan.messages[1].role, "assistant");
});

test("long threads without a summary hard-cap and mark pending older", () => {
  const history = turns(20);
  const plan = planConversationCompression(history, { hardCapMessages: 18 });
  assert.equal(plan.compressed, true);
  assert.ok(plan.pendingOlder.length > 0);
  assert.equal(plan.messages.length, 18);
  assert.equal(plan.messages[0].content, "m3");
  assert.equal(plan.messages.at(-1).content, "m20");
});

test("existing summary + recent turns only, no pending when fully covered", () => {
  const history = turns(14);
  const existing = withSummaryCoveringOlder(14, DEFAULT_RECENT_MESSAGE_COUNT, "Visitor asked about parking.");
  const plan = planConversationCompression(history, { existing });
  assert.equal(plan.compressed, true);
  assert.equal(plan.pendingOlder.length, 0);
  assert.equal(plan.messages[0].role, "system");
  assert.ok(String(plan.messages[0].content).includes("Visitor asked about parking."));
  assert.equal(plan.messages.length, 1 + DEFAULT_RECENT_MESSAGE_COUNT);
  assert.equal(plan.messages[1].content, "m9");
  assert.equal(plan.messages.at(-1).content, "m14");
});

test("incremental pending older starts after previously summarised prefix", () => {
  const history = turns(16);
  const existing = {
    runningSummary: "Earlier: discussing a leak.",
    summarizedMessageCount: 6,
  };
  const plan = planConversationCompression(history, {
    existing,
    recentMessageCount: 6,
  });
  assert.equal(plan.compressed, true);
  // older = first 10; covered = 6 ⇒ pending = turns 7..10
  assert.deepEqual(
    plan.pendingOlder.map((t) => t.content),
    ["m7", "m8", "m9", "m10"],
  );
  assert.ok(plan.messages.some((m) => m.role === "system"));
});

test("assembleCompressedMessages builds summary system + recent window", () => {
  const history = turns(12);
  const { messages, state } = assembleCompressedMessages(history, "Summary text", 6);
  assert.equal(messages[0].role, "system");
  assert.ok(messages[0].content.includes("[CONVERSATION SO FAR]"));
  assert.equal(messages.length, 7);
  assert.equal(state.summarizedMessageCount, 6);
  assert.equal(state.runningSummary, "Summary text");
});

test("normaliseCompressionState reads snake_case metadata", () => {
  const state = normaliseCompressionState({
    running_summary: "Hello",
    summarized_message_count: 4,
  });
  assert.deepEqual(state, { runningSummary: "Hello", summarizedMessageCount: 4 });
  assert.equal(normaliseCompressionState({}), null);
  assert.equal(normaliseCompressionState({ running_summary: "" }), null);
});

test("compressionStateToMetadata writes snake_case fields", () => {
  const meta = compressionStateToMetadata({
    runningSummary: "Kept",
    summarizedMessageCount: 8,
  });
  assert.equal(meta.running_summary, "Kept");
  assert.equal(meta.summarized_message_count, 8);
  assert.ok(typeof meta.compression_updated_at === "string");
});

test("buildSummarySystemContent is empty for blank input", () => {
  assert.equal(buildSummarySystemContent("  "), "");
});

test("buildCompressionSummaryPrompt folds existing summary and new turns", () => {
  const { system, user } = buildCompressionSummaryPrompt("Prior summary.", [
    { role: "user", content: "I need a callback" },
    { role: "assistant", content: "What number works?" },
  ]);
  assert.ok(system.includes("running summary"));
  assert.ok(user.includes("Prior summary."));
  assert.ok(user.includes("Visitor: I need a callback"));
  assert.ok(user.includes("Assistant: What number works?"));
});
