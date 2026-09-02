import assert from "node:assert/strict";
import test from "node:test";
import { AVA_DEMO_AGENT_NAME, avaDemoCallbackBody } from "./place-demo-callback";
import { AVA_DEMO_SLUG } from "./guest-test-agent";

test("Ava demo callback body matches homepage /try / number-first", () => {
  assert.deepEqual(avaDemoCallbackBody("07700 900123", "facebook_instant_form"), {
    phone: "07700 900123",
    profile_slug: AVA_DEMO_SLUG,
    agent_name: AVA_DEMO_AGENT_NAME,
    source: "facebook_instant_form",
  });
  assert.equal(AVA_DEMO_SLUG, "wisecall");
  assert.equal(AVA_DEMO_AGENT_NAME, "WiseCall Website Assistant");
});
