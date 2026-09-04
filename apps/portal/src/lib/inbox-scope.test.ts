import assert from "node:assert/strict";
import { test } from "node:test";
import {
  filterRowsByAgent,
  scopedProfileIds,
  visibleInboxProfileIds,
} from "./inbox-scope";

const OWNED = ["agent-a", "agent-b", "agent-c"];

test("account view with no agent cookie returns every owned profile", () => {
  assert.deepEqual(scopedProfileIds(OWNED), OWNED);
  assert.deepEqual(scopedProfileIds(OWNED, null), OWNED);
  assert.deepEqual(scopedProfileIds(OWNED, ""), OWNED);
});

test("Login as agent X returns only agent X when that profile is owned", () => {
  assert.deepEqual(scopedProfileIds(OWNED, "agent-b"), ["agent-b"]);
});

test("fail closed: unknown or foreign agent id yields no profiles", () => {
  assert.deepEqual(scopedProfileIds(OWNED, "agent-other"), []);
  assert.deepEqual(scopedProfileIds([], "agent-a"), []);
});

test("filterRowsByAgent never leaks another agent's threads", () => {
  const rows = [
    { id: "1", profileId: "agent-a" },
    { id: "2", profileId: "agent-b" },
    { id: "3", profileId: "agent-c" },
  ];
  assert.deepEqual(filterRowsByAgent(rows, ["agent-b"]), [{ id: "2", profileId: "agent-b" }]);
  assert.deepEqual(filterRowsByAgent(rows, []), []);
});

test("agent-locked inbox (Login as) ignores the admin all-inboxes flag", () => {
  assert.deepEqual(
    visibleInboxProfileIds({
      ownedIds: OWNED,
      selectedAgentId: "agent-a",
      agentLocked: true,
      adminShowAllInboxes: true,
    }),
    ["agent-a"],
  );
});

test("customer account owners keep a unified inbox of their own agents", () => {
  assert.deepEqual(
    visibleInboxProfileIds({
      ownedIds: OWNED,
      selectedAgentId: "agent-a",
      adminMode: false,
    }),
    OWNED,
  );
});

test("admin all-inboxes is opt-in and never the default", () => {
  assert.deepEqual(
    visibleInboxProfileIds({
      ownedIds: OWNED,
      selectedAgentId: "agent-a",
      adminMode: true,
      adminShowAllInboxes: false,
    }),
    ["agent-a"],
  );
  assert.deepEqual(
    visibleInboxProfileIds({
      ownedIds: OWNED,
      selectedAgentId: "agent-a",
      adminMode: true,
      adminShowAllInboxes: true,
    }),
    OWNED,
  );
});

test("admin inbox with no selected agent fails closed instead of going global", () => {
  assert.deepEqual(
    visibleInboxProfileIds({
      ownedIds: OWNED,
      selectedAgentId: undefined,
      adminMode: true,
      adminShowAllInboxes: false,
    }),
    [],
  );
});
