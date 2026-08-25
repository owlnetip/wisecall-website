import assert from "node:assert/strict";
import test from "node:test";
import {
  CARTESIA_SONIC_36_FALLBACK_MODEL_ID,
  CARTESIA_SONIC_36_MODEL_ID,
  cartesiaLanguageField,
  cartesiaPreferredModelId,
  cartesiaTtsModelCandidates,
  demoTtsMetadata,
  isWebsiteDemoAgent,
  shouldRetryCartesiaModel,
} from "./cartesia";

test("defaults to sonic-3.6 then sonic-preview", () => {
  assert.equal(cartesiaPreferredModelId(""), CARTESIA_SONIC_36_MODEL_ID);
  assert.deepEqual(cartesiaTtsModelCandidates(""), [
    CARTESIA_SONIC_36_MODEL_ID,
    CARTESIA_SONIC_36_FALLBACK_MODEL_ID,
  ]);
});

test("CARTESIA_MODEL=sonic-preview is used as-is without a second hop to 3.6", () => {
  assert.deepEqual(cartesiaTtsModelCandidates("sonic-preview"), ["sonic-preview"]);
});

test("explicit sonic-3.5 is not auto-upgraded", () => {
  assert.deepEqual(cartesiaTtsModelCandidates("sonic-3.5"), ["sonic-3.5"]);
});

test("language is en and locale is never sent", () => {
  assert.deepEqual(cartesiaLanguageField(), { language: "en" });
  assert.equal("locale" in cartesiaLanguageField(), false);
});

test("website demo is slug wisecall or DDI +441135222277", () => {
  assert.equal(isWebsiteDemoAgent({ slug: "wisecall" }), true);
  assert.equal(isWebsiteDemoAgent({ telnyxNumber: "+44 113 522 2277" }), true);
  assert.equal(isWebsiteDemoAgent({ telnyxNumber: "tel:+441135222277" }), true);
  assert.equal(isWebsiteDemoAgent({ slug: "acme-receptionist", telnyxNumber: "+441135221606" }), false);
});

test("demo metadata is TTS-only", () => {
  const meta = demoTtsMetadata("");
  assert.equal(meta.tts_model, "sonic-3.6");
  assert.equal(meta.tts_provider, "cartesia");
  assert.equal(meta.stt_model, undefined);
  assert.equal(meta.tts_locale, undefined);
});

test("unknown-model HTTP statuses retry the fallback id", () => {
  assert.equal(shouldRetryCartesiaModel(400), true);
  assert.equal(shouldRetryCartesiaModel(500), false);
});
