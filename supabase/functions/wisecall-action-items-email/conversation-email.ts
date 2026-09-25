// Keep in sync with apps/portal/src/lib/conversation-email.ts
// Dark WiseCall branded post-call email: caller name, summary, labelled conversation.

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
  company?: string;
  summary: string;
  transcript: string;
  outcome: string;
  startedAt?: string | null;
  finishedAt?: string | null;
  durationSeconds?: number | null;
  urgency?: string;
  actionItems: string[];
  agentName?: string;
};

const EMAIL_LOGO_URL = "https://app.wisecall.io/owl-logo.png";
const BRAND_DARK = "#172929";
const BRAND_MINT = "#7de8eb";
const FONT =
  "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

export function extraDetailsFromAnalysis(json: unknown): {
  company: string;
  urgency: string;
} {
  if (!json || typeof json !== "object") return { company: "", urgency: "" };
  const record = json as Record<string, unknown>;
  const company = typeof record.company === "string" ? record.company.trim() : "";
  const urgencyRaw =
    typeof record.urgency_level === "string"
      ? record.urgency_level.trim()
      : typeof record.urgency === "string"
        ? record.urgency.trim()
        : "";
  const urgency = urgencyRaw
    ? urgencyRaw.charAt(0).toUpperCase() + urgencyRaw.slice(1).toLowerCase()
    : "";
  return { company, urgency };
}

export function durationLabel(
  durationSeconds?: number | null,
  startedAt?: string | null,
  finishedAt?: string | null,
): string {
  let seconds = typeof durationSeconds === "number" && Number.isFinite(durationSeconds)
    ? Math.max(0, Math.round(durationSeconds))
    : 0;
  if (!seconds && startedAt && finishedAt) {
    const start = Date.parse(startedAt);
    const end = Date.parse(finishedAt);
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) {
      seconds = Math.round((end - start) / 1000);
    }
  }
  if (!seconds) return "";
  if (seconds < 60) return `${seconds} second${seconds === 1 ? "" : "s"}`;
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  if (!rest) return `${minutes} minute${minutes === 1 ? "" : "s"}`;
  return `${minutes} min ${rest} sec`;
}

function londonParts(startedAt?: string | null): { date: string; time: string } {
  if (!startedAt) return { date: "", time: "" };
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return { date: "", time: "" };
  return {
    date: date.toLocaleDateString("en-GB", { timeZone: "Europe/London" }),
    time: date.toLocaleTimeString("en-GB", { timeZone: "Europe/London" }),
  };
}

function displayAgentName(agentName?: string): string {
  const name = (agentName || "").trim();
  if (!name) return "WiseCall";
  const first = name.split(/\s+/)[0] || "";
  if (first && first.length <= 16 && !/^(the|test|voice|desk|home)$/i.test(first)) return first;
  return "WiseCall";
}

export function postCallEmailSubject(input: PostCallEmailInput): string {
  const who = cleanCallerName(input.callerName) || input.callerId || "Unknown";
  const actionItems = portalNextActions({ followUpTitles: input.actionItems });
  return actionItems.length
    ? `Follow-up needed · ${who} · ${input.businessName}`
    : `Message from ${who} · ${input.businessName}`;
}

function card(inner: string): string {
  return `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 18px;border:1px solid rgba(125,232,235,.35);border-radius:12px;border-left:4px solid ${BRAND_MINT};">
<tr><td style="padding:16px 18px;">${inner}</td></tr>
</table>`;
}

function sectionTitle(label: string): string {
  return `<p style="margin:0 0 10px;font-size:18px;font-weight:800;color:${BRAND_MINT};">${escapeEmailHtml(label)}</p>`;
}

function detailRow(label: string, value: string, last = false): string {
  const border = last ? "none" : "1px solid rgba(125,232,235,.18)";
  return `<tr>
<td style="padding:10px 0;border-bottom:${border};color:${BRAND_MINT};font-size:14px;width:42%;">${escapeEmailHtml(label)}</td>
<td style="padding:10px 0;border-bottom:${border};color:#ffffff;font-size:14px;font-weight:700;text-align:right;">${escapeEmailHtml(value)}</td>
</tr>`;
}

function followUpBlockHtml(actionItems: string[]): string {
  if (!actionItems.length) return "";
  const items = actionItems
    .map((item) => `<li style="margin:0 0 8px;color:#ffffff;">${escapeEmailHtml(item)}</li>`)
    .join("");
  return card(
    `${sectionTitle("Follow-up needed")}<ul style="margin:0;padding-left:18px;">${items}</ul>`,
  );
}

function nl2br(value: string): string {
  return escapeEmailHtml(value).replace(/\n/g, "<br/>");
}

function transcriptHtml(input: PostCallEmailInput): string {
  const transcript = input.transcript.trim();
  if (!transcript) return "";
  const turns = parseEmailTranscript(transcript);
  const callerLabel = cleanCallerName(input.callerName) || "Caller";
  const lines = turns.length
    ? turns
        .map((turn) => {
          const label = turn.speaker === "caller" ? callerLabel : "WiseCall";
          return `<p style="margin:0 0 12px;line-height:1.55;color:#ffffff;"><span style="color:${BRAND_MINT};font-weight:800;">${escapeEmailHtml(label)}:</span> ${nl2br(turn.text)}</p>`;
        })
        .join("")
    : `<p style="margin:0;line-height:1.55;color:#ffffff;">${nl2br(transcript)}</p>`;

  return `${sectionTitle("Full Conversation")}${card(lines)}`;
}

export function buildPostCallEmailHtml(input: PostCallEmailInput): string {
  const { date, time } = londonParts(input.startedAt);
  const outcome = emailOutcomeLabel(input.outcome);
  const agentName = displayAgentName(input.agentName);
  const actionItems = portalNextActions({ followUpTitles: input.actionItems });
  const summary = input.summary.trim();
  const callerName = cleanCallerName(input.callerName);
  const callerId = (input.callerId || "Unknown").trim() || "Unknown";
  const company = (input.company || "").trim();
  const duration = durationLabel(input.durationSeconds, input.startedAt, input.finishedAt);
  const urgency = (input.urgency || "").trim();

  const detailRows = [
    detailRow("Agent Name", agentName),
    detailRow("Caller Name", callerName || "Not captured"),
    company ? detailRow("Caller Company", company) : "",
    detailRow("Caller Phone", callerId),
    duration ? detailRow("Call Duration", duration) : "",
    urgency ? detailRow("Urgency", urgency) : "",
    date ? detailRow("Date", date) : "",
    time ? detailRow("Time", time) : "",
    detailRow("Outcome", outcome),
    detailRow("Next step", nextStepLabel(actionItems), true),
  ].filter(Boolean).join("");

  const inner = `
      <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 18px;">
        <tr>
          <td style="vertical-align:middle;padding:0 10px 0 0;">
            <img src="${EMAIL_LOGO_URL}" alt="" height="32" style="height:32px;width:auto;display:block;" />
          </td>
          <td style="vertical-align:middle;font-size:28px;line-height:1;font-weight:800;">
            <span style="color:#ffffff;">Wise</span><span style="color:${BRAND_MINT};">Call</span>
          </td>
        </tr>
      </table>
      <p style="margin:0 0 22px;font-size:20px;font-weight:700;color:#ffffff;">Call transcript</p>
      ${card(`<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${detailRows}</table>`)}
      ${followUpBlockHtml(actionItems)}
      ${
        summary
          ? `${sectionTitle("WiseCall Summary")}${card(`<p style="margin:0;color:#ffffff;line-height:1.6;">${escapeEmailHtml(summary)}</p>`)}`
          : ""
      }
      ${transcriptHtml(input)}
      <p style="margin:8px 0 0;font-size:12px;color:#9bb3b3;">Open the conversation in your WiseCall inbox to call back or mark follow-ups done.</p>`;

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
</head>
<body style="margin:0;padding:0;background:${BRAND_DARK};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BRAND_DARK};padding:24px 0;">
<tr><td align="center">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:600px;max-width:100%;font-family:${FONT};color:#ffffff;">
<tr><td style="padding:8px 24px 28px;">
${inner}
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

export function buildPostCallEmailText(input: PostCallEmailInput): string {
  const actionItems = portalNextActions({ followUpTitles: input.actionItems });
  const callerName = cleanCallerName(input.callerName);
  const turns = parseEmailTranscript(input.transcript);
  const { date, time } = londonParts(input.startedAt);
  const duration = durationLabel(input.durationSeconds, input.startedAt, input.finishedAt);
  const blocks = [
    "WiseCall",
    "Call transcript",
    `Agent Name: ${displayAgentName(input.agentName)}`,
    `Caller Name: ${callerName || "Not captured"}`,
    input.company?.trim() ? `Caller Company: ${input.company.trim()}` : "",
    `Caller Phone: ${input.callerId || "Unknown"}`,
    duration ? `Call Duration: ${duration}` : "",
    input.urgency?.trim() ? `Urgency: ${input.urgency.trim()}` : "",
    date ? `Date: ${date}` : "",
    time ? `Time: ${time}` : "",
    input.outcome.trim() ? `Outcome: ${emailOutcomeLabel(input.outcome)}` : "",
    `Next step: ${nextStepLabel(actionItems)}`,
  ].filter(Boolean);

  if (actionItems.length) {
    blocks.push(["Follow-up needed:", ...actionItems.map((item) => `- ${item}`)].join("\n"));
  }
  if (input.summary.trim()) {
    blocks.push(`WiseCall Summary: ${input.summary.trim()}`);
  }
  if (turns.length) {
    const callerLabel = callerName || "Caller";
    blocks.push(
      [
        "Full Conversation",
        ...turns.map(
          (turn) => `${turn.speaker === "caller" ? callerLabel : "WiseCall"}: ${turn.text}`,
        ),
      ].join("\n"),
    );
  } else if (input.transcript.trim()) {
    blocks.push(input.transcript.trim());
  }
  return blocks.join("\n\n");
}
