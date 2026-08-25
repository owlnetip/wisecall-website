// Voice pipeline hints the Telnyx/Cartesia caller should read from the
// profile row. This module does not call TTS/STT — it only resolves ids.
//
// Website demo (slug `wisecall`, DDI +441135222277) is pinned to Sonic 3.6
// + en-GB + Ink-2. Other agents stay on Sonic 3.5 / Deepgram unless their
// metadata already sets tts_model / stt_provider.

const DEMO_SLUG = "wisecall";
const SONIC_36 = process.env.CARTESIA_DEMO_MODEL || process.env.CARTESIA_MODEL || "sonic-preview";
const SONIC_35 = "sonic-3.5";
const INK_2 = process.env.CARTESIA_STT_MODEL || "ink-2";
const TTS_LOCALE = process.env.CARTESIA_TTS_LOCALE || "en-GB";

function isSonic36Model(modelId) {
  const id = String(modelId || "")
    .trim()
    .toLowerCase();
  return (
    id === "sonic-preview" ||
    id === "sonic-latest" ||
    id === "sonic-3.6" ||
    id.startsWith("sonic-3.6-")
  );
}

function cartesiaTranscriptLanguageFields(modelId, locale = TTS_LOCALE) {
  if (isSonic36Model(modelId)) return { locale };
  return { language: "en" };
}

function isWebsiteDemo(profile) {
  return String(profile?.slug || "").trim() === DEMO_SLUG;
}

/**
 * @param {{ slug?: string, metadata?: Record<string, unknown> }} profile
 */
function resolveVoicePipeline(profile) {
  const metadata = profile?.metadata && typeof profile.metadata === "object" ? profile.metadata : {};
  const demo = isWebsiteDemo(profile);

  const ttsModel =
    (typeof metadata.tts_model === "string" && metadata.tts_model.trim()) ||
    (demo ? SONIC_36 : SONIC_35);

  const ttsLocale =
    (typeof metadata.tts_locale === "string" && metadata.tts_locale.trim()) ||
    (isSonic36Model(ttsModel) ? TTS_LOCALE : null);

  const sttProvider =
    (typeof metadata.stt_provider === "string" && metadata.stt_provider.trim()) ||
    (demo ? "cartesia" : "deepgram");

  const sttModel =
    (typeof metadata.stt_model === "string" && metadata.stt_model.trim()) ||
    (sttProvider === "cartesia" ? INK_2 : null);

  return {
    ttsProvider:
      (typeof metadata.tts_provider === "string" && metadata.tts_provider.trim()) || "cartesia",
    ttsModel,
    ttsLocale,
    languageFields: cartesiaTranscriptLanguageFields(ttsModel, ttsLocale || TTS_LOCALE),
    sttProvider,
    sttModel,
    demo,
  };
}

module.exports = {
  DEMO_SLUG,
  isSonic36Model,
  isWebsiteDemo,
  cartesiaTranscriptLanguageFields,
  resolveVoicePipeline,
};
