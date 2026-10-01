import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractPropertyAddress,
  hasPostcode,
  requiredContactHoldReply,
  requiredContactNote,
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
  // One friendly question, not a list of demands (1 Oct: a visitor left after that).
  assertEquals(reply, "Happy to help with that. Can I take your name first?");
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
  const note = requiredContactNote(meta, collected, messages) || "";
  assertEquals(note.includes("Do not ask for those details again"), true);
  assertEquals(note.includes('"I want to sell my house"'), true);
});

Deno.test("agents without the setting are unchanged", () => {
  const messages = [{ role: "user", content: "I want to sell my house" }];
  assertEquals(requiredContactHoldReply({}, {}, messages), null);
  assertEquals(requiredContactSatisfied({}, {}), true);
});

Deno.test("a detail that didn't register is not asked with the same line twice", () => {
  // 30 Sep: "Micheleaponton @gmail.com" wasn't parsed and the chat looped.
  const messages = [
    { role: "user", content: "Please call back call was disconnected" },
    {
      role: "assistant",
      content:
        "Thanks, I can help with that. I'll need your name, email address and phone number before I can go any further. What's your name?",
    },
    { role: "user", content: "Michele" },
    {
      role: "assistant",
      content: "Thanks. I'll just need your email address and phone number before I can go any further. What's your email address?",
    },
    { role: "user", content: "something odd" },
  ];
  const collected = { contact_name: "Michele" };
  assertEquals(requiredContactHoldReply(meta, collected, messages), null);
  const note = requiredContactNote(meta, collected, messages) || "";
  assertEquals(note.includes("Still missing: their email address and phone number"), true);
  assertEquals(note.includes("Please call back call was disconnected"), true);
});

Deno.test("details are asked one at a time, using their name", () => {
  const first = [{ role: "user", content: "How does selling to you work?" }];
  assertEquals(requiredContactHoldReply(meta, {}, first), "Happy to help with that. Can I take your name first?");
  const second = [
    ...first,
    { role: "assistant", content: "Happy to help with that. Can I take your name first?" },
    { role: "user", content: "Jane Smith" },
  ];
  assertEquals(
    requiredContactHoldReply(meta, { contact_name: "Jane Smith" }, second),
    "Thanks, Jane. What's the best email address for you?",
  );
  const third = [
    ...second,
    { role: "assistant", content: "Thanks, Jane. What's the best email address for you?" },
    { role: "user", content: "jane@example.com" },
  ];
  assertEquals(
    requiredContactHoldReply(meta, { contact_name: "Jane Smith", contact_email: "jane@example.com" }, third),
    "Thanks, Jane. What's the best phone number to reach you on?",
  );
});

Deno.test("a visitor who gives their name up front is asked for the email straight away", () => {
  const messages = [{ role: "user", content: "Hi I'm Tom and I want to sell my flat" }];
  assertEquals(
    requiredContactHoldReply(meta, { contact_name: "Tom" }, messages),
    "Happy to help with that. What's the best email address for you?",
  );
});

const sellerMeta = { live_chat_required_contact: ["name", "email", "phone", "seller_address"] };
const details = { contact_name: "Jane Smith", contact_email: "jane@example.com", contact_phone: "07700900461" };

Deno.test("sellers are asked for the property address after their contact details", () => {
  const messages = [{ role: "user", content: "I want to sell my house" }];
  assertEquals(
    requiredContactHoldReply(sellerMeta, { ...details, enquiry_type: "seller" }, messages),
    "Happy to help with that. What's the address of the property you're selling, including the postcode?",
  );
  assertEquals(requiredContactSatisfied(sellerMeta, { ...details, enquiry_type: "seller" }), false);
  assertEquals(
    requiredContactSatisfied(sellerMeta, { ...details, enquiry_type: "seller", property_address: "30 Orchard Gardens, Hereford HR1 1AA" }),
    true,
  );
});

Deno.test("buyers and general enquiries are not asked for a property address", () => {
  const messages = [{ role: "user", content: "Do you have 3 bed houses in Leeds?" }];
  assertEquals(requiredContactHoldReply(sellerMeta, { ...details, enquiry_type: "buyer" }, messages), null);
  assertEquals(requiredContactSatisfied(sellerMeta, { ...details, enquiry_type: "general" }), true);
});

Deno.test("the address is taken from the reply to the question, or any postcode", () => {
  const asked = "Thanks, Jane. What's the address of the property you're selling, including the postcode?";
  assertEquals(extractPropertyAddress("30 Orchard Gardens Hereford", asked), "30 Orchard Gardens Hereford");
  assertEquals(extractPropertyAddress("95 canonbury road en1 3 LP", ""), "95 canonbury road en1 3 LP");
  assertEquals(extractPropertyAddress("yes", asked), undefined);
  assertEquals(extractPropertyAddress("I'd rather talk to someone first", asked), undefined);
  assertEquals(extractPropertyAddress("I want to sell my house", ""), undefined);
});

Deno.test("an address without a postcode gets one follow-up for it", () => {
  const collected = { ...details, enquiry_type: "seller", property_address: "30 Orchard Gardens Hereford" };
  const note = requiredContactNote(sellerMeta, collected, [{ role: "user", content: "I want to sell my house" }]) || "";
  assertEquals(note.includes("has no postcode"), true);
  const withPostcode = { ...collected, property_address: "30 Orchard Gardens, Hereford HR1 1AA" };
  const ok = requiredContactNote(sellerMeta, withPostcode, [{ role: "user", content: "I want to sell my house" }]) || "";
  assertEquals(ok.includes("has no postcode"), false);
});

Deno.test("postcodes are recognised, including stray spaces, without false hits", () => {
  for (const ok of ["HR1 1AA", "LS10 2AB", "en1 3 LP", "SW1A1AA", "M1 1AE"]) assertEquals(hasPostcode(ok), true, ok);
  for (const no of ["3 bed house", "£150,000", "07700900461", "I want to sell"]) assertEquals(hasPostcode(no), false, no);
});
