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
  Save,
} from "lucide-react";
import {
  importDentalProspectsFromSeed,
  listDueFollowUpCount,
  listOutreachProspects,
  listOutreachTemplates,
  listProspectEmails,
  previewOutreachEmail,
  processDueOutreachFollowUps,
  saveOutreachTemplate,
  sendOutreachEmail,
  updateOutreachProspect,
  type DentalProspectsSeedStats,
  type OutreachEmail,
  type OutreachProspect,
  type OutreachTemplate,
} from "@/app/actions/outreach";
import { RichEmailEditor, EmailPreview } from "@/components/rich-email-editor";

/** Seed the visual editor from a legacy plain-text body (newlines → paragraphs). */
function textToHtml(text: string): string {
  const esc = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text
    .split(/\n{2,}/)
    .map((para) => `<p>${esc(para).replace(/\n/g, "<br/>")}</p>`)
    .join("");
}

const SEGMENT_OPTIONS = [
  { value: "dentally_active", label: "Dentally independents", badge: "bg-emerald-100 text-emerald-800" },
  { value: "exact_queued", label: "Exact/SOE (queued)", badge: "bg-violet-100 text-violet-800" },
  { value: "unknown_queued", label: "Unknown PMS (queued)", badge: "bg-slate-100 text-slate-700" },
  { value: "corporate_hold", label: "Corporate (hold)", badge: "bg-amber-100 text-amber-800" },
] as const;

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

export function OutreachCrm({ seedStats }: { seedStats: DentalProspectsSeedStats | null }) {
  const [view, setView] = useState<"prospects" | "templates">("prospects");
  const [prospects, setProspects] = useState<OutreachProspect[]>([]);
  const [templates, setTemplates] = useState<OutreachTemplate[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [emails, setEmails] = useState<OutreachEmail[]>([]);
  const [regionFilter, setRegionFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [segmentFilter, setSegmentFilter] = useState("dentally_active");
  const [dueCount, setDueCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  const [templateId, setTemplateId] = useState("");
  const [subject, setSubject] = useState("");
  const [bodyHtml, setBodyHtml] = useState("");
  const [draftNonce, setDraftNonce] = useState(0);
  const [scheduleFollowUps, setScheduleFollowUps] = useState(true);

  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editTemplateName, setEditTemplateName] = useState("");
  const [editTemplateSubject, setEditTemplateSubject] = useState("");
  const [editTemplateHtml, setEditTemplateHtml] = useState("");
  const [editNonce, setEditNonce] = useState(0);

  const selected = useMemo(
    () => prospects.find((p) => p.id === selectedId) ?? null,
    [prospects, selectedId],
  );

  const regions = useMemo(
    () => [...new Set(prospects.map((p) => p.region))].sort(),
    [prospects],
  );

  const canEmail = selected?.outreachSegment === "dentally_active";

  const refresh = useCallback(async () => {
    const [p, t, d] = await Promise.all([
      listOutreachProspects({
        region: regionFilter || undefined,
        status: statusFilter || undefined,
        outreachSegment: segmentFilter || undefined,
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
  }, [regionFilter, statusFilter, segmentFilter, templateId]);

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
        // Always compose in the visual editor: use the rendered HTML when the
        // template has one, else upgrade the plain-text body to simple HTML.
        setBodyHtml(r.data.bodyHtml ?? textToHtml(r.data.body));
        setDraftNonce((n) => n + 1);
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
    setMsg({
      kind: "ok",
      text: `Imported ${res.data.imported} new, updated ${res.data.updated}, skipped ${res.data.skipped}. Seed has ${res.data.seedTotal} contacts (${res.data.bySegment.dentally_active ?? 0} Dentally).`,
    });
    await refresh();
  }

  function startEditTemplate(t: OutreachTemplate) {
    setEditingTemplateId(t.id);
    setEditTemplateName(t.name);
    setEditTemplateSubject(t.subjectTemplate);
    setEditTemplateHtml(t.bodyHtml || textToHtml(t.bodyTemplate));
    setEditNonce((n) => n + 1);
    setView("templates");
  }

  function startNewTemplate() {
    setEditingTemplateId(null);
    setEditTemplateName("Custom template");
    setEditTemplateSubject("Subject with {{practice_name}}");
    setEditTemplateHtml(
      "<p>Hi <span data-merge=\"contact_name\" contenteditable=\"false\" style=\"display:inline-block;padding:1px 8px;border-radius:9999px;background:#e0f7f8;color:#0e7d82;font-weight:600;font-size:0.9em;\">Contact name</span>,</p><p>Your message here.</p><p>Best,<br/>The WiseCall team</p>",
    );
    setEditNonce((n) => n + 1);
  }

  async function onSaveTemplate() {
    setBusy(true);
    setMsg(null);
    const res = await saveOutreachTemplate({
      id: editingTemplateId ?? undefined,
      name: editTemplateName,
      subjectTemplate: editTemplateSubject,
      bodyTemplate: "",
      bodyHtml: editTemplateHtml,
    });
    setBusy(false);
    if (!res.ok) return setMsg({ kind: "err", text: res.error });
    setMsg({ kind: "ok", text: "Template saved." });
    setEditingTemplateId(res.data.id);
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
      body: "",
      bodyHtml,
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
              Dentally prospects get email now. Exact and unknown PMS contacts are stored until you are ready.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex rounded-lg border border-[#d8e4e4] bg-[#f4f7f7] p-1">
              <button
                type="button"
                onClick={() => setView("prospects")}
                className={`rounded-md px-3 py-1.5 text-sm font-bold ${view === "prospects" ? "bg-white text-[#0e1b1b] shadow-sm" : "text-[#5a7272]"}`}
              >
                Prospects
              </button>
              <button
                type="button"
                onClick={() => setView("templates")}
                className={`rounded-md px-3 py-1.5 text-sm font-bold ${view === "templates" ? "bg-white text-[#0e1b1b] shadow-sm" : "text-[#5a7272]"}`}
              >
                Templates
              </button>
            </div>
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
              Import all contacts
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
        {seedStats && (seedStats.bySegment.dentally_active ?? 0) < 100 && (
          <p className="mx-auto mt-2 max-w-7xl rounded-lg border border-amber-200 bg-amber-50 px-4 py-2 text-sm text-amber-900">
            Deployed seed file only has <strong>{seedStats.bySegment.dentally_active ?? 0} Dentally</strong> contacts
            ({seedStats.total} total). Merge PR #42 / #45 for the full England+UK build (~333 Dentally), redeploy, then
            import again.
          </p>
        )}
        {seedStats && (seedStats.bySegment.dentally_active ?? 0) >= 100 && (
          <p className="mx-auto mt-2 max-w-7xl text-sm text-[#5a7272]">
            Seed file: <strong>{seedStats.bySegment.dentally_active ?? 0} Dentally</strong> · {seedStats.total.toLocaleString()} total contacts
          </p>
        )}
      </header>

      {view === "templates" ? (
        <div className="mx-auto max-w-6xl px-6 py-6">
          <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
            <section className="rounded-2xl border border-[#d8e4e4] bg-white p-4 shadow-sm">
              <p className="mb-3 text-xs font-semibold uppercase tracking-wide text-[#5a7272]">Templates</p>
              <ul className="space-y-2">
                {templates.map((t) => (
                  <li key={t.id}>
                    <button
                      type="button"
                      onClick={() => startEditTemplate(t)}
                      className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                        editingTemplateId === t.id ? "border-[#7de8eb] bg-[#7de8eb]/10" : "border-[#e8efef]"
                      }`}
                    >
                      <p className="font-bold text-[#0e1b1b]">{t.name}</p>
                      <p className="text-xs text-[#5a7272]">{t.sequenceStep.replace(/_/g, " ")}</p>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={startNewTemplate}
                className="mt-3 w-full rounded-lg border border-dashed border-[#d8e4e4] px-3 py-2 text-sm font-semibold text-[#5a7272]"
              >
                + New template
              </button>
            </section>
            <section className="rounded-2xl border border-[#d8e4e4] bg-white p-5 shadow-sm">
              <h2 className="text-lg font-black text-[#0e1b1b]">Edit template</h2>
              <p className="mt-1 text-sm text-[#5a7272]">
                Format text, drop in images and use <strong>Personalise</strong> to insert fields like the practice name.
              </p>
              <div className="mt-4 grid gap-3">
                <input
                  value={editTemplateName}
                  onChange={(e) => setEditTemplateName(e.target.value)}
                  className="rounded-lg border border-[#d8e4e4] px-3 py-2 text-sm font-semibold"
                  placeholder="Template name"
                />
                <input
                  value={editTemplateSubject}
                  onChange={(e) => setEditTemplateSubject(e.target.value)}
                  className="rounded-lg border border-[#d8e4e4] px-3 py-2 text-sm"
                  placeholder="Subject (personalise with the fields above)"
                />
                <div className="grid gap-4 lg:grid-cols-2">
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#5a7272]">Compose</p>
                    <RichEmailEditor
                      key={`tmpl-${editingTemplateId ?? "new"}-${editNonce}`}
                      initialHtml={editTemplateHtml}
                      onChange={setEditTemplateHtml}
                      onError={(text) => setMsg({ kind: "err", text })}
                    />
                  </div>
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-[#5a7272]">Preview</p>
                    <EmailPreview innerHtml={editTemplateHtml} />
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => void onSaveTemplate()}
                  disabled={busy}
                  className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#0e1b1b] px-4 py-3 text-sm font-bold text-white disabled:opacity-50"
                >
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                  Save template
                </button>
              </div>
            </section>
          </div>
        </div>
      ) : (
      <div className="mx-auto grid max-w-7xl gap-6 px-6 py-6 lg:grid-cols-[360px_1fr]">
        <section className="rounded-2xl border border-[#d8e4e4] bg-white p-4 shadow-sm">
          <div className="mb-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSegmentFilter("")}
              className={`rounded-full px-3 py-1 text-xs font-bold ${
                !segmentFilter ? "bg-[#0e1b1b] text-white" : "bg-[#f4f7f7] text-[#5a7272]"
              }`}
            >
              All segments
            </button>
            {SEGMENT_OPTIONS.map((s) => (
              <button
                key={s.value}
                type="button"
                onClick={() => setSegmentFilter(s.value)}
                className={`rounded-full px-3 py-1 text-xs font-bold ${
                  segmentFilter === s.value ? s.badge : "bg-[#f4f7f7] text-[#5a7272]"
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>
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
                No prospects yet. Click <strong>Import all contacts</strong> to load Dentally, Exact-queued and unknown PMS practices.
              </li>
            )}
          </ul>
        </section>

        <section className="space-y-6">
          {!selected ? (
            <div className="rounded-2xl border border-dashed border-[#d8e4e4] bg-white p-12 text-center text-[#5a7272]">
              Select a practice to view details and draft an email (Dentally) or notes for queued contacts.
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
                    <span
                      className={`mt-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ${
                        SEGMENT_OPTIONS.find((s) => s.value === selected.outreachSegment)?.badge ??
                        "bg-slate-100 text-slate-700"
                      }`}
                    >
                      {selected.outreachSegment.replace(/_/g, " ")}
                    </span>
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

              {canEmail ? (
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
                  <div className="grid gap-4 lg:grid-cols-2">
                    <div>
                      <p className="mb-1 text-sm font-semibold">Body</p>
                      <RichEmailEditor
                        key={`draft-${selected.id}-${draftNonce}`}
                        initialHtml={bodyHtml}
                        onChange={setBodyHtml}
                        onError={(text) => setMsg({ kind: "err", text })}
                      />
                    </div>
                    <div>
                      <p className="mb-1 text-sm font-semibold">Preview</p>
                      <EmailPreview innerHtml={bodyHtml} />
                    </div>
                  </div>
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
              ) : (
                <div className="rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm text-amber-900">
                  <p className="font-bold">Stored for later — email disabled</p>
                  <p className="mt-2">
                    {selected.outreachSegment === "exact_queued"
                      ? "This practice is flagged for Exact/SOE. Once WiseCall Exact integration ships, switch them to active outreach and use the Exact templates."
                      : selected.outreachSegment === "corporate_hold"
                        ? "ADG corporate group — lower priority. Use phone outbound or revisit manually."
                        : "Unknown PMS — qualify on a call first, or wait until you know their software. Phone number is saved for outbound blasts."}
                  </p>
                  {selected.phone && (
                    <p className="mt-2 font-semibold">Phone: {selected.phone}</p>
                  )}
                </div>
              )}

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
      )}
    </div>
  );
}
