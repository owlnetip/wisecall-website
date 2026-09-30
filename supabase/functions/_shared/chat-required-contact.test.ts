import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  contactDetailsCompleteNote,
  requiredContactHoldReply,
  requiredContactSatisfied,
} from "./chat-required-contact.ts";

const meta = { live_chat_required_contact: ["name", "email", "phone"] };

Deno.test("a greeting is not stopped for contact details", () => {
  const messages = [
    { role: "assistant", content: "Hi, how can I help today?" },
    { role: "user", content: "Hello" },
  ];
  assertEquals(requiredContactHoldReply(meta, {}, messages), null);
});

Deno.test("once they ask, name email and phone are required before an answer", () => {
  const messages = [
    { role: "assistant", content: "Hi, how can I help today?" },
    { role: "user", content: "I want to sell my house in Leeds" },
  ];
  const reply = requiredContactHoldReply(meta, {}, messages) || "";
  assertEquals(reply.includes("before I can go any further"), true);
  assertEquals(reply.includes("What's your name?"), true);
  assertEquals(reply.includes("phone number"), true);
  assertEquals(requiredContactSatisfied(meta, {}), false);
});

Deno.test("a skipped phone number is asked for again", () => {
  const messages = [
    { role: "user", content: "Can you value my house?" },
    {
      role: "assistant",
      content:
        "Thanks, I can help with that. I'll need your name, email address and phone number before I can go any further. What's your name?",
    },
    { role: "user", content: "Jane Smith" },
    {
      role: "assistant",
      content: "I still need your email address and phone number before I can go any further. What's your email address?",
    },
    { role: "user", content: "I'd rather not give a number, just email me" },
  ];
  const collected = { contact_name: "Jane Smith", contact_email: "jane@example.com" };
  const reply = requiredContactHoldReply(meta, collected, messages) || "";
  assertEquals(reply.includes("phone number"), true);
  assertEquals(reply.includes("What's the best phone number"), true);
  assertEquals(requiredContactSatisfied(meta, collected), false);
});

Deno.test("with name, email and phone the chat can continue", () => {
  const collected = {
    contact_name: "Jane Smith",
    contact_email: "jane@example.com",
    contact_phone: "07700900461",
  };
  const messages = [
    { role: "user", content: "I want to sell my house" },
    { role: "user", content: "07700900461" },
  ];
  assertEquals(requiredContactHoldReply(meta, collected, messages), null);
  assertEquals(requiredContactSatisfied(meta, collected), true);
  assertEquals((contactDetailsCompleteNote(meta, collected) || "").includes("not treat any of them as optional"), true);
});

Deno.test("agents without the setting are unchanged", () => {
  const messages = [{ role: "user", content: "I want to sell my house" }];
  assertEquals(requiredContactHoldReply({}, {}, messages), null);
  assertEquals(requiredContactSatisfied({}, {}), true);
});
