import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildDemoSmsAfterCallBody,
  callConnectedForHangupSms,
  demoSmsRequestHeaders,
  getDemoSmsEndpoint,
  shouldSendGuestHangupSignupSms,
} from "./guest-hangup-sms";
import { GUEST_TEST_AGENT_SOURCE } from "./guest-test-agent";

const guestMeta = { source: GUEST_TEST_AGENT_SOURCE, guest_test: true };

const connectedGuest = {
  metadata: guestMeta,
  callId: "call-1",
  callerId: "+447700900123",
  outcome: "caller_stop",
  summary: "Call about a property enquiry for Ring2Teams.",
  transcript: "assistant: Hi, thanks for calling Ring2Teams. user: What can you do?",
};

test("sends only after a connected guest hangup to a UK mobile", () => {
  assert.equal(shouldSendGuestHangupSignupSms(connectedGuest), true);
  assert.equal(
    shouldSendGuestHangupSignupSms({
      ...connectedGuest,
      metadata: { ...guestMeta, default_routing_email: "" },
    }),
    true,
  );
  assert.equal(
    shouldSendGuestHangupSignupSms({ ...connectedGuest, metadata: { source: "portal_create" } }),
    false,
  );
  assert.equal(shouldSendGuestHangupSignupSms({ ...connectedGuest, callerId: "" }), false);
  assert.equal(
    shouldSendGuestHangupSignupSms({ ...connectedGuest, callerId: "+441135222277" }),
    false,
  );
});

test("does not SMS before hangup or when the call never connected", () => {
  assert.equal(callConnectedForHangupSms({ outcome: "no-answer", transcript: "" }), false);
  assert.equal(callConnectedForHangupSms({ outcome: "busy", transcript: "" }), false);
  assert.equal(callConnectedForHangupSms({ outcome: "failed", transcript: "" }), false);
  assert.equal(
    shouldSendGuestHangupSignupSms({
      ...connectedGuest,
      outcome: "no-answer",
      summary: "",
      transcript: "",
    }),
    false,
  );
});

test("a guest call with a real transcript counts as connected", () => {
  assert.equal(
    callConnectedForHangupSms({
      outcome: "caller_stop",
      transcript: connectedGuest.transcript,
    }),
    true,
  );
});

test("uses the service-role forwarder when the demo SMS secret is not on the portal", () => {
  const prev = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    SUPABASE_SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY,
    WISECALL_DEMO_SMS_SECRET: process.env.WISECALL_DEMO_SMS_SECRET,
    WISECALL_DEMO_SMS_ENDPOINT: process.env.WISECALL_DEMO_SMS_ENDPOINT,
    WISECALL_WEBHOOK_SECRET: process.env.WISECALL_WEBHOOK_SECRET,
    WISECALL_TRIAL_REMINDER_SECRET: process.env.WISECALL_TRIAL_REMINDER_SECRET,
    WISECALL_POOL_REPLENISH_SECRET: process.env.WISECALL_POOL_REPLENISH_SECRET,
  };
  process.env.NEXT_PUBLIC_SUPABASE_URL = "https://example.supabase.co";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-role-test";
  process.env.WISECALL_TRIAL_REMINDER_SECRET = "trial-secret-test";
  delete process.env.WISECALL_DEMO_SMS_SECRET;
  delete process.env.WISECALL_DEMO_SMS_ENDPOINT;
  delete process.env.WISECALL_WEBHOOK_SECRET;
  delete process.env.WISECALL_POOL_REPLENISH_SECRET;
  try {
    assert.equal(
      getDemoSmsEndpoint(),
      "https://example.supabase.co/functions/v1/wisecall-guest-hangup-sms",
    );
    assert.deepEqual(demoSmsRequestHeaders(), {
      "Content-Type": "application/json",
      Accept: "application/json",
      "x-wisecall-secret": "trial-secret-test",
      apikey: "service-role-test",
      Authorization: "Bearer service-role-test",
    });
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});

test("payload matches the existing wisecall-demo-sms after_call hook", () => {
  const body = buildDemoSmsAfterCallBody({
    ...connectedGuest,
    profileId: "profile-1",
    profileSlug: "guest-ring2teams-231b752d",
    profileName: "Ring2Teams test",
    businessName: "Ring2Teams",
  });
  assert.equal(body.event, "after_call");
  assert.deepEqual(body.session, {
    call_id: "call-1",
    caller_id: "+447700900123",
  });
  assert.equal((body.profile as { slug: string }).slug, "guest-ring2teams-231b752d");
});
