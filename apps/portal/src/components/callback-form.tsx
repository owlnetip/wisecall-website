"use client";

import { useState } from "react";
import { Loader2, Phone } from "lucide-react";

type Status = {
  state: "idle" | "loading" | "success" | "error";
  message: string;
};

export function CallbackForm({ source }: { source: string }) {
  const [status, setStatus] = useState<Status>({ state: "idle", message: "" });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const phone = String(formData.get("phone") || "");

    setStatus({ state: "loading", message: "Starting the demo call..." });

    try {
      const response = await fetch("/api/demo-callback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ phone, source }),
      });
      const result = await response.json();

      if (!response.ok || result.ok === false) {
        throw new Error(result.error || "Could not start the demo call.");
      }

      setStatus({
        state: "success",
        message: result.message || "The WiseCall demo agent is calling now.",
      });
    } catch (error) {
      setStatus({
        state: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not start the demo call.",
      });
    }
  }

  return (
    <form onSubmit={handleSubmit}>
      <div className="flex items-center gap-3 rounded-lg border border-accent/25 bg-white/5 px-4 py-3 focus-within:border-accent/70">
        <Phone className="h-5 w-5 flex-shrink-0 text-accent" />
        <input
          name="phone"
          inputMode="tel"
          autoComplete="tel"
          placeholder="Mobile number"
          className="min-w-0 flex-1 bg-transparent text-sm font-semibold text-white outline-none placeholder:text-white/35"
          required
        />
        <button
          type="submit"
          disabled={status.state === "loading"}
          className="inline-flex h-10 items-center justify-center rounded-lg bg-accent px-4 text-sm font-bold text-[#172929] transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-65"
        >
          {status.state === "loading" ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            "Call me"
          )}
        </button>
      </div>
      {status.message && (
        <p
          className={`mt-3 text-sm ${
            status.state === "error" ? "text-red-100" : "text-white/60"
          }`}
          aria-live="polite"
        >
          {status.message}
        </p>
      )}
    </form>
  );
}
