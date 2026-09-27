import assert from "node:assert/strict";
import { test } from "node:test";
import { preferConfirmedCallerName, preferConfirmedCompany } from "./caller-identity";

const transcript = [
  "Agent: Who am I speaking with?",
  "Caller: Zamia Khan and Jamal Rashid also needs access.",
  "Agent: Could you spell your name?",
  "Caller: Z-A-M-I-A K-H-A-N",
  "Agent: Which company are you calling from?",
  "Caller: J-A-M-A-D-A space R-E-S-T-R-E-P-O",
  "Agent: Just to confirm, I'm speaking with Zamia Khan from Jamada Restrepo, and I'll read the number back.",
].join("\n");

test("summary extraction prefers the spelled caller over a merged name", () => {
  const name = preferConfirmedCallerName("Zamia Khan Jamal Rashid", transcript);
  assert.equal(name, "Zamia Khan");
});

test("summary extraction prefers the spelled company over a mishearing", () => {
  const company = preferConfirmedCompany("Jamada Restrep", transcript);
  assert.equal(company, "Jamada Restrepo");
});

test("a single answer to who am I speaking with beats a merged model name", () => {
  const name = preferConfirmedCallerName(
    "Zamia Khan Jamal Rashid",
    "Agent: Who am I speaking with?\nCaller: Zamia Khan and Jamal Rashid is my colleague.",
  );
  assert.equal(name, "Zamia Khan");
});

test("keeps the model name when nothing was confirmed or spelled", () => {
  assert.equal(preferConfirmedCallerName("Luke Harper", "Caller: What time do you open?"), "Luke Harper");
  assert.equal(preferConfirmedCompany("Northwind Ltd", "Caller: What time do you open?"), "Northwind Ltd");
});
