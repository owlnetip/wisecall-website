// wisecall-channel-overage-alert - sends a friendly email when a customer
// goes over their plan allowance on a bundled channel (SMS, email, WhatsApp,
// live chat). Overage on these channels is currently free; this email is
// informational only, letting them know how much they used and that they can
// upgrade if they're regularly hitting the limit.
//
// Called from the Stripe invoice.created webhook handler (Next.js) when any
// channel has overage in the closing period.
//
// Auth: x-trigger-secret == WISECALL_TRIAL_REMINDER_SECRET (reuses existing secret).
// Secrets: RESEND_API_KEY, RESEND_FROM_EMAIL, WISECALL_TRIAL_REMINDER_SECRET.
// Deploy with --no-verify-jwt.

type ChannelRow = {
  name: string;
  allowance: number;
  used: number;
  overage: number;
};

async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<void> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL") ?? "WiseCall <hello@wisecall.io>";
  if (!apiKey) throw new Error("RESEND_API_KEY not configured");

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to: [params.to], subject: params.subject, html: params.html }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new Error(`Resend ${res.status}: ${body.slice(0, 200)}`);
  }
}

function buildEmail(params: {
  plan: string | null;
  channels: ChannelRow[];
  billingUrl: string;
}): string {
  const { plan, channels, billingUrl } = params;
  const planLabel = plan
    ? plan.charAt(0).toUpperCase() + plan.slice(1)
    : "your";

  const rows = channels
    .map(
      (c) =>
        `<tr>
          <td style="padding:6px 12px;border-bottom:1px solid #eee">${c.name}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right">${c.allowance.toLocaleString()}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right">${c.used.toLocaleString()}</td>
          <td style="padding:6px 12px;border-bottom:1px solid #eee;text-align:right;color:#c0392b;font-weight:600">+${c.overage.toLocaleString()}</td>
        </tr>`,
    )
    .join("\n");

  return `
    <div style="font-family:sans-serif;max-width:560px;margin:0 auto;color:#1a1a1a">
      <p>Hi,</p>
      <p>
        Your WiseCall <strong>${planLabel} plan</strong> renewed today.
        Last month you went over your included allowance on one or more AI channels:
      </p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0;font-size:14px">
        <thead>
          <tr style="background:#f5f5f5">
            <th style="padding:8px 12px;text-align:left;border-bottom:2px solid #ddd">Channel</th>
            <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #ddd">Allowance</th>
            <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #ddd">Used</th>
            <th style="padding:8px 12px;text-align:right;border-bottom:2px solid #ddd">Over</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <p>
        <strong>Good news - there's no extra charge for channel overage this month.</strong>
        We'll always let you know before that changes.
      </p>
      <p>
        If you're regularly hitting these limits, upgrading your plan gives you a higher monthly
        allowance across all channels.
      </p>
      <p><a href="${billingUrl}" style="color:#4f46e5">Manage your plan</a></p>
      <p>- WiseCall</p>
    </div>
  `.trim();
}

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "POST only" }), { status: 405 });
  }

  const expected = Deno.env.get("WISECALL_TRIAL_REMINDER_SECRET") ?? "";
  if (!expected || req.headers.get("x-trigger-secret") !== expected) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401 });
  }

  let payload: { email?: string; plan?: string | null; channels?: ChannelRow[] };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), { status: 400 });
  }

  const { email, plan, channels } = payload;
  if (!email || !channels?.length) {
    return new Response(JSON.stringify({ error: "email and channels required" }), { status: 400 });
  }

  const billingUrl = "https://app.wisecall.io/billing";

  try {
    const html = buildEmail({ plan: plan ?? null, channels, billingUrl });
    await sendEmail({
      to: email,
      subject: "Your WiseCall channel usage this month",
      html,
    });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  } catch (err) {
    console.error("[wisecall-channel-overage-alert]", (err as Error).message);
    return new Response(JSON.stringify({ ok: false, error: (err as Error).message }), {
      status: 500,
    });
  }
});
