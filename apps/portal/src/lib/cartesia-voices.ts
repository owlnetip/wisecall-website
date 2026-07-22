/**
 * Cartesia voice catalogue for the portal wizard + agent editor.
 *
 * Featured voices (Gemma, Hugo, …) map to CARTESIA_VOICE_* env vars.
 * When CARTESIA_API_KEY is set we also load en-GB voices from Cartesia so
 * the picker is not limited to the original six.
 */

export type CartesiaVoiceOption = {
  id: string;
  label: string;
  blurb: string;
  /** True for the curated WiseCall picks (env-mapped names). */
  featured?: boolean;
};

/** Original six — always listed; preview/live need matching env UUIDs. */
export const FEATURED_CARTESIA_VOICES: CartesiaVoiceOption[] = [
  { id: "Gemma", label: "Gemma", blurb: "Warm British female", featured: true },
  { id: "Hugo", label: "Hugo", blurb: "Friendly British male", featured: true },
  { id: "Archie", label: "Archie", blurb: "Bright, upbeat male", featured: true },
  { id: "Victoria", label: "Victoria", blurb: "Polished, professional female", featured: true },
  { id: "Benedict", label: "Benedict", blurb: "Calm, reassuring male", featured: true },
  { id: "Julia", label: "Julia", blurb: "Clear, approachable female", featured: true },
];

const FEATURED_IDS = new Set(FEATURED_CARTESIA_VOICES.map((v) => v.id));

/** Build name → UUID map from CARTESIA_VOICE_* env vars. */
export function cartesiaVoiceEnvMap(
  env: NodeJS.ProcessEnv = process.env,
): Record<string, string | undefined> {
  return {
    Gemma: env.CARTESIA_VOICE_GEMMA,
    Hugo: env.CARTESIA_VOICE_HUGO,
    Archie: env.CARTESIA_VOICE_ARCHIE,
    Victoria: env.CARTESIA_VOICE_VICTORIA,
    Benedict: env.CARTESIA_VOICE_BENEDICT,
    Julia: env.CARTESIA_VOICE_JULIA,
  };
}

export function isCartesiaUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

/** Resolve a portal voice key (name or Cartesia UUID) to a Cartesia voice UUID. */
export function resolveCartesiaVoiceUuid(
  voice: string | null | undefined,
  envMap: Record<string, string | undefined> = cartesiaVoiceEnvMap(),
): string | null {
  const key = (voice || "").trim();
  if (!key) return null;
  if (envMap[key]) return envMap[key]!;
  if (isCartesiaUuid(key)) return key;
  return null;
}

type CartesiaApiVoice = {
  id?: string;
  name?: string;
  description?: string;
  language?: string;
  country?: string;
};

function voiceBlurb(v: CartesiaApiVoice): string {
  const bits = [v.description, v.country ? `${v.country} English` : null, v.language]
    .filter(Boolean)
    .map((s) => String(s).trim());
  return bits[0]?.slice(0, 80) || "British English";
}

/** Featured voices + en-GB library from Cartesia (when API key present). */
export async function loadCartesiaVoiceOptions(
  env: NodeJS.ProcessEnv = process.env,
): Promise<CartesiaVoiceOption[]> {
  const featured = [...FEATURED_CARTESIA_VOICES];
  const apiKey = env.CARTESIA_API_KEY?.trim();
  if (!apiKey) return featured;

  try {
    const url = new URL("https://api.cartesia.ai/voices");
    url.searchParams.set("limit", "100");
    url.searchParams.set("language", "en-GB");

    const res = await fetch(url.toString(), {
      headers: {
        "X-API-Key": apiKey,
        "Cartesia-Version": "2024-11-13",
      },
      cache: "no-store",
    });

    if (!res.ok) return featured;

    const body = (await res.json()) as { data?: CartesiaApiVoice[] };
    const envUuids = new Set(
      Object.values(cartesiaVoiceEnvMap(env)).filter(Boolean) as string[],
    );

    const library: CartesiaVoiceOption[] = [];
    for (const v of body.data ?? []) {
      if (!v.id || !v.name) continue;
      if (envUuids.has(v.id)) continue;
      if (FEATURED_IDS.has(v.name)) continue;
      library.push({
        id: v.id,
        label: v.name,
        blurb: voiceBlurb(v),
      });
    }

    library.sort((a, b) => a.label.localeCompare(b.label, "en"));
    return [...featured, ...library];
  } catch {
    return featured;
  }
}
