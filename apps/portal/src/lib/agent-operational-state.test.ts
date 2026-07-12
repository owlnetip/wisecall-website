import assert from "node:assert/strict";
import { test } from "node:test";
import { getAgentOperationalState } from "./agent-operational-state";

test("only reports live when a numbered route and active profile agree", () => {
  assert.equal(
    getAgentOperationalState({
      status: "Live",
      routing: { status: "live", number: "+441135221606" },
    }),
    "live",
  );
  assert.equal(
    getAgentOperationalState({
      status: "Setup",
      routing: { status: "live", number: "+441135221606" },
    }),
    "paused",
  );
  assert.equal(
    getAgentOperationalState({
      status: "Live",
      routing: { status: "unprovisioned", number: "" },
    }),
    "disconnected",
  );
});

test("keeps provisioning and review states distinct", () => {
  assert.equal(
    getAgentOperationalState({
      status: "Setup",
      routing: { status: "pending", number: "" },
    }),
    "setting_up",
  );
  assert.equal(
    getAgentOperationalState({
      status: "Review",
      routing: { status: "live", number: "+441135221606" },
    }),
    "review",
  );
});
