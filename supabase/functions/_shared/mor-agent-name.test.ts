import assert from "node:assert/strict";
import { test } from "node:test";
import { morAgentDisplayName } from "./mor-agent-name.ts";

test("uses business name so MOR users are unique", () => {
  const name = morAgentDisplayName({
    business_name: "Bright Smiles Dental",
    receptionist_name: "Ava",
  });
  assert.equal(name.firstName, "Ava");
  assert.equal(name.lastName, "Bright Smiles Dental");
  assert.equal(name.companyName, "Bright Smiles Dental");
  assert.equal(name.description, "Bright Smiles Dental");
});

test("splits a business-only name into first + last for the MOR Users list", () => {
  const name = morAgentDisplayName({
    business_name: "Ashleigh Stone Lettings",
  });
  assert.equal(name.firstName, "Ashleigh");
  assert.equal(name.lastName, "Stone Lettings");
  assert.equal(name.companyName, "Ashleigh Stone Lettings");
});

test("falls back to receptionist + Agent when no business is set", () => {
  const name = morAgentDisplayName({ receptionist_name: "Mia" });
  assert.equal(name.firstName, "Mia");
  assert.equal(name.lastName, "Agent");
  assert.equal(name.companyName, "Mia");
});

test("does not duplicate the receptionist when it is already in the business name", () => {
  const name = morAgentDisplayName({
    business_name: "Sarah's Dental",
    receptionist_name: "Sarah",
  });
  assert.equal(name.firstName, "Sarah's");
  assert.equal(name.lastName, "Dental");
});

test("falls back to WiseCall Agent when the profile has no names", () => {
  const name = morAgentDisplayName({});
  assert.equal(name.firstName, "WiseCall");
  assert.equal(name.lastName, "Agent");
  assert.equal(name.companyName, "WiseCall Agent");
});

test("strips markup and control characters from MOR fields", () => {
  const name = morAgentDisplayName({
    business_name: "Acme <script> Dental\nLtd",
    receptionist_name: "Jo",
  });
  assert.equal(name.firstName, "Jo");
  assert.equal(name.lastName, "Acme Dental Ltd");
  assert.equal(name.companyName, "Acme Dental Ltd");
});
