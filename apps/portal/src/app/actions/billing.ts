"use server";

import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getServiceSupabase } from "@/lib/supabase";
import { getAppBaseUrl } from "@/lib/env";
import {
  getStripe,
  paygLineItems,
  TRIAL_DAYS,
  TRIAL_CALL_CAP,
} from "@/lib/stripe";

export type CheckoutResult = { ok: boolean; url?: string; error?: string };

// Starts the 7-day PAYG free trial. Finds-or-creates the customer's Stripe
// customer, persists it on wisecall_billing, then opens a Checkout Session that
// collects a card (required, even during the trial) and applies 20% VAT. The
// subscription itself is recorded by the Stripe webhook once checkout completes.
export async function startTrialCheckout(): Promise<CheckoutResult> {
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
        plan: "payg",
        trial_call_cap: TRIAL_CALL_CAP,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "user_id" },
    );
  }

  const baseUrl = getAppBaseUrl();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    customer: customerId,
    line_items: paygLineItems(),
    payment_method_collection: "always", // card on file even during the free trial
    allow_promotion_codes: true,
    billing_address_collection: "required",
    subscription_data: {
      trial_period_days: TRIAL_DAYS,
      trial_settings: { end_behavior: { missing_payment_method: "cancel" } },
      metadata: { owner_id: user.id, plan: "payg" },
    },
    metadata: { owner_id: user.id, plan: "payg" },
    success_url: `${baseUrl}/dashboard`,
    cancel_url: `${baseUrl}/billing`,
  });

  if (!session.url) return { ok: false, error: "Could not start checkout." };
  return { ok: true, url: session.url };
}
