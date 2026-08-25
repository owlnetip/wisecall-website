// Cartesia model ids for portal "Test voice" and for tagging the website demo
// agent. The live Telnyx media path is not in this repo; it should read
// wisecall_profiles.metadata.tts_model (and CARTESIA_MODEL on the telephony
// host). Do not send `language` and `locale` together — Cartesia 400s.

export const CARTESIA_API_VERSION =
  process.env.CARTESIA_API_VERSION || "2024-11-13";

/** Preferred Sonic 3.6 id. Cartesia may still only accept `sonic-preview`. */
export const CARTESIA_SONIC_36_MODEL_ID = "sonic-3.6";
export const CARTESIA_SONIC_36_FALLBACK_MODEL_ID = "sonic-preview";
export const CARTESIA_SONIC_35_MODEL_ID = "sonic-3.5";

/** Public website demo (wisecall.io live number + desktop callback). */
export const WISECALL_WEBSITE_DEMO_SLUG = "wisecall";
export const WISECALL_WEBSITE_DEMO_DDI_DIGITS = "441135222277";

export function cartesiaPreferredModelId(
  envModel = process.env.CARTESIA_MODEL,
): string {
  const id = (envModel || "").trim();
  return id || CARTESIA_SONIC_36_MODEL_ID;
}

/**
 * Try `sonic-3.6` first (or CARTESIA_MODEL), then `sonic-preview` if the API
 * rejects the primary id. Other explicit models (e.g. sonic-3.5) are not
 * upgraded via fallback.
 */
export function cartesiaTtsModelCandidates(
  envModel = process.env.CARTESIA_MODEL,
): string[] {
  const primary = cartesiaPreferredModelId(envModel);
  if (primary === CARTESIA_SONIC_36_MODEL_ID) {
    return [CARTESIA_SONIC_36_MODEL_ID, CARTESIA_SONIC_36_FALLBACK_MODEL_ID];
  }
  return [primary];
}

export function shouldRetryCartesiaModel(status: number): boolean {
  return status === 400 || status === 404 || status === 422;
}

/** Always `language: "en"`. Never include `locale`. */
export function cartesiaLanguageField(): { language: "en" } {
  return { language: "en" };
}

export function phoneDigits(value: string | null | undefined): string {
  return String(value || "").replace(/\D/g, "");
}

export function isWebsiteDemoAgent(opts: {
  slug?: unknown;
  telnyxNumber?: unknown;
}): boolean {
  if (String(opts.slug || "").trim() === WISECALL_WEBSITE_DEMO_SLUG) return true;
  const digits = phoneDigits(String(opts.telnyxNumber || ""));
  if (digits === WISECALL_WEBSITE_DEMO_DDI_DIGITS) return true;
  if (digits === "01135222277") return true;
  return digits.endsWith("1135222277") && digits.length >= 10 && digits.length <= 13;
}

/** Demo-only TTS hint. Does not switch STT (Ink-2 is not a Deepgram drop-in). */
export function demoTtsMetadata(
  envModel = process.env.CARTESIA_MODEL,
): Record<string, string> {
  return {
    tts_provider: "cartesia",
    tts_model: cartesiaPreferredModelId(envModel),
  };
}
