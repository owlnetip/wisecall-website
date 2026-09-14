"use client";

import { useState } from "react";
import { Tag } from "lucide-react";
import { syncMorAgentNames } from "@/app/actions/agents";

export function SyncMorNamesButton() {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  async function onClick() {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    setFailed(false);
    const result = await syncMorAgentNames();
    setBusy(false);
    if (result.ok) {
      const count = result.updated ?? 0;
      setMessage(`Renamed ${count} MOR user${count === 1 ? "" : "s"}`);
      return;
    }
    setFailed(true);
    setMessage(result.error || "Could not rename MOR users");
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => void onClick()}
        disabled={busy}
        className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white disabled:cursor-not-allowed disabled:opacity-55"
      >
        <Tag className="h-5 w-5 flex-shrink-0" />
        {busy ? "Renaming MOR users…" : "Rename MOR users"}
      </button>
      {message ? (
        <p className={`px-3 pb-1 text-[11px] font-bold ${failed ? "text-red-300" : "text-[#7de8eb]"}`}>
          {message}
        </p>
      ) : null}
    </div>
  );
}
