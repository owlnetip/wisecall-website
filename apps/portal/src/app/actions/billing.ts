"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getAppBaseUrl } from "@/lib/env";
import {
  getStripe,
  lineItemsForPlan,
  lineItemsForEmailChannel,
  planHasTrial,
  isPlanId,
  type PlanId,
  TRIAL_DAYS,
  TRIAL_CALL_CAP,
} from "@/lib/stripe";
import { getBillingForUser, hasActiveAccess, hasEmailChannelAccess } from "@/lib/billing";

export type CheckoutResult = { ok: boolean; url?: string; error?: string };

// Starts Stripe Checkout for the chosen plan. Every plan includes a 7-day free
// trial (card required; 20 AI-call cap enforced in-app). Finds-or-creates the
// Stripe customer and reuses it (so an upgrade attaches to the same customer).
// The subscription is recorded by the webhook once checkout completes; the
// webhook also cancels any prior subscription so an upgrade doesn't double-bill.
export async function startCheckout(planInput: string): Promise<CheckoutResult> {
  const plan: PlanId = isPlanId(planInput) ? planInput : "professional";

  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Billing isn't switched on yet." };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  // Reuse an existing Stripe customer if we've made one before.
  const { data: existing } = await service
    .from("wisecall_billing")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let customerId = existing?.stripe_customer_id as string | undefined;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { owner_id: user.id },
    });
    customerId = customer.id;
    await service.from("wisecall_billing").upsert(
      {
        user_id: user.id,
        stripe_customer_id: customerId,
        plan,
        trial_call_cap: TRIAL_CALL_CAP,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  }

  const trial = planHasTrial(plan);
  const baseUrl = getAppBaseUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: lineItemsForPlan(plan),
    payment_method_collection: "always",
    allow_promotion_codes: true,
    billing_address_collection: "required",
    phone_number_collection: { enabled: true }, // captured for the trial-ending SMS
    subscription_data: {
      ...(trial
        ? {
            trial_period_days: TRIAL_DAYS,
            trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
          }
        : {}),
      metadata: { owner_id: user.id, plan },
    },
    metadata: { owner_id: user.id, plan },
    success_url: `${baseUrl}/dashboard`,
    cancel_url: `${baseUrl}/billing`,
  });

  if (!session.url) return { ok: false, error: "Could not start checkout." };
  return { ok: true, url: session.url };
}

// Email channel add-on — £79/mo, no trial. Requires an active Core/Growth/Pro plan first.
export async function startEmailChannelCheckout(): Promise<CheckoutResult> {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const billing = await getBillingForUser(user.id);
  if (!hasActiveAccess(billing)) {
    return { ok: false, error: "Start a WiseCall plan before adding Email channel." };
  }
  if (hasEmailChannelAccess(billing)) {
    return { ok: false, error: "Email channel is already active on your account." };
  }

  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Billing isn't switched on yet." };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const customerId = billing?.stripeCustomerId;
  if (!customerId) {
    return { ok: false, error: "No billing account found — contact support." };
  }

  const baseUrl = getAppBaseUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: lineItemsForEmailChannel(),
    payment_method_collection: "always",
    allow_promotion_codes: true,
    subscription_data: {
      metadata: { owner_id: user.id, addon: "email_channel" },
    },
    metadata: { owner_id: user.id, addon: "email_channel" },
    success_url: `${baseUrl}/dashboard?email_channel=1`,
    cancel_url: `${baseUrl}/billing`,
  });

  if (!session.url) return { ok: false, error: "Could not start checkout." };
  return { ok: true, url: session.url };
}

// Opens the Stripe Customer Portal so a customer can cancel or change their
// subscription (e.g. before the trial converts). Requires the Customer Portal to
// be enabled in the Stripe dashboard.
export async function openCustomerPortal(): Promise<CheckoutResult> {
  const auth = await createSupabaseServerClient();
  const {
    data: { user },
  } = await auth.auth.getUser();
  if (!user) return { ok: false, error: "Not signed in." };

  const stripe = getStripe();
  if (!stripe) return { ok: false, error: "Billing isn't switched on yet." };

  const service = getServiceSupabase();
  if (!service) return { ok: false, error: "Server not configured." };

  const { data: row } = await service
    .from("wisecall_billing")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  const customerId = row?.stripe_customer_id as string | undefined;
  if (!customerId) return { ok: false, error: "No subscription found." };

  try {
    const portal = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${getAppBaseUrl()}/dashboard`,
    });
    return { ok: true, url: portal.url };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Could not open the billing portal.",
    };
  }
}
