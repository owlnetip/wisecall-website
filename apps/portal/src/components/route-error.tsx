"use client";

import { useEffect, useState } from "react";

// Shared route error UI. Most server errors in this app are transient — a cold
// start or a flaky Supabase/Stripe call in a server component, which is why a
// manual refresh fixes them. So we auto-retry once before showing the wall,
// turning the "server error, reload" annoyance into a self-healing blip.
export function RouteError({
  error,
  reset,
  label = "loading this page",
}: {
  error: Error & { digest?: string };
  reset: () => void;
  label?: string;
}) {
  const [retried, setRetried] = useState(false);

  useEffect(() => {
    console.error("route error boundary:", error.digest ?? error.message);
    if (!retried) {
      setRetried(true);
      const t = setTimeout(() => reset(), 600);
      return () => clearTimeout(t);
    }
  }, [error, reset, retried]);

  if (!retried) {
    return (
      <main className="flex min-h-screen items-center justify-center" style={{ background: "#172929" }}>
        <p className="text-sm text-white/60">Loading…</p>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-6 text-center" style={{ background: "#172929" }}>
      <p className="text-white">Something went wrong {label}.</p>
      <button
        type="button"
        onClick={() => reset()}
        className="rounded-lg bg-[#7de8eb] px-5 py-2.5 text-sm font-black text-[#0c1717] transition hover:opacity-90"
      >
        Try again
      </button>
    </main>
  );
}
