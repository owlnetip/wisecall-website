import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { readSalesforceSmsEnv, secretsMatch } from "@/lib/salesforce-sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

// Stripe usage-meter events for WiseCall channels (SMS segments first).
// Called by the wisecall-sms-metering edge function: the Supabase functions'
// STRIPE_SECRET_KEY is on a different Stripe account, the portal's is on the
// live Owlnet IP account that owns the meters and subscriptions.
// Auth: x-wisecall-salesforce-secret (the shared WiseCall ↔ edge secret).
//   POST { events: [{ event_name, stripe_customer_id, value, identifier, timestamp }] }
//   → { results: [{ identifier, ok, duplicate?, error? }] }

type MeterEvent = { event_name: string; stripe_customer_id: string; value: number; identifier: string; timestamp?: number };

export async function POST(request: Request) {
  const read = readSalesforceSmsEnv(process.env);
  if (!read.ok) return NextResponse.json({ ok: false, error: "not_configured" }, { status: 503 });
  if (!secretsMatch(request.headers.get("x-wisecall-salesforce-secret") || "", read.config.secret)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const stripe = getStripe();
  if (!stripe) return NextResponse.json({ ok: false, error: "Stripe not configured" }, { status: 503 });

  let events: MeterEvent[];
  try {
    const body = (await request.json()) as { events?: MeterEvent[] };
    events = Array.isArray(body.events) ? body.events.slice(0, 200) : [];
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }

  const results = [];
  for (const event of events) {
    if (!event?.event_name || !event.stripe_customer_id || !event.identifier || !(Number(event.value) > 0)) {
      results.push({ identifier: event?.identifier ?? null, ok: false, error: "invalid event" });
      continue;
    }
    try {
      await stripe.billing.meterEvents.create({
        event_name: event.event_name,
        payload: { stripe_customer_id: event.stripe_customer_id, value: String(event.value) },
        identifier: event.identifier,
        ...(event.timestamp ? { timestamp: Math.floor(event.timestamp) } : {}),
      });
      results.push({ identifier: event.identifier, ok: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Stripe already has this identifier: it was reported before.
      if (/identifier/i.test(message) && /(exist|duplicate|already)/i.test(message)) {
        results.push({ identifier: event.identifier, ok: true, duplicate: true });
      } else {
        results.push({ identifier: event.identifier, ok: false, error: message.slice(0, 200) });
      }
    }
  }
  return NextResponse.json({ ok: true, results });
}
