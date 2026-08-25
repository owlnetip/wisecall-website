import assert from "node:assert/strict";
import { test } from "node:test";
import {
  cartesiaTranscriptLanguageFields,
  demoVoiceMetadata,
  isSonic36Model,
} from "./cartesia";

test("Sonic 3.6 family ids use locale en-GB, not language en", () => {
  for (const id of ["sonic-preview", "sonic-3.6", "sonic-latest", "sonic-3.6-2026-08-17"]) {
    assert.equal(isSonic36Model(id), true);
    assert.deepEqual(cartesiaTranscriptLanguageFields(id), { locale: "en-GB" });
  }
});

test("Sonic 3.5 keeps language en so locale does not 400", () => {
  assert.equal(isSonic36Model("sonic-3.5"), false);
  assert.deepEqual(cartesiaTranscriptLanguageFields("sonic-3.5"), {
    language: "en",
  });
});

test("demo metadata is Cartesia Sonic 3.6 + Ink-2", () => {
  const meta = demoVoiceMetadata();
  assert.equal(meta.tts_model, "sonic-preview");
  assert.equal(meta.tts_locale, "en-GB");
  assert.equal(meta.stt_model, "ink-2");
  assert.equal(meta.stt_provider, "cartesia");
});
