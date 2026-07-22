"use client";

import { useEffect, useState, useTransition } from "react";
import { Home, RefreshCw, Upload } from "lucide-react";
import {
  importPropertiesFromCsv,
  listPropertiesForProfile,
  listViewingsForProfile,
} from "@/app/actions/viewings";
import { PropertyCrmCard } from "@/components/property-crm-card";
import {
  guessAddressColumn,
  guessListingRefColumn,
  guessOwnerNameColumn,
  guessOwnerPhoneColumn,
  guessPostcodeColumn,
  parseCsv,
} from "@/lib/csv";
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

export function EstatePropertiesCard({ agentId }: { agentId: string }) {
  const [properties, setProperties] = useState<PropertyRow[]>([]);
  const [viewings, setViewings] = useState<ViewingRequestRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [parsedHeaders, setParsedHeaders] = useState<string[]>([]);
  const [parsedRows, setParsedRows] = useState<Record<string, string>[]>([]);
  const [addressCol, setAddressCol] = useState("");
  const [ownerPhoneCol, setOwnerPhoneCol] = useState("");
  const [ownerNameCol, setOwnerNameCol] = useState("");
  const [listingRefCol, setListingRefCol] = useState("");
  const [postcodeCol, setPostcodeCol] = useState("");

  function load() {
    startTransition(async () => {
      setError(null);
      const [propsRes, viewsRes] = await Promise.all([
        listPropertiesForProfile(agentId),
        listViewingsForProfile(agentId),
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
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  function onCsvFile(file: File | null) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const text = String(reader.result || "");
      const res = parseCsv(text);
      setParsedHeaders(res.headers);
      setParsedRows(res.rows);
      setAddressCol(guessAddressColumn(res.headers) || "");
      setOwnerPhoneCol(guessOwnerPhoneColumn(res.headers) || "");
      setOwnerNameCol(guessOwnerNameColumn(res.headers) || "");
      setListingRefCol(guessListingRefColumn(res.headers) || "");
      setPostcodeCol(guessPostcodeColumn(res.headers) || "");
      setNote(null);
      setError(null);
    };
    reader.readAsText(file);
  }

  return (
    <section className="mb-5 rounded-xl border border-line bg-card p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-card-tint">
          <Home className="h-4 w-4 text-ink-soft" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-black text-ink">Property register</h3>
          <p className="mt-1 text-sm text-ink-soft">
            Import your listings from a CRM or spreadsheet export. Each row maps an address (or
            listing ref) to the owner&apos;s mobile so the agent can text them for viewing
            confirmation. You get an email when a viewing is requested.
          </p>
        </div>
        <button
          type="button"
          onClick={load}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-white px-3 text-xs font-semibold"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${isPending ? "animate-spin" : ""}`} />
          Refresh
        </button>
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

      <PropertyCrmCard agentId={agentId} onSynced={() => load()} />

      <div className="mb-5 rounded-lg border border-dashed border-line bg-card-tint/50 p-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-soft">
          Or import from CSV / spreadsheet
        </p>
        <p className="mb-3 text-xs text-ink-soft">
          Expected columns: <strong>address</strong>, <strong>owner mobile</strong>. Optional:
          owner name, listing ref, postcode. Re-importing updates rows that match the same listing
          ref or address.
        </p>
        <label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-lg border border-line bg-white px-4 text-sm font-semibold">
          <Upload className="h-4 w-4" />
          {parsedRows.length ? `${parsedRows.length} rows loaded — replace file` : "Upload CSV"}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            onChange={(e) => onCsvFile(e.target.files?.[0] ?? null)}
          />
        </label>

        {parsedHeaders.length > 0 && (
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {[
              ["Address column", addressCol, setAddressCol, true],
              ["Owner mobile column", ownerPhoneCol, setOwnerPhoneCol, true],
              ["Owner name column", ownerNameCol, setOwnerNameCol, false],
              ["Listing ref column", listingRefCol, setListingRefCol, false],
              ["Postcode column", postcodeCol, setPostcodeCol, false],
            ].map(([label, value, setter, required]) => (
              <label key={String(label)} className="block text-sm">
                <span className="mb-1 block font-semibold text-ink">
                  {label}
                  {required ? " *" : ""}
                </span>
                <select
                  value={value}
                  onChange={(e) => (setter as (v: string) => void)(e.target.value)}
                  className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm"
                >
                  <option value="">—</option>
                  {parsedHeaders.map((h) => (
                    <option key={h} value={h}>
                      {h}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        )}

        {parsedRows.length > 0 && (
          <button
            type="button"
            disabled={isPending || !addressCol || !ownerPhoneCol}
            onClick={() => {
              startTransition(async () => {
                setError(null);
                setNote(null);
                const res = await importPropertiesFromCsv({
                  profileId: agentId,
                  rows: parsedRows.map((row) => ({
                    address: row[addressCol] || "",
                    ownerPhone: row[ownerPhoneCol] || "",
                    ownerName: ownerNameCol ? row[ownerNameCol] : undefined,
                    listingRef: listingRefCol ? row[listingRefCol] : undefined,
                    postcode: postcodeCol ? row[postcodeCol] : undefined,
                  })),
                });
                if (!res.ok) {
                  setError(res.error);
                  return;
                }
                setNote(
                  `Imported ${res.imported} propert${res.imported === 1 ? "y" : "ies"}` +
                    (res.skipped ? ` · ${res.skipped} skipped (missing address or mobile)` : "") +
                    ".",
                );
                setParsedRows([]);
                setParsedHeaders([]);
                load();
              });
            }}
            className="mt-4 inline-flex h-10 items-center rounded-lg bg-ink px-4 text-sm font-black text-white disabled:opacity-40"
          >
            Import properties
          </button>
        )}
      </div>

      {properties.length > 0 ? (
        <div className="mb-5">
          <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-soft">
            {properties.length} propert{properties.length === 1 ? "y" : "ies"}
          </p>
          <ul className="max-h-48 space-y-2 overflow-y-auto rounded-lg border border-line">
            {properties.slice(0, 50).map((p) => (
              <li key={p.id} className="border-b border-line px-3 py-2 text-sm last:border-0">
                <div className="font-semibold text-ink">{p.address}</div>
                <div className="text-ink-soft">
                  {[p.listing_ref, p.owner_name, p.owner_phone].filter(Boolean).join(" · ")}
                </div>
              </li>
            ))}
          </ul>
          {properties.length > 50 && (
            <p className="mt-1 text-xs text-ink-soft">Showing first 50 of {properties.length}.</p>
          )}
        </div>
      ) : (
        <p className="mb-5 text-sm text-ink-soft">
          No properties yet — upload a CSV from your CRM or property software.
        </p>
      )}

      <div>
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-soft">
          Recent viewing requests
        </p>
        {viewings.length === 0 ? (
          <p className="text-sm text-ink-soft">
            When callers ask to view a property, the owner gets an SMS and you get an email here.
          </p>
        ) : (
          <ul className="divide-y divide-line rounded-lg border border-line">
            {viewings.slice(0, 10).map((v) => (
              <li
                key={v.id}
                className="flex flex-col gap-2 px-3 py-3 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="text-sm font-semibold text-ink">{v.property_address}</div>
                  <div className="text-xs text-ink-soft">
                    {formatViewingSlot(v.proposed_starts_at)}
                    {v.viewer_name ? ` · ${v.viewer_name}` : ""}
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
      </div>
    </section>
  );
}
