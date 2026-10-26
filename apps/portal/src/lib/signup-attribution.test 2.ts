import assert from "node:assert/strict";
import { test } from "node:test";
import {
  attributionFromSearchParams,
  chooseAttribution,
  firstTouchAttribution,
  isSignupAttributionSchemaMissing,
  KNOWN_SIGNUP_SOURCES,
  parseStoredAttribution,
  rememberStoredAttribution,
  resolveFirstTouchCookie,
  sanitizeSignupLandingPath,
  sanitizeSignupSource,
  sanitizeSignupUtm,
  serializeAttribution,
} from "./signup-attribution";

const example = new URLSearchParams(
  "trial=calls&src=organic_google&lp=%2Ftrades%2Fplumbers&utm_source=google&utm_medium=organic&utm_campaign=spring",
);

test("accepts every channel the marketing site sends, including paid_other", () => {
  for (const src of KNOWN_SIGNUP_SOURCES) {
    const params = new URLSearchParams(example);
    params.set("src", src);
    assert.equal(attributionFromSearchParams(params)?.src, src);
  }
  assert.deepEqual(attributionFromSearchParams(example), {
    src: "organic_google",
    lp: "/trades/plumbers",
    utm_source: "google",
    utm_medium: "organic",
    utm_campaign: "spring",
  });
});

test("unknown src tokens are stored lowercased and length-capped; unsafe values become other", () => {
  assert.equal(sanitizeSignupSource("  Newsletter-2026 "), "newsletter-2026");
  assert.equal(sanitizeSignupSource("A".repeat(80)), "a".repeat(64));
  assert.equal(sanitizeSignupSource("user@example.com"), "other");
  assert.equal(sanitizeSignupSource("+447700900123"), "other");
  assert.equal(sanitizeSignupSource("https://evil.example/path"), "other");
  assert.equal(sanitizeSignupSource("   "), null);
});

test("landing path is a decoded path with query, fragment and traversal removed", () => {
  assert.equal(sanitizeSignupLandingPath("/"), "/");
  assert.equal(sanitizeSignupLandingPath("%2Ftrades%2Fplumbers"), "/trades/plumbers");
  assert.equal(sanitizeSignupLandingPath("/trades/plumbers?email=a@b.co#x"), "/trades/plumbers");
  assert.equal(sanitizeSignupLandingPath("/../../etc/passwd"), null);
  assert.equal(sanitizeSignupLandingPath("user@example.com"), null);
  assert.equal(sanitizeSignupLandingPath(`/${"a".repeat(400)}`), `/${"a".repeat(199)}`);
});

test("utm values are capped and emails are dropped", () => {
  assert.equal(sanitizeSignupUtm(" Google "), "google");
  assert.equal(sanitizeSignupUtm("a@b.co"), null);
  assert.equal(sanitizeSignupUtm("x".repeat(101)), null);
  assert.equal(sanitizeSignupUtm("spring campaign"), null);
  const params = new URLSearchParams("utm_source=a@b.co&utm_medium=cpc&src=paid_google");
  assert.deepEqual(attributionFromSearchParams(params), {
    src: "paid_google",
    utm_medium: "cpc",
  });
});

test("first touch wins for the cookie, storage and stored account value", () => {
  const first = serializeAttribution({ src: "organic_google", lp: "/trades/plumbers" });
  const later = new URLSearchParams("src=paid_meta&lp=%2Fpricing");
  assert.equal(resolveFirstTouchCookie(first, later), null);
  assert.equal(
    resolveFirstTouchCookie(undefined, later),
    serializeAttribution({ src: "paid_meta", lp: "/pricing" }),
  );
  assert.equal(resolveFirstTouchCookie(undefined, new URLSearchParams("trial=calls")), null);
  assert.deepEqual(
    firstTouchAttribution(
      { src: "direct", lp: "/" },
      { src: "paid_google", lp: "/pricing" },
    ),
    { src: "direct", lp: "/" },
  );
  assert.equal(
    rememberStoredAttribution(first, { src: "paid_meta", lp: "/pricing" }),
    first,
  );
  assert.deepEqual(chooseAttribution(first, serializeAttribution({ src: "referral", lp: "/blog" })), {
    src: "organic_google",
    lp: "/trades/plumbers",
  });
  assert.deepEqual(chooseAttribution(undefined, serializeAttribution({ src: "referral", lp: "/blog" })), {
    src: "referral",
    lp: "/blog",
  });
});

test("stored attribution is re-sanitised and rejects oversized or non-object payloads", () => {
  const raw = serializeAttribution({
    src: "organic_bing",
    lp: "/trades/plumbers",
    utm_source: "bing",
    utm_medium: "organic",
    utm_campaign: "spring",
  });
  assert.deepEqual(parseStoredAttribution(raw), {
    src: "organic_bing",
    lp: "/trades/plumbers",
    utm_source: "bing",
    utm_medium: "organic",
    utm_campaign: "spring",
  });
  assert.equal(parseStoredAttribution('{"src":"user@example.com","lp":"/ok"}')?.src, "other");
  assert.equal(parseStoredAttribution("not-json"), null);
  assert.equal(parseStoredAttribution("[]"), null);
  assert.equal(parseStoredAttribution("x".repeat(801)), null);
});

test("a missing signup attribution column is ignored; other errors are not", () => {
  assert.equal(
    isSignupAttributionSchemaMissing({
      code: "PGRST204",
      message: "Could not find the 'signup_attribution' column of 'wisecall_billing' in the schema cache",
    }),
    true,
  );
  assert.equal(
    isSignupAttributionSchemaMissing({
      code: "42703",
      message: 'column "signup_at" of relation "wisecall_billing" does not exist',
    }),
    true,
  );
  assert.equal(
    isSignupAttributionSchemaMissing({
      code: "23505",
      message: "duplicate key value violates unique constraint",
    }),
    false,
  );
});
