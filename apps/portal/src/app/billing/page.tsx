import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { getBillingForUser, hasActiveAccess } from "@/lib/billing";
import { TRIAL_CALL_CAP } from "@/lib/stripe";
import { StartTrialButton } from "./start-trial-button";

const PERKS = [
  "AI receptionist, 24/7",
  "Pay only for the calls you use",
  "Call summaries & data capture",
  "Escalation & call routing",
];

export default async function BillingPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Middleware guards this route, but double-check.
  if (!user) redirect("/?redirect=/billing");

  // Already trialing/active → straight to the workspace.
  const billing = await getBillingForUser(user.id);
  if (hasActiveAccess(billing)) redirect("/dashboard");

  return (
    <main
      className="size-full min-h-screen flex items-center justify-center relative overflow-hidden px-4"
      style={{ background: "#172929" }}
    >
      <div
        className="absolute pointer-events-none"
        style={{
          width: 600,
          height: 600,
          background: "radial-gradient(circle, rgba(125,232,235,0.07) 0%, transparent 70%)",
        }}
      />
      <div
        className="relative z-10 w-full max-w-sm rounded-2xl px-8 pt-8 pb-8"
        style={{ background: "#1f3535" }}
      >
        <div className="text-center mb-6">
          <h1 className="text-2xl font-bold tracking-tight text-white">
            Start your <span style={{ color: "#7de8eb" }}>WiseCall</span> trial
          </h1>
          <p className="mt-2 text-sm font-medium" style={{ color: "rgba(255,255,255,0.5)" }}>
            7 days free, up to {TRIAL_CALL_CAP} AI calls. Then £10/month + 65p per
            call (+VAT) — cancel anytime.
          </p>
        </div>

        <ul className="mb-7 space-y-2.5">
          {PERKS.map((perk) => (
            <li key={perk} className="flex items-center gap-2.5 text-sm text-white/85">
              <span
                className="inline-flex size-4 items-center justify-center rounded-full text-[10px] font-bold"
                style={{ background: "rgba(125,232,235,0.18)", color: "#7de8eb" }}
              >
                ✓
              </span>
              {perk}
            </li>
          ))}
        </ul>

        <p className="mb-5 text-center text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
          A full phone system and staff extensions are available on our Core,
          Growth and Pro plans.
        </p>

        <StartTrialButton />
      </div>
    </main>
  );
}
