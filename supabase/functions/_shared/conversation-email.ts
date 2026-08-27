// Keep in sync with apps/portal/src/lib/conversation-email.ts
// Portal inbox wording: Next step / Follow-up needed / What happened.

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

export type PostCallEmailInput = {
  businessName: string;
  callerId: string;
  summary: string;
  transcript: string;
  outcome: string;
  startedAt?: string | null;
  actionItems: string[];
  agentName?: string;
};

function formatWhen(startedAt?: string | null): string {
  if (!startedAt) return "";
  const date = new Date(startedAt);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", { timeZone: "Europe/London" });
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
        <p style="margin:0 0 8px;font-size:11px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#148b8e;">Follow-up needed</p>
        <ul style="margin:0;padding-left:18px;">${items}</ul>
      </div>`;
}

export function buildPostCallEmailHtml(input: PostCallEmailInput): string {
  const when = formatWhen(input.startedAt);
  const outcome = input.outcome.trim();
  const agentName = (input.agentName || "WiseCall").trim() || "WiseCall";
  const actionItems = portalNextActions({ followUpTitles: input.actionItems });
  const summary = input.summary.trim();
  const transcript = input.transcript.trim();

  return `
    <div style="font-family:system-ui,-apple-system,sans-serif;color:#172929;max-width:640px;">
      <h2 style="margin:0 0 8px;font-size:20px;">New message for ${escapeEmailHtml(input.businessName)}</h2>
      <p style="margin:0 0 16px;color:#4a5c5b;">A caller left a message with your WiseCall assistant.</p>
      <table style="width:100%;border-collapse:collapse;margin:0 0 16px;">
        <tr><td style="padding:6px 0;color:#148b8e;font-weight:700;width:120px;">Caller</td><td>${escapeEmailHtml(input.callerId || "Unknown")}</td></tr>
        ${when ? `<tr><td style="padding:6px 0;color:#148b8e;font-weight:700;">When</td><td>${escapeEmailHtml(when)}</td></tr>` : ""}
      </table>
      <table style="width:100%;border-collapse:collapse;margin:0 0 18px;background:#f7fafa;border:1px solid #d7e4e3;border-radius:10px;">
        <tr>
          <td style="padding:12px 14px;border-right:1px solid #d7e4e3;width:33%;vertical-align:top;">
            <p style="margin:0 0 4px;font-size:10px;font-weight:800;letter-spacing:.06em;text-transform:uppercase;color:#7a8a89;">Outcome</p>
            <p style="margin:0;font-size:14px;font-weight:800;">${escapeEmailHtml(outcome || "Conversation recorded")}</p>
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
      ${
        transcript
          ? `<h3 style="margin:0 0 8px;font-size:15px;">Conversation transcript</h3><pre style="white-space:pre-wrap;background:#f7fafa;border:1px solid #d7e4e3;border-radius:8px;padding:14px;font-family:ui-monospace,monospace;line-height:1.45;">${escapeEmailHtml(transcript)}</pre>`
          : ""
      }
      <p style="margin:20px 0 0;font-size:12px;color:#7a8a89;">Open the conversation in your WiseCall inbox to call back or mark follow-ups done.</p>
    </div>`;
}

export function buildPostCallEmailText(input: PostCallEmailInput): string {
  const actionItems = portalNextActions({ followUpTitles: input.actionItems });
  const blocks = [
    `New message for ${input.businessName}`,
    `Caller: ${input.callerId || "Unknown"}`,
    input.outcome.trim() ? `Outcome: ${input.outcome.trim()}` : "",
    `Next step: ${nextStepLabel(actionItems)}`,
  ].filter(Boolean);

  if (actionItems.length) {
    blocks.push(["Follow-up needed:", ...actionItems.map((item) => `- ${item}`)].join("\n"));
  }
  if (input.summary.trim()) {
    blocks.push(`What happened: ${input.summary.trim()}`);
  }
  if (input.transcript.trim()) {
    blocks.push(input.transcript.trim());
  }
  return blocks.join("\n\n");
}
