"use client";

import { useState, useTransition } from "react";
import { updateAgent } from "@/app/actions/agents";
import type { OfficeHours } from "./customer-agent-workspace";

export const OFFICE_DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

// Controlled 7-day open/close grid. Reused by the card (saves itself) and the
// setup wizard (collects into the new-agent draft). Parent owns the value.
export function OfficeHoursGrid({
  hours,
  onChange,
}: {
  hours: OfficeHours;
  onChange: (next: OfficeHours) => void;
}) {
  function toggle(day: string, open: boolean) {
    const next = { ...hours };
    if (open) next[day] = next[day] ?? { open: "09:00", close: "17:00" };
    else delete next[day];
    onChange(next);
  }
  function setTime(day: string, field: "open" | "close", value: string) {
    onChange({
      ...hours,
      [day]: { ...(hours[day] ?? { open: "09:00", close: "17:00" }), [field]: value },
    });
  }
  return (
    <div className="space-y-2">
      {OFFICE_DAYS.map(({ key, label }) => {
        const day = hours[key];
        const isOpen = Boolean(day);
        return (
          <div key={key} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:gap-3">
            <label className="flex w-full items-center gap-2 text-sm font-bold text-[#111716] sm:w-32">
              <input
                type="checkbox"
                checked={isOpen}
                onChange={(e) => toggle(key, e.target.checked)}
                className="accent-[#148b8e]"
              />
              {label}
            </label>
            {isOpen ? (
              <div className="flex flex-wrap items-center gap-2 text-sm sm:pl-0">
                <input
                  type="time"
                  value={day!.open}
                  onChange={(e) => setTime(key, "open", e.target.value)}
                  className="rounded border border-black/10 px-2 py-1 text-[#111716]"
                />
                <span className="text-[#66716e]">to</span>
                <input
                  type="time"
                  value={day!.close}
                  onChange={(e) => setTime(key, "close", e.target.value)}
                  className="rounded border border-black/10 px-2 py-1 text-[#111716]"
                />
              </div>
            ) : (
              <span className="text-sm text-[#9aa5a2]">Closed</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

function defaultOutOfHoursMessage(businessName?: string) {
  const name = businessName?.trim() || "us";
  return `Thank you for calling ${name}. We're currently closed, but I'd be happy to take a message or help you with anything I can right now. How can I help you today?`;
}

export function OfficeHoursCard({
  agentId,
  initial,
  initialMessage,
  businessName,
  timezone,
}: {
  agentId: string;
  initial?: OfficeHours;
  initialMessage?: string;
  businessName?: string;
  timezone?: string;
}) {
  const [hours, setHours] = useState<OfficeHours>(initial ?? {});
  const [message, setMessage] = useState(initialMessage ?? "");
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const hasHours = Object.keys(hours).length > 0;

  function save() {
    setMsg(null);
    start(async () => {
      const r = await updateAgent(agentId, { officeHours: hours, outOfHoursMessage: message });
      setMsg(r.ok ? { ok: true, text: "Office hours saved." } : { ok: false, text: r.error ?? "Couldn't save." });
    });
  }

  return (
    <div className="mb-8 rounded-[14px] border border-black/10 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-black text-[#111716]">Office hours</p>
          <p className="text-sm text-[#66716e]">
            Set when your business is open. Outside these hours the agent uses the message below instead of its normal behaviour.
            {timezone ? ` Times in ${timezone}.` : ""} Leave all days closed to disable.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex h-9 items-center rounded-lg bg-[#111716] px-4 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="mt-4">
        <OfficeHoursGrid hours={hours} onChange={setHours} />
      </div>

      {hasHours && (
        <div className="mt-5 border-t border-black/5 pt-4">
          <label className="mb-1 block text-sm font-bold text-[#111716]">
            Out-of-hours message
          </label>
          <p className="mb-2 text-xs text-[#66716e]">
            What the agent says when a call comes in outside your opening hours. You can still offer bookings, take messages, or anything else — the agent will follow whatever you write here.
          </p>
          <textarea
            rows={4}
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder={defaultOutOfHoursMessage(businessName)}
            className="w-full rounded-lg border border-black/10 bg-[#f8fafa] px-3 py-2 text-sm text-[#111716] placeholder:text-[#9aa5a2] focus:outline-none focus:ring-2 focus:ring-[#148b8e]/40"
          />
        </div>
      )}

      {msg && (
        <p className={`mt-3 text-sm font-medium ${msg.ok ? "text-[#148b8e]" : "text-red-600"}`} aria-live="polite">
          {msg.text}
        </p>
      )}
    </div>
  );
}
