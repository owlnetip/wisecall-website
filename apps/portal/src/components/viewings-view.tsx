"use client";

import { useEffect, useState, useTransition } from "react";
import { CalendarClock, Home, Plus, RefreshCw } from "lucide-react";
import {
  listPropertiesForProfile,
  listViewingsForProfile,
  requestViewing,
  upsertProperty,
} from "@/app/actions/viewings";
import {
  formatViewingSlot,
  type PropertyRow,
  type ViewingRequestRow,
  viewingStatusLabel,
} from "@/lib/viewing-bookings";

function statusTone(status: string): string {
  switch (status) {
    case "confirmed":
      return "bg-emerald-50 text-emerald-800 border-emerald-200";
    case "pending_owner":
      return "bg-amber-50 text-amber-900 border-amber-200";
    case "declined":
    case "cancelled":
    case "expired":
      return "bg-rose-50 text-rose-800 border-rose-200";
    case "change_requested":
      return "bg-sky-50 text-sky-900 border-sky-200";
    default:
      return "bg-card-tint text-ink-soft border-line";
  }
}

export function ViewingsView({
  agents,
}: {
  agents: { id: string; name: string }[];
}) {
  const [profileId, setProfileId] = useState(agents[0]?.id || "");
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [viewings, setViewings] = useState<ViewingRequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [address, setAddress] = useState("");
  const [ownerPhone, setOwnerPhone] = useState("");
  const [ownerName, setOwnerName] = useState("");

  const [propertyId, setPropertyId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [viewerName, setViewerName] = useState("");
  const [viewerPhone, setViewerPhone] = useState("");

  function refresh(pid = profileId) {
    if (!pid) return;
    startTransition(async () => {
      setError(null);
      const [propsRes, viewsRes] = await Promise.all([
        listPropertiesForProfile(pid),
        listViewingsForProfile(pid),
      ]);
      if (!propsRes.ok) {
        setError(propsRes.error);
        return;
      }
      if (!viewsRes.ok) {
        setError(viewsRes.error);
        return;
      }
      setProperties(propsRes.properties);
      setViewings(viewsRes.viewings);
      if (!propertyId && propsRes.properties[0]) {
        setPropertyId(propsRes.properties[0].id);
      }
    });
  }

  useEffect(() => {
    refresh(profileId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profileId]);

  if (!agents.length) {
    return (
      <div className="rounded-xl border border-line bg-card p-6 text-sm text-ink-soft">
        Create an agent first, then add properties and request viewings here.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-ink">Viewings</h1>
          <p className="mt-1 max-w-2xl text-sm text-ink-soft">
            Book a slot, check agent availability, ask the owner by WhatsApp or SMS, then
            confirm and remind both parties automatically.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <select
            value={profileId}
            onChange={(e) => setProfileId(e.target.value)}
            className="h-10 rounded-lg border border-line bg-white px-3 text-sm"
          >
            {agents.map((a) => (
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
      {note && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
          {note}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <Home className="h-4 w-4 text-ink-soft" />
            <h2 className="font-black text-ink">Add property</h2>
          </div>
          <div className="space-y-3">
            <input
              value={address}
              onChange={(e) => setAddress(e.target.value)}
              placeholder="Address"
              className="h-10 w-full rounded-lg border border-line px-3 text-sm"
            />
            <input
              value={ownerName}
              onChange={(e) => setOwnerName(e.target.value)}
              placeholder="Owner name"
              className="h-10 w-full rounded-lg border border-line px-3 text-sm"
            />
            <input
              value={ownerPhone}
              onChange={(e) => setOwnerPhone(e.target.value)}
              placeholder="Owner mobile (+44…)"
              className="h-10 w-full rounded-lg border border-line px-3 text-sm"
            />
            <button
              type="button"
              disabled={isPending}
              onClick={() => {
                startTransition(async () => {
                  setError(null);
                  setNote(null);
                  const res = await upsertProperty({
                    profileId,
                    address,
                    ownerName,
                    ownerPhone,
                  });
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  setAddress("");
                  setOwnerName("");
                  setOwnerPhone("");
                  setPropertyId(res.id);
                  setNote("Property saved.");
                  refresh();
                });
              }}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-black text-white"
            >
              <Plus className="h-4 w-4" />
              Save property
            </button>
          </div>
          {properties.length > 0 && (
            <ul className="mt-5 space-y-2 border-t border-line pt-4">
              {properties.map((p) => (
                <li key={p.id} className="text-sm">
                  <button
                    type="button"
                    onClick={() => setPropertyId(p.id)}
                    className={`w-full rounded-lg border px-3 py-2 text-left ${
                      propertyId === p.id ? "border-ink bg-card-tint" : "border-line"
                    }`}
                  >
                    <div className="font-semibold text-ink">{p.address}</div>
                    <div className="text-ink-soft">
                      {[p.owner_name, p.owner_phone].filter(Boolean).join(" · ")}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="rounded-xl border border-line bg-card p-5">
          <div className="mb-4 flex items-center gap-2">
            <CalendarClock className="h-4 w-4 text-ink-soft" />
            <h2 className="font-black text-ink">Request viewing</h2>
          </div>
          <div className="space-y-3">
            <select
              value={propertyId}
              onChange={(e) => setPropertyId(e.target.value)}
              className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm"
            >
              <option value="">Select property…</option>
              {properties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.address}
                </option>
              ))}
            </select>
            <input
              type="datetime-local"
              value={startsAt}
              onChange={(e) => setStartsAt(e.target.value)}
              className="h-10 w-full rounded-lg border border-line px-3 text-sm"
            />
            <input
              value={viewerName}
              onChange={(e) => setViewerName(e.target.value)}
              placeholder="Viewer name"
              className="h-10 w-full rounded-lg border border-line px-3 text-sm"
            />
            <input
              value={viewerPhone}
              onChange={(e) => setViewerPhone(e.target.value)}
              placeholder="Viewer mobile (+44…)"
              className="h-10 w-full rounded-lg border border-line px-3 text-sm"
            />
            <button
              type="button"
              disabled={isPending || !propertyId || !startsAt}
              onClick={() => {
                startTransition(async () => {
                  setError(null);
                  setNote(null);
                  // datetime-local is wall-clock without TZ; treat as London by appending offset-less ISO and letting the edge accept it.
                  const iso = new Date(startsAt).toISOString();
                  const res = await requestViewing({
                    profileId,
                    propertyId,
                    startsAt: iso,
                    viewerName,
                    viewerPhone,
                  });
                  if (!res.ok) {
                    setError(res.error);
                    return;
                  }
                  setNote(res.note || `Viewing ${res.status}. Owner has been asked to confirm.`);
                  setViewerName("");
                  setViewerPhone("");
                  refresh();
                });
              }}
              className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-black text-white disabled:opacity-40"
            >
              Ask owner to confirm
            </button>
          </div>
        </section>
      </div>

      <section className="rounded-xl border border-line bg-card">
        <div className="border-b border-line px-5 py-4">
          <h2 className="font-black text-ink">Recent requests</h2>
        </div>
        {viewings.length === 0 ? (
          <p className="px-5 py-8 text-sm text-ink-soft">No viewing requests yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {viewings.map((v) => (
              <li key={v.id} className="flex flex-col gap-2 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <div className="font-semibold text-ink">{v.property_address}</div>
                  <div className="text-sm text-ink-soft">
                    {formatViewingSlot(v.proposed_starts_at)}
                    {v.viewer_name ? ` · ${v.viewer_name}` : ""}
                    {v.owner_channel ? ` · via ${v.owner_channel}` : ""}
                  </div>
                </div>
                <span
                  className={`inline-flex w-fit rounded-full border px-2.5 py-1 text-xs font-semibold ${statusTone(v.status)}`}
                >
                  {viewingStatusLabel(v.status)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
