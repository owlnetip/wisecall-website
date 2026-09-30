// ops-alert-email, email the platform owner when a background job fails.
//
// POST { subject, body }. Service-role JWT only (verify_jwt on, role checked).
// The recipient is fixed, so a leaked token can't be used to email anyone else.
// Used by scripts/bettermove-sync/run.sh on the WiseCall server, which has the
// Supabase service key but no email key.

const RECIPIENT = "owlnetip@gmail.com";

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function isServiceRole(req: Request): boolean {
  const token = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  const payload = token.split(".")[1];
  if (!payload) return false;
  try {
    return JSON.parse(atob(payload.replace(/-/g, "+").replace(/_/g, "/"))).role === "service_role";
  } catch {
    return false;
  }
}

const escapeHtml = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

Deno.serve(async (req) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  if (!isServiceRole(req)) return json({ error: "Unauthorized" }, 401);

  const body = await req.json().catch(() => ({}));
  const subject = String(body.subject ?? "").trim().slice(0, 200);
  const text = String(body.body ?? "").trim().slice(0, 8000);
  if (!subject) return json({ error: "subject is required" }, 400);

  const apiKey = Deno.env.get("RESEND_API_KEY");
  if (!apiKey) return json({ error: "RESEND_API_KEY not configured" }, 500);

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: Deno.env.get("WISECALL_EMAIL_FROM") || "WiseCall <info@owlnet.io>",
      to: [RECIPIENT],
      subject,
      text,
      html: `<pre style="font:13px/1.4 monospace;white-space:pre-wrap">${escapeHtml(text)}</pre>`,
    }),
  });
  if (!res.ok) return json({ error: `Resend ${res.status}` }, 502);
  return json({ ok: true });
});
