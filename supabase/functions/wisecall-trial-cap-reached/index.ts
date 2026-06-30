import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-trigger-secret",
};

type BillingRow = {
  user_id: string;
  stripe_customer_id: string | null;
  plan: string | null;
  status: string | null;
  trial_end: string | null;
  trial_call_cap: number | null;
  notification_phone: string | null;
};

function requireEnv(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`${name} is not configured`);
  return value;
}

function formatDate(iso: string | null): string {
  if (!iso) return "soon";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function planLabel(plan: string | null): string {
  switch (plan) {
    case "growth":
      return "Growth";
    case "pro":
      return "Pro";
    default:
      return "Core";
  }
}

async function fetchStripePhone(customerId: string): Promise<string | null> {
  const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
  if (!stripeKey) return null;

  const res = await fetch(`https://api.stripe.com/v1/customers/${customerId}`, {
    headers: { Authorization: `Bearer ${stripeKey}` },
  });
  if (!res.ok) return null;

  const customer = (await res.json()) as { phone?: string | null; deleted?: boolean };
  if (customer.deleted) return null;
  return customer.phone ?? null;
}

async function sendEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<boolean> {
  const apiKey = Deno.env.get("RESEND_API_KEY");
  const from = Deno.env.get("RESEND_FROM_EMAIL") ?? "WiseCall <hello@wisecall.io>";
  if (!apiKey) return false;

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from,
      to: [params.to],
      subject: params.subject,
      html: params.html,
    }),
  });

  if (!res.ok) {
    console.error("resend failed", res.status, await res.text().catch(() => ""));
    return false;
  }
  return true;
}

async function sendSms(params: { to: string; text: string }): Promise<boolean> {
  const apiKey = Deno.env.get("VONAGE_API_KEY");
  const apiSecret = Deno.env.get("VONAGE_API_SECRET");
  const from = Deno.env.get("VONAGE_FROM_NUMBER");
  if (!apiKey || !apiSecret || !from) return false;

  const credentials = btoa(`${apiKey}:${apiSecret}`);
  const res = await fetch("https://api.nexmo.com/v1/messages", {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: "sms",
      message_type: "text",
      to: params.to.replace(/\s+/g, ""),
      from,
      text: params.text,
    }),
  });

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    console.error("vonage failed", res.status, body);
    return false;
  }
  return true;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const expectedSecret = Deno.env.get("WISECALL_TRIAL_REMINDER_SECRET");
  const triggerSecret = req.headers.get("x-trigger-secret");
  if (!expectedSecret || triggerSecret !== expectedSecret) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let ownerId: string;
  try {
    const payload = (await req.json()) as { owner_id?: string };
    ownerId = payload.owner_id ?? "";
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!ownerId) {
    return new Response(JSON.stringify({ error: "owner_id is required" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(
      requireEnv("SUPABASE_URL"),
      requireEnv("SUPABASE_SERVICE_ROLE_KEY"),
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: billing, error: billingError } = await supabase
      .from("wisecall_billing")
      .select(
        "user_id, stripe_customer_id, plan, status, trial_end, trial_call_cap, notification_phone",
      )
      .eq("user_id", ownerId)
      .maybeSingle();

    if (billingError) {
      console.error("billing lookup failed", billingError.message);
      return new Response(JSON.stringify({ error: "Billing lookup failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const row = billing as BillingRow | null;
    if (!row || row.status !== "trialing") {
      return new Response(JSON.stringify({ ok: true, skipped: "not_trialing" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userData, error: userError } = await supabase.auth.admin.getUserById(ownerId);
    if (userError) {
      console.error("auth lookup failed", userError.message);
      return new Response(JSON.stringify({ error: "User lookup failed" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const email = userData.user?.email ?? null;
    let phone = row.notification_phone;
    if (!phone && row.stripe_customer_id) {
      phone = await fetchStripePhone(row.stripe_customer_id);
    }

    const manageUrl =
      Deno.env.get("WISECALL_APP_URL")?.replace(/\/$/, "") ??
      "https://app.wisecall.io/billing";
    const billingUrl = manageUrl.endsWith("/billing") ? manageUrl : `${manageUrl}/billing`;
    const endDate = formatDate(row.trial_end);
    const cap = row.trial_call_cap ?? 20;
    const plan = planLabel(row.plan);

    const smsText =
      `WiseCall: You've used all ${cap} trial calls - your AI agent is paused. ` +
      `Manage or cancel before ${endDate} to avoid being charged: ${billingUrl}`;

    const emailHtml = `
      <p>Hi,</p>
      <p>You've used all <strong>${cap} AI calls</strong> included in your WiseCall free trial (${plan} plan).</p>
      <p>Your AI receptionist is now <strong>paused</strong> and won't answer new calls until your subscription is active.</p>
      <p>Your trial ends on <strong>${endDate}</strong>. After that, billing starts unless you cancel.</p>
      <p><a href="${billingUrl}">Manage your subscription or cancel</a></p>
      <p>- WiseCall</p>
    `.trim();

    const results = {
      email: false,
      sms: false,
    };

    if (email) {
      results.email = await sendEmail({
        to: email,
        subject: "Your WiseCall trial call limit has been reached",
        html: emailHtml,
      });
    }

    if (phone) {
      results.sms = await sendSms({ to: phone, text: smsText });
    }

    if (!email && !phone) {
      console.error("trial cap notify: no contact details for owner", ownerId);
    }

    return new Response(JSON.stringify({ ok: true, ...results }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("trial cap notify error", err);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
