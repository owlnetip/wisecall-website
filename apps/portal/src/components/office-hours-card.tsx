"use client";

import { useState, useTransition } from "react";
import { Check, Clock, Loader2 } from "lucide-react";
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

const DAY_SHORT: Record<string, string> = {
  mon: "Mon",
  tue: "Tue",
  wed: "Wed",
  thu: "Thu",
  fri: "Fri",
  sat: "Sat",
  sun: "Sun",
};

// Controlled 7-day open/close grid. Reused by the card (saves itself) and the
// setup wizard (collects into the new-agent draft). Parent owns the value.
// Each day is a row: a pill toggle (tap to open/close) + time inputs when open.
export function OfficeHoursGrid({
  hours,
  onChange,
}: {
  hours: OfficeHours;
  onChange: (next: OfficeHours) => void;
}) {
  function toggle(day: string) {
    const next = { ...hours };
    if (next[day]) delete next[day];
    else next[day] = { open: "09:00", close: "17:00" };
    onChange(next);
  }
  function setTime(day: string, field: "open" | "close", value: string) {
    onChange({
      ...hours,
      [day]: { ...(hours[day] ?? { open: "09:00", close: "17:00" }), [field]: value },
    });
  }
  function copyToWeekdays(sourceDay: string) {
    const src = hours[sourceDay];
    if (!src) return;
    const next = { ...hours };
    for (const key of ["mon", "tue", "wed", "thu", "fri"]) {
      next[key] = { ...src };
    }
    onChange(next);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-line">
      {OFFICE_DAYS.map(({ key, label }, idx) => {
        const day = hours[key];
        const isOpen = Boolean(day);
        return (
          <div
            key={key}
            className={`flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 transition ${
              idx > 0 ? "border-t border-line" : ""
            } ${isOpen ? "bg-card" : "bg-card-tint"}`}
          >
            <button
              type="button"
              onClick={() => toggle(key)}
              aria-pressed={isOpen}
              className={`press inline-flex w-[104px] flex-shrink-0 items-center gap-2 rounded-full px-3 py-1.5 text-sm font-bold transition ${
                isOpen
                  ? "bg-teal-wash text-teal-deep"
                  : "text-ink-faint hover:bg-white hover:text-ink-soft"
              }`}
            >
              <span
                className={`flex h-4 w-4 flex-shrink-0 items-center justify-center rounded-full border transition ${
                  isOpen ? "border-teal bg-teal text-white" : "border-line-strong bg-white text-transparent"
                }`}
              >
                <Check className="h-3 w-3" />
              </span>
              {DAY_SHORT[key] ?? label}
            </button>
            {isOpen ? (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <input
                  type="time"
                  value={day!.open}
                  onChange={(e) => setTime(key, "open", e.target.value)}
                  className="rounded-lg border border-line bg-white px-2 py-1 font-mono text-sm text-ink outline-none transition focus:border-teal"
                />
                <span className="text-ink-faint">–</span>
                <input
                  type="time"
                  value={day!.close}
                  onChange={(e) => setTime(key, "close", e.target.value)}
                  className="rounded-lg border border-line bg-white px-2 py-1 font-mono text-sm text-ink outline-none transition focus:border-teal"
                />
                {key === "mon" ? (
                  <button
                    type="button"
                    onClick={() => copyToWeekdays(key)}
                    className="press ml-1 rounded-lg px-2 py-1 text-xs font-bold text-teal transition hover:bg-teal-wash"
                  >
                    Copy to Mon–Fri
                  </button>
                ) : null}
              </div>
            ) : (
              <span className="text-sm text-ink-faint">Closed</span>
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
  const [dirty, setDirty] = useState(false);

  const hasHours = Object.keys(hours).length > 0;

  function save() {
    setMsg(null);
    start(async () => {
      const r = await updateAgent(agentId, { officeHours: hours, outOfHoursMessage: message });
      if (r.ok) {
        setDirty(false);
        setMsg({ ok: true, text: "Saved" });
        setTimeout(() => setMsg(null), 2000);
      } else {
        setMsg({ ok: false, text: r.error ?? "Couldn't save." });
      }
    });
  }

  return (
    <div className="mb-6 rounded-2xl border border-line bg-card px-5 py-4 shadow-card">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl bg-teal-wash text-teal">
            <Clock className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="font-black text-ink">Office hours</p>
            <p className="text-sm text-ink-soft">
              Outside these hours the agent switches to your after-hours message.
              {timezone ? ` Times in ${timezone}.` : ""}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          {msg && (
            <span
              aria-live="polite"
              className={`anim-pop text-sm font-bold ${msg.ok ? "text-good" : "text-danger"}`}
            >
              {msg.ok ? (
                <span className="inline-flex items-center gap-1">
                  <Check className="h-4 w-4" /> {msg.text}
                </span>
              ) : (
                msg.text
              )}
            </span>
          )}
          <button
            type="button"
            onClick={save}
            disabled={pending || !dirty}
            className="press inline-flex h-9 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-40"
          >
            {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {pending ? "Saving…" : "Save"}
          </button>
        </div>
      </div>

      <div className="mt-4">
        <OfficeHoursGrid
          hours={hours}
          onChange={(next) => {
            setHours(next);
            setDirty(true);
          }}
        />
      </div>

      {hasHours && (
        <div className="anim-fade mt-5 border-t border-line pt-4">
          <label className="mb-1 block text-sm font-black text-ink">Out-of-hours message</label>
          <p className="mb-2 text-xs text-ink-soft">
            What the agent says when a call comes in outside your opening hours. It can still take
            messages, offer bookings, or anything else you write here.
          </p>
          <textarea
            rows={3}
            value={message}
            onChange={(e) => {
              setMessage(e.target.value);
              setDirty(true);
            }}
            placeholder={defaultOutOfHoursMessage(businessName)}
            className="w-full rounded-xl border border-line bg-card-tint px-3 py-2 text-sm leading-relaxed text-ink outline-none transition placeholder:text-ink-faint focus:border-teal focus:bg-white"
          />
        </div>
      )}
    </div>
  );
}
