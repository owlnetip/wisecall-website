import assert from "node:assert/strict";
import { test } from "node:test";
import { enquiryRoutingMetadata, readEnquiryRouting } from "./enquiry-routing";

const metadata = {
  chat_enquiry_categories: [
    { key: "seller", label: "Vendor / seller enquiry", description: "Wants to sell" },
    { key: "general", label: "General enquiry", description: "Anything else" },
  ],
  chat_enquiry_routing: { seller: ["nick@example.com", "rory@example.com"], general: ["hello@example.com"], buyer: "a@example.com, b@example.com" },
};

test("reads categories with their inboxes, plus routing-only types", () => {
  const routes = readEnquiryRouting(metadata);
  assert.deepEqual(routes.map((r) => [r.key, r.emails]), [
    ["seller", ["nick@example.com", "rory@example.com"]],
    ["general", ["hello@example.com"]],
    ["buyer", ["a@example.com", "b@example.com"]],
  ]);
});

test("round-trips existing keys so the classifier and email routing still match", () => {
  const built = enquiryRoutingMetadata(readEnquiryRouting(metadata));
  assert.ok(built.ok);
  assert.deepEqual(built.value.chat_enquiry_routing.seller, ["nick@example.com", "rory@example.com"]);
  assert.equal(built.value.chat_enquiry_categories[0].key, "seller");
});

test("new types get a key from their name; bad input is refused", () => {
  const built = enquiryRoutingMetadata([{ key: "", label: "Lettings enquiry", description: "", emails: [] }]);
  assert.ok(built.ok);
  assert.equal(built.value.chat_enquiry_categories[0].key, "lettings_enquiry");
  assert.equal(enquiryRoutingMetadata([{ key: "", label: "", description: "", emails: [] }]).ok, false);
  assert.equal(enquiryRoutingMetadata([{ key: "x_y", label: "X", description: "", emails: ["not an email"] }]).ok, false);
  const dup = enquiryRoutingMetadata([
    { key: "", label: "Offer", description: "", emails: [] },
    { key: "offer", label: "Offer", description: "", emails: [] },
  ]);
  assert.equal(dup.ok, false);
});
