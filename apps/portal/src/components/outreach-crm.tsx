"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Loader2,
  Mail,
  RefreshCw,
  Send,
  Upload,
  User,
  Building2,
  Clock,
  CheckCircle2,
  XCircle,
} from "lucide-react";
import {
  importDentalProspectsFromSeed,
  listDueFollowUpCount,
  listOutreachProspects,
  listOutreachTemplates,
  listProspectEmails,
  previewOutreachEmail,
  processDueOutreachFollowUps,
  sendOutreachEmail,
  updateOutreachProspect,
  type OutreachEmail,
  type OutreachProspect,
  type OutreachTemplate,
} from "@/app/actions/outreach";

const STATUS_OPTIONS = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "replied", label: "Replied" },
  { value: "interested", label: "Interested" },
  { value: "not_interested", label: "Not interested" },
  { value: "paused", label: "Paused" },
];

const STATUS_BADGE: Record<string, string> = {
  new: "bg-slate-100 text-slate-700",
  contacted: "bg-blue-100 text-blue-800",
  replied: "bg-violet-100 text-violet-800",
  interested: "bg-emerald-100 text-emerald-800",
  not_interested: "bg-red-100 text-red-800",
  paused: "bg-amber-100 text-amber-800",
};

export function OutreachCrm() {
  const [prospects, setProspects] = useState<OutreachProspect[]>([]);
  const [templates, setTemplates] = useState<OutreachTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [emails, setEmails] = useState<OutreachEmail[]>([]);
  const [regionFilter, setRegionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [dueCount, setDueCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [scheduleFollowUps, setScheduleFollowUps] = useState(true);

  const selected = useMemo(
    () => prospects.find((p) => p.id === selectedId) ?? null,
    [prospects, selectedId],
  );

  const regions = useMemo(
    () => [...new Set(prospects.map((p) => p.region))].sort(),
    [prospects],
  );

  const refresh = useCallback(async () => {
    const [p, t, d] = await Promise.all([
      listOutreachProspects({
        region: regionFilter || undefined,
        status: statusFilter || undefined,
      }),
      listOutreachTemplates(),
      listDueFollowUpCount(),
    ]);
    if (p.ok) setProspects(p.data);
    if (t.ok) {
      setTemplates(t.data);
      if (!templateId && t.data.length) {
        const initial = t.data.find((x) => x.sequenceStep === "initial") ?? t.data[0];
        setTemplateId(initial.id);
      }
    }
    if (d.ok) setDueCount(d.data);
  }, [regionFilter, statusFilter, templateId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!selectedId) {
      setEmails([]);
      return;
    }
    void listProspectEmails(selectedId).then((r) => {
      if (r.ok) setEmails(r.data);
    });
  }, [selectedId]);

  useEffect(() => {
    if (!selectedId || !templateId) return;
    void previewOutreachEmail({ prospectId: selectedId, templateId }).then((r) => {
      if (r.ok) {
        setSubject(r.data.subject);
        setBody(r.data.body);
      }
    });
  }, [selectedId, templateId]);

  async function saveProspect(patch: Partial<OutreachProspect>) {
    if (!selected) return;
    setBusy(true);
    setMsg(null);
    const res = await updateOutreachProspect({
      id: selected.id,
      contactName: patch.contactName ?? undefined,
      email: patch.email ?? undefined,
      phone: patch.phone ?? undefined,
      notes: patch.notes ?? undefined,
      status: patch.status ?? undefined,
    });
    setBusy(false);
    if (!res.ok) return setMsg({ kind: "err", text: res.error });
    setProspects((prev) => prev.map((p) => (p.id === res.data.id ? res.data : p)));
    setMsg({ kind: "ok", text: "Saved." });
  }

  async function onImport() {
    setBusy(true);
    setMsg(null);
    const res = await importDentalProspectsFromSeed();
    setBusy(false);
    if (!res.ok) return setMsg({ kind: "err", text: res.error });
    setMsg({ kind: "ok", text: `Imported ${res.data.imported} prospects (${res.data.skipped} skipped).` });
    await refresh();
  }

  async function onSend() {
    if (!selected || !templateId) return;
    if (!selected.email) return setMsg({ kind: "err", text: "Add an email address first." });
    setBusy(true);
    setMsg(null);
    const res = await sendOutreachEmail({
      prospectId: selected.id,
      templateId,
      subject,
      body,
      scheduleFollowUps,
    });
    setBusy(false);
    if (!res.ok) return setMsg({ kind: "err", text: res.error });
    setMsg({
      kind: "ok",
      text: scheduleFollowUps
        ? "Email sent. Follow-ups scheduled for day 3, 7 and 14."
        : "Email sent.",
    });
    await refresh();
    const hist = await listProspectEmails(selected.id);
    if (hist.ok) setEmails(hist.data);
  }

  async function onProcessDue() {
    setBusy(true);
    setMsg(null);
    const res = await processDueOutreachFollowUps();
    setBusy(false);
    if (!res.ok) return setMsg({ kind: "err", text: res.error });
    setMsg({
      kind: "ok",
      text: `Processed follow-ups: ${res.data.sent} sent, ${res.data.failed} failed, ${res.data.cancelled} cancelled.`,
    });
    await refresh();
  }

  return (
    <div className="min-h-screen bg-[#f4f7f7]">
      <header className="border-b border-[#d8e4e4] bg-white px-6 py-5">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-black text-[#0e1b1b]">Dental outreach CRM</h1>
            <p className="mt-1 text-sm text-[#5a7272]">
              Track Dentally prospects, personalize emails, and run 3 / 7 / 14-day follow-ups.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/admin"
              className="rounded-lg border border-[#d8e4e4] px-3 py-2 text-sm font-semibold text-[#0e1b1b] hover:bg-[#f4f7f7]"
            >
              Admin home
            </a>
            <button
              type="button"
              onClick={() => void onImport()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg border border-[#d8e4e4] bg-white px-3 py-2 text-sm font-semibold text-[#0e1b1b] hover:bg-[#f4f7f7] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
              Import Dentally list
            </button>
            {dueCount > 0 && (
              <button
                type="button"
                onClick={() => void onProcessDue()}
                disabled={busy}
                className="inline-flex items-center gap-2 rounded-lg bg-amber-500 px-3 py-2 text-sm font-bold text-white hover:bg-amber-600 disabled:opacity-50"
              >
                <Clock className="h-4 w-4" />
                Send {dueCount} due follow-up{dueCount === 1 ? "" : "s"}
              </button>
            )}
            <button
              type="button"
              onClick={() => void refresh()}
              disabled={busy}
              className="inline-flex items-center gap-2 rounded-lg bg-[#0e1b1b] px-3 py-2 text-sm font-bold text-white hover:bg-[#1a3535] disabled:opacity-50"
            >
              <RefreshCw className="h-4 w-4" />
              Refresh
            </button>
          </div>
        </div>
        {msg && (
          <p
            className={`mx-auto mt-3 max-w-7xl text-sm font-semibold ${msg.kind === "ok" ? "text-emerald-700" : "text-red-600"}`}
          >
            {msg.text}
          </p>
        )}
      </header>

      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[360px_1fr]">
        <section className="rounded-2xl border border-[#d8e4e4] bg-white p-4 shadow-sm">
          <div className="mb-4 flex gap-2">
            <select
              value={regionFilter}
              onChange={(e) => setRegionFilter(e.target.value)}
              className="w-full rounded-lg border border-[#d8e4e4] px-3 py-2 text-sm"
            >
              <option value="">All regions</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value)}
              className="w-full rounded-lg border border-[#d8e4e4] px-3 py-2 text-sm"
            >
              <option value="">All statuses</option>
              {STATUS_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
          </div>
          <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#5a7272]">
            {prospects.length} prospect{prospects.length === 1 ? "" : "s"}
          </p>
          <ul className="max-h-[70vh] space-y-2 overflow-y-auto">
            {prospects.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  onClick={() => setSelectedId(p.id)}
                  className={`w-full rounded-xl border px-3 py-3 text-left transition ${
                    selectedId === p.id
                      ? "border-[#7de8eb] bg-[#7de8eb]/10"
                      : "border-[#e8efef] hover:border-[#7de8eb]/50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <p className="font-bold text-[#0e1b1b]">{p.practiceName}</p>
                      <p className="text-xs text-[#5a7272]">
                        {p.region.toUpperCase()} · {p.postcode}
                      </p>
                    </div>
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${STATUS_BADGE[p.status] ?? STATUS_BADGE.new}`}>
                      {p.status.replace("_", " ")}
                    </span>
                  </div>
                  {p.sequenceStatus === "active" && p.nextFollowUpAt && (
                    <p className="mt-1 text-[11px] text-amber-700">
                      Next follow-up: {new Date(p.nextFollowUpAt).toLocaleDateString()}
                    </p>
                  )}
                </button>
              </li>
            ))}
            {!prospects.length && (
              <li className="rounded-xl border border-dashed border-[#d8e4e4] p-6 text-center text-sm text-[#5a7272]">
                No prospects yet. Click <strong>Import Dentally list</strong> to load York + Leeds Tier 1 targets.
              </li>
            )}
          </ul>
        </section>

        <section className="space-y-6">
          {!selected ? (
            <div className="rounded-2xl border border-dashed border-[#d8e4e4] bg-white p-12 text-center text-[#5a7272]">
              Select a practice to draft a personalized email.
            </div>
          ) : (
            <>
              <div className="rounded-2xl border border-[#d8e4e4] bg-white p-5 shadow-sm">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div>
                    <h2 className="text-xl font-black text-[#0e1b1b]">{selected.practiceName}</h2>
                    <p className="text-sm text-[#5a7272]">
                      {selected.area || selected.region} · {selected.pms} · {selected.tier?.split(" - ")[0]}
                    </p>
                  </div>
                  <select
                    value={selected.status}
                    onChange={(e) => void saveProspect({ status: e.target.value })}
                    className="rounded-lg border border-[#d8e4e4] px-3 py-2 text-sm font-semibold"
                  >
                    {STATUS_OPTIONS.map((s) => (
                      <option key={s.value} value={s.value}>
                        {s.label}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  <label className="block text-sm">
                    <span className="mb-1 flex items-center gap-1 font-semibold text-[#0e1b1b]">
                      <User className="h-4 w-4" /> Contact name
                    </span>
                    <input
                      defaultValue={selected.contactName ?? ""}
                      onBlur={(e) => {
                        if (e.target.value !== (selected.contactName ?? "")) {
                          void saveProspect({ contactName: e.target.value });
                        }
                      }}
                      className="w-full rounded-lg border border-[#d8e4e4] px-3 py-2"
                      placeholder="Practice manager / owner"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 flex items-center gap-1 font-semibold text-[#0e1b1b]">
                      <Mail className="h-4 w-4" /> Email
                    </span>
                    <input
                      defaultValue={selected.email ?? ""}
                      onBlur={(e) => {
                        if (e.target.value !== (selected.email ?? "")) {
                          void saveProspect({ email: e.target.value });
                        }
                      }}
                      className="w-full rounded-lg border border-[#d8e4e4] px-3 py-2"
                      placeholder="owner@practice.co.uk"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 font-semibold text-[#0e1b1b]">Phone</span>
                    <input
                      defaultValue={selected.phone ?? ""}
                      onBlur={(e) => {
                        if (e.target.value !== (selected.phone ?? "")) {
                          void saveProspect({ phone: e.target.value });
                        }
                      }}
                      className="w-full rounded-lg border border-[#d8e4e4] px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 flex items-center gap-1 font-semibold text-[#0e1b1b]">
                      <Building2 className="h-4 w-4" /> Website
                    </span>
                    <input
                      readOnly
                      value={selected.website ?? ""}
                      className="w-full rounded-lg border border-[#e8efef] bg-[#f8fafa] px-3 py-2 text-[#5a7272]"
                    />
                  </label>
                </div>
                <label className="mt-3 block text-sm">
                  <span className="mb-1 font-semibold text-[#0e1b1b]">Notes</span>
                  <textarea
                    defaultValue={selected.notes ?? ""}
                    rows={2}
                    onBlur={(e) => {
                      if (e.target.value !== (selected.notes ?? "")) {
                        void saveProspect({ notes: e.target.value });
                      }
                    }}
                    className="w-full rounded-lg border border-[#d8e4e4] px-3 py-2"
                    placeholder="Personalization notes, call outcomes…"
                  />
                </label>
              </div>

              <div className="rounded-2xl border border-[#d8e4e4] bg-white p-5 shadow-sm">
                <h3 className="text-lg font-black text-[#0e1b1b]">Draft email</h3>
                <div className="mt-3 grid gap-3">
                  <label className="block text-sm">
                    <span className="mb-1 font-semibold">Template</span>
                    <select
                      value={templateId}
                      onChange={(e) => setTemplateId(e.target.value)}
                      className="w-full rounded-lg border border-[#d8e4e4] px-3 py-2"
                    >
                      {templates.map((t) => (
                        <option key={t.id} value={t.id}>
                          {t.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 font-semibold">Subject</span>
                    <input
                      value={subject}
                      onChange={(e) => setSubject(e.target.value)}
                      className="w-full rounded-lg border border-[#d8e4e4] px-3 py-2"
                    />
                  </label>
                  <label className="block text-sm">
                    <span className="mb-1 font-semibold">Body</span>
                    <textarea
                      value={body}
                      onChange={(e) => setBody(e.target.value)}
                      rows={12}
                      className="w-full rounded-lg border border-[#d8e4e4] px-3 py-2 font-mono text-sm leading-relaxed"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-sm">
                    <input
                      type="checkbox"
                      checked={scheduleFollowUps}
                      onChange={(e) => setScheduleFollowUps(e.target.checked)}
                    />
                    Schedule automatic follow-ups on day 3, 7 and 14 (stops if marked not interested / paused)
                  </label>
                  <button
                    type="button"
                    onClick={() => void onSend()}
                    disabled={busy || !selected.email}
                    className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#7de8eb] px-4 py-3 text-sm font-black text-[#0e1b1b] hover:bg-[#5de0e5] disabled:opacity-50"
                  >
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                    Send email
                  </button>
                </div>
              </div>

              {emails.length > 0 && (
                <div className="rounded-2xl border border-[#d8e4e4] bg-white p-5 shadow-sm">
                  <h3 className="text-lg font-black text-[#0e1b1b]">Activity</h3>
                  <ul className="mt-3 space-y-2">
                    {emails.map((e) => (
                      <li key={e.id} className="flex items-start gap-3 rounded-xl border border-[#e8efef] px-3 py-3 text-sm">
                        {e.status === "sent" ? (
                          <CheckCircle2 className="mt-0.5 h-4 w-4 text-emerald-600" />
                        ) : e.status === "scheduled" ? (
                          <Clock className="mt-0.5 h-4 w-4 text-amber-600" />
                        ) : (
                          <XCircle className="mt-0.5 h-4 w-4 text-red-500" />
                        )}
                        <div>
                          <p className="font-semibold text-[#0e1b1b]">
                            {e.sequenceStep.replace(/_/g, " ")} · {e.status}
                          </p>
                          <p className="text-[#5a7272]">{e.subject}</p>
                          <p className="text-xs text-[#5a7272]">
                            {e.sentAt
                              ? `Sent ${new Date(e.sentAt).toLocaleString()}`
                              : e.scheduledFor
                                ? `Scheduled ${new Date(e.scheduledFor).toLocaleString()}`
                                : e.createdAt}
                          </p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
        </section>
      </div>
    </div>
  );
}
