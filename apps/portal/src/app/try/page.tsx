import type { Metadata } from "next";
import { CallbackForm } from "@/components/callback-form";

export const metadata: Metadata = {
  title: "Try WiseCall, live AI receptionist demo",
  description: "Enter your number and the WiseCall AI receptionist will call you for a live demo.",
};

// Public "try the agent" page — no auth. Enter a mobile → /api/demo-callback →
// the WiseCall demo agent calls back for a full conversation.
export default function TryPage() {
  return (
    <main
      className="min-h-screen w-full flex items-center justify-center px-4 py-12"
      style={{ background: "#172929" }}
    >
      <div
        className="w-full max-w-md rounded-2xl px-8 py-9 text-center"
        style={{ background: "#1f3535" }}
      >
        <div className="flex items-center justify-center gap-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/owl-logo.png" alt="" className="h-8 w-8 object-contain" />
          <span className="text-2xl font-bold tracking-tight">
            <span className="text-white">Wise</span>
            <span style={{ color: "#7de8eb" }}>Call</span>
          </span>
        </div>

        <h1 className="mt-5 text-2xl font-bold text-white">Try the AI receptionist</h1>
        <p className="mt-2 text-sm leading-6" style={{ color: "rgba(255,255,255,0.6)" }}>
          Pop in your mobile and WiseCall will call you straight back, so you can have a
          real conversation with the AI receptionist, ask about opening hours, request a
          callback, or ask to be put through. Takes about a minute.
        </p>

        <div className="mt-6 text-left">
          <CallbackForm source="public_try" />
        </div>

        <p className="mt-4 text-xs" style={{ color: "rgba(255,255,255,0.35)" }}>
          UK mobile numbers only.
        </p>
      </div>
    </main>
  );
}
