"use client";

import { useEffect, useState, useTransition } from "react";
import {
  CalendarCheck,
  Handshake,
  RefreshCw,
  UserRound,
  AlertTriangle,
  Home,
} from "lucide-react";
import {
  getNegotiatorDigest,
  listEnquiriesForProfile,
  updateEnquiryStatus,
} from "@/app/actions/enquiries";
import {
  enquiryStatusLabel,
  partyRoleLabel,
  type EnquiryRow,
  type EnquiryStatus,
  type NegotiatorDigest,
} from "@/lib/digital-negotiator";

function statusTone(status: string): string {
  switch (status) {
    case "confirmed":
    case "qualified":
    case "viewing_requested":
    case "closed_won":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "qualifying":
    case "new":
      return "bg-amber-50 text-amber-900 border-amber-200";
    case "handed_to_negotiator":
      return "bg-sky-50 text-sky-900 border-sky-200";
    case "closed_lost":
      return "bg-rose-50 text-rose-800 border-rose-200";
    default:
      return "bg-card-tint text-ink-soft border-line";
  }
}

function formatWhen(iso: string): string {
  try {
    return new Intl.DateTimeFormat("en-GB", {
      weekday: "short",
      day: "numeric",
      month: "short",
      hour: "2-digit",
      minute: "2-digit",
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function DigitalNegotiatorView({
  agents,
}: {
  agents: { id: string; name: string; templateId?: string }[];
}) {
  const estateAgents = agents.filter(
    (a) => !a.templateId || a.templateId === "estate_agent",
  );
  const list = estateAgents.length ? estateAgents : agents;
  const [profileId, setProfileId] = useState(list[0]?.id || "");
  const [digest, setDigest] = useState<NegotiatorDigest | null>(null);
  const [enquiries, setEnquiries] = useState<EnquiryRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function refresh(pid = profileId) {
    if (!pid) return;
    startTransition(async () => {
      setError(null);
      const [digestRes, listRes] = await Promise.all([
        getNegotiatorDigest(pid),
        listEnquiriesForProfile(pid),
      ]);
      if (!digestRes.ok) {
        setError(digestRes.error);
        return;
      }
      if (!listRes.ok) {
        setError(listRes.error);
        return;
      }
      setDigest(digestRes.digest);
      setEnquiries(listRes.enquiries);
    });
  }

  useEffect(() => {
    refresh(profileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  if (!list.length) {
    return (
      <div className="rounded-xl border border-line bg-card p-6 text-sm text-ink-soft">
        Create an estate agent first to see qualified enquiries and weekend results.
      </div>
    );
  }

  const stats = [
    {
      label: "Viewings confirmed",
      value: digest?.viewersBooked ?? "—",
      icon: CalendarCheck,
    },
    {
      label: "Pending owner",
      value: digest?.pendingOwner ?? "—",
      icon: Home,
    },
    {
      label: "Valuations",
      value: digest?.valuations ?? "—",
      icon: Handshake,
    },
    {
      label: "Qualified buyers",
      value: digest?.qualifiedBuyers ?? "—",
      icon: UserRound,
    },
    {
      label: "Needs human",
      value: digest?.needsHuman ?? "—",
      icon: AlertTriangle,
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-ink">Digital Negotiator</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Out-of-hours qualification, viewing bookings, and the Monday morning results board —
            train the rules on each estate agent under Behaviour.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            className="h-10 rounded-lg border border-line bg-white px-3 text-sm"
          >
            {list.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={() => refresh()}
            className="inline-flex h-10 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold"
          >
            <RefreshCw className={`h-4 w-4 ${isPending ? "animate-spin" : ""}`} />
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-900">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-line bg-card p-5">
        <div className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="font-black text-ink">
            {digest?.label || "Weekend"} results
          </h2>
          {digest && (
            <p className="text-xs text-ink-soft">
              {formatWhen(digest.windowFrom)} → {formatWhen(digest.windowTo)}
            </p>
          )}
        </div>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          {stats.map((s) => (
            <div
              key={s.label}
              className="rounded-xl border border-line bg-card-tint px-4 py-3"
            >
              <div className="flex items-center gap-2 text-ink-soft">
                <s.icon className="h-4 w-4" />
                <span className="text-xs font-bold uppercase tracking-wide">{s.label}</span>
              </div>
              <p className="mt-2 text-2xl font-black text-ink">{s.value}</p>
            </div>
          ))}
        </div>
        {digest && digest.enquiries.length === 0 && (
          <p className="mt-4 text-sm text-ink-soft">
            No enquiries logged in this window yet. Once the agent qualifies callers (or after-call
            analysis runs for property leads), they show up here.
          </p>
        )}
      </section>

      <section className="rounded-xl border border-line bg-card p-5">
        <h2 className="mb-4 font-black text-ink">All enquiries</h2>
        {enquiries.length === 0 ? (
          <p className="text-sm text-ink-soft">
            No enquiries yet. The voice agent logs them via <code className="text-xs">log_enquiry</code>{" "}
            during the call, and after-call analysis backfills property leads.
          </p>
        ) : (
          <ul className="divide-y divide-line">
            {enquiries.map((e) => (
              <li key={e.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-ink">
                      {e.contact_name || e.contact_phone || "Unknown caller"}
                    </span>
                    <span
                      className={`rounded-full border px-2 py-0.5 text-[11px] font-bold ${statusTone(e.status)}`}
                    >
                      {enquiryStatusLabel(e.status)}
                    </span>
                    <span className="rounded-full border border-line bg-white px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
                      {partyRoleLabel(e.party_role)}
                    </span>
                    {e.needs_human && (
                      <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-[11px] font-bold text-amber-900">
                        Needs human
                      </span>
                    )}
                  </div>
                  <p className="mt-1 text-sm text-ink-soft">
                    {[
                      e.budget_text ||
                        (e.budget_max != null ? `£${e.budget_max.toLocaleString("en-GB")}` : null),
                      e.areas.length ? e.areas.join(", ") : null,
                      e.beds_min != null ? `${e.beds_min}+ beds` : null,
                      e.move_timeline,
                      e.financing,
                    ]
                      .filter(Boolean)
                      .join(" · ") || e.summary || "No qualification details yet"}
                  </p>
                  {e.summary && (
                    <p className="mt-1 text-sm text-ink">{e.summary}</p>
                  )}
                  {e.human_reason && (
                    <p className="mt-1 text-xs text-amber-800">{e.human_reason}</p>
                  )}
                  <p className="mt-1 text-xs text-ink-faint">
                    {formatWhen(e.created_at)} · {e.source}
                    {e.contact_phone ? ` · ${e.contact_phone}` : ""}
                  </p>
                </div>
                <select
                  value={e.status}
                  disabled={isPending}
                  onChange={(ev) => {
                    const status = ev.target.value as EnquiryStatus;
                    startTransition(async () => {
                      const res = await updateEnquiryStatus({
                        profileId,
                        enquiryId: e.id,
                        status,
                      });
                      if (!res.ok) {
                        setError(res.error);
                        return;
                      }
                      setEnquiries((cur) =>
                        cur.map((row) => (row.id === e.id ? { ...row, status } : row)),
                      );
                    });
                  }}
                  className="h-9 shrink-0 rounded-lg border border-line bg-white px-2 text-xs font-semibold"
                >
                  {(
                    [
                      "new",
                      "qualifying",
                      "qualified",
                      "viewing_requested",
                      "confirmed",
                      "handed_to_negotiator",
                      "closed_lost",
                      "closed_won",
                    ] as EnquiryStatus[]
                  ).map((s) => (
                    <option key={s} value={s}>
                      {enquiryStatusLabel(s)}
                    </option>
                  ))}
                </select>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
