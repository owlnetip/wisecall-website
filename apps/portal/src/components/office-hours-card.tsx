"use client";

import { useState, useTransition } from "react";
import { updateAgent } from "@/app/actions/agents";
import type { OfficeHours } from "./customer-agent-workspace";

const DAYS: { key: string; label: string }[] = [
  { key: "mon", label: "Monday" },
  { key: "tue", label: "Tuesday" },
  { key: "wed", label: "Wednesday" },
  { key: "thu", label: "Thursday" },
  { key: "fri", label: "Friday" },
  { key: "sat", label: "Saturday" },
  { key: "sun", label: "Sunday" },
];

export function OfficeHoursCard({
  agentId,
  initial,
  timezone,
}: {
  agentId: string;
  initial?: OfficeHours;
  timezone?: string;
}) {
  const [hours, setHours] = useState<OfficeHours>(initial ?? {});
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  function toggle(day: string, open: boolean) {
    setHours((h) => {
      const next = { ...h };
      if (open) next[day] = next[day] ?? { open: "09:00", close: "17:00" };
      else delete next[day];
      return next;
    });
  }
  function setTime(day: string, field: "open" | "close", value: string) {
    setHours((h) => ({
      ...h,
      [day]: { ...(h[day] ?? { open: "09:00", close: "17:00" }), [field]: value },
    }));
  }
  function save() {
    setMsg(null);
    start(async () => {
      const r = await updateAgent(agentId, { officeHours: hours });
      setMsg(r.ok ? { ok: true, text: "Office hours saved." } : { ok: false, text: r.error ?? "Couldn't save." });
    });
  }

  return (
    <div className="mb-8 rounded-[14px] border border-black/10 bg-white px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-black text-[#111716]">Office hours</p>
          <p className="text-sm text-[#66716e]">
            Outside these hours the agent takes a detailed message and emails it — no transfers or bookings.
            {timezone ? ` Times in ${timezone}.` : ""} Leave all days closed to disable.
          </p>
        </div>
        <button
          type="button"
          onClick={save}
          disabled={pending}
          className="inline-flex h-9 items-center rounded-lg bg-[#111716] px-4 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
        >
          {pending ? "Saving…" : "Save hours"}
        </button>
      </div>

      <div className="mt-4 space-y-2">
        {DAYS.map(({ key, label }) => {
          const day = hours[key];
          const isOpen = Boolean(day);
          return (
            <div key={key} className="flex items-center gap-3">
              <label className="flex w-32 items-center gap-2 text-sm font-bold text-[#111716]">
                <input
                  type="checkbox"
                  checked={isOpen}
                  onChange={(e) => toggle(key, e.target.checked)}
                  className="accent-[#148b8e]"
                />
                {label}
              </label>
              {isOpen ? (
                <div className="flex items-center gap-2 text-sm">
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

      {msg && (
        <p className={`mt-3 text-sm font-medium ${msg.ok ? "text-[#148b8e]" : "text-red-600"}`} aria-live="polite">
          {msg.text}
        </p>
      )}
    </div>
  );
}
