"use client";

import { useState } from "react";
import {
  PLAN_ANNUAL_GBP,
  PLAN_ANNUAL_MONTHLY_GBP,
  PLAN_MONTHLY_GBP,
  type BillingInterval,
  type PlanId,
} from "@/lib/stripe";
import { PlanCheckoutButton } from "./start-trial-button";

type Plan = {
  id: PlanId;
  name: string;
  tagline: string;
  allowances: string[];
  popular?: boolean;
};

function formatGbp(value: number) {
  return value.toLocaleString("en-GB", { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 });
}

export function PlanGrid({
  plans,
  inclusions,
  checkoutLabel,
  currentPlan,
}: {
  plans: Plan[];
  inclusions: string[];
  checkoutLabel: (planId: PlanId) => string;
  currentPlan: string | null;
}) {
  const [interval, setInterval] = useState<BillingInterval>("year");

  return (
    <>
      <div className="mt-6 flex flex-wrap items-center justify-center gap-3">
        <div
          className="inline-flex rounded-full p-1"
          style={{ background: "rgba(255,255,255,0.08)" }}
          role="group"
          aria-label="Billing cycle"
        >
          <button
            type="button"
            onClick={() => setInterval("month")}
            className="rounded-full px-4 py-1.5 text-sm font-semibold"
            style={
              interval === "month"
                ? { background: "#fff", color: "#0c1f1f" }
                : { background: "transparent", color: "rgba(255,255,255,0.62)" }
            }
          >
            Monthly
          </button>
          <button
            type="button"
            onClick={() => setInterval("year")}
            className="rounded-full px-4 py-1.5 text-sm font-semibold"
            style={
              interval === "year"
                ? { background: "#fff", color: "#0c1f1f" }
                : { background: "transparent", color: "rgba(255,255,255,0.62)" }
            }
          >
            Annual
          </button>
        </div>
        <span
          className="rounded-full px-2.5 py-1 text-[11px] font-bold"
          style={{ background: "rgba(125,232,235,0.12)", color: "#7de8eb" }}
        >
          Save 15%
        </span>
      </div>

      <div className="mt-8 grid gap-5 md:grid-cols-3">
        {plans.map((plan) => {
          const monthly = interval === "year" ? PLAN_ANNUAL_MONTHLY_GBP[plan.id] : PLAN_MONTHLY_GBP[plan.id];
          const yearly = PLAN_ANNUAL_GBP[plan.id];
          return (
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

              <div className="mt-4 flex flex-wrap items-baseline gap-2">
                <span className="text-3xl font-bold">£{formatGbp(monthly)}</span>
                <span className="text-sm" style={{ color: "rgba(255,255,255,0.45)" }}>
                  /month
                </span>
                {interval === "year" ? (
                  <span
                    className="rounded-full px-2 py-0.5 text-[10px] font-bold"
                    style={{ background: "rgba(125,232,235,0.12)", color: "#7de8eb" }}
                  >
                    Save 15%
                  </span>
                ) : null}
              </div>
              <p className="mt-1 text-[11px] uppercase tracking-wide" style={{ color: "rgba(255,255,255,0.4)" }}>
                {interval === "year"
                  ? `£${formatGbp(yearly)}/year · billed annually · excl. VAT`
                  : "30-day rolling · excl. VAT"}
              </p>

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
                  interval={interval}
                  label={
                    currentPlan === plan.id
                      ? checkoutLabel(plan.id)
                      : interval === "year"
                        ? `${checkoutLabel(plan.id)} · annual`
                        : checkoutLabel(plan.id)
                  }
                  variant={plan.popular ? "primary" : "secondary"}
                />
              </div>

              <ul className="mt-5 space-y-2.5">
                {inclusions.map((item) => (
                  <li key={item} className="flex items-start gap-2.5 text-sm text-white/80">
                    <span
                      className="mt-0.5 inline-flex size-4 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold"
                      style={{ background: "rgba(125,232,235,0.18)", color: "#7de8eb" }}
                    >
                      ✓
                    </span>
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
    </>
  );
}
