import assert from "node:assert/strict";
import { test } from "node:test";
import { isLiveChatLog } from "./follow-ups-sync";

test("treats website chat logs as live chat so the lead email is not duplicated", () => {
  assert.equal(isLiveChatLog({ call_id: "chat_abc", metadata: {} }), true);
  assert.equal(
    isLiveChatLog({ call_id: "call-1", metadata: { source: "wisecall-live-chat" } }),
    true,
  );
  assert.equal(isLiveChatLog({ call_id: "call-1", metadata: { channel: "chat" } }), true);
  assert.equal(isLiveChatLog({ call_id: "call-1", metadata: {} }), false);
});
