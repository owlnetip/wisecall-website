"use client";

import { useState } from "react";

// Small inline "copy to clipboard" button used on the partner console for the
// referral link. Self-contained so it can drop into a server-rendered page.
export function CopyButton({ value, label = "Copy" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        } catch {
          /* clipboard unavailable - no-op */
        }
      }}
      className="rounded-lg px-3 py-1.5 text-xs font-semibold transition"
      style={{ background: "#7de8eb", color: "#172929" }}
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
