// Conversation memory compression for multi-turn agent replies.
//
// Instead of sending the full thread on every LLM call, keep a running summary
// of older turns and only include the last few exchanges in the message array.
// Full transcripts stay stored for UI / email; only the model payload is compact.

export type ChatTurn = {
  role: "user" | "assistant";
  content: string;
};

export type LlmChatMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

export type CompressionState = {
  /** Rolling summary of turns covered by summarizedMessageCount. */
  runningSummary: string;
  /** How many prefix messages in the full history the summary already covers. */
  summarizedMessageCount: number;
};

export type CompressOptions = {
  /** Recent user/assistant turns to keep verbatim. Default 6 (≈3 exchanges). */
  recentMessageCount?: number;
  /**
   * Start compressing once history exceeds this many messages.
   * Default 10 — short chats stay uncompressed.
   */
  compressAfterMessages?: number;
  /** Absolute cap if summarisation is unavailable. Default 18 (legacy live-chat). */
  hardCapMessages?: number;
  /** Existing running summary from session metadata. */
  existing?: CompressionState | null;
};

export type CompressResult = {
  /** Turns / system blocks to send after the main system prompt (and KB/memory). */
  messages: LlmChatMessage[];
  /** Updated compression state to persist on the session. */
  state: CompressionState;
  /** True when older turns were (or should be) summarised rather than sent raw. */
  compressed: boolean;
  /** Older turns not yet covered by existing.summary — caller should summarise these. */
  pendingOlder: ChatTurn[];
};

export const DEFAULT_RECENT_MESSAGE_COUNT = 6;
export const DEFAULT_COMPRESS_AFTER_MESSAGES = 10;
export const DEFAULT_HARD_CAP_MESSAGES = 18;
export const MAX_SUMMARY_CHARS = 1200;

const SUMMARY_SYSTEM_PREFIX = "[CONVERSATION SO FAR]";

function envGet(name: string): string | undefined {
  try {
    // Deno edge runtime
    // deno-lint-ignore no-explicit-any
    const deno = (globalThis as any).Deno;
    if (deno?.env?.get) return deno.env.get(name) ?? undefined;
  } catch {
    /* ignore */
  }
  try {
    // Node tests / local tooling
    // deno-lint-ignore no-explicit-any
    const proc = (globalThis as any).process;
    if (proc?.env) return proc.env[name];
  } catch {
    /* ignore */
  }
  return undefined;
}

export function normaliseCompressionState(
  value: unknown,
): CompressionState | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const runningSummary = String(record.running_summary || record.runningSummary || "").trim();
  const summarizedMessageCount = Number(
    record.summarized_message_count ?? record.summarizedMessageCount ?? 0,
  );
  if (!runningSummary || !Number.isFinite(summarizedMessageCount) || summarizedMessageCount < 0) {
    return null;
  }
  return {
    runningSummary: runningSummary.slice(0, MAX_SUMMARY_CHARS),
    summarizedMessageCount: Math.floor(summarizedMessageCount),
  };
}

export function compressionStateToMetadata(state: CompressionState): Record<string, unknown> {
  return {
    running_summary: state.runningSummary.slice(0, MAX_SUMMARY_CHARS),
    summarized_message_count: state.summarizedMessageCount,
    compression_updated_at: new Date().toISOString(),
  };
}

export function buildSummarySystemContent(summary: string): string {
  const trimmed = String(summary || "").trim().slice(0, MAX_SUMMARY_CHARS);
  if (!trimmed) return "";
  return [
    SUMMARY_SYSTEM_PREFIX,
    "Earlier turns in this thread were compressed into this summary. Treat it as reliable context.",
    "Do not ask for details already present below unless the visitor contradicts them.",
    "",
    trimmed,
  ].join("\n");
}

function clampRecentCount(count: number, historyLength: number): number {
  if (historyLength <= 0) return 0;
  const even = count % 2 === 0 ? count : count + 1;
  return Math.min(Math.max(2, even), historyLength);
}

/**
 * Pure assembly: decide what to send and what still needs summarising.
 * Does not call an LLM — the caller summarises `pendingOlder` when non-empty
 * via `compressConversationForLlm`, or supplies a refreshed summary itself.
 */
export function planConversationCompression(
  history: ChatTurn[],
  options: CompressOptions = {},
): CompressResult {
  const recentMessageCount = options.recentMessageCount ?? DEFAULT_RECENT_MESSAGE_COUNT;
  const compressAfter = options.compressAfterMessages ?? DEFAULT_COMPRESS_AFTER_MESSAGES;
  const hardCap = options.hardCapMessages ?? DEFAULT_HARD_CAP_MESSAGES;
  const existing = options.existing ?? null;

  if (!history.length) {
    return {
      messages: [],
      state: existing ?? { runningSummary: "", summarizedMessageCount: 0 },
      compressed: false,
      pendingOlder: [],
    };
  }

  if (history.length <= compressAfter) {
    return {
      messages: history.map((turn) => ({
        role: turn.role === "assistant" ? "assistant" : "user",
        content: turn.content,
      })),
      state: existing ?? { runningSummary: "", summarizedMessageCount: 0 },
      compressed: false,
      pendingOlder: [],
    };
  }

  const recentCount = clampRecentCount(recentMessageCount, history.length);
  const recent = history.slice(-recentCount);
  const older = history.slice(0, -recentCount);
  const covered = Math.min(existing?.summarizedMessageCount ?? 0, older.length);
  const pendingOlder = older.slice(covered);
  const runningSummary = existing?.runningSummary?.trim() || "";
  const nextCount = older.length;

  const messages: LlmChatMessage[] = [];

  if (runningSummary) {
    // Keep current summary while a refresh is pending; better than full older turns.
    messages.push({ role: "system", content: buildSummarySystemContent(runningSummary) });
  }

  // No usable summary yet → hard-capped window rather than dumping the whole thread.
  if (!runningSummary && pendingOlder.length > 0) {
    const fallback = history.slice(-hardCap);
    return {
      messages: fallback.map((turn) => ({
        role: turn.role === "assistant" ? "assistant" : "user",
        content: turn.content,
      })),
      state: {
        runningSummary: "",
        summarizedMessageCount: covered,
      },
      compressed: true,
      pendingOlder,
    };
  }

  for (const turn of recent) {
    messages.push({
      role: turn.role === "assistant" ? "assistant" : "user",
      content: turn.content,
    });
  }

  return {
    messages,
    state: {
      runningSummary,
      // Only advance covered count when pending older turns are already folded in.
      summarizedMessageCount: pendingOlder.length === 0 ? nextCount : covered,
    },
    compressed: true,
    pendingOlder,
  };
}

export function withSummaryCoveringOlder(
  historyLength: number,
  recentMessageCount: number,
  summary: string,
): CompressionState {
  const recentCount = clampRecentCount(recentMessageCount, historyLength);
  return {
    runningSummary: String(summary || "").trim().slice(0, MAX_SUMMARY_CHARS),
    summarizedMessageCount: Math.max(0, historyLength - recentCount),
  };
}

export function formatTurnsForSummary(turns: ChatTurn[]): string {
  return turns
    .map((turn) => `${turn.role === "assistant" ? "Assistant" : "Visitor"}: ${turn.content}`)
    .join("\n");
}

export function buildCompressionSummaryPrompt(
  existingSummary: string,
  newOlderTurns: ChatTurn[],
): { system: string; user: string } {
  const system = [
    "You compress customer-support chat history into a running summary.",
    "Write a concise factual summary in UK English for another assistant to continue the conversation.",
    "Preserve: visitor intent, key facts, contact details, decisions, open questions, and unresolved issues.",
    "Omit pleasantries and repeated confirmation. Max ~180 words. No markdown headings.",
  ].join(" ");

  const parts: string[] = [];
  if (existingSummary.trim()) {
    parts.push("Existing running summary:", existingSummary.trim(), "");
  }
  parts.push("New older turns to fold in:", formatTurnsForSummary(newOlderTurns));
  parts.push("", "Return only the updated running summary.");

  return { system, user: parts.join("\n") };
}

export function assembleCompressedMessages(
  history: ChatTurn[],
  summary: string,
  recentMessageCount: number = DEFAULT_RECENT_MESSAGE_COUNT,
): CompressResult {
  const recentCount = clampRecentCount(recentMessageCount, history.length);
  const recent = history.slice(-recentCount);
  const state = withSummaryCoveringOlder(history.length, recentMessageCount, summary);
  return {
    messages: [
      { role: "system", content: buildSummarySystemContent(summary) },
      ...recent.map((turn) => ({
        role: (turn.role === "assistant" ? "assistant" : "user") as "user" | "assistant",
        content: turn.content,
      })),
    ],
    state,
    compressed: true,
    pendingOlder: [],
  };
}

/**
 * Refresh the running summary via OpenAI (cheap model). Returns null on failure
 * so callers can keep the previous summary / hard-cap fallback.
 */
export async function refreshRunningSummaryWithOpenAi(
  existingSummary: string,
  newOlderTurns: ChatTurn[],
  opts: { apiKey?: string; model?: string } = {},
): Promise<string | null> {
  if (!newOlderTurns.length) return existingSummary.trim() || null;

  const apiKey = opts.apiKey || envGet("OPENAI_API_KEY");
  if (!apiKey) return null;

  const model =
    opts.model ||
    envGet("WISECALL_COMPRESSION_MODEL") ||
    envGet("WISECALL_CHAT_MODEL") ||
    "gpt-4.1-mini";

  const { system, user } = buildCompressionSummaryPrompt(existingSummary, newOlderTurns);

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
        temperature: 0.1,
        max_tokens: 350,
      }),
    });

    if (!response.ok) {
      console.error(
        "[conversation-compress] OpenAI summary error:",
        response.status,
        await response.text(),
      );
      return null;
    }

    const result = await response.json();
    const text = String(result?.choices?.[0]?.message?.content || "").trim();
    return text ? text.slice(0, MAX_SUMMARY_CHARS) : null;
  } catch (error) {
    console.error("[conversation-compress] summary failed:", (error as Error).message);
    return null;
  }
}

/**
 * End-to-end: plan → optionally summarise pending older turns → return payload + state.
 */
export async function compressConversationForLlm(
  history: ChatTurn[],
  options: CompressOptions = {},
): Promise<CompressResult> {
  const plan = planConversationCompression(history, options);
  if (!plan.pendingOlder.length) return plan;

  const refreshed = await refreshRunningSummaryWithOpenAi(
    plan.state.runningSummary,
    plan.pendingOlder,
  );

  if (!refreshed) return plan;

  const recentMessageCount = options.recentMessageCount ?? DEFAULT_RECENT_MESSAGE_COUNT;
  return assembleCompressedMessages(history, refreshed, recentMessageCount);
}
