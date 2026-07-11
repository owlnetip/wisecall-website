import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normaliseTopic,
  stripLearnedBlock,
  buildLearnedBlock,
  composeBusinessContext,
  resolveClusters,
  LEARNED_START,
  LEARNED_END,
  MAX_LEARNED_LINES,
} from "./agent-memory.ts";

const entry = (o) => ({
  id: o.id ?? "x",
  profileId: "p",
  topic: o.topic ?? "Topic",
  questionExamples: o.questionExamples ?? [],
  handling: o.handling ?? null,
  answer: o.answer ?? null,
  status: o.status ?? "active",
  distinctCalls: o.distinctCalls ?? 2,
  timesSeen: o.timesSeen ?? 2,
  lastSeenAt: o.lastSeenAt ?? "2026-07-01T00:00:00.000Z",
});

test("normaliseTopic collapses whitespace and caps length", () => {
  assert.equal(normaliseTopic("  Upcoming   fixtures\n& prices "), "Upcoming fixtures & prices");
});

test("stripLearnedBlock removes a synced block, leaving owner knowledge", () => {
  const owner = "We are open Mon-Fri.";
  const composed = `${owner}\n\n${LEARNED_START}\n• do X\n${LEARNED_END}`;
  assert.equal(stripLearnedBlock(composed), owner);
});

test("stripLearnedBlock is a no-op when no block present", () => {
  assert.equal(stripLearnedBlock("just owner knowledge"), "just owner knowledge");
});

test("composeBusinessContext is idempotent (no append-forever)", () => {
  const owner = "Owner knowledge.";
  const once = composeBusinessContext(owner, "• handle X");
  const twice = composeBusinessContext(once, "• handle X");
  assert.equal(once, twice);
  // and only one block exists
  assert.equal(twice.split(LEARNED_START).length - 1, 1);
});

test("composeBusinessContext swaps the block when learned content changes", () => {
  const owner = "Owner knowledge.";
  const a = composeBusinessContext(owner, "• handle X");
  const b = composeBusinessContext(a, "• handle Y");
  assert.ok(b.includes("• handle Y"));
  assert.ok(!b.includes("• handle X"));
  assert.equal(stripLearnedBlock(b), owner);
});

test("composeBusinessContext with empty block returns just owner knowledge", () => {
  const owner = "Owner knowledge.";
  const a = composeBusinessContext(owner, "• handle X");
  assert.equal(composeBusinessContext(a, ""), owner);
});

test("buildLearnedBlock: answered → Q/A knowledge, active → handling line", () => {
  const block = buildLearnedBlock([
    entry({ topic: "Parking", status: "answered", answer: "Free parking on-site." }),
    entry({ topic: "Fixtures", status: "active", handling: "Take a message; never guess dates." }),
  ]);
  assert.ok(block.includes("Parking: Free parking on-site."));
  assert.ok(block.includes("Take a message; never guess dates."));
});

test("buildLearnedBlock: answered entries rank above active ones", () => {
  const block = buildLearnedBlock([
    entry({ topic: "A-active", status: "active", handling: "handle A", lastSeenAt: "2030-01-01T00:00:00Z" }),
    entry({ topic: "B-answered", status: "answered", answer: "answer B", lastSeenAt: "2000-01-01T00:00:00Z" }),
  ]);
  assert.ok(block.indexOf("answer B") < block.indexOf("handle A"));
});

test("buildLearnedBlock caps the number of lines", () => {
  const many = Array.from({ length: 40 }, (_, i) =>
    entry({ id: `e${i}`, topic: `T${i}`, status: "active", handling: `handle ${i}` }),
  );
  const block = buildLearnedBlock(many);
  assert.equal(block.split("\n").length, MAX_LEARNED_LINES);
});

test("buildLearnedBlock skips answered without answer and active without handling", () => {
  const block = buildLearnedBlock([
    entry({ topic: "NoAnswer", status: "answered", answer: "" }),
    entry({ topic: "NoHandling", status: "active", handling: null }),
  ]);
  assert.equal(block, "");
});

test("resolveClusters maps source indices to distinct call IDs", () => {
  const inputs = [
    { callId: "c1", question: "next fixture?" },
    { callId: "c1", question: "next home game?" },
    { callId: "c2", question: "next match?" },
    { callId: "c3", question: "ticket price?" },
  ];
  const clusters = resolveClusters(inputs, [
    { topic: "Fixtures", examples: ["next fixture?"], handling: "take a message", source_indices: [0, 1, 2] },
    { topic: "Tickets", examples: ["ticket price?"], handling: "point to website", source_indices: [3] },
  ]);
  assert.equal(clusters.length, 2);
  const fixtures = clusters.find((c) => c.topic === "Fixtures");
  // indices 0,1 share call c1 → 2 distinct calls (c1, c2)
  assert.deepEqual(fixtures.callIds.sort(), ["c1", "c2"]);
});

test("resolveClusters drops groups with no topic or no handling", () => {
  const inputs = [{ callId: "c1", question: "q" }];
  const clusters = resolveClusters(inputs, [
    { topic: "", handling: "x", source_indices: [0] },
    { topic: "T", handling: "", source_indices: [0] },
    { topic: "Good", handling: "take a message", source_indices: [0] },
  ]);
  assert.equal(clusters.length, 1);
  assert.equal(clusters[0].topic, "Good");
});
