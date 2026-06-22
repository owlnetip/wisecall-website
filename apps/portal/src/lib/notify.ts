// Triggers the WiseCall trial-ending reminder (email via Resend + SMS via Vonage)
// through the Supabase Edge Function `wisecall-trial-reminder`, which holds the
// provider keys (so they don't need to live in Vercel). Fail-soft + env-gated:
// no-op if the Supabase URL or trigger secret isn't configured.
export async function notifyTrialEnding(params: {
  email: string | null;
  phone: string | null;
  endDate: string;
  manageUrl: string;
  billingLine?: string | null;
  final?: boolean;
}) {
  const base = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const secret = process.env.WISECALL_TRIAL_REMINDER_SECRET;
  if (!base || !secret) {
    console.error(
      "trial reminder not configured (NEXT_PUBLIC_SUPABASE_URL / WISECALL_TRIAL_REMINDER_SECRET)",
    );
    return;
  }
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}/functions/v1/wisecall-trial-reminder`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-trigger-secret": secret },
      body: JSON.stringify(params),
    });
    if (!res.ok) {
      console.error(
        "trial reminder send failed:",
        res.status,
        (await res.text().catch(() => "")).slice(0, 160),
      );
    }
  } catch (err) {
    console.error("trial reminder error:", err instanceof Error ? err.message : err);
  }
}
