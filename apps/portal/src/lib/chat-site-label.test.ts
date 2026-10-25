import assert from "node:assert/strict";
import { test } from "node:test";
import { chatSiteLabel } from "./chat-site-label";

const profile = {
  businessName: "Bettermove",
  metadata: {
    website: "https://bettermove.co.uk/",
    chat_sites: {
      "yorkshirepropertybuyers.co.uk": { brand_name: "Yorkshire Property Buyers" },
      "quick-housebuyers.co.uk": { brand_name: "Quick House Buyers" },
    },
  },
};

test("configured sites use their brand name, www or not", () => {
  assert.equal(chatSiteLabel({ page_url: "https://www.yorkshirepropertybuyers.co.uk/sell" }, profile), "Yorkshire Property Buyers");
  assert.equal(chatSiteLabel({ page_url: "https://quick-housebuyers.co.uk/" }, profile), "Quick House Buyers");
});

test("the agent's own website uses the business name", () => {
  assert.equal(chatSiteLabel({ page_url: "https://www.bettermove.co.uk/thankyou/?postcode=LS1" }, profile), "Bettermove");
});

test("an unknown site shows its hostname; last_page_url is the fallback", () => {
  assert.equal(chatSiteLabel({ page_url: "https://www.example.org/x" }, profile), "example.org");
  assert.equal(chatSiteLabel({ last_page_url: "https://quick-housebuyers.co.uk/" }, profile), "Quick House Buyers");
});

test("no recorded page means no label", () => {
  assert.equal(chatSiteLabel({}, profile), "");
  assert.equal(chatSiteLabel(null, undefined), "");
  assert.equal(chatSiteLabel({ page_url: "not a url !!" }, profile), "");
});

test("lookalike hostnames do not match", () => {
  assert.equal(chatSiteLabel({ page_url: "https://notbettermove.co.uk/" }, profile), "notbettermove.co.uk");
});
