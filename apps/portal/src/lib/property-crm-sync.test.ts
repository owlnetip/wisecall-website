import assert from "node:assert/strict";
import { test } from "node:test";
import { formatReapitAddress, formatStreetAddress } from "./property-crm-sync";
import { getPropertyCrmProvider, propertyCrmProviders } from "./property-crm-providers";

test("formatReapitAddress joins building and lines", () => {
  const address = formatReapitAddress({
    buildingNumber: "12",
    line1: "Oak Lane",
    line2: "Headingley",
    postcode: "LS6 2AB",
  });
  assert.match(address, /12/);
  assert.match(address, /Oak Lane/);
});

test("formatStreetAddress prefers line fields", () => {
  const address = formatStreetAddress({
    address_line_1: "Flat 2",
    address_line_2: "10 High Street",
    town: "Leeds",
  });
  assert.match(address, /Flat 2/);
  assert.match(address, /Leeds/);
});

test("property CRM providers include top UK platforms", () => {
  const ids = propertyCrmProviders.map((p) => p.id);
  assert.ok(ids.includes("reapit"));
  assert.ok(ids.includes("street"));
  assert.ok(ids.includes("agentos"));
  assert.ok(ids.includes("dezrez"));
  assert.ok(ids.includes("jupix"));
});

test("Reapit provider requires customer id", () => {
  const reapit = getPropertyCrmProvider("reapit");
  assert.ok(reapit);
  assert.ok(reapit.configFields.some((f) => f.key === "customer_id" && f.required));
});
