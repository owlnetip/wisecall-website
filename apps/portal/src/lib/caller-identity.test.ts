import assert from "node:assert/strict";
import { test } from "node:test";
import {
  preferConfirmedCallerName,
  preferConfirmedCompany,
  presentCompany,
  resolveCompanyCapture,
} from "./caller-identity";

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
});

test("a spelled and confirmed company beats a garbled first hearing", () => {
  const transcript = [
    "Agent: Who am I speaking with?",
    "Caller: Zamia Khan",
    "Agent: And which company are you calling from?",
    "Caller: Jamada Restrep",
    "Agent: Could you spell the company?",
    "Caller: J-A-M-A-D-A space R-E-S-T-R-E-P-O",
    "Agent: So that's Jamada Restrepo. Is that right?",
    "Caller: Yes",
  ].join("\n");
  const capture = resolveCompanyCapture("Jamada Restrep", transcript);
  assert.equal(capture.company, "Jamada Restrepo");
  assert.equal(capture.company_status, "confirmed");
  assert.equal(
    presentCompany({ company: capture.company, companyStatus: capture.company_status }).text,
    "Jamada Restrepo",
  );
});

test("a company that was never confirmed stays marked unconfirmed", () => {
  const transcript = [
    "Agent: And which company are you calling from?",
    "Caller: Harbour and Co",
  ].join("\n");
  const capture = resolveCompanyCapture("Harbour and Co", transcript);
  assert.equal(capture.company, "Harbour and Co");
  assert.equal(capture.company_status, "unconfirmed");
  assert.equal(
    presentCompany({ company: capture.company, companyStatus: capture.company_status }).text,
    "Harbour and Co (not confirmed)",
  );
  const invented = resolveCompanyCapture("Northwind Ltd", "Caller: What time do you open?");
  assert.equal(invented.company, "");
  assert.equal(invented.company_status, "unconfirmed");
  assert.equal(
    presentCompany({ company: invented.company, companyStatus: invented.company_status }).text,
    "Company not confirmed",
  );
});

test("a correction on read-back replaces the company", () => {
  const transcript = [
    "Agent: And which company are you calling from?",
    "Caller: Jamada Restrep",
    "Agent: I have you calling from Jamada Restrep. Is that right?",
    "Caller: No, it's Northwind Digital. N-O-R-T-H-W-I-N-D space D-I-G-I-T-A-L",
    "Agent: So that's Northwind Digital. Is that correct?",
    "Caller: Yes",
  ].join("\n");
  const capture = resolveCompanyCapture("Jamada Restrep", transcript);
  assert.equal(capture.company, "Northwind Digital");
  assert.equal(capture.company_status, "confirmed");
});

test("a personal call records no company instead of a guess", () => {
  const transcript = [
    "Agent: And which company are you calling from?",
    "Caller: No company, I'm calling personally.",
  ].join("\n");
  const capture = resolveCompanyCapture("Jamada Restrep", transcript);
  assert.equal(capture.company, "");
  assert.equal(capture.company_status, "none");
  assert.equal(
    presentCompany({ company: capture.company, companyStatus: capture.company_status }).text,
    "No company",
  );
});

test("older analyses without a confidence field stay readable", () => {
  assert.equal(presentCompany({ company: "Acme Ltd" }).text, "Acme Ltd (not confirmed)");
  assert.equal(presentCompany({ company: "" }).visible, false);
  assert.equal(presentCompany({}).visible, false);
  const confirmed = [
    "Agent: And which company are you calling from?",
    "Caller: J-A-M-A-D-A space R-E-S-T-R-E-P-O",
    "Agent: So that's Jamada Restrepo. Is that right?",
    "Caller: Yes",
  ].join("\n");
  assert.equal(
    presentCompany({ company: "Jamada Restrep", transcript: confirmed }).text,
    "Jamada Restrepo",
  );
});

test("a chat read-back of the phone number is not a caller name", () => {
  // 30 Sep: "Just to confirm, your phone number is 01132863299?" became "Phone Is".
  const chat = [
    "Visitor: luke , luke@exceltelecom.co.uk , 01132863299",
    "WiseCall: Thanks, Luke. Just to confirm, your phone number is 01132863299?",
    "Visitor: yes",
  ].join("\n");
  assert.equal(preferConfirmedCallerName("Luke", chat), "Luke");
  assert.equal(preferConfirmedCallerName("", chat), "");
  assert.equal(
    preferConfirmedCallerName("Jane Smith", "Agent: Just to confirm, your email address is jane@example.com?"),
    "Jane Smith",
  );
});

test("a voice read-back of the name still works", () => {
  assert.equal(
    preferConfirmedCallerName("", "Agent: Just to confirm, I'm speaking with Alana Shaw."),
    "Alana Shaw",
  );
});
