// Lets a website chat agent run its during_call integration webhooks as AI tools.
// Opt-in per agent, and the chat is public, so only tools named in
// metadata.chat_tools run:
//   chat_tools: { enabled: true, tools: ["..."], once_per_chat: ["..."] }
// The payload matches the voice runtime's (integrationWebhooks.runtime.js), so one
// webhook serves both channels. Hook headers hold secrets: they go to the webhook
// only, never to the model or the chat log.

export const MAX_TOOL_CALLS_PER_CHAT = 20;
const WEBHOOK_TIMEOUT_MS = 8000;
// One-shot actions do real work before answering (a booking creates the calendar
// entry and sends the text). Giving up early would turn a success into "unknown".
const ONE_SHOT_TIMEOUT_MS = 25000;
const RESULT_MAX_CHARS = 8000;
const REMEMBERED_RESULTS = 4;

export type ChatToolHook = {
  name: string;
  url: string;
  method?: string;
  description?: string;
  friendlyName?: string;
  headers?: { key?: string; value?: string }[];
  parameters?: { key?: string; value?: string }[];
};

export type ChatToolContext = { profileId: string; callId: string; callerId: string };

export type ChatToolState = {
  calls: number;
  completed: string[];
  results: { name: string; content: string }[];
};

export type ChatToolResult = { ok: boolean; status?: number; content?: string; error?: string };

function isRecord(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function nameList(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

export function readChatToolHooks(metadata: unknown): ChatToolHook[] {
  if (!isRecord(metadata) || !isRecord(metadata.chat_tools) || metadata.chat_tools.enabled !== true) return [];
  const allowed = new Set(nameList(metadata.chat_tools.tools));
  const hooks = Array.isArray(metadata.integration_webhooks) ? metadata.integration_webhooks : [];
  return hooks.filter((hook: any) =>
    isRecord(hook) && hook.enabled !== false && hook.condition === "during_call" &&
    typeof hook.name === "string" && allowed.has(hook.name) &&
    typeof hook.url === "string" && hook.url.startsWith("https://")
  ) as ChatToolHook[];
}

export function chatToolDefinitions(hooks: ChatToolHook[]) {
  return hooks.map((hook) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const param of hook.parameters ?? []) {
      const key = (param.key || "").trim();
      if (!key || (param.value ?? "").trim()) continue; // fixed values are not the model's to set
      properties[key] = { type: "string", description: "Extract from the conversation" };
      required.push(key);
    }
    return {
      type: "function",
      function: {
        name: hook.name,
        description: hook.description || hook.friendlyName || `Call the ${hook.name} integration`,
        parameters: { type: "object", properties, required },
      },
    };
  });
}

export function readChatToolState(metadata: unknown): ChatToolState {
  const saved = isRecord(metadata) ? metadata.chat_tool_state : null;
  return {
    calls: isRecord(saved) && typeof saved.calls === "number" ? saved.calls : 0,
    completed: isRecord(saved) ? nameList(saved.completed) : [],
    results: isRecord(saved) && Array.isArray(saved.results) ? saved.results : [],
  };
}

// The transcript keeps text only, so a slot offered on one turn has to be
// remembered for the turn where the visitor picks it.
export function earlierToolResultsBlock(state: ChatToolState): string | null {
  if (!state.results.length) return null;
  const lines = state.results.map((r) => `${r.name}: ${r.content}`);
  return `[EARLIER TOOL RESULTS IN THIS CHAT] Use these exact values.\n${lines.join("\n")}`;
}

function substitute(value: string, context: ChatToolContext) {
  return value
    .replace(/\{\{caller_id\}\}/g, context.callerId)
    .replace(/\{\{profile_id\}\}/g, context.profileId)
    .replace(/\{\{call_id\}\}/g, context.callId);
}

export function buildChatToolPayload(hook: ChatToolHook, context: ChatToolContext, args: Record<string, unknown>) {
  const payload: Record<string, unknown> = { ...context };
  for (const param of hook.parameters ?? []) {
    const key = (param.key || "").trim();
    if (!key) continue;
    const fixed = (param.value ?? "").trim();
    if (fixed) payload[key] = substitute(fixed, context);
    else if (Object.prototype.hasOwnProperty.call(args, key)) payload[key] = args[key];
  }
  return payload;
}

function buildHeaders(hook: ChatToolHook) {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json" };
  const forbidden = new Set(["connection", "content-length", "host", "transfer-encoding"]);
  for (const row of hook.headers ?? []) {
    const key = (row.key || "").trim();
    if (key && !forbidden.has(key.toLowerCase())) headers[key] = row.value ?? "";
  }
  return headers;
}

function parseArgs(raw: unknown): Record<string, unknown> | null {
  if (isRecord(raw)) return raw;
  try {
    const parsed = JSON.parse(String(raw || "{}"));
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function succeeded(ok: boolean, content: string) {
  if (!ok) return false;
  try {
    const parsed = JSON.parse(content);
    return !(isRecord(parsed) && parsed.ok === false);
  } catch {
    return true;
  }
}

// Updates state in place. Never throws: the model gets the failure and tells the visitor.
export async function runChatTool(
  hooks: ChatToolHook[],
  onceOnly: string[],
  name: string,
  rawArgs: unknown,
  context: ChatToolContext,
  state: ChatToolState,
  fetcher: typeof fetch = fetch,
): Promise<ChatToolResult> {
  const hook = hooks.find((h) => h.name === name);
  if (!hook) return { ok: false, error: `Unknown tool: ${name}` };
  if (state.completed.includes(name)) {
    return {
      ok: false,
      error: "This has already been attempted on this chat and cannot be repeated. Use the earlier tool result. If that result says the outcome is unknown, do not say it worked: tell the visitor the team will confirm it.",
    };
  }
  if (state.calls >= MAX_TOOL_CALLS_PER_CHAT) {
    return { ok: false, error: "Tool limit reached on this chat. Offer to take their details for a callback." };
  }
  const args = parseArgs(rawArgs);
  if (!args) return { ok: false, error: "Tool arguments were not valid JSON." };

  state.calls += 1;
  const once = onceOnly.includes(name);
  try {
    const response = await fetcher(hook.url, {
      method: (hook.method || "POST").toUpperCase(),
      headers: buildHeaders(hook),
      body: JSON.stringify(buildChatToolPayload(hook, context, args)),
      redirect: "error",
      signal: AbortSignal.timeout(once ? ONE_SHOT_TIMEOUT_MS : WEBHOOK_TIMEOUT_MS),
    });
    const content = (await response.text().catch(() => "")).slice(0, RESULT_MAX_CHARS);
    if (once && succeeded(response.ok, content)) state.completed.push(name);
    state.results = [...state.results, { name, content }].slice(-REMEMBERED_RESULTS);
    return { ok: response.ok, status: response.status, content };
  } catch (error) {
    console.error(`[chat-tools] ${name}:`, (error as Error).message);
    // A timeout may still have gone through, so a retry could repeat a one-shot action.
    // Remember that on later turns, or the model is left guessing what happened.
    if (once) {
      state.completed.push(name);
      const content = JSON.stringify({ outcome: "unknown", note: "No answer was received. It may or may not have worked." });
      state.results = [...state.results, { name, content }].slice(-REMEMBERED_RESULTS);
    }
    return {
      ok: false,
      error: once
        ? "Outcome unknown. Do not retry and do not say it worked. Offer to take their details for a callback."
        : "The tool could not be reached. Do not say it worked.",
    };
  }
}
