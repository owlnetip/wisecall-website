"use client";

import { useActionState, useEffect } from "react";
import { signInAction, type AuthState } from "@/app/actions/auth";

export function LoginForm({
  redirectTo = "/",
  initialError,
}: {
  redirectTo?: string;
  initialError?: string;
}) {
  const [state, formAction, isPending] = useActionState<AuthState, FormData>(signInAction, {
    error: initialError,
  });

  useEffect(() => {
    if (state.ok) {
      // Hard navigation ensures Supabase auth cookies are present before middleware runs.
      window.location.assign(redirectTo);
    }
  }, [state.ok, redirectTo]);

  return (
    <div className="flex min-h-screen items-center justify-center px-4" style={{ background: "#172929" }}>
      <div
        className="w-full max-w-sm rounded-2xl px-8 py-8"
        style={{
          background: "#1f3535",
          border: "1px solid rgba(125,232,235,0.14)",
          boxShadow: "0 24px 48px rgba(0,0,0,0.3)",
        }}
      >
        <div className="mb-6 text-center">
          <h1 className="text-xl font-bold text-white">Marketing Studio</h1>
          <p className="mt-1 text-sm text-muted">Admin sign-in</p>
        </div>

        <form action={formAction} className="space-y-4">
          <input type="hidden" name="redirect" value={redirectTo} />

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Email
            </label>
            <input
              type="email"
              name="email"
              required
              placeholder="you@owlnet.io"
              className="w-full rounded-xl border border-accent/20 bg-background px-4 py-3 text-sm text-white outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="block text-xs font-semibold uppercase tracking-wide text-muted">
              Password
            </label>
            <input
              type="password"
              name="password"
              required
              placeholder="••••••••"
              className="w-full rounded-xl border border-accent/20 bg-background px-4 py-3 text-sm text-white outline-none"
            />
          </div>

          {state.error ? (
            <p className="rounded-lg border border-red-400/25 bg-red-400/10 px-3 py-2 text-xs text-red-300">
              {state.error}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={isPending || state.ok}
            className="w-full rounded-xl bg-accent py-3 text-sm font-semibold text-background disabled:opacity-60"
          >
            {state.ok ? "Redirecting…" : isPending ? "Signing in…" : "Sign in"}
          </button>
        </form>
      </div>
    </div>
  );
}
