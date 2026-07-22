"use client";

import { useEffect, useState, useTransition } from "react";
import { CalendarRange, Check, Loader2, Unplug } from "lucide-react";
import {
  connectCalCom,
  disconnectCalendar,
  getCalendarConnection,
  saveCalComEventTypes,
  type CalendarConnection,
  type CalendarEventType,
} from "@/app/actions/calendar";

export function CalendarBookingCard({ agentId }: { agentId: string }) {
  const [connection, setConnection] = useState<CalendarConnection | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function load() {
    startTransition(async () => {
      setError(null);
      const res = await getCalendarConnection(agentId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConnection(res.connection);
      if (res.connection?.event_types?.length) {
        setSelected(new Set(res.connection.event_types.map((e) => String(e.id))));
      }
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  return (
    <section className="mb-5 rounded-xl border border-line bg-card p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-card-tint">
          <CalendarRange className="h-4 w-4 text-ink-soft" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-black text-ink">Diary / Cal.com</h3>
          <p className="mt-1 text-sm text-ink-soft">
            Connect Cal.com so viewing requests can check negotiator availability before the
            owner is asked. Without it, viewings still work — the owner confirm loop runs, and
            availability is left for the branch to double-check.
          </p>
        </div>
      </div>

      {error && (
        <div className="mb-3 rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
          {error}
        </div>
      )}
      {note && (
        <div className="mb-3 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
          {note}
        </div>
      )}

      {connection?.connected ? (
        <div className="space-y-4">
          <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-emerald-800">
            <Check className="h-3.5 w-3.5" />
            Cal.com connected
            {connection.event_types.length
              ? ` · ${connection.event_types.length} event type${connection.event_types.length === 1 ? "" : "s"}`
              : ""}
          </div>

          {connection.event_types.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-soft">
                Bookable event types
              </p>
              <ul className="space-y-2">
                {connection.event_types.map((et) => {
                  const id = String(et.id);
                  const on = selected.has(id);
                  return (
                    <li key={id}>
                      <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm">
                        <input
                          type="checkbox"
                          checked={on}
                          onChange={() => {
                            setSelected((prev) => {
                              const next = new Set(prev);
                              if (next.has(id)) next.delete(id);
                              else next.add(id);
                              return next;
                            });
                          }}
                        />
                        <span className="font-semibold text-ink">{et.title}</span>
                        {et.duration_mins ? (
                          <span className="text-ink-soft">{et.duration_mins} mins</span>
                        ) : null}
                      </label>
                    </li>
                  );
                })}
              </ul>
              <button
                type="button"
                disabled={isPending || selected.size === 0}
                onClick={() => {
                  startTransition(async () => {
                    setError(null);
                    setNote(null);
                    const kept: CalendarEventType[] = connection.event_types.filter((e) =>
                      selected.has(String(e.id)),
                    );
                    const res = await saveCalComEventTypes(agentId, kept);
                    if (!res.ok) {
                      setError(res.error);
                      return;
                    }
                    setConnection({ ...connection, event_types: kept });
                    setNote("Saved bookable event types.");
                  });
                }}
                className="mt-3 inline-flex h-9 items-center rounded-lg border border-line bg-white px-3 text-sm font-semibold disabled:opacity-40"
              >
                Save event types
              </button>
            </div>
          )}

          <button
            type="button"
            disabled={isPending}
            onClick={() => {
              startTransition(async () => {
                setError(null);
                setNote(null);
                const res = await disconnectCalendar(agentId);
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                setConnection(null);
                setApiKey("");
                setNote("Cal.com disconnected.");
              });
            }}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line px-3 text-sm font-semibold text-ink-soft"
          >
            <Unplug className="h-4 w-4" />
            Disconnect
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block font-semibold text-ink">Cal.com API key</span>
            <input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="cal_live_…"
              className="h-10 w-full rounded-lg border border-line px-3 text-sm"
              autoComplete="off"
            />
          </label>
          <p className="text-xs text-ink-soft">
            Cal.com → Settings → API keys. Create a key, paste it here. We store it on the agent
            and use it only to read slots / book when a viewing is requested.
          </p>
          <button
            type="button"
            disabled={isPending || !apiKey.trim()}
            onClick={() => {
              startTransition(async () => {
                setError(null);
                setNote(null);
                const res = await connectCalCom(agentId, apiKey);
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                setConnection(res.connection);
                setSelected(new Set(res.connection.event_types.map((e) => String(e.id))));
                setApiKey("");
                setNote("Cal.com connected.");
              });
            }}
            className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-black text-white disabled:opacity-40"
          >
            {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Connect Cal.com
          </button>
        </div>
      )}
    </section>
  );
}
