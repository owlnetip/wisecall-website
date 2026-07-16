"use client";

import { useEffect, useRef, useState } from "react";
import { X, Send } from "lucide-react";
import { sendSupportChatMessage } from "@/app/actions/support-chat";
import { SupportOwl } from "./customer-agent-workspace";

type ChatTurn = { role: "user" | "assistant"; content: string };

const GREETING = "Hi, I'm Ava. What can I help you with in your WiseCall account?";

export function SupportChatPanel({
  onClose,
  onRaiseTicket,
}: {
  onClose: () => void;
  onRaiseTicket: () => void;
}) {
  const [messages, setMessages] = useState<ChatTurn[]>([{ role: "assistant", content: GREETING }]);
  const [input, setInput] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ticketFiled, setTicketFiled] = useState<string | null>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight });
  }, [messages, pending]);

  async function send() {
    const text = input.trim();
    if (!text || pending) return;
    setInput("");
    setError(null);
    const history = messages;
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setPending(true);

    const result = await sendSupportChatMessage({
      history,
      message: text,
      ticketAlreadyFiled: Boolean(ticketFiled),
    });

    setPending(false);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setMessages((prev) => [...prev, { role: "assistant", content: result.reply }]);
    if (result.ticketNumber) setTicketFiled(result.ticketNumber);
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      <div className="relative z-10 flex h-[600px] w-full max-w-md flex-col overflow-hidden rounded-2xl bg-white shadow-[0_24px_90px_rgba(17,23,22,0.3)]">
        <div className="flex items-center gap-3 bg-[#172929] px-5 py-4">
          <div className="scale-75">
            <SupportOwl />
          </div>
          <div className="flex-1">
            <p className="text-sm font-black text-white">Ava</p>
            <p className="text-xs text-[#94b4b2]">WiseCall support</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#94b4b2] transition hover:bg-white/10 hover:text-white"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div ref={bodyRef} className="flex-1 space-y-3 overflow-y-auto bg-card-tint px-4 py-4">
          {messages.map((m, i) => (
            <div
              key={i}
              className={`max-w-[84%] whitespace-pre-wrap rounded-2xl px-4 py-2.5 text-sm leading-relaxed ${
                m.role === "user"
                  ? "ml-auto rounded-br-sm bg-[#7de8eb] text-[#0e1b1b]"
                  : "rounded-bl-sm border border-line bg-white text-ink"
              }`}
            >
              {m.content}
            </div>
          ))}
          {pending && (
            <div className="w-fit rounded-2xl rounded-bl-sm border border-line bg-white px-4 py-2.5 text-sm text-ink-soft">
              Ava is typing…
            </div>
          )}
          {error && <p className="text-sm font-medium text-danger">{error}</p>}
        </div>

        <div className="border-t border-line bg-white px-4 py-2 text-center">
          <button
            type="button"
            onClick={onRaiseTicket}
            className="text-xs font-bold text-ink-soft underline decoration-dotted underline-offset-2 hover:text-ink"
          >
            Talk to a human instead
          </button>
        </div>

        <div className="flex gap-2 border-t border-line bg-white p-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") send();
            }}
            placeholder="Type your message…"
            aria-label="Message"
            className="flex-1 rounded-lg border border-line bg-card-tint px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-teal/40"
          />
          <button
            type="button"
            onClick={send}
            disabled={pending || !input.trim()}
            aria-label="Send"
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-[#7de8eb] text-[#0e1b1b] transition hover:bg-[#5de0e5] disabled:opacity-60"
          >
            <Send className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
