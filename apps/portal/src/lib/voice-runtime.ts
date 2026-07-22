import { DEFAULT_VOICE_ID, getVoiceOption } from "@/lib/voices";

export type VoiceProvider = "cartesia" | "elevenlabs";

type VoiceRuntimeConfig = {
  id: string;
  provider: VoiceProvider;
  /** Cartesia UUID from env, or ElevenLabs voice id baked in below. */
  voiceId: string | null;
};

const CARTESIA_VOICE_ENV: Record<string, string | undefined> = {
  Gemma: process.env.CARTESIA_VOICE_GEMMA,
  Hugo: process.env.CARTESIA_VOICE_HUGO,
  Archie: process.env.CARTESIA_VOICE_ARCHIE,
  Victoria: process.env.CARTESIA_VOICE_VICTORIA,
  Benedict: process.env.CARTESIA_VOICE_BENEDICT,
  Julia: process.env.CARTESIA_VOICE_JULIA,
};

const CARTESIA_VOICE_IDS: Record<string, string> = {
  Hamish: "0ea47942-be0b-4bc7-a1bf-5dba008dc1cc",
  Fiona: "fb02b554-7d64-4f90-841e-e57fc88f410c",
  Isla: "81cd8d19-45e7-47b2-ad0e-bcd94f557ad0",
  Callum: "5e7d492a-5502-482e-b315-ebf587427806",
};

const ELEVENLABS_VOICE_IDS: Record<string, string> = {
  Jane: "RILOU7YmBhvwJGDGjNmP",
  Asher: "UaYTS0wayjmO9KD1LR4R",
  Verity: "1hlpeD1ydbI2ow0Tt3EW",
  Lucy: "EQu48Nbp4OqDxsnYh27f",
  John: "7rQX8r6PVq3gfJ8rZzyE",
  Ollie: "jRAAK67SEFE9m7ci5DhD",
  Hugh: "2UMI2FME0FFUFMlUoRER",
  Leanne: "HXOwtW4XU7Ne6iOiDHTl",
};

// Per-voice ElevenLabs preview pace. John reads slow at default; others at 1.1.
const ELEVENLABS_PREVIEW_SPEED: Partial<Record<string, number>> = {
  John: 1.2,
};

export function getElevenLabsPreviewSpeed(voiceName: string): number {
  const override = ELEVENLABS_PREVIEW_SPEED[voiceName];
  if (override != null) return override;
  const fromEnv = Number(process.env.ELEVENLABS_VOICE_SPEED);
  return Number.isFinite(fromEnv) && fromEnv > 0 ? fromEnv : 1.1;
}

function resolveVoiceRuntimeConfig(voiceId: string): VoiceRuntimeConfig {
  const elevenLabsId = ELEVENLABS_VOICE_IDS[voiceId];
  if (elevenLabsId) {
    return { id: voiceId, provider: "elevenlabs", voiceId: elevenLabsId };
  }

  return {
    id: voiceId,
    provider: "cartesia",
    voiceId: CARTESIA_VOICE_IDS[voiceId] ?? CARTESIA_VOICE_ENV[voiceId] ?? null,
  };
}

export function resolveVoiceRuntime(
  voice: string | null | undefined,
): { ttsProvider: VoiceProvider; voiceId: string | null } {
  const selectedId = getVoiceOption(voice)?.id ?? DEFAULT_VOICE_ID;
  const config = resolveVoiceRuntimeConfig(selectedId);
  return { ttsProvider: config.provider, voiceId: config.voiceId };
}

export function getVoiceRuntimeConfig(
  voice: string | null | undefined,
): VoiceRuntimeConfig | null {
  const selectedId = getVoiceOption(voice)?.id;
  if (!selectedId) return null;
  return resolveVoiceRuntimeConfig(selectedId);
}

export function getCartesiaVoiceId(voiceName: string): string | undefined {
  return CARTESIA_VOICE_IDS[voiceName] ?? CARTESIA_VOICE_ENV[voiceName];
}
