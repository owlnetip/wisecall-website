import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBillingForUser, hasActiveAccess } from "@/lib/billing";
import { planDisplayName, TRIAL_CALL_CAP, TRIAL_DAYS } from "@/lib/stripe";
import { PlanCheckoutButton, ManageSubscriptionButton } from "./start-trial-button";
import { getEmailChannelUsage } from "@/lib/billing";

type Plan = {
  id: "starter" | "professional" | "business";
  name: string;
  price: string;
  tagline: string;
  allowances: string[];
  popular?: boolean;
};

const PLANS: Plan[] = [
  {
    id: "starter",
    name: "Starter",
    price: "£99",
    tagline: "Ideal for small businesses",
    allowances: [
      "100 AI calls / month",
      "100 AI email replies / month",
      "250 WhatsApp conversations / month",
      "100 live chat conversations / month",
    ],
  },
  {
    id: "professional",
    name: "Professional",
    price: "£199",
    tagline: "Growing businesses with regular enquiries",
    allowances: [
      "300 AI calls / month",
      "500 AI email replies / month",
      "500 WhatsApp conversations / month",
      "500 live chat conversations / month",
    ],
    popular: true,
  },
  {
    id: "business",
    name: "Business",
    price: "£399",
    tagline: "Busy teams & multi-site businesses",
    allowances: [
      "750 AI calls / month",
      "2,000 AI email replies / month",
      "2,000 WhatsApp conversations / month",
      "2,000 live chat conversations / month",
    ],
  },
];

// Shared inclusions, identical across plans (mirrors the marketing pricing page).
const INCLUSIONS = [
  "AI Receptionist 24/7",
  "AI Email Assistant",
  "AI WhatsApp Assistant",
  "AI Live Chat",
  "Call summaries & transcripts",
  "Appointment booking",
  "Smart routing & transfers",
  "CRM integrations",
  "Dashboard & analytics",
  "Knowledge Base",
  "AI Insights",
  "SMS notifications",
];

function Tick() {
  return (
    <span
      className="mt-0.5 inline-flex size-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
      style={{ background: "rgba(125,232,235,0.18)", color: "#7de8eb" }}
    >
      ✓
    </span>
  );
}

function checkoutLabel(
  planId: Plan["id"],
  currentPlan: string | null,
  status: string | null | undefined,
  hasPlan: boolean,
): string {
  if (currentPlan === planId) {
    return status === "trialing" ? "Current trial" : "Current plan";
  }
  return hasPlan ? "Switch to this plan" : "Start free trial";
}

export default async function BillingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/?signup=1&redirect=/billing");

  // This page doubles as the upgrade screen, so we do NOT redirect active users away.
  const billing = await getBillingForUser(user.id);
  const hasPlan = hasActiveAccess(billing);
  const currentPlan = billing?.plan ?? null;
  const emailChannel = getEmailChannelUsage(billing, hasPlan);

  return (
    <main className="min-h-screen w-full px-4 py-6 text-white sm:py-10" style={{ background: "#172929" }}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-6 flex flex-col gap-3 sm:mb-8 sm:flex-row sm:items-center sm:justify-between">
          <Link
            href="/"
            className="text-sm font-semibold transition hover:text-[#7de8eb]"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            ← Back to sign in
          </Link>
          <Link
            href="/dashboard"
            className="text-sm font-semibold transition hover:text-[#7de8eb]"
            style={{ color: "rgba(255,255,255,0.55)" }}
          >
            Dashboard
          </Link>
        </div>
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            Choose your <span style={{ color: "#7de8eb" }}>WiseCall</span> plan
          </h1>
          <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
            Everything included. Choose the amount of AI communication your business needs.
            Prices exclude VAT, billed monthly on a 12-month term.
          </p>
          <p
            className="mx-auto mt-4 max-w-2xl rounded-xl px-4 py-3 text-xs leading-relaxed"
            style={{ background: "rgba(125,232,235,0.08)", color: "rgba(125,232,235,0.9)", border: "1px solid rgba(125,232,235,0.2)" }}
          >
            <strong>7-day free trial on every plan</strong>. Try the full product with up to{" "}
            <strong>{TRIAL_CALL_CAP} AI calls</strong>. Card required; billing starts after{" "}
            {TRIAL_DAYS} days unless you cancel.
          </p>
          {hasPlan ? (
            <div
              className="mt-3 flex flex-col items-center gap-2 text-xs sm:flex-row sm:flex-wrap sm:justify-center"
              style={{ color: "rgba(125,232,235,0.85)" }}
            >
              <span>
                You&apos;re currently on <strong>{planDisplayName(currentPlan)}</strong>.
              </span>
              <span className="hidden sm:inline">·</span>
              <span>Switching cancels your current subscription.</span>
              <ManageSubscriptionButton />
              <a href="/dashboard" className="underline">
                Back to dashboard
              </a>
            </div>
          ) : null}
        </div>

        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className="relative flex flex-col rounded-2xl p-6"
              style={{
                background: "#1f3535",
                border: plan.popular ? "1.5px solid #7de8eb" : "1.5px solid rgba(255,255,255,0.08)",
              }}
            >
              {plan.popular ? (
                <span
                  className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide"
                  style={{ background: "#7de8eb", color: "#0c1717" }}
                >
                  Best value
                </span>
              ) : null}
              <h2 className="text-xl font-bold">{plan.name}</h2>
              <p className="mt-1 text-xs" style={{ color: "rgba(255,255,255,0.45)" }}>
                {plan.tagline}
              </p>

              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-3xl font-bold">{plan.price}</span>
                <span className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>
                  /month
                </span>
              </div>
              <p className="mt-1 text-[11px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.4)" }}>
                excl. VAT · 12-month term · {TRIAL_DAYS}-day free trial
              </p>

              {/* Headline allowances */}
              <div className="mt-4 space-y-2 border-y border-white/10 py-4">
                {plan.allowances.map((allowance) => (
                  <div key={allowance} className="flex items-center gap-2 text-sm font-semibold text-white">
                    <span style={{ color: "#7de8eb" }}>✓</span> {allowance}
                  </div>
                ))}
              </div>

              <div className="mt-5">
                <PlanCheckoutButton
                  plan={plan.id}
                  label={checkoutLabel(plan.id, currentPlan, billing?.status, hasPlan)}
                  variant={plan.popular ? "primary" : "secondary"}
                />
              </div>

              {/* Full inclusions */}
              <ul className="mt-5 space-y-2.5">
                {INCLUSIONS.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-white/80">
                    <Tick />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {hasPlan ? (
          <div
            className="mt-10 rounded-2xl p-6"
            style={{ background: "#1f3535", border: "1.5px solid rgba(125,232,235,0.35)" }}
          >
            <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between">
              <div className="max-w-xl">
                <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#7de8eb" }}>
                  Included in your plan
                </p>
                <h2 className="mt-1 text-xl font-bold">AI Email Assistant</h2>
                <p className="mt-2 text-sm leading-relaxed" style={{ color: "rgba(255,255,255,0.55)" }}>
                  Forward support@ to WiseCall and the same AI replies by email, logging every
                  contact alongside voice, WhatsApp and live chat conversations.
                </p>
                <p className="mt-4 text-sm font-semibold" style={{ color: "#7de8eb" }}>
                  {emailChannel.used}/{emailChannel.allowance} AI email replies used this period
                  {emailChannel.overage > 0 ? ` · ${emailChannel.overage} over allowance` : ""}
                </p>
              </div>
              <div className="flex-shrink-0">
                <Link
                  href="/dashboard"
                  className="inline-block rounded-xl px-5 py-2.5 text-sm font-bold"
                  style={{ background: "rgba(125,232,235,0.15)", color: "#7de8eb" }}
                >
                  Set up forwarding →
                </Link>
              </div>
            </div>
          </div>
        ) : null}

        <div
          className="mt-10 rounded-2xl p-6"
          style={{ background: "#1f3535", border: "1.5px solid rgba(255,255,255,0.08)" }}
        >
          <p className="text-xs font-bold uppercase tracking-wide" style={{ color: "#7de8eb" }}>
            Need more usage?
          </p>
          <div className="mt-2 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h2 className="text-xl font-bold">Extra AI Communication Pack</h2>
              <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
                £39 adds +100 AI calls, +100 email replies, +100 WhatsApp conversations and
                +100 live chat conversations for occasional busy months.
              </p>
            </div>
            <span className="text-2xl font-bold" style={{ color: "#7de8eb" }}>
              £39
            </span>
          </div>
        </div>
      </div>
    </main>
  );
}
