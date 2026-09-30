import assert from "node:assert/strict";
import { test } from "node:test";
import { isLiveChatLog, liveChatRequiredContactMissing } from "./follow-ups-sync";

test("treats website chat logs as live chat so the lead email is not duplicated", () => {
  assert.equal(isLiveChatLog({ call_id: "chat_abc", metadata: {} }), true);
  assert.equal(
    isLiveChatLog({ call_id: "call-1", metadata: { source: "wisecall-live-chat" } }),
    true,
  );
  assert.equal(isLiveChatLog({ call_id: "call-1", metadata: { channel: "chat" } }), true);
  assert.equal(isLiveChatLog({ call_id: "call-1", metadata: {} }), false);
});

test("a chat with a required phone still missing is not ready to hand on", () => {
  const profile = { live_chat_required_contact: ["name", "email", "phone"] };
  assert.equal(
    liveChatRequiredContactMissing(profile, {
      collected: { contact_name: "Jane Smith", contact_email: "jane@example.com" },
    }),
    true,
  );
  assert.equal(
    liveChatRequiredContactMissing(profile, {
      collected: {
        contact_name: "Jane Smith",
        contact_email: "jane@example.com",
        contact_phone: "07700900461",
      },
    }),
    false,
  );
  assert.equal(liveChatRequiredContactMissing({}, { collected: {} }), false);
});
