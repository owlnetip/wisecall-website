import type Stripe from "stripe";
import {
  getStripe,
  getStripeWebhookSecret,
  isEmailChannelSubscription,
  EMAIL_INCLUDED_REPLIES,
} from "@/lib/stripe";
import { getServiceSupabase } from "@/lib/supabase";
import { getAppBaseUrl } from "@/lib/env";
import { notifyTrialEnding } from "@/lib/notify";
import { syncEmailChannelProfiles } from "@/lib/billing";

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

  await service.from("wisecall_billing").upsert(
    {
      user_id: userId,
      stripe_customer_id: customerId ?? null,
      subscription_id: sub.id,
      plan: sub.metadata?.plan ?? "core",
      status: sub.status,
      trial_end: unixToIso(sub.trial_end),
      current_period_end: periodEnd(sub),
      ...(notificationPhone ? { notification_phone: notificationPhone } : {}),
      updated_at: new Date().toISOString(),
    },
    { onConflict: "user_id" },
  );
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

  await notifyTrialEnding({ email, phone, endDate, manageUrl });
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
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await handleSubscriptionEvent(sub);
        if (
          event.type === "customer.subscription.deleted" &&
          isEmailChannelSubscription(sub.metadata)
        ) {
          const userId = await resolveOwnerId(sub, getServiceSupabase());
          if (userId) await syncEmailChannelProfiles(userId, false);
        }
        break;
      }
      case "customer.subscription.trial_will_end": {
        await sendTrialEndingReminder(stripe, event.data.object as Stripe.Subscription);
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
