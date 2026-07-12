import assert from "node:assert/strict";
import { test } from "node:test";
import {
  canPauseAgent,
  canResumeAgent,
  getAgentOperationalState,
} from "./agent-operational-state";

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

test("pause is offered only when live, resume only when paused", () => {
  assert.equal(canPauseAgent("live"), true);
  assert.equal(canPauseAgent("paused"), false);
  assert.equal(canPauseAgent("setting_up"), false);
  assert.equal(canPauseAgent("review"), false);
  assert.equal(canPauseAgent("disconnected"), false);

  assert.equal(canResumeAgent("paused"), true);
  assert.equal(canResumeAgent("live"), false);
  assert.equal(canResumeAgent("setting_up"), false);
  assert.equal(canResumeAgent("review"), false);
  assert.equal(canResumeAgent("disconnected"), false);
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
