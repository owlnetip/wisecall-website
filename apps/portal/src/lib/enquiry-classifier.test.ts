import assert from "node:assert/strict";
import { test } from "node:test";
import { buildClassifierPrompt, classifyEnquiry, parseCategories, pickCategory } from "./enquiry-classifier";

const categories = parseCategories({
  chat_enquiry_categories: [
    { key: "viewing", label: "Viewing request", description: "Wants to book a viewing" },
    { key: "offers", label: "Offer", description: "Making an offer" },
    { key: "general", label: "General enquiry", description: "Anything else" },
    { key: "BAD KEY", label: "x" },
  ],
});

test("categories are parsed and invalid keys dropped", () => {
  assert.deepEqual(categories.map((c) => c.key), ["viewing", "offers", "general"]);
});

test("prompt lists categories and the chat", () => {
  const prompt = buildClassifierPrompt("Visitor: can I see the house on Friday?", categories);
  assert.match(prompt, /- viewing: Wants to book a viewing/);
  assert.match(prompt, /can I see the house on Friday/);
});

test("reply is matched to a known key only", () => {
  assert.equal(pickCategory("viewing", categories), "viewing");
  assert.equal(pickCategory(" Offers.", categories), "offers");
  assert.equal(pickCategory("sales_progression", categories), null);
});

test("classifyEnquiry uses the model reply", async () => {
  assert.equal(await classifyEnquiry("Visitor: I'd like to offer 250k on Wesley Street", categories, async () => "offers"), "offers");
  assert.equal(await classifyEnquiry("hi", categories, async () => "offers"), null); // too short
});
