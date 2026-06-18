"use client";

import { useState, useTransition } from "react";
import { Loader2, Phone } from "lucide-react";
import { startAgentTestCall } from "@/app/actions/agents";

// "Test this agent" control: rings the tester's mobile and connects them to this
// agent, so you don't have to dial the agent's real number to test it.
export function AgentTestCall({ agentId }: { agentId: string }) {
  const [phone, setPhone] = useState("");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function go() {
    setMsg(null);
    start(async () => {
      const r = await startAgentTestCall(agentId, phone);
      setMsg({ ok: r.ok, text: r.ok ? r.message || "Calling you now." : r.error || "Couldn't start the call." });
    });
  }

  return (
    <div className="mb-6 rounded-[14px] border border-black/10 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-black text-[#111716]">Test this agent</p>
          <p className="text-sm text-[#66716e]">
            We&apos;ll call your mobile and connect you to this agent — no need to dial its number.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2">
            <Phone className="h-4 w-4 flex-shrink-0 text-[#148b8e]" />
            <input
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              inputMode="tel"
              autoComplete="tel"
              placeholder="Your mobile"
              className="w-36 bg-transparent text-sm font-semibold text-[#111716] outline-none placeholder:text-[#9aa5a2]"
            />
          </div>
          <button
            type="button"
            onClick={go}
            disabled={pending}
            className="inline-flex h-10 items-center justify-center rounded-lg bg-[#7de8eb] px-4 text-sm font-bold text-[#0c1717] transition hover:opacity-90 disabled:opacity-60"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : "Call me to test"}
          </button>
        </div>
      </div>
      {msg && (
        <p className={`mt-2 text-sm font-medium ${msg.ok ? "text-[#148b8e]" : "text-red-600"}`} aria-live="polite">
          {msg.text}
        </p>
      )}
    </div>
  );
}
