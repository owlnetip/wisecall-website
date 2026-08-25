// Cartesia ids and request fields for portal "Test voice" and for tagging
// the website demo agent. The live phone path (DDI → Telnyx → STT → LLM → TTS)
// does not live in this repo; it should read the same keys from
// wisecall_profiles.metadata (see wisecall-edge/src/lib/voicePipeline.js).

/** Dated Cartesia API header used by /tts/bytes. */
export const CARTESIA_API_VERSION =
  process.env.CARTESIA_API_VERSION || "2026-08-14";

/**
 * Sonic 3.6 (as of 2026-08-25 Cartesia docs still ship it as beta
 * `sonic-preview`; the 2026-08-14 bytes schema also lists `sonic-latest`.
 * `sonic-3.6` is accepted as an override if GA aliases it). Locale `en-GB`
 * 400s on Sonic 3.5 — only send it for 3.6-family ids.
 */
export const CARTESIA_SONIC_36_MODEL_ID =
  process.env.CARTESIA_MODEL || "sonic-preview";

export const CARTESIA_SONIC_35_MODEL_ID = "sonic-3.5";

export const CARTESIA_INK_2_MODEL_ID = process.env.CARTESIA_STT_MODEL || "ink-2";

export const CARTESIA_TTS_LOCALE = process.env.CARTESIA_TTS_LOCALE || "en-GB";

/** Public website demo agent (wisecall.io callback + +441135222277). */
export const WISECALL_WEBSITE_DEMO_SLUG = "wisecall";

export function isSonic36Model(modelId: string): boolean {
  const id = modelId.trim().toLowerCase();
  return (
    id === "sonic-preview" ||
    id === "sonic-latest" ||
    id === "sonic-3.6" ||
    id.startsWith("sonic-3.6-")
  );
}

/** TTS request language vs locale — never set both (Cartesia 400). */
export function cartesiaTranscriptLanguageFields(
  modelId: string,
  locale = CARTESIA_TTS_LOCALE,
): { locale: string } | { language: string } {
  if (isSonic36Model(modelId)) {
    return { locale };
  }
  return { language: "en" };
}

export function demoVoiceMetadata(): Record<string, string> {
  return {
    tts_provider: "cartesia",
    tts_model: CARTESIA_SONIC_36_MODEL_ID,
    tts_locale: CARTESIA_TTS_LOCALE,
    stt_provider: "cartesia",
    stt_model: CARTESIA_INK_2_MODEL_ID,
  };
}
