import { test } from "node:test";
import assert from "node:assert/strict";
import {
  findReusableMorUserId,
  joinMorName,
  morAccountReuseKey,
  morDeviceDescription,
  morUsernameForAccount,
  morUserNameParts,
  profileAgentName,
  profileBusinessName,
} from "../../_shared/wisecall-mor-account.mjs";

test("MOR user display is the business name", () => {
  assert.equal(joinMorName(morUserNameParts("Signature North East")), "Signature North East");
  assert.equal(joinMorName(morUserNameParts("Bettermove")), "Bettermove");
  assert.equal(profileBusinessName({ business_name: "Signature North East" }), "Signature North East");
  assert.equal(profileBusinessName({ clinic_name: "Bettermove" }), "Bettermove");
});

test("MOR device description is the receptionist / agent name", () => {
  assert.equal(
    morDeviceDescription(profileAgentName({ receptionist_name: "Ava", profile_name: "Front desk" })),
    "Ava",
  );
  assert.equal(
    morDeviceDescription(profileAgentName({ profile_name: "North East receptionist" })),
    "North East receptionist",
  );
});

test("same owner + business share one MOR account key and username", () => {
  const a = { ownerId: "owner-1", businessName: "Signature North East" };
  const b = { ownerId: "owner-1", businessName: "  Signature   North East " };
  assert.equal(morAccountReuseKey(a), morAccountReuseKey(b));
  assert.equal(
    morUsernameForAccount({ ...a, profileId: "11111111-1111-4111-8111-111111111111" }),
    morUsernameForAccount({ ...b, profileId: "22222222-2222-4222-8222-222222222222" }),
  );
});

test("a second agent on the same owner + business reuses that MOR user", () => {
  const siblings = [
    {
      id: "agent-1",
      business_name: "Bettermove",
      metadata: { owner_id: "owner-1", routing: { morUserId: "8801" } },
    },
  ];
  assert.equal(
    findReusableMorUserId(siblings, {
      ownerId: "owner-1",
      businessName: "Bettermove",
      profileId: "agent-2",
    }),
    "8801",
  );
});

test("different owner or business does not reuse a MOR user", () => {
  const siblings = [
    {
      id: "agent-1",
      business_name: "Bettermove",
      metadata: { owner_id: "owner-1", routing: { morUserId: "8801" } },
    },
  ];
  assert.equal(
    findReusableMorUserId(siblings, {
      ownerId: "owner-1",
      businessName: "Signature North East",
      profileId: "agent-2",
    }),
    "",
  );
  assert.equal(
    findReusableMorUserId(siblings, {
      ownerId: "owner-2",
      businessName: "Bettermove",
      profileId: "agent-2",
    }),
    "",
  );
});
