"use client";

import { useState, useTransition } from "react";
import { X, LifeBuoy, Check } from "lucide-react";
import { raiseSupportTicket } from "@/app/actions/support";

export function RaiseTicketModal({ onClose }: { onClose: () => void }) {
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const [done, setDone] = useState<{ ticketNumber: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  function submit() {
    setError(null);
    start(async () => {
      const r = await raiseSupportTicket({ subject, message });
      if (r.ok) setDone({ ticketNumber: r.ticketNumber });
      else setError(r.error);
    });
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 w-full max-w-md rounded-2xl bg-white p-6 shadow-[0_24px_90px_rgba(17,23,22,0.3)]">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="absolute right-4 top-4 flex h-8 w-8 items-center justify-center rounded-lg text-[#7a8582] transition hover:bg-[#f2f4f3]"
        >
          <X className="h-4 w-4" />
        </button>

        {done ? (
          <div className="py-4 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#eafaf1] text-[#14823f]">
              <Check className="h-6 w-6" />
            </div>
            <p className="text-lg font-black text-[#111716]">Ticket raised</p>
            <p className="mt-1 text-sm text-[#66716e]">
              Our support team has it — reference <strong>{done.ticketNumber}</strong>. We&apos;ll be in touch by email.
            </p>
            <button
              type="button"
              onClick={onClose}
              className="mt-5 inline-flex h-10 items-center rounded-lg bg-[#111716] px-5 text-sm font-black text-white transition hover:bg-[#263130]"
            >
              Done
            </button>
          </div>
        ) : (
          <>
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-[#eefbfb] text-[#148b8e]">
                <LifeBuoy className="h-5 w-5" />
              </div>
              <div>
                <p className="font-black text-[#111716]">Raise a ticket</p>
                <p className="text-xs text-[#66716e]">Goes straight to our support desk.</p>
              </div>
            </div>

            <label className="mb-1 block text-sm font-bold text-[#111716]">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              placeholder="What do you need help with?"
              className="mb-3 w-full rounded-lg border border-black/10 bg-[#f8fafa] px-3 py-2 text-sm text-[#111716] placeholder:text-[#9aa5a2] focus:outline-none focus:ring-2 focus:ring-[#148b8e]/40"
            />

            <label className="mb-1 block text-sm font-bold text-[#111716]">Message</label>
            <textarea
              rows={5}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Tell us what's happening and we'll help."
              className="mb-3 w-full rounded-lg border border-black/10 bg-[#f8fafa] px-3 py-2 text-sm text-[#111716] placeholder:text-[#9aa5a2] focus:outline-none focus:ring-2 focus:ring-[#148b8e]/40"
            />

            {error && <p className="mb-3 text-sm font-medium text-red-600">{error}</p>}

            <button
              type="button"
              onClick={submit}
              disabled={pending || !subject.trim() || !message.trim()}
              className="inline-flex h-10 w-full items-center justify-center rounded-lg bg-[#7de8eb] px-5 text-sm font-black text-[#0e1b1b] transition hover:bg-[#5de0e5] disabled:opacity-60"
            >
              {pending ? "Sending…" : "Send to support"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
