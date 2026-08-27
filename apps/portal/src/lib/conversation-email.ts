/**
 * Team email for a completed conversation.
 *
 * Matches the customer portal inbox: Outcome / Next step / Follow-up needed /
 * What happened, plus the branded caller/agent transcript bubbles. Next actions
 * are the same fields the portal already stores. Never invents tasks.
 */

export function nextActionsFromAnalysisJson(json: unknown): string[] {
  if (!json || typeof json !== "object") return [];
  const record = json as Record<string, unknown>;
  const items = record.action_items;
  if (Array.isArray(items)) {
    return items
      .filter((value): value is string => typeof value === "string")
      .map((value) => value.trim())
      .filter(Boolean)
      .slice(0, 5);
  }
  const legacy = record.recommended_follow_up;
  return typeof legacy === "string" && legacy.trim() ? [legacy.trim()] : [];
}

export function nextActionsFromFollowUpTitles(titles: unknown): string[] {
  if (!Array.isArray(titles)) return [];
  return titles
    .filter((value): value is string => typeof value === "string")
    .map((value) => value.trim())
    .filter(Boolean)
    .slice(0, 5);
}

/** Same resolution the inbox uses: analysis items first, then open follow-ups. */
export function portalNextActions(input: {
  analysisJson?: unknown;
  followUpTitles?: string[];
}): string[] {
  const fromAnalysis = nextActionsFromAnalysisJson(input.analysisJson);
  if (fromAnalysis.length) return fromAnalysis;
  return nextActionsFromFollowUpTitles(input.followUpTitles);
}

export function nextStepLabel(actionItems: string[]): string {
  if (!actionItems.length) return "No follow-up needed";
  return `${actionItems.length} follow-up${actionItems.length === 1 ? "" : "s"} needed`;
}

export function escapeEmailHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const EMAIL_OUTCOME_LABELS: Record<string, string> = {
  remote_hangup: "Caller ended",
  caller_stop: "Caller ended",
  transfer: "Transferred",
  transferred: "Transferred",
  voicemail: "Voicemail",
  no_answer: "No answer",
  busy: "Busy",
  failed: "Failed",
  completed: "Completed",
  live_chat: "Live chat",
  live_chat_in_progress: "Chat in progress",
  live_chat_ended: "Chat ended",
};

export function emailOutcomeLabel(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) return "Conversation recorded";
  const key = trimmed.toLowerCase();
  return EMAIL_OUTCOME_LABELS[key] ?? trimmed.replace(/_/g, " ");
}

const NAME_BLOCKLIST = new Set([
  "unknown",
  "caller",
  "customer",
  "client",
  "guest",
  "team",
  "hello",
  "hi",
  "yes",
  "no",
  "thanks",
  "thank",
  "you",
  "is",
  "that",
  "this",
  "just",
  "looking",
  "calling",
  "about",
  "from",
  "here",
  "there",
  "home",
  "cloud",
]);

function titleCaseName(value: string): string {
  return value
    .split(/\s+/)
    .map((word) => {
      if (!word) return "";
      if (word.length <= 2 && /^[A-Z]{1,2}$/.test(word)) return word;
      return word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join(" ")
    .trim();
}

export function cleanCallerName(value: unknown): string {
  if (typeof value !== "string") return "";
  const name = titleCaseName(value.replace(/['"]/g, "").replace(/[.,!?;:]+$/g, "").trim());
  if (!name) return "";
  const lower = name.toLowerCase();
  if (NAME_BLOCKLIST.has(lower)) return "";
  if (/^\+?\d[\d\s()-]{6,}$/.test(name)) return "";
  if (name.length < 2 || name.length > 48) return "";
  if (!/[a-zA-Z]/.test(name)) return "";
  const words = name.split(/\s+/);
  if (words.length > 4) return "";
  if (words.every((word) => NAME_BLOCKLIST.has(word.toLowerCase()))) return "";
  return name;
}

const NAME_PATTERNS: RegExp[] = [
  /\bcaptured name\s+([A-Za-z][A-Za-z' -]{1,40})/i,
  /\bcaller\s+([A-Za-z][A-Za-z' -]{1,40})\s+(?:said|asked|reported|called)\b/i,
  /\bmy name(?:'s| is)\s+([A-Za-z][A-Za-z' -]{1,40})/i,
  /\bthis is\s+([A-Za-z][A-Za-z' -]{1,40})(?:\s+(?:calling|from|speaking))?/i,
  /\bthanks,?\s+is that\s+([A-Za-z][A-Za-z' -]{1,40})/i,
  /\bthanks,?\s+([A-Z][a-z]{1,20})\.?\s*$/m,
];

export function extractCallerNameFromText(text: string): string {
  if (!text?.trim()) return "";
  for (const pattern of NAME_PATTERNS) {
    const match = text.match(pattern);
    const cleaned = cleanCallerName(match?.[1]);
    if (cleaned) return cleaned;
  }
  return "";
}

export function callerNameFromSources(input: {
  callerName?: string | null;
  analysisJson?: unknown;
  summary?: string | null;
  transcript?: string | null;
  collected?: Record<string, unknown> | null;
}): string {
  const explicit = cleanCallerName(input.callerName);
  if (explicit) return explicit;

  if (input.analysisJson && typeof input.analysisJson === "object") {
    const fromAnalysis = cleanCallerName(
      (input.analysisJson as Record<string, unknown>).caller_name,
    );
    if (fromAnalysis) return fromAnalysis;
  }

  const collected = input.collected && typeof input.collected === "object" ? input.collected : {};
  for (const key of ["contact_name", "caller_name", "name"]) {
    const fromCollected = cleanCallerName(collected[key]);
    if (fromCollected) return fromCollected;
  }

  return (
    extractCallerNameFromText(input.summary ?? "") ||
    extractCallerNameFromText(input.transcript ?? "")
  );
}

export type EmailTranscriptTurn = { speaker: "agent" | "caller"; text: string };

const TOOL_LINE = /^\s*\[function_(?:request|response)\]/i;
const SPEAKER_LINE =
  /^(assistant|agent|ai|bot|wisecall|user|caller|human|visitor|customer)\s*:\s*([\s\S]*)$/i;
const CALLER_ROLES = new Set(["user", "caller", "human", "visitor", "customer"]);

function isToolLogLine(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (TOOL_LINE.test(trimmed)) return true;
  if (/^\{[\s\S]*\}$/.test(trimmed)) return true;
  return false;
}

function pushTurn(turns: EmailTranscriptTurn[], speaker: EmailTranscriptTurn["speaker"], text: string) {
  const cleaned = text.trim();
  if (!cleaned || isToolLogLine(cleaned)) return;
  const last = turns[turns.length - 1];
  if (last && last.speaker === speaker) {
    last.text = `${last.text}\n${cleaned}`;
    return;
  }
  turns.push({ speaker, text: cleaned });
}

/** Parse stored transcripts into caller/agent turns, dropping tool-call dumps. */
export function parseEmailTranscript(raw: string): EmailTranscriptTurn[] {
  const turns: EmailTranscriptTurn[] = [];
  for (const line of raw.replace(/\r\n/g, "\n").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || isToolLogLine(trimmed)) continue;
    const labelled = trimmed.match(SPEAKER_LINE);
    if (labelled) {
      const speaker = CALLER_ROLES.has(labelled[1].toLowerCase()) ? "caller" : "agent";
      pushTurn(turns, speaker, labelled[2]);
      continue;
    }
    if (turns.length) pushTurn(turns, turns[turns.length - 1].speaker, trimmed);
  }
  return turns;
}

export type PostCallEmailInput = {
  businessName: string;
  callerId: string;
  callerName?: string;
  summary: string;
  transcript: string;
  outcome: string;
  startedAt?: string | null;
  actionItems: string[];
  agentName?: string;
};

const EMAIL_LOGO_URL = "https://app.wisecall.io/owl-logo.png";
const BRAND_DARK = "#172929";
const BRAND_TEAL = "#148b8e";
const BRAND_MINT = "#7de8eb";

function formatWhen(startedAt?: string | null): string {
  if (!startedAt) return "";
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", { timeZone: "Europe/London" });
}

function callerHeading(input: PostCallEmailInput): string {
  const name = cleanCallerName(input.callerName);
  if (name) return `New message from ${name}`;
  return `New message for ${input.businessName}`;
}

export function postCallEmailSubject(input: PostCallEmailInput): string {
  const who = cleanCallerName(input.callerName) || input.callerId || "Unknown";
  const actionItems = portalNextActions({ followUpTitles: input.actionItems });
  return actionItems.length
    ? `Follow-up needed · ${who} · ${input.businessName}`
    : `Message from ${who} · ${input.businessName}`;
}

function followUpBlockHtml(actionItems: string[]): string {
  if (!actionItems.length) return "";
  const items = actionItems
    .map(
      (item) =>
        `<li style="margin:0 0 8px;color:#0e4b4d;">${escapeEmailHtml(item)}</li>`,
    )
    .join("");
  return `
      <div style="margin:0 0 18px;padding:14px 16px;background:#f0faf9;border:1px solid #cfe9e4;border-radius:10px;">
        <p style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${BRAND_TEAL};">Follow-up needed</p>
        <ul style="margin:0;padding-left:18px;">${items}</ul>
      </div>`;
}

function agentBubbleLabel(agentName: string): string {
  const first = agentName.trim().split(/\s+/)[0] || "";
  if (first && first.length <= 16 && !/^(the|test|voice|desk|home)$/i.test(first)) return first;
  return "AI agent";
}

function nl2br(value: string): string {
  return escapeEmailHtml(value).replace(/\n/g, "<br/>");
}

function transcriptHtml(input: PostCallEmailInput): string {
  const transcript = input.transcript.trim();
  if (!transcript) return "";
  const turns = parseEmailTranscript(transcript);
  const callerLabel = cleanCallerName(input.callerName) || "Caller";
  const agentLabel = agentBubbleLabel(input.agentName || "WiseCall");

  const bubbles = turns
    .map((turn) => {
      const isCaller = turn.speaker === "caller";
      const inner = isCaller
        ? `<td style="background:${BRAND_DARK};border-radius:16px 16px 4px 16px;padding:10px 14px;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${BRAND_MINT};">${escapeEmailHtml(callerLabel)}</p>
            <p style="margin:0;font-size:14px;line-height:1.5;color:#ffffff;">${nl2br(turn.text)}</p>
          </td>`
        : `<td style="background:#ffffff;border:1px solid #d7e4e3;border-radius:16px 16px 16px 4px;padding:10px 14px;">
            <p style="margin:0 0 4px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:${BRAND_TEAL};">${escapeEmailHtml(agentLabel)}</p>
            <p style="margin:0;font-size:14px;line-height:1.5;color:${BRAND_DARK};">${nl2br(turn.text)}</p>
          </td>`;
      return `<tr><td align="${isCaller ? "right" : "left"}" style="padding:6px 8px;">
        <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:82%;${isCaller ? "margin-left:auto;" : ""}">
          <tr>${inner}</tr>
        </table>
      </td></tr>`;
    })
    .join("");

  return `
      <h3 style="margin:0 0 8px;font-size:15px;color:${BRAND_DARK};">Conversation</h3>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f7;border:1px solid #d7e4e3;border-radius:12px;">
        ${bubbles || `<tr><td style="padding:14px;font-size:14px;color:${BRAND_DARK};">${nl2br(transcript)}</td></tr>`}
      </table>`;
}

function wrapBrandedEmail(innerHtml: string): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:#f4f7f7;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7f7;padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;background:#ffffff;border-radius:16px;overflow:hidden;border:1px solid #d8e4e4;">
<tr><td style="background:${BRAND_DARK};padding:18px 28px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr>
<td style="vertical-align:middle;padding:0 10px 0 0;">
<img src="${EMAIL_LOGO_URL}" alt="" height="32" style="height:32px;width:auto;display:block;" />
</td>
<td style="vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;line-height:1;font-weight:800;">
<span style="color:#ffffff;">Wise</span><span style="color:${BRAND_MINT};">Call</span>
</td>
</tr>
</table>
</td></tr>
<tr><td style="padding:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1a2b2b;">
${innerHtml}
</td></tr>
<tr><td style="padding:18px 28px;background:#f4f7f7;border-top:1px solid #d8e4e4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#5a7272;">
WiseCall · AI receptionists for UK businesses<br/>
<a href="https://wisecall.io" style="color:#0e7d82;text-decoration:none;">wisecall.io</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function buildPostCallEmailHtml(input: PostCallEmailInput): string {
  const when = formatWhen(input.startedAt);
  const outcome = emailOutcomeLabel(input.outcome);
  const agentName = (input.agentName || "WiseCall").trim() || "WiseCall";
  const actionItems = portalNextActions({ followUpTitles: input.actionItems });
  const summary = input.summary.trim();
  const callerName = cleanCallerName(input.callerName);
  const callerId = (input.callerId || "Unknown").trim() || "Unknown";

  const inner = `
      <h2 style="margin:0 0 8px;font-size:22px;color:${BRAND_DARK};">${escapeEmailHtml(callerHeading(input))}</h2>
      <p style="margin:0 0 16px;color:#4a5c5b;">A caller left a message with your WiseCall assistant.</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">
        ${
          callerName
            ? `<tr><td style="padding:6px 0;color:${BRAND_TEAL};font-weight:700;width:120px;">Caller</td><td style="font-weight:800;color:${BRAND_DARK};">${escapeEmailHtml(callerName)}</td></tr>
        <tr><td style="padding:6px 0;color:${BRAND_TEAL};font-weight:700;">Number</td><td>${escapeEmailHtml(callerId)}</td></tr>`
            : `<tr><td style="padding:6px 0;color:${BRAND_TEAL};font-weight:700;width:120px;">Caller</td><td>${escapeEmailHtml(callerId)}</td></tr>`
        }
        ${when ? `<tr><td style="padding:6px 0;color:${BRAND_TEAL};font-weight:700;">When</td><td>${escapeEmailHtml(when)}</td></tr>` : ""}
      </table>
      <table style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#f7fafa;border:1px solid #d7e4e3;border-radius:10px;">
        <tr>
          <td style="padding:12px 14px;border-right:1px solid #d7e4e3;width:33%;vertical-align:top;">
            <p style="margin:0 0 4px;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#7a8a89;">Outcome</p>
            <p style="margin:0;font-size:14px;font-weight:800;">${escapeEmailHtml(outcome)}</p>
          </td>
          <td style="padding:12px 14px;border-right:1px solid #d7e4e3;width:33%;vertical-align:top;">
            <p style="margin:0 0 4px;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#7a8a89;">Next step</p>
            <p style="margin:0;font-size:14px;font-weight:800;color:${actionItems.length ? "#0e4b4d" : "#1f7a5c"};">${escapeEmailHtml(nextStepLabel(actionItems))}</p>
          </td>
          <td style="padding:12px 14px;width:33%;vertical-align:top;">
            <p style="margin:0 0 4px;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#7a8a89;">Handled by</p>
            <p style="margin:0;font-size:14px;font-weight:800;">${escapeEmailHtml(agentName)}</p>
          </td>
        </tr>
      </table>
      ${followUpBlockHtml(actionItems)}
      ${
        summary
          ? `<h3 style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#7a8a89;">What happened</h3><p style="margin:0 0 16px;padding:12px;background:#f0faf9;border-radius:8px;">${escapeEmailHtml(summary)}</p>`
          : ""
      }
      ${transcriptHtml(input)}
      <p style="margin:20px 0 0;font-size:12px;color:#7a8a89;">Open the conversation in your WiseCall inbox to call back or mark follow-ups done.</p>`;

  return wrapBrandedEmail(inner);
}

export function buildPostCallEmailText(input: PostCallEmailInput): string {
  const actionItems = portalNextActions({ followUpTitles: input.actionItems });
  const callerName = cleanCallerName(input.callerName);
  const turns = parseEmailTranscript(input.transcript);
  const blocks = [
    callerHeading(input),
    callerName ? `Caller: ${callerName}` : "",
    `Number: ${input.callerId || "Unknown"}`,
    input.outcome.trim() ? `Outcome: ${emailOutcomeLabel(input.outcome)}` : "",
    `Next step: ${nextStepLabel(actionItems)}`,
  ].filter(Boolean);

  if (actionItems.length) {
    blocks.push(["Follow-up needed:", ...actionItems.map((item) => `- ${item}`)].join("\n"));
  }
  if (input.summary.trim()) {
    blocks.push(`What happened: ${input.summary.trim()}`);
  }
  if (turns.length) {
    const callerLabel = callerName || "Caller";
    const agentLabel = agentBubbleLabel(input.agentName || "WiseCall");
    blocks.push(
      turns
        .map((turn) => `${turn.speaker === "caller" ? callerLabel : agentLabel}: ${turn.text}`)
        .join("\n\n"),
    );
  } else if (input.transcript.trim()) {
    blocks.push(input.transcript.trim());
  }
  return blocks.join("\n\n");
}
