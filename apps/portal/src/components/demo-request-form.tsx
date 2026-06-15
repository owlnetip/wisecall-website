"use client";

import { useState } from "react";
import { ArrowRight, CheckCircle2, Globe2, Loader2, Phone, Tag } from "lucide-react";

const industries = [
  "Property",
  "Dental",
  "Legal",
  "Trades",
  "Care homes",
  "General",
];

type SubmitState =
  | { status: "idle"; message: string }
  | { status: "loading"; message: string }
  | { status: "success"; message: string; demoUrl: string; smsQueued: boolean }
  | { status: "error"; message: string };

export function DemoRequestForm() {
  const [state, setState] = useState<SubmitState>({
    status: "idle",
    message: "",
  });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const formData = new FormData(form);

    setState({
      status: "loading",
      message: "Creating the demo agent request...",
    });

    try {
      const response = await fetch("/api/demo-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mobile: formData.get("mobile"),
          websiteUrl: formData.get("websiteUrl"),
          industry: formData.get("industry"),
          businessName: formData.get("businessName"),
        }),
      });
      const result = await response.json();

      if (!response.ok || result.ok === false) {
        throw new Error(result.error || "Could not create the demo request.");
      }

      setState({
        status: "success",
        message: result.message || "Demo link created.",
        demoUrl: result.demoUrl,
        smsQueued: Boolean(result.smsQueued),
      });
      form.reset();
    } catch (error) {
      setState({
        status: "error",
        message:
          error instanceof Error
            ? error.message
            : "Could not create the demo request.",
      });
    }
  }

  return (
    <form className="space-y-4" onSubmit={handleSubmit}>
      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-white/80">
          Mobile number
        </span>
        <span className="flex items-center gap-3 rounded-lg border border-accent/20 bg-white/5 px-4 py-3 focus-within:border-accent/70">
          <Phone className="h-4 w-4 flex-shrink-0 text-accent" />
          <input
            name="mobile"
            inputMode="tel"
            autoComplete="tel"
            placeholder="07..."
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
            required
          />
        </span>
      </label>

      <label className="block">
        <span className="mb-2 block text-sm font-semibold text-white/80">
          Website URL
        </span>
        <span className="flex items-center gap-3 rounded-lg border border-accent/20 bg-white/5 px-4 py-3 focus-within:border-accent/70">
          <Globe2 className="h-4 w-4 flex-shrink-0 text-accent" />
          <input
            name="websiteUrl"
            inputMode="url"
            autoComplete="url"
            placeholder="https://example.co.uk"
            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
            required
          />
        </span>
      </label>

      <div className="grid gap-4 sm:grid-cols-[1fr_1.1fr]">
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-white/80">
            Industry
          </span>
          <select
            name="industry"
            defaultValue="Property"
            className="h-[46px] w-full rounded-lg border border-accent/20 bg-[#172929] px-4 text-sm font-semibold text-white outline-none focus:border-accent/70"
          >
            {industries.map((industry) => (
              <option key={industry} value={industry}>
                {industry}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-white/80">
            Business name
          </span>
          <span className="flex items-center gap-3 rounded-lg border border-accent/20 bg-white/5 px-4 py-3 focus-within:border-accent/70">
            <Tag className="h-4 w-4 flex-shrink-0 text-accent" />
            <input
              name="businessName"
              placeholder="Optional"
              className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/35"
            />
          </span>
        </label>
      </div>

      <button
        type="submit"
        disabled={state.status === "loading"}
        className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-accent px-5 py-3 text-sm font-bold text-[#172929] transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-65"
      >
        {state.status === "loading" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Creating demo
          </>
        ) : (
          <>
            Send demo link by SMS
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>

      {state.status === "success" && (
        <div className="rounded-lg border border-accent/25 bg-accent/10 p-4 text-sm text-white">
          <div className="mb-2 flex items-center gap-2 font-bold text-accent">
            <CheckCircle2 className="h-4 w-4" />
            Demo link ready
          </div>
          <p className="text-white/70">{state.message}</p>
          <a
            href={state.demoUrl}
            className="mt-3 inline-flex font-bold text-accent hover:text-white"
          >
            Open demo page
          </a>
          <p className="mt-2 text-xs text-white/45">
            SMS status: {state.smsQueued ? "queued" : "not configured yet"}
          </p>
        </div>
      )}

      {state.status === "error" && (
        <p className="rounded-lg border border-red-300/20 bg-red-400/10 p-3 text-sm text-red-100">
          {state.message}
        </p>
      )}
    </form>
  );
}
