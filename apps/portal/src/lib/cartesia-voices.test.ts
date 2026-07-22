import assert from "node:assert/strict";
import { test } from "node:test";
import {
  FEATURED_CARTESIA_VOICES,
  isCartesiaUuid,
  resolveCartesiaVoiceUuid,
} from "./cartesia-voices";

test("featured catalogue has six voices", () => {
  assert.equal(FEATURED_CARTESIA_VOICES.length, 6);
});

test("resolves named env voices and raw UUIDs", () => {
  const map = { Gemma: "uuid-gemma" };
  assert.equal(resolveCartesiaVoiceUuid("Gemma", map), "uuid-gemma");
  assert.equal(
    resolveCartesiaVoiceUuid("62ae83ad-4f6a-430b-af41-a9bede9286ca", map),
    "62ae83ad-4f6a-430b-af41-a9bede9286ca",
  );
  assert.equal(resolveCartesiaVoiceUuid("Unknown", map), null);
});

test("detects Cartesia UUID shape", () => {
  assert.equal(isCartesiaUuid("62ae83ad-4f6a-430b-af41-a9bede9286ca"), true);
  assert.equal(isCartesiaUuid("Gemma"), false);
});
