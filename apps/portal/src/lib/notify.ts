// Lightweight email (Resend) + SMS (Telnyx) senders. Both are env-gated and
// fail-soft: if the relevant key/from isn't configured, or anything errors, they
// log and return without throwing — so a missing config or provider hiccup never
// breaks the webhook that calls them.

export async function sendEmail(to: string | null | undefined, subject: string, html: string) {
  const key = process.env.RESEND_API_KEY;
  const from = process.env.RESEND_FROM || "WiseCall <info@owlnet.io>";
  if (!key || !to) return;
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, subject, html }),
    });
    if (!res.ok) {
      console.error("Resend email failed:", res.status, (await res.text().catch(() => "")).slice(0, 160));
    }
  } catch (err) {
    console.error("Resend email error:", err instanceof Error ? err.message : err);
  }
}

export async function sendSms(to: string | null | undefined, text: string) {
  const key = process.env.TELNYX_API_KEY;
  const from = process.env.TELNYX_SMS_FROM;
  if (!key || !from || !to) return;
  try {
    const res = await fetch("https://api.telnyx.com/v2/messages", {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from, to, text }),
    });
    if (!res.ok) {
      console.error("Telnyx SMS failed:", res.status, (await res.text().catch(() => "")).slice(0, 160));
    }
  } catch (err) {
    console.error("Telnyx SMS error:", err instanceof Error ? err.message : err);
  }
}
