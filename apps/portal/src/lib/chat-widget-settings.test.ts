import assert from "node:assert/strict";
import test from "node:test";
import { cleanChatAssistantName, cleanChatGreeting } from "./chat-widget-settings";

test("chat name keeps a normal first name", () => {
  assert.deepEqual(cleanChatAssistantName("  Betty "), { ok: true, value: "Betty" });
});

test("chat name rejects markup and numbers", () => {
  assert.equal(cleanChatAssistantName("Betty<script>").ok, false);
  assert.equal(cleanChatAssistantName("Betty 2").ok, false);
});

test("empty chat name is allowed so the agent name is used", () => {
  assert.deepEqual(cleanChatAssistantName("   "), { ok: true, value: "" });
});

test("opening line keeps the BetterMove sentence", () => {
  const line = "Hi, I'm Betty, Bettermove's AI Assistant. How can I help today?";
  assert.deepEqual(cleanChatGreeting(line), { ok: true, value: line });
});

test("opening line rejects tags and very long text", () => {
  assert.equal(cleanChatGreeting("Hello <b>there</b>").ok, false);
  assert.equal(cleanChatGreeting("Hi ".repeat(200)).ok, false);
});
