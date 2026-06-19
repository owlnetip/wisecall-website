"use client";

import { useState, useTransition } from "react";
import { startCheckout, openCustomerPortal } from "@/app/actions/billing";

// Opens the Stripe Customer Portal (manage / cancel subscription).
export function ManageSubscriptionButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    startTransition(async () => {
      const res = await openCustomerPortal();
      if (res.ok && res.url) {
        window.location.href = res.url;
      } else {
        setError(res.error ?? "Couldn't open the billing portal.");
      }
    });
  }

  return (
    <span>
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="underline disabled:opacity-60"
      >
        {pending ? "Opening…" : "Manage or cancel your subscription"}
      </button>
      {error ? <span className="ml-2 text-[#ff9b9b]">{error}</span> : null}
    </span>
  );
}

// Single checkout button for any plan. Every plan opens a 7-day free trial in
// Stripe Checkout. Redirects to Stripe on click.
export function PlanCheckoutButton({
  plan,
  label,
  variant = "primary",
}: {
  plan: string;
  label: string;
  variant?: "primary" | "secondary";
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    startTransition(async () => {
      const res = await startCheckout(plan);
      if (res.ok && res.url) {
        window.location.href = res.url;
      } else {
        setError(res.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  const style =
    variant === "primary"
      ? { background: "#7de8eb", color: "#0c1717" }
      : {
          background: "transparent",
          color: "#7de8eb",
          border: "1.5px solid rgba(125,232,235,0.4)",
        };

  return (
    <div>
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="w-full rounded-xl px-4 py-2.5 text-sm font-bold transition-opacity duration-150 disabled:opacity-60"
        style={style}
      >
        {pending ? "Starting…" : label}
      </button>
      {error ? (
        <div
          className="mt-2 rounded-lg px-3 py-2 text-xs font-medium"
          style={{ background: "rgba(255,90,90,0.12)", color: "#ff9b9b" }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
