import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_DASHBOARD_VIEW, parseDashboardView } from "./dashboard-view";

test("generic /dashboard (and missing/invalid ?view=) opens Agents", () => {
  assert.equal(DEFAULT_DASHBOARD_VIEW, "assistants");
  assert.equal(parseDashboardView(undefined), "assistants");
  assert.equal(parseDashboardView(null), "assistants");
  assert.equal(parseDashboardView(""), "assistants");
  assert.equal(parseDashboardView("not-a-tab"), "assistants");
});

test("accepts sidebar names and URL aliases", () => {
  assert.equal(parseDashboardView("assistants"), "assistants");
  assert.equal(parseDashboardView("Agents"), "assistants");
  assert.equal(parseDashboardView("insights"), "insights");
  assert.equal(parseDashboardView("home"), "insights");
  assert.equal(parseDashboardView("inbox"), "calls");
  assert.equal(parseDashboardView("calls"), "calls");
  assert.equal(parseDashboardView("contacts"), "contacts");
  assert.equal(parseDashboardView("channels"), "channels");
});
