import Anthropic from "@anthropic-ai/sdk";
import { claudeConfig } from "@/lib/call-analysis";

// Picks the enquiry type of a finished website chat from the agent's own list
// (profile.metadata.chat_enquiry_categories), so the one post-chat email can go
// to that department (metadata.chat_enquiry_routing[key]).

export type EnquiryCategory = { key: string; label: string; description: string };

export function parseCategories(metadata: unknown): EnquiryCategory[] {
  if (!metadata || typeof metadata !== "object") return [];
  const raw = (metadata as Record<string, unknown>).chat_enquiry_categories;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((c): c is Record<string, unknown> => Boolean(c) && typeof c === "object")
    .map((c) => ({
      key: String(c.key || "").trim(),
      label: String(c.label || c.key || "").trim(),
      description: String(c.description || "").trim(),
    }))
    .filter((c) => /^[a-z0-9_]{2,40}$/.test(c.key));
}

export function buildClassifierPrompt(transcript: string, categories: EnquiryCategory[]): string {
  const list = categories.map((c) => `- ${c.key}: ${c.description || c.label}`).join("\n");
  return [
    "Classify this website chat into exactly one category, based on what the visitor needs.",
    "",
    "Categories:",
    list,
    "",
    "Reply with the category key only, nothing else.",
    "",
    "Chat:",
    transcript.slice(-12000),
  ].join("\n");
}

export function pickCategory(reply: string, categories: EnquiryCategory[]): string | null {
  const text = reply.trim().toLowerCase().replace(/[^a-z0-9_]/g, " ");
  const exact = categories.find((c) => text.split(/\s+/).includes(c.key));
  return exact?.key ?? null;
}

export async function classifyEnquiry(
  transcript: string,
  categories: EnquiryCategory[],
  ask?: (prompt: string) => Promise<string>,
): Promise<string | null> {
  if (!categories.length || transcript.trim().length < 10) return null;
  const call =
    ask ??
    (async (prompt: string) => {
      const cfg = claudeConfig();
      if (!cfg) throw new Error("Claude not configured");
      const anthropic = new Anthropic({ apiKey: cfg.apiKey });
      const message = await anthropic.messages.create({
        model: cfg.model,
        max_tokens: 20,
        messages: [{ role: "user", content: prompt }],
      });
      return message.content.map((b) => (b.type === "text" ? b.text : "")).join("");
    });
  const reply = await call(buildClassifierPrompt(transcript, categories));
  return pickCategory(reply, categories);
}
