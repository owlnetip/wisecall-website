import type Stripe from "stripe";
import { getStripe, getStripeWebhookSecret } from "@/lib/stripe";
import { getServiceSupabase } from "@/lib/supabase";
import { getAppBaseUrl } from "@/lib/env";
import { notifyTrialEnding } from "@/lib/notify";

// Stripe webhooks need the Node runtime + the raw request body to verify the
// signature, so don't let Next parse/cache it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function unixToIso(secs: number | null | undefined): string | null {
  return typeof secs === "number" ? new Date(secs * 1000).toISOString() : null;
}

function periodEnd(sub: Stripe.Subscription): string | null {
  // API versions differ on where the period end lives (subscription-level vs
  // per-item). Prefer the item, fall back to the top-level field.
  const item = sub.items?.data?.[0] as { current_period_end?: number } | undefined;
  const top = (sub as unknown as { current_period_end?: number }).current_period_end;
  return unixToIso(item?.current_period_end ?? top);
}

// Resolves which auth user a subscription belongs to: the owner_id we stamped on
// subscription metadata at checkout, else the existing billing row for the customer.
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

async function upsertFromSubscription(sub: Stripe.Subscription) {
  const service = getServiceSupabase();
  if (!service) return;

  const userId = await resolveOwnerId(sub, service);
  if (!userId) {
    console.error("stripe webhook: could not resolve owner for subscription", sub.id);
    return;
  }

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
  const notificationPhone = await fetchStripeCustomerPhone(
    getStripe(),
    customerId,
  );

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

// On a new checkout (e.g. switching plans), cancel the customer's other live
// subscriptions so they aren't billed twice. Best-effort: needs the Stripe key
// to allow Subscriptions write — logs and continues if not.
async function cancelOtherSubscriptions(
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
      if (s.status === "active" || s.status === "trialing" || s.status === "past_due") {
        try {
          await stripe.subscriptions.cancel(s.id);
          console.log("stripe webhook: cancelled superseded subscription", s.id);
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

// Stripe fires customer.subscription.trial_will_end ~3 days before a trial ends.
// We email + SMS the customer so they're never surprise-charged (cuts refunds /
// disputes) with a link to the customer portal to cancel or change plan.
async function sendTrialEndingReminder(stripe: Stripe, sub: Stripe.Subscription) {
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
          await upsertFromSubscription(sub);
          const customerId =
            typeof sub.customer === "string" ? sub.customer : sub.customer?.id;
          await cancelOtherSubscriptions(stripe, customerId, sub.id);
        }
        break;
      }
      case "customer.subscription.created":
      case "customer.subscription.updated":
      case "customer.subscription.deleted": {
        await upsertFromSubscription(event.data.object as Stripe.Subscription);
        break;
      }
      case "customer.subscription.trial_will_end": {
        await sendTrialEndingReminder(stripe, event.data.object as Stripe.Subscription);
        break;
      }
      default:
        // Ignore everything else.
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
