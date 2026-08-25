const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  isWebsiteDemo,
  resolveVoicePipeline,
  cartesiaLanguageField,
  cartesiaTtsModelCandidates,
} = require("../src/lib/voicePipeline");

test("website demo is slug wisecall or DDI +441135222277", () => {
  assert.equal(isWebsiteDemo({ slug: "wisecall" }), true);
  assert.equal(isWebsiteDemo({ telnyx_number: "+44 113 522 2277" }), true);
  assert.equal(isWebsiteDemo({ slug: "acme-receptionist" }), false);
});

test("demo agent resolves Sonic 3.6 with language en and leaves STT on Deepgram", () => {
  const demo = resolveVoicePipeline({ slug: "wisecall", metadata: {} });
  assert.equal(demo.demo, true);
  assert.equal(demo.ttsModel, "sonic-3.6");
  assert.deepEqual(demo.ttsModelCandidates, ["sonic-3.6", "sonic-preview"]);
  assert.deepEqual(demo.languageFields, { language: "en" });
  assert.equal(demo.sttProvider, "deepgram");
  assert.equal(demo.sttModel, null);

  const byNumber = resolveVoicePipeline({
    slug: "other",
    telnyx_number: "+441135222277",
    metadata: {},
  });
  assert.equal(byNumber.demo, true);
  assert.equal(byNumber.ttsModel, "sonic-3.6");

  const other = resolveVoicePipeline({ slug: "client-agent", metadata: {} });
  assert.equal(other.demo, false);
  assert.equal(other.ttsModel, "sonic-3.5");
  assert.deepEqual(other.ttsModelCandidates, ["sonic-3.5"]);
  assert.deepEqual(other.languageFields, { language: "en" });
  assert.equal(other.sttProvider, "deepgram");
});

test("explicit metadata wins over demo defaults", () => {
  const out = resolveVoicePipeline({
    slug: "wisecall",
    metadata: { tts_model: "sonic-preview", stt_provider: "deepgram" },
  });
  assert.equal(out.ttsModel, "sonic-preview");
  assert.deepEqual(out.ttsModelCandidates, ["sonic-preview"]);
  assert.equal(out.sttProvider, "deepgram");
});

test("never pairs language with locale", () => {
  assert.deepEqual(cartesiaLanguageField(), { language: "en" });
  assert.equal("locale" in cartesiaLanguageField(), false);
  assert.deepEqual(cartesiaTtsModelCandidates("sonic-3.6"), ["sonic-3.6", "sonic-preview"]);
});
