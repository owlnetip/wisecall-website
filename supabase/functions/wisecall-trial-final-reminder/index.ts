// wisecall-trial-final-reminder, sends the SECOND, final trial reminder ~24h
// before a trial ends, in addition to the ~3-day reminder fired by Stripe's
// customer.subscription.trial_will_end webhook. Stripe only emits trial_will_end
// once, so this 24h nudge has to be cron-driven.
//
// Runs hourly (pg_cron → net.http_post). Finds trialing customers whose trial
// ends within the next 24h and who haven't had the final reminder yet, then
// delegates the actual send to wisecall-trial-reminder (which owns the provider
// keys + copy) with final:true. Dedup via wisecall_billing.trial_final_reminder_sent_at.
//
// Auth: deployed --no-verify-jwt; header x-trigger-secret == WISECALL_POOL_REPLENISH_SECRET
//   (reuses the existing cron secret so we don't add another).
// Secrets: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, WISECALL_TRIAL_REMINDER_SECRET,
//   WISECALL_POOL_REPLENISH_SECRET.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

// Monthly list price (excl. VAT) per plan, mirrors lib/stripe.ts. Used to word
// the reminder; the authoritative charge is whatever Stripe bills.
const PLAN_PRICE_GBP: Record<string, number> = { core: 249, growth: 399, pro: 699 };
const PLAN_NAME: Record<string, string> = {
  core: "Core",
  growth: "Growth",
  pro: "Pro",
  payg: "Pay As You Go (legacy)",
};

function billingLineFor(plan: string | null): string {
  const key = String(plan || "").toLowerCase();
  const price = PLAN_PRICE_GBP[key];
  const name = PLAN_NAME[key] || "your";
  return price
    ? `£${price}/month (plus VAT) for your ${name} plan`
    : "the full price of your plan";
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });

  const expected = Deno.env.get("WISECALL_POOL_REPLENISH_SECRET") || "";
  if (!expected || req.headers.get("x-trigger-secret") !== expected) {
    return new Response(JSON.stringify({ ok: false, error: "Unauthorized" }), { status: 401 });
  }

  const json = (b: unknown, s = 200) =>
    new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const base = (Deno.env.get("SUPABASE_URL") || "").replace(/\/$/, "");
  const reminderSecret = Deno.env.get("WISECALL_TRIAL_REMINDER_SECRET");
  if (!reminderSecret) return json({ ok: false, error: "WISECALL_TRIAL_REMINDER_SECRET not set" }, 500);

  const now = new Date();
  const in24h = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString();

  // Trials ending within the next 24h that haven't had the final reminder.
  const { data: due, error } = await supabase
    .from("wisecall_billing")
    .select("user_id, plan, trial_end, notification_phone")
    .eq("status", "trialing")
    .gt("trial_end", now.toISOString())
    .lte("trial_end", in24h)
    .is("trial_final_reminder_sent_at", null)
    .limit(200);
  if (error) return json({ ok: false, error: error.message }, 500);
  if (!due?.length) return json({ ok: true, sent: 0, checked: 0 });

  let sent = 0;
  for (const row of due) {
    const userId = row.user_id as string;

    // Email comes from the auth user record; phone from the billing row (set by
    // the 3-day reminder webhook). Email-only is fine if there's no mobile.
    let email: string | null = null;
    try {
      const { data: u } = await supabase.auth.admin.getUserById(userId);
      email = u?.user?.email ?? null;
    } catch (_e) { /* email optional */ }
    const phone = (row.notification_phone as string | null) ?? null;
    if (!email && !phone) continue; // no way to reach them, leave for a later run

    const endDate = row.trial_end
      ? new Date(row.trial_end as string).toLocaleDateString("en-GB", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "soon";

    const res = await fetch(`${base}/functions/v1/wisecall-trial-reminder`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-trigger-secret": reminderSecret },
      body: JSON.stringify({
        email,
        phone,
        endDate,
        manageUrl: "https://app.wisecall.io/billing",
        billingLine: billingLineFor(row.plan as string | null),
        final: true,
      }),
    });

    // Mark sent only on a successful handoff, so a transient failure retries next run.
    if (res.ok) {
      await supabase
        .from("wisecall_billing")
        .update({ trial_final_reminder_sent_at: new Date().toISOString() })
        .eq("user_id", userId);
      sent += 1;
    }
  }

  return json({ ok: true, sent, checked: due.length });
});
