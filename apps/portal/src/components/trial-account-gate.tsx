"use client";

import { useActionState, useState } from "react";
import { finishGuestTrialWithAccount, type AuthState } from "@/app/actions/auth";
import type { AgentDraft } from "@/app/actions/wizard";

export function TrialAccountGate({
  draft,
  onCancel,
}: {
  draft: AgentDraft;
  onCancel: () => void;
}) {
  const [state, formAction, isPending] = useActionState<AuthState, FormData>(
    finishGuestTrialWithAccount,
    {},
  );
  const [mode, setMode] = useState<"signup" | "signin">("signup");
  const [email, setEmail] = useState(draft.defaultEmail || "");
  const [password, setPassword] = useState("");

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-black/40 p-4 sm:items-center">
      <div
        role="dialog"
        aria-labelledby="trial-account-title"
        aria-modal="true"
        className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl sm:p-8"
      >
        <p id="trial-account-title" className="text-xl font-black text-ink">
          Get your number
        </p>
        <p className="mt-2 text-sm leading-relaxed text-ink-soft">
          Email and password only. Then you get a number and 20 free inbound AI calls. No card.
        </p>

        <form action={formAction} className="mt-5 space-y-3">
          <input type="hidden" name="intent" value={mode} />
          <input type="hidden" name="draft" value={JSON.stringify(draft)} />

          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
              Email
            </span>
            <input
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-12 w-full rounded-xl border border-line-strong bg-card px-3 text-ink outline-none focus:border-teal"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
              Password
            </span>
            <input
              type="password"
              name="password"
              autoComplete={mode === "signup" ? "new-password" : "current-password"}
              required
              minLength={mode === "signup" ? 8 : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-12 w-full rounded-xl border border-line-strong bg-card px-3 text-ink outline-none focus:border-teal"
            />
          </label>

          {state.error ? (
            <p className="rounded-lg bg-[#fff0f0] px-3 py-2 text-sm text-danger">{state.error}</p>
          ) : null}
          {state.message ? (
            <p className="rounded-lg bg-teal-wash px-3 py-2 text-sm text-[#1f5f60]">{state.message}</p>
          ) : null}

          <button
            type="submit"
            disabled={isPending}
            className="press mt-1 inline-flex h-12 w-full items-center justify-center rounded-xl bg-good font-black text-white transition hover:bg-[#0e7a4d] disabled:opacity-60"
          >
            {isPending
              ? "Connecting your number…"
              : mode === "signup"
                ? "Create account and get number"
                : "Sign in and get number"}
          </button>
        </form>

        <p className="mt-4 text-center text-sm text-ink-soft">
          {mode === "signup" ? "Already have an account? " : "Need an account? "}
          <button
            type="button"
            onClick={() => setMode(mode === "signup" ? "signin" : "signup")}
            className="font-semibold text-[#1f5f60] underline-offset-2 hover:underline"
          >
            {mode === "signup" ? "Sign in" : "Create one"}
          </button>
        </p>

        <button
          type="button"
          onClick={onCancel}
          className="mt-3 w-full text-center text-xs font-semibold text-ink-faint underline-offset-2 hover:underline"
        >
          Back to setup
        </button>
      </div>
    </div>
  );
}
