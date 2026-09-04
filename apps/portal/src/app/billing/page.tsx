import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBillingForUser, hasActiveAccess } from "@/lib/billing";
import { planDisplayName, TRIAL_CALL_CAP, TRIAL_DAYS } from "@/lib/stripe-plans";
import { isNoCardTrial } from "@/lib/trial";
import { isAdmin } from "@/lib/admin";
import { IMPERSONATE_COOKIE } from "@/lib/impersonation";
import { ManageSubscriptionButton } from "./start-trial-button";
import { PlanGrid } from "./plan-grid";
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

function checkoutLabel(
  planId: Plan["id"],
  currentPlan: string | null,
  status: string | null | undefined,
  hasPlan: boolean,
  noCardUpgrade: boolean,
): string {
  if (currentPlan === planId) {
    return status === "trialing" ? "Current trial" : "Current plan";
  }
  if (noCardUpgrade) return "Continue with this plan";
  return hasPlan ? "Switch to this plan" : "Start free trial";
}

export default async function BillingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/?signup=1&redirect=/billing");

  const impersonateId = isAdmin(user) ? (await cookies()).get(IMPERSONATE_COOKIE)?.value : undefined;
  const billingUserId = impersonateId || user.id;

  // This page doubles as the upgrade screen, so we do NOT redirect active users away.
  let billing = null;
  try {
    billing = await getBillingForUser(billingUserId);
  } catch (err) {
    console.error("billing page: load failed", err instanceof Error ? err.message : err);
    billing = null;
  }
  const noCardUpgrade = isNoCardTrial(billing);
  const hasPlan = hasActiveAccess(billing) && !noCardUpgrade;
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
            Prices exclude VAT. 30-day rolling as standard, or save 15% annually.
          </p>
          <p
            className="mx-auto mt-4 max-w-2xl rounded-xl px-4 py-3 text-xs leading-relaxed"
            style={{ background: "rgba(125,232,235,0.08)", color: "rgba(125,232,235,0.9)", border: "1px solid rgba(125,232,235,0.2)" }}
          >
            {noCardUpgrade ? (
              <>
                <strong>{TRIAL_CALL_CAP} free inbound AI calls</strong> are already running on
                your account, with no card on file. Choose a plan to keep taking calls after
                those {TRIAL_CALL_CAP} — card is collected here, not before.
              </>
            ) : (
              <>
                <strong>7-day free trial on every plan</strong>. Try the full product with up to{" "}
                <strong>{TRIAL_CALL_CAP} AI calls</strong>. Card required; billing starts after{" "}
                {TRIAL_DAYS} days unless you cancel.
              </>
            )}
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

        <PlanGrid
          plans={PLANS}
          inclusions={INCLUSIONS}
          currentPlan={currentPlan}
          checkoutLabels={{
            starter: checkoutLabel("starter", currentPlan, billing?.status, hasPlan, noCardUpgrade),
            professional: checkoutLabel(
              "professional",
              currentPlan,
              billing?.status,
              hasPlan,
              noCardUpgrade,
            ),
            business: checkoutLabel("business", currentPlan, billing?.status, hasPlan, noCardUpgrade),
          }}
        />

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
