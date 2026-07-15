/**
 * Shared helpers for the visual (HTML) outreach email editor.
 *
 * The editor produces a fragment of "inner" HTML (headings, paragraphs,
 * images, buttons). Before previewing or sending we wrap that fragment in a
 * branded, email-client-safe shell (table layout + inline styles) so it
 * looks like a real WiseCall email rather than raw browser markup.
 *
 * Merge fields stay as {{token}} text inside the HTML so the existing
 * renderer (renderOutreachTemplate) substitutes them exactly as it does for
 * plain-text templates — HTML templates need no special rendering path.
 */

export type MergeField = { token: string; label: string };

/** Personalisation tokens offered in the editor's "Personalise" menu. */
export const MERGE_FIELDS: MergeField[] = [
  { token: "practice_name", label: "Practice name" },
  { token: "contact_name", label: "Contact name" },
  { token: "area", label: "Area" },
  { token: "region", label: "Region" },
  { token: "postcode", label: "Postcode" },
  { token: "pms", label: "PMS / software" },
  { token: "phone", label: "Phone" },
  { token: "website", label: "Website" },
  { token: "unsubscribe_url", label: "Unsubscribe link" },
];

const BRAND_DARK = "#172929";

/** Public, absolutely-hosted logo (served by the portal itself). */
export const EMAIL_LOGO_URL =
  process.env.NEXT_PUBLIC_EMAIL_LOGO_URL || "https://app.wisecall.io/owl-logo.png";

/**
 * True when a template row should be treated as a rich HTML email. Legacy
 * plain-text templates (no body_html) keep sending as text, unchanged.
 */
export function isHtmlBody(bodyHtml: string | null | undefined): boolean {
  return typeof bodyHtml === "string" && bodyHtml.trim().length > 0;
}

/**
 * Strip anything unsafe / non-email-friendly from editor HTML. This is an
 * admin-only composer (the "attacker" would be the admin), so the goal is
 * clean, email-client-safe markup rather than XSS defence — email clients
 * strip <script> etc. regardless. We still remove scripts, event handlers
 * and javascript: URLs so nothing broken or dangerous is ever stored/sent.
 */
export function sanitizeEmailHtml(html: string): string {
  if (!html) return "";
  return (
    html
      // drop script/style/iframe/object blocks entirely
      .replace(/<\s*(script|style|iframe|object|embed|link|meta)[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
      .replace(/<\s*(script|style|iframe|object|embed|link|meta)[^>]*\/?\s*>/gi, "")
      // strip inline event handlers: on*="..."
      .replace(/\son\w+\s*=\s*"[^"]*"/gi, "")
      .replace(/\son\w+\s*=\s*'[^']*'/gi, "")
      // neutralise javascript: / data: (except images) URLs in href/src
      .replace(/(href|src)\s*=\s*"(\s*javascript:|\s*data:(?!image\/))[^"]*"/gi, '$1="#"')
      .trim()
  );
}

/**
 * The visual editor shows merge fields as friendly pills
 * (<span data-merge="practice_name">Practice name</span>). Before storing /
 * sending we convert those back to bare {{token}} text so the standard
 * renderer substitutes them and no editor-only styling leaks into the email.
 */
export function unwrapMergeChips(html: string): string {
  if (!html) return "";
  return html.replace(
    /<span[^>]*\bdata-merge\s*=\s*"([\w.-]+)"[^>]*>[\s\S]*?<\/span>/gi,
    (_m, token: string) => `{{${token}}}`,
  );
}

/** Best-effort plain-text fallback for the HTML body (Resend `text`). */
export function htmlToText(html: string): string {
  return html
    .replace(/<\s*br\s*\/?\s*>/gi, "\n")
    .replace(/<\s*\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "• ")
    .replace(/<a[^>]*href\s*=\s*"([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi, "$2 ($1)")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Wrap the editor's inner HTML in a branded, email-client-safe shell.
 * Table-based + inline styles for Outlook/Gmail compatibility.
 */
export function wrapEmailHtml(innerHtml: string): string {
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
<tr><td style="background:${BRAND_DARK};padding:20px 28px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="border-collapse:collapse;">
<tr>
<td style="vertical-align:middle;padding:0 10px 0 0;">
<img src="${EMAIL_LOGO_URL}" alt="" height="34" style="height:34px;width:auto;display:block;" />
</td>
<td style="vertical-align:middle;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:20px;line-height:1;font-weight:800;">
<span style="color:#ffffff;">Wise</span><span style="color:#7de8eb;">Call</span>
</td>
</tr>
</table>
</td></tr>
<tr><td style="padding:28px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:16px;line-height:1.6;color:#1a2b2b;">
${innerHtml}
</td></tr>
<tr><td style="padding:20px 28px;background:#f4f7f7;border-top:1px solid #d8e4e4;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;font-size:12px;line-height:1.5;color:#5a7272;">
WiseCall · AI receptionists for UK businesses<br/>
<a href="https://wisecall.io/dental" style="color:#0e7d82;text-decoration:none;">wisecall.io/dental</a>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}
