import assert from "node:assert/strict";
import test from "node:test";
import {
  createCallbackRateLimitKey,
  getCallbackClientIp,
  normaliseCallbackNumber,
  readCallbackRateLimitResult,
} from "./demo-callback-rate-limit";

test("uses the trusted proxy IP header and first forwarded address", () => {
  assert.equal(
    getCallbackClientIp(
      new Headers({
        "x-vercel-forwarded-for": "203.0.113.4, 10.0.0.2",
        "x-forwarded-for": "198.51.100.9",
      }),
    ),
    "203.0.113.4",
  );
  assert.equal(getCallbackClientIp(new Headers()), "unknown");
});

test("normalises equivalent UK and international callback numbers", () => {
  assert.equal(normaliseCallbackNumber("07700 900123"), "447700900123");
  assert.equal(normaliseCallbackNumber("+44 (7700) 900-123"), "447700900123");
  assert.equal(normaliseCallbackNumber("0044 7700 900123"), "447700900123");
});

test("creates stable namespaced rate-limit keys without retaining identifiers", () => {
  const ipKey = createCallbackRateLimitKey("ip", "203.0.113.4");
  const numberKey = createCallbackRateLimitKey("number", "203.0.113.4");
  assert.match(ipKey, /^ip:[a-f0-9]{64}$/);
  assert.notEqual(ipKey, numberKey);
  assert.equal(ipKey.includes("203.0.113.4"), false);
});

test("validates and rounds the database limiter result", () => {
  assert.deepEqual(readCallbackRateLimitResult({ allowed: false, retry_after_seconds: 14.1 }), {
    allowed: false,
    retryAfterSeconds: 15,
  });
  assert.equal(readCallbackRateLimitResult({ allowed: "false", retry_after_seconds: 10 }), null);
  assert.equal(readCallbackRateLimitResult(null), null);
});
