import assert from "node:assert/strict";
import { test } from "node:test";
import {
  displayAgentPhoneNumber,
  isCustomerDdi,
  resolveAgentRouting,
} from "./agent-routing";
import {
  GUEST_TEST_AGENT_SOURCE,
  guestRoutingNumber,
  isGuestRoutingNumber,
} from "./guest-test-agent";

const guestNumber = guestRoutingNumber("abc12345");

test("guest +4455 keys are not customer DDIs", () => {
  assert.equal(isGuestRoutingNumber(guestNumber), true);
  assert.equal(isGuestRoutingNumber("+441135221606"), false);
  assert.equal(isCustomerDdi(guestNumber), false);
  assert.equal(isCustomerDdi("+441135221606"), true);
  assert.equal(isCustomerDdi(""), false);
});

test("guest test routing does not look assigned on the agents list or detail", () => {
  const routing = resolveAgentRouting({
    telnyxNumber: guestNumber,
    metadata: {
      source: GUEST_TEST_AGENT_SOURCE,
      guest_test: true,
      routing: { provider: "guest_test", number: guestNumber, status: "test" },
    },
  });
  assert.deepEqual(routing, { provider: null, number: "", status: "unprovisioned" });
  assert.equal(displayAgentPhoneNumber(routing, { guestTest: true }), "Test call only");
});

test("status test or guest_test provider is enough even without guest metadata", () => {
  assert.equal(
    resolveAgentRouting({
      telnyxNumber: guestNumber,
      metadata: { routing: { provider: "guest_test", number: guestNumber, status: "test" } },
    }).status,
    "unprovisioned",
  );
});

test("a real pooled DDI on a claimed guest agent stays live", () => {
  const routing = resolveAgentRouting({
    telnyxNumber: "+441135221606",
    metadata: {
      source: GUEST_TEST_AGENT_SOURCE,
      guest_test: true,
      routing: { provider: "guest_test", number: guestNumber, status: "test" },
    },
  });
  assert.deepEqual(routing, { provider: "telnyx", number: "+441135221606", status: "live" });
  assert.equal(displayAgentPhoneNumber(routing, { guestTest: true }), "+441135221606");
});

test("legacy telnyx_number still counts as live when routing is missing", () => {
  const routing = resolveAgentRouting({
    telnyxNumber: "+441135221666",
    metadata: { owner_id: "user-1" },
  });
  assert.deepEqual(routing, { provider: "telnyx", number: "+441135221666", status: "live" });
  assert.equal(displayAgentPhoneNumber(routing), "+441135221666");
});

test("stale unprovisioned routing still honours a real telnyx_number", () => {
  const routing = resolveAgentRouting({
    telnyxNumber: "+441135221666",
    metadata: { routing: { provider: "telnyx", number: "", status: "unprovisioned" } },
  });
  assert.equal(routing.status, "live");
  assert.equal(routing.number, "+441135221666");
});

test("a real routing number with a stale status still shows as live", () => {
  const routing = resolveAgentRouting({
    telnyxNumber: "+441135221666",
    metadata: { routing: { provider: "telnyx", number: "+441135221666", status: "unprovisioned" } },
  });
  assert.equal(routing.status, "live");
  assert.equal(routing.number, "+441135221666");
});

test("pending stays pending so the portal can poll", () => {
  const routing = resolveAgentRouting({
    telnyxNumber: null,
    metadata: { routing: { provider: "telnyx", number: "", status: "pending" } },
  });
  assert.equal(routing.status, "pending");
  assert.equal(displayAgentPhoneNumber(routing), "Setting up…");
});

test("live routing is shown only when the number is a real DDI", () => {
  const routing = resolveAgentRouting({
    telnyxNumber: "+441135221606",
    metadata: { routing: { provider: "telnyx", number: "+441135221606", status: "live" } },
  });
  assert.equal(routing.status, "live");
  assert.equal(displayAgentPhoneNumber(routing), "+441135221606");
  assert.equal(
    displayAgentPhoneNumber({ number: guestNumber, status: "test" }),
    "Number pending",
  );
});
