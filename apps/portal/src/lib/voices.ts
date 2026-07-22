export type VoiceOption = {
  id: string;
  label: string;
  blurb: string;
};

export const DEFAULT_VOICE_ID = "Gemma";

// Voices shown in the portal picker — one flat list, no provider distinction.
export const voiceOptions: VoiceOption[] = [
  { id: "Gemma", label: "Gemma", blurb: "Warm British female" },
  { id: "Hugo", label: "Hugo", blurb: "Friendly British male" },
  { id: "Archie", label: "Archie", blurb: "Bright, upbeat male" },
  { id: "Victoria", label: "Victoria", blurb: "Polished, professional female" },
  { id: "Benedict", label: "Benedict", blurb: "Calm, reassuring male" },
  { id: "Julia", label: "Julia", blurb: "Clear, approachable female" },
  { id: "Hamish", label: "Hamish", blurb: "Scottish male" },
  { id: "Fiona", label: "Fiona", blurb: "Scottish female" },
  { id: "Isla", label: "Isla", blurb: "Scottish female" },
  { id: "Callum", label: "Callum", blurb: "Scottish male" },
  { id: "Jane", label: "Jane", blurb: "Soft British female" },
  { id: "Asher", label: "Asher", blurb: "Steady British male" },
  { id: "Verity", label: "Verity", blurb: "Clear British female" },
  { id: "Lucy", label: "Lucy", blurb: "Bright British female" },
  { id: "John", label: "John", blurb: "Northern British male" },
  { id: "Ollie", label: "Ollie", blurb: "Upbeat British male" },
  { id: "Hugh", label: "Hugh", blurb: "Reassuring British male" },
  { id: "Leanne", label: "Leanne", blurb: "Warm British female" },
];

export function getVoiceOption(id: string | null | undefined): VoiceOption | undefined {
  const key = (id || "").trim();
  if (!key) return undefined;
  return voiceOptions.find((voice) => voice.id === key);
}
