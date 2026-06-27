import type Stripe from "stripe";
import {
  getStripe,
  getStripeWebhookSecret,
  planDisplayName,
  isEmailChannelSubscription,
  EMAIL_INCLUDED_REPLIES,
  VAT_RATE,
  planCallsIncluded,
  planEmailIncluded,
  planWhatsappIncluded,
  planOverageRateGbp,
} from "@/lib/stripe";
import { getServiceSupabase } from "@/lib/supabase";
import { getAppBaseUrl } from "@/lib/env";
import { notifyTrialEnding } from "@/lib/notify";
import { syncEmailChannelProfiles, getBillingForUser, hasActiveAccess } from "@/lib/billing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unixToIso(secs: number | null | undefined): string | null {
  return typeof secs === "number" ? new Date(secs * 1000).toISOString() : null;
}

function periodEnd(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  const top = (sub as unknown as { current_period_end?: number }).current_period_end;
  return unixToIso(item?.current_period_end ?? top);
}

async function resolveOwnerId(
  sub: Stripe.Subscription,
  service: ReturnType<typeof getServiceSupabase>,
): Promise<string | null> {
  const fromMeta = sub.metadata?.owner_id;
  if (fromMeta) return fromMeta;

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId || !service) return null;

  const { data } = await service
    .from("wisecall_billing")
    .select("user_id")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();
  return (data?.user_id as string | undefined) ?? null;
}

// Returns pooled numbers to the pool (and clears them off the owner's agents)
// when the customer no longer has active access — i.e. a real cancellation, not
// a plan switch (which also fires subscription.deleted for the superseded sub).
async function reclaimOwnerNumbers(
  userId: string,
  service: ReturnType<typeof getServiceSupabase>,
): Promise<void> {
  if (!service) return;
  // Still a paying/trialing customer (e.g. just switched plans) — keep their number.
  if (hasActiveAccess(await getBillingForUser(userId))) return;

  const { data: profiles } = await service
    .from("wisecall_profiles")
    .select("id, metadata")
    .eq("metadata->>owner_id", userId);
  const rows = (profiles ?? []) as { id: string; metadata: Record<string, unknown> | null }[];
  if (!rows.length) return;
  const ids = rows.map((p) => p.id);

  const now = new Date().toISOString();
  // Free the pool numbers for reuse.
  await service
    .from("wisecall_number_pool")
    .update({ status: "free", assigned_profile_id: null, assigned_at: null, released_at: now, updated_at: now })
    .in("assigned_profile_id", ids);

  // Clear the number off each agent + mark it unprovisioned/inactive.
  for (const p of rows) {
    const meta = (p.metadata ?? {}) as Record<string, unknown>;
    await service
      .from("wisecall_profiles")
      .update({
        telnyx_number: null,
        is_active: false,
        metadata: { ...meta, routing: { provider: null, number: "", status: "unprovisioned" } },
      })
      .eq("id", p.id);
  }
}

async function fetchStripeCustomerPhone(
  stripe: ReturnType<typeof getStripe>,
  customerId: string | null | undefined,
): Promise<string | null> {
  if (!stripe || !customerId) return null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if ("deleted" in customer && customer.deleted) return null;
    return (customer as Stripe.Customer).phone ?? null;
  } catch (err) {
    console.error(
      "stripe webhook: customer phone lookup failed",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function upsertPlanSubscription(sub: Stripe.Subscription) {
  const service = getServiceSupabase();
  if (!service) return;

  const userId = await resolveOwnerId(sub, service);
  if (!userId) {
    console.error("stripe webhook: could not resolve owner for plan subscription", sub.id);
    return;
  }

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const notificationPhone = await fetchStripeCustomerPhone(getStripe(), customerId);
  const plan = sub.metadata?.plan ?? "professional";
  const newPeriodEnd = periodEnd(sub);
  const planActive = sub.status === "active" || sub.status === "trialing";

  // Detect billing period change so we can reset usage counters for the new period.
  const { data: existing } = await service
    .from("wisecall_billing")
    .select("calls_period_end")
    .eq("user_id", userId)
    .maybeSingle();
  const prevPeriodEnd = (existing?.calls_period_end as string | null) ?? null;
  const periodChanged = Boolean(newPeriodEnd && prevPeriodEnd && newPeriodEnd !== prevPeriodEnd);

  await service.from("wisecall_billing").upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId ?? null,
      subscription_id: sub.id,
      plan,
      status: sub.status,
      trial_end: unixToIso(sub.trial_end),
      current_period_end: newPeriodEnd,
      // Bundled channel allowances (single-platform model).
      calls_monthly_allowance: planCallsIncluded(plan) || undefined,
      calls_period_end: newPeriodEnd,
      // AI email is now bundled into every plan (£79 add-on retired). Enable it for
      // any active/trialing plan so the email-inbound gate passes, and set the
      // per-plan email allowance.
      email_channel_enabled: planActive ? true : false,
      email_channel_status: planActive ? "active" : sub.status,
      email_monthly_allowance: planEmailIncluded(plan) || undefined,
      whatsapp_monthly_allowance: planWhatsappIncluded(plan) || undefined,
      whatsapp_period_end: newPeriodEnd,
      ...(periodChanged
        ? {
            calls_used_period: 0,
            calls_overage_period: 0,
            email_used_period: 0,
            email_overage_period: 0,
            whatsapp_used_period: 0,
            whatsapp_overage_period: 0,
          }
        : {}),
      ...(notificationPhone ? { notification_phone: notificationPhone } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );

  // Mirror email-enabled onto the owner's agent profiles (runtime/UI reads metadata).
  await syncEmailChannelProfiles(userId, planActive);
}

async function upsertEmailChannelSubscription(sub: Stripe.Subscription) {
  const service = getServiceSupabase();
  if (!service) return;

  const userId = await resolveOwnerId(sub, service);
  if (!userId) {
    console.error("stripe webhook: could not resolve owner for email channel subscription", sub.id);
    return;
  }

  const active = sub.status === "active";
  const end = periodEnd(sub);

  const { data: existing } = await service
    .from("wisecall_billing")
    .select("email_period_end")
    .eq("user_id", userId)
    .maybeSingle();

  const priorEnd = (existing?.email_period_end as string | null) ?? null;
  const newPeriod = Boolean(end && priorEnd && end !== priorEnd);

  await service
    .from("wisecall_billing")
    .update({
      email_channel_enabled: active,
      email_channel_subscription_id: sub.id,
      email_channel_status: sub.status,
      email_period_end: end,
      email_monthly_allowance: EMAIL_INCLUDED_REPLIES,
      ...(newPeriod ? { email_used_period: 0, email_overage_period: 0 } : {}),
      updated_at: new Date().toISOString(),
    })
    .eq("user_id", userId);

  await syncEmailChannelProfiles(userId, active);
}

async function handleSubscriptionEvent(sub: Stripe.Subscription) {
  if (isEmailChannelSubscription(sub.metadata)) {
    await upsertEmailChannelSubscription(sub);
    return;
  }
  await upsertPlanSubscription(sub);
}

async function handleDeletedSubscription(sub: Stripe.Subscription) {
  const svc = getServiceSupabase();
  const userId = await resolveOwnerId(sub, svc);
  if (!userId) return;

  if (isEmailChannelSubscription(sub.metadata)) {
    await syncEmailChannelProfiles(userId, false);
    return;
  }

  // Main plan cancelled — return pooled numbers for reuse (the helper no-ops
  // if the customer still has active access, e.g. a plan switch).
  await reclaimOwnerNumbers(userId, svc);
}

// When switching Core/Growth/Pro, cancel other plan subs — keep the email channel add-on.
async function cancelOtherPlanSubscriptions(
  stripe: Stripe,
  customerId: string | null | undefined,
  keepId: string,
) {
  if (!customerId) return;
  try {
    const subs = await stripe.subscriptions.list({
      customer: customerId,
      status: "all",
      limit: 20,
    });
    for (const s of subs.data) {
      if (s.id === keepId) continue;
      if (isEmailChannelSubscription(s.metadata)) continue;
      if (s.status === "active" || s.status === "trialing" || s.status === "past_due") {
        try {
          await stripe.subscriptions.cancel(s.id);
          console.log("stripe webhook: cancelled superseded plan subscription", s.id);
        } catch (err) {
          console.error(
            "stripe webhook: could not cancel old subscription",
            s.id,
            err instanceof Error ? err.message : err,
          );
        }
      }
    }
  } catch (err) {
    console.error(
      "stripe webhook: list subscriptions failed",
      err instanceof Error ? err.message : err,
    );
  }
}

// When Stripe creates a new subscription invoice (draft, before finalisation),
// we add an overage line item for any AI calls beyond the plan's monthly allowance
// in the closing period. Stripe then includes this in the same invoice the customer pays.
async function handleInvoiceCreated(invoice: Stripe.Invoice) {
  const stripe = getStripe();
  const service = getServiceSupabase();
  if (!stripe || !service) return;

  // Only act on subscription invoices. `subscription` exists at runtime but the
  // installed Stripe types relocated it, so read it through a narrow cast. Newer
  // API versions also expose it via invoice.parent.subscription_details.
  const inv = invoice as unknown as {
    subscription?: string | { id?: string } | null;
    parent?: { subscription_details?: { subscription?: string | { id?: string } } | null } | null;
  };
  const subRef = inv.subscription ?? inv.parent?.subscription_details?.subscription ?? null;
  const subId = typeof subRef === "string" ? subRef : subRef?.id;
  if (!subId) return;

  // Skip email channel add-on invoices — only main plan subs have call overage
  let sub: Stripe.Subscription;
  try {
    sub = await stripe.subscriptions.retrieve(subId);
  } catch {
    return;
  }
  if (isEmailChannelSubscription(sub.metadata)) return;

  const customerId = typeof invoice.customer === "string"
    ? invoice.customer
    : (invoice.customer as { id?: string } | null)?.id;
  if (!customerId) return;

  // Look up their call overage for the closing period
  const { data: billing } = await service
    .from("wisecall_billing")
    .select("user_id, plan, calls_overage_period")
    .eq("stripe_customer_id", customerId)
    .maybeSingle();

  const overageCount = (billing?.calls_overage_period as number | null) ?? 0;
  if (overageCount <= 0) return;

  const plan = (billing?.plan as string | null) ?? null;
  const rateGbp = planOverageRateGbp(plan);
  const amountPence = Math.round(overageCount * rateGbp * 100);
  if (amountPence <= 0) return;

  try {
    await stripe.invoiceItems.create({
      customer: customerId,
      invoice: invoice.id,
      amount: amountPence,
      currency: "gbp",
      description: `AI call overage — ${overageCount} call${overageCount === 1 ? "" : "s"} @ £${rateGbp.toFixed(2)} each`,
      tax_rates: [VAT_RATE],
    });
    console.log(
      `stripe webhook: added call overage item — ${overageCount} calls @ £${rateGbp} = £${(amountPence / 100).toFixed(2)} for user ${billing?.user_id}`,
    );
  } catch (err) {
    console.error(
      "stripe webhook: failed to add overage invoice item",
      err instanceof Error ? err.message : err,
    );
  }
}

async function sendTrialEndingReminder(stripe: Stripe, sub: Stripe.Subscription) {
  if (isEmailChannelSubscription(sub.metadata)) return;

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  if (!customerId) return;

  let email: string | null = null;
  let phone: string | null = null;
  try {
    const customer = await stripe.customers.retrieve(customerId);
    if (!("deleted" in customer && customer.deleted)) {
      email = (customer as Stripe.Customer).email ?? null;
      phone = (customer as Stripe.Customer).phone ?? null;
    }
  } catch (err) {
    console.error("trial_will_end: customer retrieve failed", err instanceof Error ? err.message : err);
  }

  const userId = await resolveOwnerId(sub, getServiceSupabase());
  if (userId && phone) {
    const service = getServiceSupabase();
    await service
      ?.from("wisecall_billing")
      .update({ notification_phone: phone, updated_at: new Date().toISOString() })
      .eq("user_id", userId);
  }

  const endDate = sub.trial_end
    ? new Date(sub.trial_end * 1000).toLocaleDateString("en-GB", {
        day: "numeric",
        month: "long",
        year: "numeric",
      })
    : "soon";
  const manageUrl = `${getAppBaseUrl()}/billing`;
  const billingLine = billingLineForSub(sub);

  await notifyTrialEnding({ email, phone, endDate, manageUrl, billingLine });
}

// Builds the human "what you'll be charged" clause from the actual subscription
// price, so the reminder states the customer's real plan + amount (e.g. "£249/
// month (plus VAT) for your Core plan") instead of a hardcoded figure.
function billingLineForSub(sub: Stripe.Subscription): string | null {
  const item = sub.items?.data?.[0];
  const amount = item?.price?.unit_amount; // pence, excl. VAT
  const interval = item?.price?.recurring?.interval ?? "month";
  if (typeof amount !== "number") return null;
  const pounds = (amount / 100).toLocaleString("en-GB", { maximumFractionDigits: 2 });
  const planName = planDisplayName(sub.metadata?.plan);
  return `£${pounds}/${interval} (plus VAT) for your ${planName} plan`;
}

export async function POST(req: Request) {
  const stripe = getStripe();
  const secret = getStripeWebhookSecret();
  if (!stripe || !secret) {
    return new Response("Billing not configured", { status: 500 });
  }

  const signature = req.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const body = await req.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, secret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "invalid";
    console.error("stripe webhook signature verification failed:", message);
    return new Response(`Webhook Error: ${message}`, { status: 400 });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const subId =
          typeof session.subscription === "string"
            ? session.subscription
            : session.subscription?.id;
        if (subId) {
          const sub = await stripe.subscriptions.retrieve(subId);
          await handleSubscriptionEvent(sub);
          if (!isEmailChannelSubscription(sub.metadata)) {
            const customerId =
              typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
            await cancelOtherPlanSubscriptions(stripe, customerId, sub.id);
          }
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.paused":
      case "customer.subscription.resumed":
      case "customer.subscription.pending_update_applied":
      case "customer.subscription.pending_update_expired":
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await handleSubscriptionEvent(sub);
        if (event.type === "customer.subscription.deleted") {
          await handleDeletedSubscription(sub);
        }
        break;
      }
      case "customer.subscription.trial_will_end": {
        await sendTrialEndingReminder(stripe, event.data.object as Stripe.Subscription);
        break;
      }
      case "invoice.created": {
        await handleInvoiceCreated(event.data.object as Stripe.Invoice);
        break;
      }
      default:
        break;
    }
  } catch (err) {
    console.error("stripe webhook handler error:", err);
    return new Response("Handler error", { status: 500 });
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
}
