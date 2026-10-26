import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { detectEnquiryType } from "./chat-enquiry-type.ts";

Deno.test("clear answers set the type", () => {
  assertEquals(detectEnquiryType("I'm looking to sell my house"), "seller");
  assertEquals(detectEnquiryType("Selling"), "seller");
  assertEquals(detectEnquiryType("I want to buy a property"), "buyer");
  assertEquals(detectEnquiryType("I'm an investor"), "buyer");
  assertEquals(detectEnquiryType("It's a general enquiry"), "general");
  assertEquals(detectEnquiryType("general"), "general");
});

Deno.test("weak hints only fill an empty type", () => {
  assertEquals(detectEnquiryType("Can I get a valuation on my house?"), "seller");
  assertEquals(detectEnquiryType("Can I get a valuation on my house?", "buyer"), null);
  assertEquals(detectEnquiryType("Do you have properties for sale in Leeds?"), "buyer");
});

Deno.test("a later clear answer changes it; unrelated messages don't", () => {
  assertEquals(detectEnquiryType("Actually I'm buying, not selling", "seller"), "buyer");
  assertEquals(detectEnquiryType("my name is Jane Smith", "seller"), null);
  assertEquals(detectEnquiryType("07700 900123"), null);
  assertEquals(detectEnquiryType("I want to sell my house and buy another"), "seller");
});
