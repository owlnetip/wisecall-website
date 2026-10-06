// Website chat name and opening line. Stored on the agent and read by
// wisecall-live-chat. Empty means "use the agent's own name / the default hello".

const NAME_MAX = 40;
const GREETING_MAX = 240;

export function cleanChatAssistantName(value: string): { ok: true; value: string } | { ok: false; error: string } {
  const name = value.replace(/\s+/g, " ").trim();
  if (!name) return { ok: true, value: "" };
  if (name.length > NAME_MAX) return { ok: false, error: "Chat name must be 40 characters or fewer." };
  if (!/^[\p{L}][\p{L}\s'’.-]*$/u.test(name)) {
    return { ok: false, error: "Use letters for the chat name." };
  }
  return { ok: true, value: name };
}

export function cleanChatGreeting(value: string): { ok: true; value: string } | { ok: false; error: string } {
  const greeting = value.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
  if (!greeting) return { ok: true, value: "" };
  if (greeting.length > GREETING_MAX) {
    return { ok: false, error: "Opening line must be 240 characters or fewer." };
  }
  if (/[<>]/.test(greeting)) return { ok: false, error: "Opening line can't include < or >." };
  return { ok: true, value: greeting };
}
