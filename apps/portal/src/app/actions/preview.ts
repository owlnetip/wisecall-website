"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { isAdmin } from "@/lib/admin";

// In-browser live agent preview (no phone call needed). Mints a short-lived
// OpenAI Realtime ephemeral token bound to this agent's prompt/knowledge, which
// the browser uses to open a WebRTC voice session directly with the model. The
// real API key never leaves the server.

export type PreviewSessionResult =
  | { ok: true; clientSecret: string; greeting: string; agentName: string }
  | { ok: false; error: string };

// The live phone pipeline uses Cartesia voices, but OpenAI Realtime only ships
// its own 10 built-in voices (no way to plug a Cartesia voice ID into it), so
// each Cartesia voice gets its own closest-matching OpenAI stand-in - matched
// on tone/character rather than just gender, so all six sound distinct in
// preview. marin/cedar are OpenAI's highest-quality voices, used for the two
// default agent voices (Gemma, Hugo).
const PREVIEW_VOICE: Record<string, string> = {
  Gemma: "marin", // warm British female → marin (warm, natural)
  Victoria: "sage", // polished, professional female → sage (composed, measured)
  Julia: "coral", // clear, approachable female → coral (friendly, clear)
  Hugo: "cedar", // friendly British male → cedar (warm, natural)
  Archie: "verse", // bright, upbeat male → verse (energetic)
  Benedict: "ash", // calm, reassuring male → ash (calm, even)
};

function composePreviewInstructions(profile: {
  system_prompt: string | null;
  business_context: string | null;
  receptionist_name: string | null;
  business_name: string | null;
  clinic_name: string | null;
  profile_name: string | null;
  greeting: string | null;
  metadata: Record<string, unknown> | null;
}): { instructions: string; greeting: string } {
  const businessName =
    profile.business_name || profile.clinic_name || profile.profile_name || "the business";
  const receptionist = profile.receptionist_name || "the receptionist";
  const greeting =
    (typeof profile.metadata?.greeting === "string" && profile.metadata.greeting.trim()) ||
    (profile.greeting || "").trim() ||
    `Hi, you've reached ${businessName}. How can I help today?`;

  const knowledge =
    typeof profile.metadata?.knowledge === "string" ? profile.metadata.knowledge.trim() : "";

  const sections = [
    profile.system_prompt?.trim() ||
      `You are ${receptionist}, a helpful, professional UK English telephone receptionist for ${businessName}.`,
    "",
    "*** LIVE PREVIEW CALL ***",
    "This is a browser-based test call from the business owner previewing their agent. Behave EXACTLY as you would on a real inbound phone call - same tone, same rules, same knowledge. Do not mention that this is a preview or a test.",
    "",
    "Voice call style:",
    "- Speak naturally and conversationally, like a real UK receptionist on the phone.",
    "- Keep answers short - one to three sentences - then let the caller speak.",
    "- Never invent prices, availability or bookings you cannot verify.",
    "- Use UK English.",
  ];

  if (profile.business_context?.trim()) {
    sections.push("", "Business knowledge:", profile.business_context.trim());
  }
  if (knowledge && knowledge !== profile.business_context?.trim()) {
    sections.push("", "Additional business knowledge:", knowledge);
  }

  sections.push("", `Open the call with this greeting (or a very close variant): "${greeting}"`);

  return { instructions: sections.join("\n"), greeting };
}

export async function startAgentPreview(agentId: string): Promise<PreviewSessionResult> {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return { ok: false, error: "Live preview isn't switched on yet." };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data: profile, error: readError } = await service
    .from("wisecall_profiles")
    .select(
      "id, profile_name, receptionist_name, business_name, clinic_name, system_prompt, greeting, business_context, metadata",
    )
    .eq("id", agentId)
    .maybeSingle();

  if (readError) return { ok: false, error: readError.message };
  if (!profile) return { ok: false, error: "Agent not found." };

  const metadata = (profile.metadata as Record<string, unknown> | null) ?? {};
  if (metadata.owner_id !== user.id && !isAdmin(user)) {
    return { ok: false, error: "You don't have access to this agent." };
  }

  const { instructions, greeting } = composePreviewInstructions({
    ...profile,
    metadata,
  });

  const voiceName = typeof metadata.voice === "string" ? metadata.voice : "";
  const previewVoice = PREVIEW_VOICE[voiceName] ?? "marin";

  try {
    const res = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "OpenAI-Safety-Identifier": user.id,
      },
      body: JSON.stringify({
        expires_after: { anchor: "created_at", seconds: 600 },
        session: {
          type: "realtime",
          model: "gpt-realtime",
          instructions,
          audio: {
            input: {
              transcription: { model: "gpt-4o-mini-transcribe" },
            },
            output: { voice: previewVoice },
          },
        },
      }),
    });

    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("startAgentPreview: client_secrets failed", res.status, detail.slice(0, 300));
      return { ok: false, error: `Couldn't start the preview (${res.status}). Try again.` };
    }

    const data = await res.json();
    const clientSecret = data?.value || data?.client_secret?.value;
    if (!clientSecret) {
      return { ok: false, error: "Couldn't start the preview. Try again." };
    }

    return {
      ok: true,
      clientSecret,
      greeting,
      agentName:
        profile.receptionist_name || profile.profile_name || profile.business_name || "Agent",
    };
  } catch (err) {
    console.error("startAgentPreview:", err instanceof Error ? err.message : err);
    return { ok: false, error: "Couldn't start the preview. Try again." };
  }
}
