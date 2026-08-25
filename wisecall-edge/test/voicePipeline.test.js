const { test } = require("node:test");
const assert = require("node:assert/strict");
const {
  isWebsiteDemo,
  resolveVoicePipeline,
} = require("../src/lib/voicePipeline");

test("website demo slug is wisecall", () => {
  assert.equal(isWebsiteDemo({ slug: "wisecall" }), true);
  assert.equal(isWebsiteDemo({ slug: "acme-receptionist" }), false);
});

test("demo agent resolves Sonic 3.6 + en-GB + Ink-2 without flipping others", () => {
  const demo = resolveVoicePipeline({ slug: "wisecall", metadata: {} });
  assert.equal(demo.demo, true);
  assert.equal(demo.ttsModel, "sonic-preview");
  assert.equal(demo.ttsLocale, "en-GB");
  assert.deepEqual(demo.languageFields, { locale: "en-GB" });
  assert.equal(demo.sttProvider, "cartesia");
  assert.equal(demo.sttModel, "ink-2");

  const other = resolveVoicePipeline({ slug: "client-agent", metadata: {} });
  assert.equal(other.demo, false);
  assert.equal(other.ttsModel, "sonic-3.5");
  assert.deepEqual(other.languageFields, { language: "en" });
  assert.equal(other.sttProvider, "deepgram");
  assert.equal(other.sttModel, null);
});

test("explicit metadata wins over demo defaults", () => {
  const out = resolveVoicePipeline({
    slug: "wisecall",
    metadata: { tts_model: "sonic-3.6", stt_provider: "deepgram" },
  });
  assert.equal(out.ttsModel, "sonic-3.6");
  assert.equal(out.sttProvider, "deepgram");
  assert.equal(out.sttModel, null);
});
