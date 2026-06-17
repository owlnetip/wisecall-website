import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBillingForUser, hasActiveAccess } from "@/lib/billing";
import { PlanCheckoutButton, ManageSubscriptionButton } from "./start-trial-button";

type Plan = {
  id: "core" | "growth" | "pro";
  name: string;
  price: string;
  tagline: string;
  highlights: string[];
  popular?: boolean;
};

const PLANS: Plan[] = [
  {
    id: "core",
    name: "Core",
    price: "£249",
    tagline: "Smaller teams & practices",
    highlights: ["250 AI calls / month", "5 staff extensions", "Complete phone system"],
  },
  {
    id: "growth",
    name: "Growth",
    price: "£399",
    tagline: "Busier teams, higher volumes",
    highlights: ["500 AI calls / month", "10 staff extensions", "Complete phone system"],
    popular: true,
  },
  {
    id: "pro",
    name: "Pro",
    price: "£699",
    tagline: "High volume, unlimited extensions",
    highlights: ["1,000 AI calls / month", "Unlimited extensions", "Complete phone system"],
  },
];

export default async function BillingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/?redirect=/billing");

  // Note: we do NOT redirect active customers away — this page doubles as the
  // upgrade screen, so existing trial/PAYG users can switch to a bigger plan.
  const billing = await getBillingForUser(user.id);
  const hasPlan = hasActiveAccess(billing);
  const currentPlan = billing?.plan ?? null;

  return (
    <main
      className="min-h-screen w-full px-4 py-10 text-white"
      style={{ background: "#172929" }}
    >
      <div className="mx-auto max-w-5xl">
        <div className="text-center">
          <h1 className="text-3xl font-bold tracking-tight">
            Choose your <span style={{ color: "#7de8eb" }}>WiseCall</span> plan
          </h1>
          <p className="mt-2 text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
            Every plan includes the AI receptionist, a complete phone system and UK
            outbound calling. Prices exclude VAT, billed monthly.
          </p>
          {hasPlan ? (
            <p className="mt-3 text-xs" style={{ color: "rgba(125,232,235,0.85)" }}>
              You&apos;re currently on{" "}
              <strong>{currentPlan === "payg" ? "Pay As You Go" : (currentPlan ?? "a plan")}</strong>
              . Switching cancels your current subscription.{" "}
              <ManageSubscriptionButton />{" "}·{" "}
              <a href="/dashboard" className="underline">Back to dashboard</a>
            </p>
          ) : null}
        </div>

        {/* Monthly plans */}
        <div className="mt-8 grid gap-5 md:grid-cols-3">
          {PLANS.map((plan) => (
            <div
              key={plan.id}
              className="relative flex flex-col rounded-2xl p-6"
              style={{
                background: "#1f3535",
                border: plan.popular
                  ? "1.5px solid #7de8eb"
                  : "1.5px solid rgba(255,255,255,0.08)",
              }}
            >
              {plan.popular ? (
                <span
                  className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full px-3 py-1 text-[10px] font-bold uppercase tracking-wide"
                  style={{ background: "#7de8eb", color: "#0c1717" }}
                >
                  Most popular
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
              <ul className="mt-5 mb-6 space-y-2.5 flex-1">
                {plan.highlights.map((h) => (
                  <li key={h} className="flex items-center gap-2.5 text-sm text-white/85">
                    <span
                      className="inline-flex size-4 items-center justify-center rounded-full text-[10px] font-bold"
                      style={{ background: "rgba(125,232,235,0.18)", color: "#7de8eb" }}
                    >
                      ✓
                    </span>
                    {h}
                  </li>
                ))}
              </ul>
              <PlanCheckoutButton
                plan={plan.id}
                label={currentPlan === plan.id ? "Current plan" : "Subscribe"}
                variant={plan.popular ? "primary" : "secondary"}
              />
            </div>
          ))}
        </div>

        {/* PAYG — secondary option */}
        <div
          className="mx-auto mt-6 max-w-3xl rounded-2xl p-5"
          style={{ background: "#1b2e2e", border: "1px solid rgba(255,255,255,0.08)" }}
        >
          <div className="flex flex-col items-center gap-3 text-center sm:flex-row sm:justify-between sm:text-left">
            <div>
              <h3 className="text-base font-semibold">Just need AI call answering?</h3>
              <p className="mt-1 text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                Pay As You Go — <strong>£10/month + 65p per AI call</strong>. No bundled
                phone system or extensions. Includes a 7-day free trial (up to 20 calls).
              </p>
            </div>
            <div className="w-full sm:w-48 shrink-0">
              <PlanCheckoutButton plan="payg" label="Start free trial" variant="secondary" />
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}
