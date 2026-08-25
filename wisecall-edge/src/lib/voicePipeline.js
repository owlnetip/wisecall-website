// Voice pipeline hints the Telnyx/Cartesia caller should read from the
// profile row. This module does not call TTS/STT — it only resolves ids.
//
// Website demo (slug `wisecall`, DDI +441135222277) is pinned to Sonic 3.6
// with language "en". Other agents stay on Sonic 3.5 unless metadata.tts_model
// is set. Live STT stays Deepgram; Ink-2 is not a drop-in.

const DEMO_SLUG = "wisecall";
const DEMO_DDI_DIGITS = "441135222277";
const SONIC_36 = "sonic-3.6";
const SONIC_36_FALLBACK = "sonic-preview";
const SONIC_35 = "sonic-3.5";

function phoneDigits(value) {
  return String(value || "").replace(/\D/g, "");
}

function isWebsiteDemo(profile) {
  if (String(profile?.slug || "").trim() === DEMO_SLUG) return true;
  const digits = phoneDigits(profile?.telnyx_number);
  if (digits === DEMO_DDI_DIGITS) return true;
  if (digits === "01135222277") return true;
  return digits.endsWith("1135222277") && digits.length >= 10 && digits.length <= 13;
}

function cartesiaTtsModelCandidates(primary) {
  const first = String(primary || "").trim() || SONIC_36;
  if (first === SONIC_36) return [SONIC_36, SONIC_36_FALLBACK];
  return [first];
}

function shouldRetryCartesiaModel(status) {
  return status === 400 || status === 404 || status === 422;
}

/** Always language en. Never send locale alongside it. */
function cartesiaLanguageField() {
  return { language: "en" };
}

/**
 * @param {{ slug?: string, telnyx_number?: string, metadata?: Record<string, unknown> }} profile
 */
function resolveVoicePipeline(profile) {
  const metadata =
    profile?.metadata && typeof profile.metadata === "object" ? profile.metadata : {};
  const demo = isWebsiteDemo(profile);

  const fromMetadata =
    typeof metadata.tts_model === "string" && metadata.tts_model.trim()
      ? metadata.tts_model.trim()
      : "";

  let ttsModel;
  if (fromMetadata) {
    ttsModel = fromMetadata;
  } else if (demo) {
    ttsModel = SONIC_36;
  } else {
    // Do not apply a host-wide CARTESIA_MODEL to every production agent.
    ttsModel = SONIC_35;
  }

  const sttProvider =
    (typeof metadata.stt_provider === "string" && metadata.stt_provider.trim()) || "deepgram";
  const sttModel =
    typeof metadata.stt_model === "string" && metadata.stt_model.trim()
      ? metadata.stt_model.trim()
      : null;

  return {
    ttsProvider:
      (typeof metadata.tts_provider === "string" && metadata.tts_provider.trim()) || "cartesia",
    ttsModel,
    ttsModelCandidates: cartesiaTtsModelCandidates(ttsModel),
    languageFields: cartesiaLanguageField(),
    sttProvider,
    sttModel,
    demo,
  };
}

module.exports = {
  DEMO_SLUG,
  DEMO_DDI_DIGITS,
  cartesiaLanguageField,
  cartesiaTtsModelCandidates,
  isWebsiteDemo,
  resolveVoicePipeline,
  shouldRetryCartesiaModel,
};
