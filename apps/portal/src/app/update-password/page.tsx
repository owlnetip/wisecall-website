"use client";

import { useActionState, useState } from "react";
import { updatePassword, type AuthState } from "@/app/actions/auth";

export default function UpdatePasswordPage() {
  const [state, action, pending] = useActionState<AuthState, FormData>(updatePassword, {});
  const [password, setPassword] = useState("");

  return (
    <main
      className="min-h-screen w-full flex items-center justify-center overflow-x-hidden overflow-y-auto px-4 py-8"
      style={{ background: "#172929" }}
    >
      <div className="w-full max-w-sm rounded-2xl px-8 pt-8 pb-8" style={{ background: "#1f3535" }}>
        <div className="text-center mb-6">
          <div className="text-2xl font-bold tracking-tight">
            <span className="text-white">Wise</span>
            <span style={{ color: "#7de8eb" }}>Call</span>
          </div>
          <h1 className="mt-3 text-lg font-semibold text-white">Set a new password</h1>
        </div>

        <form action={action} className="space-y-4">
          <div className="space-y-1.5">
            <label
              className="block text-xs font-semibold"
              style={{ color: "rgba(255,255,255,0.5)", letterSpacing: "0.04em", textTransform: "uppercase" }}
            >
              New password
            </label>
            <input
              type="password"
              name="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="w-full rounded-xl px-4 py-3 text-sm outline-none"
              style={{ background: "#172929", border: "1.5px solid rgba(125,232,235,0.15)", color: "#ffffff" }}
              required
              minLength={8}
            />
          </div>

          <button
            type="submit"
            disabled={pending}
            className="w-full rounded-xl px-4 py-3 text-sm font-bold transition-opacity duration-150 disabled:opacity-60"
            style={{ background: "#7de8eb", color: "#0c1717" }}
          >
            {pending ? "Saving…" : "Update password"}
          </button>

          {state.error ? (
            <div className="rounded-lg px-3 py-2 text-xs font-medium" style={{ background: "rgba(255,90,90,0.12)", color: "#ff9b9b" }}>
              {state.error}
            </div>
          ) : null}
        </form>
      </div>
    </main>
  );
}
