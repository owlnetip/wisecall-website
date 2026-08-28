import assert from "node:assert/strict";
import { test } from "node:test";
import { toE164UkMobile } from "./uk-callback-number";

test("normalises UK mobiles to E.164", () => {
  assert.equal(toE164UkMobile("07700 900123"), "+447700900123");
  assert.equal(toE164UkMobile("+44 7700 900123"), "+447700900123");
  assert.equal(toE164UkMobile("+44 (7700) 900-123"), "+447700900123");
  assert.equal(toE164UkMobile("0044 7700 900123"), "+447700900123");
  assert.equal(toE164UkMobile("447700900123"), "+447700900123");
  assert.equal(toE164UkMobile("7700900123"), "+447700900123");
});

test("rejects landlines, short, and non-UK numbers", () => {
  assert.equal(toE164UkMobile(""), null);
  assert.equal(toE164UkMobile("0113 522 2277"), null);
  assert.equal(toE164UkMobile("+441135222277"), null);
  assert.equal(toE164UkMobile("07700 900"), null);
  assert.equal(toE164UkMobile("+1 415 555 2671"), null);
  assert.equal(toE164UkMobile("not a number"), null);
});
