import { redirect } from "next/navigation";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import { isPartner } from "@/lib/partner";
import { getPartnerOverview } from "@/lib/partner";
import { getAppBaseUrl } from "@/lib/env";
import { CopyButton } from "@/components/copy-button";
import { signOutAction } from "@/app/actions/auth";

export const dynamic = "force-dynamic";

function gbp(n: number): string {
  return `£${n.toLocaleString("en-GB", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
}

function statusBadge(status: string | null): { label: string; bg: string; fg: string } {
  switch (status) {
    case "active":
      return { label: "Live", bg: "rgba(125,232,235,0.15)", fg: "#7de8eb" };
    case "trialing":
      return { label: "Trial", bg: "rgba(245,200,92,0.15)", fg: "#f5c85c" };
    case "canceled":
    case "incomplete_expired":
      return { label: "Churned", bg: "rgba(255,99,99,0.12)", fg: "#ff9b9b" };
    default:
      return { label: status ?? "-", bg: "rgba(255,255,255,0.08)", fg: "rgba(255,255,255,0.6)" };
  }
}

export default async function PartnerPage() {
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/?redirect=/partner");
  if (!isPartner(user)) redirect("/dashboard");

  const overview = await getPartnerOverview(user.id);
  if (!overview) {
    // Partner role but no partner profile yet - shouldn't happen once minted.
    return (
      <main className="min-h-screen w-full px-4 py-10 text-white" style={{ background: "#172929" }}>
        <div className="mx-auto max-w-md text-center">
          <p className="text-sm" style={{ color: "rgba(255,255,255,0.6)" }}>
            Your partner account isn&apos;t set up yet. Please contact WiseCall.
          </p>
        </div>
      </main>
    );
  }

  const { partner, customers, stats } = overview;
  const referralLink = `${getAppBaseUrl().replace(/\/$/, "")}/r/${partner.referralCode}`;
  const ratePct = Math.round(partner.commissionRate * 100);

  const statCards = [
    { label: "Referred customers", value: String(stats.referred) },
    { label: "Live & trialing", value: String(stats.live) },
    { label: "Referred MRR", value: gbp(stats.estMrrGbp) },
    { label: `Commission accrued (${ratePct}%)`, value: gbp(stats.commissionAccruedGbp) },
  ];

  return (
    <main className="min-h-screen w-full px-4 py-6 text-white sm:py-10" style={{ background: "#172929" }}>
      <div className="mx-auto max-w-5xl">
        {/* Header */}
        <div className="mb-8 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <div className="flex items-center gap-1">
              <span className="text-xl font-bold tracking-tight text-white">Wise</span>
              <span className="text-xl font-bold tracking-tight" style={{ color: "#7de8eb" }}>Call</span>
              <span className="ml-2 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide" style={{ background: "rgba(125,232,235,0.15)", color: "#7de8eb" }}>
                Partner
              </span>
            </div>
            <p className="mt-1 text-sm" style={{ color: "rgba(255,255,255,0.55)" }}>
              {partner.name}
            </p>
          </div>
          <form action={signOutAction}>
            <button type="submit" className="text-sm font-semibold transition hover:text-[#7de8eb]" style={{ color: "rgba(255,255,255,0.6)" }}>
              Sign out
            </button>
          </form>
        </div>

        {/* Referral link */}
        <div className="mb-8 rounded-2xl p-5" style={{ background: "#1f3535", border: "1px solid rgba(125,232,235,0.14)" }}>
          <p className="text-xs font-semibold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.5)" }}>
            Your referral link
          </p>
          <div className="mt-2 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <code className="break-all text-sm font-medium" style={{ color: "#7de8eb" }}>
              {referralLink}
            </code>
            <CopyButton value={referralLink} label="Copy link" />
          </div>
          <p className="mt-3 text-xs leading-relaxed" style={{ color: "rgba(255,255,255,0.45)" }}>
            Share this link. Anyone who signs up through it is attributed to you, and you earn{" "}
            <strong style={{ color: "rgba(255,255,255,0.7)" }}>{ratePct}% recurring commission</strong>{" "}
            on their subscription for as long as they stay a customer.
          </p>
        </div>

        {/* Stats */}
        <div className="mb-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          {statCards.map((card) => (
            <div key={card.label} className="rounded-2xl p-4" style={{ background: "#1f3535", border: "1px solid rgba(125,232,235,0.1)" }}>
              <p className="text-2xl font-bold">{card.value}</p>
              <p className="mt-1 text-xs leading-tight" style={{ color: "rgba(255,255,255,0.5)" }}>{card.label}</p>
            </div>
          ))}
        </div>

        {/* Customers */}
        <div className="rounded-2xl p-5" style={{ background: "#1f3535", border: "1px solid rgba(125,232,235,0.1)" }}>
          <div className="mb-4 flex items-center justify-between">
            <h2 className="text-sm font-bold uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.7)" }}>
              Your customers
            </h2>
            {stats.commissionPaidGbp > 0 ? (
              <p className="text-xs" style={{ color: "rgba(255,255,255,0.5)" }}>
                {gbp(stats.commissionPaidGbp)} paid out to date
              </p>
            ) : null}
          </div>

          {customers.length === 0 ? (
            <p className="py-8 text-center text-sm" style={{ color: "rgba(255,255,255,0.4)" }}>
              No referrals yet. Share your link above to get started.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr style={{ color: "rgba(255,255,255,0.4)" }}>
                    <th className="pb-2 text-xs font-semibold uppercase tracking-wide">Customer</th>
                    <th className="pb-2 text-xs font-semibold uppercase tracking-wide">Plan</th>
                    <th className="pb-2 text-xs font-semibold uppercase tracking-wide">Status</th>
                    <th className="pb-2 text-right text-xs font-semibold uppercase tracking-wide">MRR</th>
                  </tr>
                </thead>
                <tbody>
                  {customers.map((c) => {
                    const badge = statusBadge(c.status);
                    return (
                      <tr key={c.userId} style={{ borderTop: "1px solid rgba(255,255,255,0.06)" }}>
                        <td className="py-3 pr-3">{c.email}</td>
                        <td className="py-3 pr-3" style={{ color: "rgba(255,255,255,0.7)" }}>
                          {c.plan ? c.plan.charAt(0).toUpperCase() + c.plan.slice(1) : "-"}
                        </td>
                        <td className="py-3 pr-3">
                          <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: badge.bg, color: badge.fg }}>
                            {badge.label}
                          </span>
                        </td>
                        <td className="py-3 text-right" style={{ color: "rgba(255,255,255,0.7)" }}>
                          {c.mrrGbp > 0 ? gbp(c.mrrGbp) : "-"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <p className="mt-6 text-center text-xs" style={{ color: "rgba(255,255,255,0.3)" }}>
          Read-only view. Commission is calculated on net (ex-VAT) subscription revenue and paid monthly.
        </p>
      </div>
    </main>
  );
}
