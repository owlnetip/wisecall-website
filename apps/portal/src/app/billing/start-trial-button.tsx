"use client";

import { useState, useTransition } from "react";
import { startTrialCheckout } from "@/app/actions/billing";

export function StartTrialButton() {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function go() {
    setError(null);
    startTransition(async () => {
      const res = await startTrialCheckout();
      if (res.ok && res.url) {
        window.location.href = res.url;
      } else {
        setError(res.error ?? "Something went wrong. Please try again.");
      }
    });
  }

  return (
    <div className="space-y-3">
      <button
        type="button"
        onClick={go}
        disabled={pending}
        className="w-full rounded-xl px-4 py-3 text-sm font-bold transition-opacity duration-150 disabled:opacity-60"
        style={{ background: "#7de8eb", color: "#0c1717" }}
      >
        {pending ? "Starting…" : "Start 7-day free trial"}
      </button>
      <p className="text-center text-xs" style={{ color: "rgba(255,255,255,0.4)" }}>
        Card required. You won&apos;t be charged during the trial — cancel anytime.
      </p>
      {error ? (
        <div
          className="rounded-lg px-3 py-2 text-xs font-medium"
          style={{ background: "rgba(255,90,90,0.12)", color: "#ff9b9b" }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
