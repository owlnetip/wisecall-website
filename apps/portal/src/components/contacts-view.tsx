"use client";

import { useState, useTransition } from "react";
import { Phone, Mail, Search, MessageSquareText, History } from "lucide-react";
import type { Contact } from "@/lib/contacts";
import type { CallLog } from "@/lib/agents";
import { updateContactNotes } from "@/app/actions/contacts";

function initials(name: string, phone: string): string {
  const n = name.trim();
  if (n) {
    const parts = n.split(/\s+/);
    return parts.length >= 2
      ? (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
      : n.slice(0, 2).toUpperCase();
  }
  return phone ? phone.slice(-2) : "?";
}

function relativeDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = Date.now();
  const diff = now - d.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}

function absoluteDate(iso: string): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function ContactRow({
  contact,
  selected,
  onClick,
}: {
  contact: Contact;
  selected: boolean;
  onClick: () => void;
}) {
  const displayName = contact.name || contact.phone || contact.email || "Unknown";
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
        selected ? "bg-[#eefbfb]" : "hover:bg-[#f2f4f3]"
      }`}
    >
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-[#148b8e]/10 text-sm font-black text-[#148b8e]">
        {initials(contact.name, contact.phone)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-[#111716]">{displayName}</p>
        <p className="truncate text-xs text-[#66716e]">
          {contact.phone || contact.email || "No contact info"}
        </p>
      </div>
      <div className="flex-shrink-0 text-right">
        <p className="text-xs text-[#9aa5a2]">{relativeDate(contact.lastSeen)}</p>
        {contact.callCount > 0 && (
          <p className="mt-0.5 text-xs font-semibold text-[#148b8e]">
            {contact.callCount} call{contact.callCount !== 1 ? "s" : ""}
          </p>
        )}
      </div>
    </button>
  );
}

function ContactDetail({
  contact,
  callLogs,
}: {
  contact: Contact;
  callLogs: CallLog[];
}) {
  const [notes, setNotes] = useState(contact.notes);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Reset local state when the selected contact changes
  const [lastId, setLastId] = useState(contact.id);
  if (contact.id !== lastId) {
    setLastId(contact.id);
    setNotes(contact.notes);
    setSaved(false);
    setSaveError(null);
  }

  // Match interactions across channels: phone calls (caller = number) and emails
  // (caller = email address). One timeline per contact.
  const phoneKey = contact.phone.replace(/\s/g, "");
  const emailKey = contact.email.toLowerCase();
  const relatedCalls = callLogs.filter((l) => {
    const caller = (l.caller || "").trim();
    if (phoneKey && caller.replace(/\s/g, "") === phoneKey) return true;
    if (emailKey && caller.toLowerCase() === emailKey) return true;
    return false;
  });

  const displayName = contact.name || contact.phone || contact.email || "Unknown caller";

  function saveNotes() {
    setSaved(false);
    setSaveError(null);
    start(async () => {
      const r = await updateContactNotes(contact.id, notes);
      if (r.ok) setSaved(true);
      else setSaveError(r.error ?? "Couldn't save.");
    });
  }

  return (
    <div className="flex h-full flex-col overflow-y-auto">
      {/* Header */}
      <div className="flex items-start gap-4 border-b border-black/5 px-6 py-5">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-[#148b8e]/10 text-lg font-black text-[#148b8e]">
          {initials(contact.name, contact.phone)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-black text-[#111716]">{displayName}</h2>
          <p className="text-sm text-[#66716e]">{contact.agentName}</p>
          <div className="mt-2 flex flex-wrap gap-3">
            {contact.phone && (
              <span className="flex items-center gap-1.5 text-sm text-[#111716]">
                <Phone className="h-3.5 w-3.5 text-[#148b8e]" />
                {contact.phone}
              </span>
            )}
            {contact.email && (
              <span className="flex items-center gap-1.5 text-sm text-[#111716]">
                <Mail className="h-3.5 w-3.5 text-[#148b8e]" />
                {contact.email}
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-5 px-6 py-5">
        {/* Stats row */}
        <div className="grid grid-cols-3 gap-3">
          {[
            {
              label: "Interactions",
              value: `${contact.callCount} call${contact.callCount !== 1 ? "s" : ""}${
                contact.emailCount ? `, ${contact.emailCount} email${contact.emailCount !== 1 ? "s" : ""}` : ""
              }`,
            },
            { label: "First contact", value: absoluteDate(contact.firstSeen) },
            { label: "Last contact", value: relativeDate(contact.lastSeen) },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl bg-[#f8fafa] px-4 py-3">
              <p className="text-xs text-[#66716e]">{label}</p>
              <p className="mt-0.5 text-sm font-black text-[#111716]">{value}</p>
            </div>
          ))}
        </div>

        {/* AI summary */}
        {contact.aiSummary && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-[#111716]">
              <MessageSquareText className="h-4 w-4 text-[#148b8e]" />
              AI summary
            </p>
            <p className="rounded-xl bg-[#eefbfb] px-4 py-3 text-sm text-[#0e4b4d]">
              {contact.aiSummary}
            </p>
          </div>
        )}

        {/* Notes */}
        <div>
          <p className="mb-1.5 text-sm font-bold text-[#111716]">Notes</p>
          <textarea
            rows={4}
            value={notes}
            onChange={(e) => { setNotes(e.target.value); setSaved(false); }}
            placeholder="Add private notes about this contact — visible only to you."
            className="w-full rounded-lg border border-black/10 bg-[#f8fafa] px-3 py-2 text-sm text-[#111716] placeholder:text-[#9aa5a2] focus:outline-none focus:ring-2 focus:ring-[#148b8e]/40"
          />
          <div className="mt-2 flex items-center gap-3">
            <button
              type="button"
              onClick={saveNotes}
              disabled={pending}
              className="inline-flex h-8 items-center rounded-lg bg-[#111716] px-4 text-xs font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save notes"}
            </button>
            {saved && <span className="text-xs font-medium text-[#148b8e]">Saved</span>}
            {saveError && <span className="text-xs font-medium text-red-600">{saveError}</span>}
          </div>
        </div>

        {/* Call history */}
        {relatedCalls.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-[#111716]">
              <History className="h-4 w-4 text-[#148b8e]" />
              Call history ({relatedCalls.length})
            </p>
            <div className="space-y-2">
              {relatedCalls.slice(0, 10).map((log) => (
                <div
                  key={log.id}
                  className="rounded-xl border border-black/5 bg-[#f8fafa] px-4 py-3"
                >
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-[#111716]">
                      {log.outcome || "Call"}
                    </p>
                    <span className="flex-shrink-0 text-xs text-[#9aa5a2]">
                      {relativeDate(log.startedAt)} · {log.durationLabel}
                    </span>
                  </div>
                  {log.summary && (
                    <p className="mt-1 text-xs text-[#66716e] line-clamp-2">{log.summary}</p>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function ContactsView({
  contacts,
  callLogs,
}: {
  contacts: Contact[];
  callLogs: CallLog[];
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(contacts[0]?.id ?? null);

  const filtered = contacts.filter((c) => {
    const q = search.toLowerCase().trim();
    if (!q) return true;
    return (
      c.name.toLowerCase().includes(q) ||
      c.phone.includes(q) ||
      c.email.toLowerCase().includes(q) ||
      c.aiSummary.toLowerCase().includes(q)
    );
  });

  const selected = contacts.find((c) => c.id === selectedId) ?? null;

  if (contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-[#eefbfb]">
          <Phone className="h-8 w-8 text-[#148b8e]" />
        </div>
        <p className="text-lg font-black text-[#111716]">No contacts yet</p>
        <p className="mt-2 max-w-xs text-sm text-[#66716e]">
          Contacts appear here automatically as your agents handle calls. Every caller becomes a
          contact with a full history of their interactions.
        </p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-[600px] gap-0 overflow-hidden rounded-[14px] border border-black/10 bg-white">
      {/* Contact list */}
      <div className="flex w-[300px] flex-shrink-0 flex-col border-r border-black/5">
        <div className="border-b border-black/5 p-3">
          <div className="flex items-center gap-2 rounded-lg border border-black/10 bg-[#f8fafa] px-3 py-2">
            <Search className="h-4 w-4 flex-shrink-0 text-[#9aa5a2]" />
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts…"
              className="min-w-0 flex-1 bg-transparent text-sm text-[#111716] placeholder:text-[#9aa5a2] focus:outline-none"
            />
          </div>
          <p className="mt-2 px-1 text-xs text-[#9aa5a2]">
            {filtered.length} contact{filtered.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              selected={c.id === selectedId}
              onClick={() => setSelectedId(c.id)}
            />
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-[#9aa5a2]">No results</p>
          )}
        </div>
      </div>

      {/* Detail panel */}
      <div className="flex-1 overflow-hidden">
        {selected ? (
          <ContactDetail contact={selected} callLogs={callLogs} />
        ) : (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-[#9aa5a2]">Select a contact</p>
          </div>
        )}
      </div>
    </div>
  );
}
