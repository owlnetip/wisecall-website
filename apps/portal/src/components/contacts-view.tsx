"use client";

import { useState, useTransition } from "react";
import {
  ArrowLeft,
  Phone,
  Mail,
  Search,
  MessageSquareText,
  History,
} from "lucide-react";
import type { EnrichedContact } from "@/lib/enrich-contacts";
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
  if (!iso) return "-";
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
  if (!iso) return "-";
  return new Date(iso).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function contactDisplayName(contact: EnrichedContact): string {
  if (contact.name.trim()) return contact.name.trim();
  return contact.phone || contact.email || "Unknown";
}

function contactSubtitle(contact: EnrichedContact): string {
  const primary = contactDisplayName(contact);
  const parts: string[] = [];
  if (contact.company.trim()) parts.push(contact.company.trim());
  if (contact.phone && primary !== contact.phone) parts.push(contact.phone);
  else if (contact.email && primary !== contact.email) parts.push(contact.email);
  if (parts.length) return parts.join(" · ");
  if (contact.nameInferred || contact.detailsInferred) return "Details from call history";
  return "No name yet";
}

function ContactRow({
  contact,
  selected,
  onClick,
}: {
  contact: EnrichedContact;
  selected: boolean;
  onClick: () => void;
}) {
  const displayName = contactDisplayName(contact);
  const subtitle = contactSubtitle(contact);

  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left transition ${
        selected ? "bg-teal-wash" : "hover:bg-card-tint active:bg-[#e6f7f7]"
      }`}
    >
      <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full bg-teal/10 text-sm font-black text-teal">
        {initials(contact.name, contact.phone)}
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-bold text-ink">{displayName}</p>
        <p className="truncate text-xs text-ink-soft">{subtitle}</p>
      </div>
      <div className="flex-shrink-0 text-right">
        <p className="text-xs text-ink-faint">{relativeDate(contact.lastSeen)}</p>
        {contact.callCount > 0 && (
          <p className="mt-0.5 text-xs font-semibold text-teal">
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
  onBack,
  showBack,
}: {
  contact: EnrichedContact;
  callLogs: CallLog[];
  onBack?: () => void;
  showBack?: boolean;
}) {
  const [notes, setNotes] = useState(contact.notes);
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const [lastId, setLastId] = useState(contact.id);
  if (contact.id !== lastId) {
    setLastId(contact.id);
    setNotes(contact.notes);
    setSaved(false);
    setSaveError(null);
  }

  const phoneKey = contact.phone.replace(/\s/g, "");
  const emailKey = contact.email.toLowerCase();
  const relatedCalls = callLogs.filter((l) => {
    const caller = (l.caller || "").trim();
    if (phoneKey && caller.replace(/\s/g, "") === phoneKey) return true;
    if (emailKey && caller.toLowerCase() === emailKey) return true;
    return false;
  });

  const displayName = contactDisplayName(contact);

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
    <div className="flex h-full min-h-0 flex-col overflow-y-auto">
      {showBack && onBack ? (
        <div className="sticky top-0 z-10 border-b border-line bg-white px-3 py-2 lg:hidden">
          <button
            type="button"
            onClick={onBack}
            className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-bold text-teal"
          >
            <ArrowLeft className="h-4 w-4" />
            All contacts
          </button>
        </div>
      ) : null}

      <div className="flex items-start gap-4 border-b border-line px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-full bg-teal/10 text-lg font-black text-teal">
          {initials(contact.name, contact.phone)}
        </div>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-lg font-black text-ink">{displayName}</h2>
          {contact.nameInferred ? (
            <p className="text-xs font-medium text-teal">Name detected from past calls</p>
          ) : null}
          <p className="text-sm text-ink-soft">{contact.agentName}</p>
          <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:gap-3">
            {contact.phone && (
              <span className="flex items-center gap-1.5 text-sm text-ink">
                <Phone className="h-3.5 w-3.5 flex-shrink-0 text-teal" />
                <span className="break-all">
                  {contact.callbackPhone && contact.callbackPhone !== contact.phone.replace(/\s/g, "")
                    ? `Line: ${contact.phone}`
                    : contact.phone}
                </span>
              </span>
            )}
            {contact.callbackPhone &&
              contact.callbackPhone !== contact.phone.replace(/\s/g, "") && (
                <span className="flex items-center gap-1.5 text-sm text-ink">
                  <Phone className="h-3.5 w-3.5 flex-shrink-0 text-teal" />
                  <span className="break-all">Callback: {contact.callbackPhone}</span>
                </span>
              )}
            {contact.company && (
              <span className="text-sm text-ink">
                <span className="font-bold text-ink-soft">Company: </span>
                {contact.company}
              </span>
            )}
            {contact.email && (
              <span className="flex items-center gap-1.5 text-sm text-ink">
                <Mail className="h-3.5 w-3.5 flex-shrink-0 text-teal" />
                <span className="break-all">{contact.email}</span>
              </span>
            )}
          </div>
        </div>
      </div>

      <div className="flex-1 space-y-5 px-4 py-4 sm:px-6 sm:py-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          {[
            {
              label: "Interactions",
              value: `${contact.callCount} call${contact.callCount !== 1 ? "s" : ""}${
                contact.emailCount
                  ? `, ${contact.emailCount} email${contact.emailCount !== 1 ? "s" : ""}`
                  : ""
              }`,
            },
            { label: "First contact", value: absoluteDate(contact.firstSeen) },
            { label: "Last contact", value: relativeDate(contact.lastSeen) },
          ].map(({ label, value }) => (
            <div key={label} className="rounded-xl bg-card-tint px-4 py-3">
              <p className="text-xs text-ink-soft">{label}</p>
              <p className="mt-0.5 text-sm font-black text-ink">{value}</p>
            </div>
          ))}
        </div>

        {contact.aiSummary && (
          <div>
            <p className="mb-1.5 flex items-center gap-1.5 text-sm font-bold text-ink">
              <MessageSquareText className="h-4 w-4 text-teal" />
              AI summary
            </p>
            <p className="rounded-xl bg-teal-wash px-4 py-3 text-sm leading-relaxed text-[#0e4b4d]">
              {contact.aiSummary}
            </p>
          </div>
        )}

        <div>
          <p className="mb-1.5 text-sm font-bold text-ink">Notes</p>
          <textarea
            rows={4}
            value={notes}
            onChange={(e) => {
              setNotes(e.target.value);
              setSaved(false);
            }}
            placeholder="Add private notes about this contact, visible only to you."
            className="w-full rounded-lg border border-line bg-card-tint px-3 py-2 text-sm text-ink placeholder:text-ink-faint focus:outline-none focus:ring-2 focus:ring-teal/40"
          />
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={saveNotes}
              disabled={pending}
              className="inline-flex h-9 items-center rounded-lg bg-ink px-4 text-xs font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
            >
              {pending ? "Saving…" : "Save notes"}
            </button>
            {saved && <span className="text-xs font-medium text-teal">Saved</span>}
            {saveError && <span className="text-xs font-medium text-danger">{saveError}</span>}
          </div>
        </div>

        {relatedCalls.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-bold text-ink">
              <History className="h-4 w-4 text-teal" />
              Call history ({relatedCalls.length})
            </p>
            <div className="space-y-2">
              {relatedCalls.slice(0, 10).map((log) => (
                <div
                  key={log.id}
                  className="rounded-xl border border-line bg-card-tint px-4 py-3"
                >
                  <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between sm:gap-2">
                    <p className="text-xs font-semibold text-ink">
                      {log.outcome || "Call"}
                    </p>
                    <span className="text-xs text-ink-faint">
                      {relativeDate(log.startedAt)} · {log.durationLabel}
                    </span>
                  </div>
                  {log.summary && (
                    <p className="mt-1 text-xs leading-relaxed text-ink-soft line-clamp-3">
                      {log.summary}
                    </p>
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
  contacts: EnrichedContact[];
  callLogs: CallLog[];
}) {
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(contacts[0]?.id ?? null);
  const [mobileShowDetail, setMobileShowDetail] = useState(false);

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

  function selectContact(id: string) {
    setSelectedId(id);
    setMobileShowDetail(true);
  }

  function backToList() {
    setMobileShowDetail(false);
  }

  if (contacts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center px-4 py-16 text-center sm:py-24">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-teal-wash">
          <Phone className="h-8 w-8 text-teal" />
        </div>
        <p className="text-lg font-black text-ink">No contacts yet</p>
        <p className="mt-2 max-w-xs text-sm text-ink-soft">
          Contacts appear here automatically as your agents handle calls. Every caller becomes a
          contact with a full history of their interactions.
        </p>
      </div>
    );
  }

  return (
    <div className="flex min-h-[480px] flex-col overflow-hidden rounded-xl border border-line bg-white lg:min-h-[600px] lg:flex-row">
      <div
        className={`flex flex-col border-line lg:w-[min(100%,320px)] lg:flex-shrink-0 lg:border-r ${
          mobileShowDetail ? "hidden lg:flex" : "flex flex-1 lg:flex-none"
        }`}
      >
        <div className="border-b border-line p-3">
          <div className="flex items-center gap-2 rounded-lg border border-line bg-card-tint px-3 py-2.5">
            <Search className="h-4 w-4 flex-shrink-0 text-ink-faint" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search contacts…"
              className="min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none sm:text-sm"
            />
          </div>
          <p className="mt-2 px-1 text-xs text-ink-faint">
            {filtered.length} contact{filtered.length !== 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex-1 overflow-y-auto p-2">
          {filtered.map((c) => (
            <ContactRow
              key={c.id}
              contact={c}
              selected={c.id === selectedId}
              onClick={() => selectContact(c.id)}
            />
          ))}
          {filtered.length === 0 && (
            <p className="px-3 py-6 text-center text-sm text-ink-faint">No results</p>
          )}
        </div>
      </div>

      <div
        className={`min-h-0 flex-1 overflow-hidden ${
          mobileShowDetail ? "flex flex-col" : "hidden lg:flex lg:flex-col"
        }`}
      >
        {selected ? (
          <ContactDetail
            contact={selected}
            callLogs={callLogs}
            showBack
            onBack={backToList}
          />
        ) : (
          <div className="flex h-full min-h-[240px] items-center justify-center px-4">
            <p className="text-sm text-ink-faint">Select a contact</p>
          </div>
        )}
      </div>
    </div>
  );
}
