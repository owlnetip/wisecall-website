import assert from "node:assert/strict";
import { test } from "node:test";
import {
  dashboardSetupPath,
  guestSetupPath,
  parseNoWebsite,
  parseOpenSetup,
  parseSetupWebsite,
  shouldOpenSetupWizard,
} from "./setup-website";

test("accepts a pasted UK hostname and adds https", () => {
  assert.equal(parseSetupWebsite("yourwebsite.co.uk"), "https://yourwebsite.co.uk/");
  assert.equal(parseSetupWebsite("  www.example.co.uk/about "), "https://www.example.co.uk/about");
});

test("accepts an already-absolute public URL", () => {
  assert.equal(parseSetupWebsite("https://thedentalhub.com"), "https://thedentalhub.com/");
  assert.equal(parseSetupWebsite("http://example.com/"), "http://example.com/");
});

test("rejects empty, local, and unsafe values", () => {
  for (const input of [
    "",
    "   ",
    "not a site",
    "localhost",
    "https://localhost",
    "javascript:alert(1)",
    "data:text/html,hi",
    "https://user:pass@example.com",
    "<script>example.com</script>",
  ]) {
    assert.equal(parseSetupWebsite(input), null, input);
  }
  assert.equal(parseSetupWebsite("x".repeat(301)), null);
});

test("no-card signup always lands on /dashboard?setup=1 so the wizard opens immediately", () => {
  assert.equal(dashboardSetupPath(undefined), "/dashboard?setup=1");
  assert.equal(dashboardSetupPath("bad"), "/dashboard?setup=1");
  assert.equal(
    dashboardSetupPath("yourwebsite.co.uk"),
    "/dashboard?setup=1&website=https%3A%2F%2Fyourwebsite.co.uk%2F",
  );
});

test("Facebook /try opens the public guest wizard, not signup", () => {
  assert.equal(guestSetupPath(undefined), "/setup?trial=calls");
  assert.equal(guestSetupPath("bad"), "/setup?trial=calls");
  assert.equal(
    guestSetupPath("yourwebsite.co.uk"),
    "/setup?trial=calls&website=https%3A%2F%2Fyourwebsite.co.uk%2F",
  );
  assert.equal(guestSetupPath(undefined, { noWebsite: true }), "/setup?trial=calls&nowebsite=1");
  assert.equal(
    guestSetupPath("yourwebsite.co.uk", { noWebsite: true }),
    "/setup?trial=calls&website=https%3A%2F%2Fyourwebsite.co.uk%2F",
  );
});

test("nowebsite query is only used when no website was pasted", () => {
  assert.equal(parseNoWebsite("1"), true);
  assert.equal(parseNoWebsite("yes"), true);
  assert.equal(parseNoWebsite(""), false);
  assert.equal(parseNoWebsite("website"), false);
});

test("setup=1 opens the create-agent wizard only when they have no agents yet", () => {
  assert.equal(parseOpenSetup("1"), true);
  assert.equal(parseOpenSetup("true"), true);
  assert.equal(parseOpenSetup(""), false);

  assert.equal(shouldOpenSetupWizard({ setup: "1", agentCount: 0 }), true);
  assert.equal(
    shouldOpenSetupWizard({ website: "yourwebsite.co.uk", agentCount: 0 }),
    true,
  );
  assert.equal(shouldOpenSetupWizard({ setup: "1", agentCount: 1 }), false);
  assert.equal(
    shouldOpenSetupWizard({ setup: "1", website: "yourwebsite.co.uk", agentCount: 2 }),
    false,
  );
  assert.equal(shouldOpenSetupWizard({ agentCount: 0 }), false);
});
