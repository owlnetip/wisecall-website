import { NextResponse } from "next/server";
import type Stripe from "stripe";
import { getStripe, VAT_RATE } from "@/lib/stripe";
import { readSalesforceSmsEnv, secretsMatch } from "@/lib/salesforce-sms";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Stripe only bills metered usage recorded while the price is on the
// subscription. When a metered price (e.g. SMS segments) is added mid-period,
// this looks up the usage recorded on its meter between the start of the
// current billing period and the moment the price was added, and adds it as a
// one-off pending invoice item, so it lands on the next invoice.
// Once per subscription item per period (metadata key). Auth: x-wisecall-salesforce-secret.
//   POST { subscription_id, dry_run? }

function json(body: Record<string, unknown>, status = 200) {
  return NextResponse.json(body, { status, headers: { "Cache-Control": "no-store" } });
}

function minuteFloor(seconds: number) {
  return Math.floor(seconds / 60) * 60;
}

export async function POST(request: Request) {
  const read = readSalesforceSmsEnv(process.env);
  if (!read.ok) return json({ ok: false, error: "not_configured" }, 503);
  if (!secretsMatch(request.headers.get("x-wisecall-salesforce-secret") || "", read.config.secret)) {
    return json({ ok: false, error: "Unauthorized" }, 401);
  }
  const stripe = getStripe();
  if (!stripe) return json({ ok: false, error: "Stripe not configured" }, 503);

  let body: { subscription_id?: string; dry_run?: boolean };
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }
  if (!body.subscription_id) return json({ ok: false, error: "subscription_id is required." }, 422);

  const sub = await stripe.subscriptions.retrieve(body.subscription_id);
  const customer = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const results: Record<string, unknown>[] = [];

  for (const item of sub.items.data) {
    const price = item.price as Stripe.Price;
    const meterId = price.recurring?.meter;
    const periodStart = (item as unknown as { current_period_start?: number }).current_period_start
      ?? (sub as unknown as { current_period_start?: number }).current_period_start;
    if (!meterId || !periodStart || !price.unit_amount_decimal) continue;
    if (item.created <= periodStart) continue; // on the subscription for the whole period: nothing missed

    const key = `usage_catchup:${item.id}:${periodStart}`;
    const existing = await stripe.invoiceItems.list({ customer, pending: true, limit: 100 });
    if (existing.data.some((ii) => ii.metadata?.catchup_key === key)) {
      results.push({ item: item.id, skipped: "already_added" });
      continue;
    }

    const start = minuteFloor(periodStart);
    const end = minuteFloor(item.created);
    if (end <= start) continue;
    const summaries = await stripe.billing.meters.listEventSummaries(meterId, {
      customer, start_time: start, end_time: end, limit: 100,
    });
    const units = summaries.data.reduce((n, s) => n + Number(s.aggregated_value || 0), 0);
    const pence = Math.round(units * Number(price.unit_amount_decimal));
    const from = new Date(start * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
    const to = new Date(end * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "Europe/London" });
    const productId = typeof price.product === "string" ? price.product : price.product.id;
    const product = await stripe.products.retrieve(productId);
    const description = `${product.name}: ${units} × ${price.unit_amount_decimal}p, ${from} to ${to}`;
    const result: Record<string, unknown> = { item: item.id, meter: meterId, units, amount_gbp: pence / 100, description };

    if (units > 0 && pence > 0 && !body.dry_run) {
      const created = await stripe.invoiceItems.create({
        customer,
        subscription: sub.id,
        amount: pence,
        currency: price.currency,
        description,
        tax_rates: [VAT_RATE],
        metadata: { catchup_key: key, meter: meterId, units: String(units) },
      });
      result.invoice_item = created.id;
    }
    results.push(result);
  }
  return json({ ok: true, dry_run: Boolean(body.dry_run), results });
}
