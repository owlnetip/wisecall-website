"use client";

import { useEffect, useId, useMemo, useState } from "react";
import { AlertTriangle, Ban, Loader2, Phone, RefreshCw, Trash2, Upload, X } from "lucide-react";
import {
  listOutboundTemplates,
  listBlasts,
  createBlast,
  getBlastResults,
  cancelBlast,
  listDnc,
  addDnc,
  removeDnc,
  type OutboundTemplate,
  type OutboundBlast,
  type OutboundCallRow,
  type DncEntry,
} from "@/app/actions/outbound";
import { parseCsv, guessNumberColumn, guessNameColumn, renderObjective } from "@/lib/csv";
import {
  getLargeBlastConfirmation,
  OUTBOUND_RECIPIENT_CAP,
  prepareOutboundRecipients,
  type OutboundRecipientCandidate,
  type OutboundRecipientReview,
} from "@/lib/outbound-safeguards";

type Parsed = { headers: string[]; rows: Record<string, string>[] };
type BlastReview = OutboundRecipientReview & {
  idempotencyKey: string;
  recipients: OutboundRecipientCandidate[];
  scheduledAt: string | null;
};

const STATUS_LABEL: Record<string, string> = {
  queued: "Queued",
  calling: "Calling",
  completed: "Completed",
  no_answer: "No answer",
  voicemail: "Voicemail",
  failed: "Failed",
  opted_out: "Opted out",
  cancelled: "Cancelled",
};

export function OutboundManager({ profileId, businessName }: { profileId: string; businessName: string }) {
  const [templates, setTemplates] = useState<OutboundTemplate[]>([]);
  const [blasts, setBlasts] = useState<OutboundBlast[]>([]);
  const [dnc, setDnc] = useState<DncEntry[]>([]);

  const [templateId, setTemplateId] = useState<string>("");
  const [name, setName] = useState("");
  const [objective, setObjective] = useState("");
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [numberCol, setNumberCol] = useState<string>("");
  const [nameCol, setNameCol] = useState<string>("");
  const [runNow, setRunNow] = useState(true);
  const [scheduledAt, setScheduledAt] = useState("");
  const [quietStart, setQuietStart] = useState(8);
  const [quietEnd, setQuietEnd] = useState(21);
  const [maxAttempts, setMaxAttempts] = useState(2);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const [openBlast, setOpenBlast] = useState<string | null>(null);
  const [results, setResults] = useState<Record<string, OutboundCallRow[]>>({});
  const [dncNumber, setDncNumber] = useState("");
  const [review, setReview] = useState<BlastReview | null>(null);
  const [typedConfirmation, setTypedConfirmation] = useState("");
  const [submissionIdentity, setSubmissionIdentity] = useState<{ signature: string; key: string } | null>(null);
  const reviewTitleId = useId();

  async function refresh() {
    const [t, b, d] = await Promise.all([listOutboundTemplates(), listBlasts(profileId), listDnc()]);
    if (t.ok) setTemplates(t.data);
    if (b.ok) setBlasts(b.data);
    if (d.ok) setDnc(d.data);
  }
  useEffect(() => {
    let active = true;
    (async () => {
      const [t, b, d] = await Promise.all([listOutboundTemplates(), listBlasts(profileId), listDnc()]);
      if (!active) return;
      if (t.ok) setTemplates(t.data);
      if (b.ok) setBlasts(b.data);
      if (d.ok) setDnc(d.data);
    })();
    return () => {
      active = false;
    };
  }, [profileId]);

  function onPickTemplate(id: string) {
    setTemplateId(id);
    const t = templates.find((x) => x.id === id);
    if (t) {
      setObjective(t.objectiveTemplate);
      if (!name) setName(t.name);
    }
  }

  async function onCsv(file: File) {
    const text = await file.text();
    const res = parseCsv(text);
    setParsed(res);
    setNumberCol(guessNumberColumn(res.headers) ?? res.headers[0] ?? "");
    setNameCol(guessNameColumn(res.headers) ?? "");
  }

  const recipientCount = parsed?.rows.length ?? 0;

  const previewObjective = useMemo(() => {
    if (!parsed || !parsed.rows.length || !objective) return "";
    const row = parsed.rows[0];
    const fields = { ...row, name: nameCol ? row[nameCol] ?? "" : "" };
    return renderObjective(objective, fields);
  }, [parsed, objective, nameCol]);

  useEffect(() => {
    if (!review) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !busy) setReview(null);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [busy, review]);

  function getCandidates(): OutboundRecipientCandidate[] {
    if (!parsed || !numberCol) return [];
    return parsed.rows.map((row) => ({
      toNumber: (row[numberCol] || "").trim(),
      contactName: nameCol ? row[nameCol] || undefined : undefined,
      mergeFields: row,
    }));
  }

  function openReview() {
    setMsg(null);
    if (!objective.trim()) return setMsg({ kind: "err", text: "Pick a template or write an objective." });
    if (!parsed || !numberCol) return setMsg({ kind: "err", text: "Upload a CSV and choose the phone column." });
    if (!runNow && !scheduledAt) return setMsg({ kind: "err", text: "Pick a date/time, or choose Run now." });

    const candidates = getCandidates();
    if (candidates.length > OUTBOUND_RECIPIENT_CAP) {
      return setMsg({
        kind: "err",
        text: `This file has ${candidates.length} rows. Split it into lists of ${OUTBOUND_RECIPIENT_CAP} or fewer.`,
      });
    }
    const prepared = prepareOutboundRecipients(candidates, maxAttempts);
    if (!prepared.recipientCount) {
      return setMsg({ kind: "err", text: "No valid phone numbers were found in that column." });
    }

    const resolvedSchedule = runNow ? null : new Date(scheduledAt).toISOString();
    const signature = JSON.stringify({
      profileId,
      name,
      templateId,
      objective,
      scheduledAt: resolvedSchedule,
      quietStart,
      quietEnd,
      maxAttempts,
      recipients: prepared.recipients,
    });
    const idempotencyKey =
      submissionIdentity?.signature === signature ? submissionIdentity.key : crypto.randomUUID();
    setSubmissionIdentity({ signature, key: idempotencyKey });
    setTypedConfirmation("");
    setReview({ ...prepared, idempotencyKey, scheduledAt: resolvedSchedule });
  }

  async function submit() {
    if (!review) return;

    setBusy(true);
    const res = await createBlast({
      agentId: profileId,
      name: name || `${businessName} outbound`,
      templateId: templateId || undefined,
      objective,
      scheduledAt: review.scheduledAt,
      quietHoursStart: quietStart,
      quietHoursEnd: quietEnd,
      maxAttempts,
      idempotencyKey: review.idempotencyKey,
      confirmation: typedConfirmation || undefined,
      recipients: review.recipients,
    });
    setBusy(false);
    if (!res.ok) return setMsg({ kind: "err", text: res.error });
    setMsg({ kind: "ok", text: `Blast created, ${res.data.queued} calls queued.` });
    setReview(null);
    setSubmissionIdentity(null);
    setParsed(null);
    setName("");
    await refresh();
  }

  async function toggleResults(blastId: string) {
    if (openBlast === blastId) return setOpenBlast(null);
    setOpenBlast(blastId);
    if (!results[blastId]) {
      const r = await getBlastResults(blastId);
      if (r.ok) setResults((prev) => ({ ...prev, [blastId]: r.data }));
    }
  }

  const card = "rounded-xl border border-line bg-white p-5";
  const input =
    "w-full rounded-lg border border-line-strong bg-white px-3 py-2 text-sm outline-none focus:border-ink";

  return (
    <div className="space-y-6">
      <div className={card}>
        <div className="mb-1 flex items-center gap-2">
          <Phone className="h-5 w-5 text-ink" />
          <h3 className="text-lg font-black">New outbound blast</h3>
        </div>
        <p className="mb-4 text-sm text-ink-soft">
          {businessName} will call each recipient with the objective below. Service reminders and
          renewals only, keep it to people who expect to hear from you.
        </p>

        <label className="mb-1 block text-sm font-bold">Template</label>
        <select className={`${input} mb-4`} value={templateId} onChange={(e) => onPickTemplate(e.target.value)}>
          <option value="">Choose a template…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.isSystem ? "" : " (yours)"}
            </option>
          ))}
        </select>

        <label className="mb-1 block text-sm font-bold">Objective</label>
        <textarea
          className={`${input} mb-1 min-h-28`}
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          placeholder="What should the agent achieve on the call? Use {{name}}, {{appointment_date}} etc. from your CSV."
        />
        <p className="mb-4 text-xs text-[#8a938f]">
          Tokens like <code>{"{{name}}"}</code> are filled from your CSV columns per recipient.
        </p>

        <label className="mb-1 block text-sm font-bold">Recipients (CSV)</label>
        <label className="mb-3 flex cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed border-black/20 px-4 py-4 text-sm font-bold text-ink-soft hover:bg-card-tint">
          <Upload className="h-4 w-4" />
          {parsed ? `${recipientCount} recipients loaded, replace file` : "Upload CSV (number + name + merge fields)"}
          <input
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && onCsv(e.target.files[0])}
          />
        </label>

        {parsed ? (
          <div className="mb-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-xs font-bold">Phone number column</label>
              <select className={input} value={numberCol} onChange={(e) => setNumberCol(e.target.value)}>
                {parsed.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="mb-1 block text-xs font-bold">Name column (optional)</label>
              <select className={input} value={nameCol} onChange={(e) => setNameCol(e.target.value)}>
                <option value="">-</option>
                {parsed.headers.map((h) => (
                  <option key={h} value={h}>
                    {h}
                  </option>
                ))}
              </select>
            </div>
            {previewObjective ? (
              <div className="sm:col-span-2 rounded-lg bg-[#f2f7f6] p-3 text-xs text-[#3a4543]">
                <span className="font-bold">Preview (first recipient): </span>
                {previewObjective}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mb-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-sm font-bold">When</label>
            <div className="flex items-center gap-3 text-sm">
              <label className="flex items-center gap-1">
                <input type="radio" checked={runNow} onChange={() => setRunNow(true)} /> Run now
              </label>
              <label className="flex items-center gap-1">
                <input type="radio" checked={!runNow} onChange={() => setRunNow(false)} /> Schedule
              </label>
            </div>
            {!runNow ? (
              <input
                type="datetime-local"
                className={`${input} mt-2`}
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
              />
            ) : null}
          </div>
          <div>
            <label className="mb-1 block text-sm font-bold">Blast name</label>
            <input className={input} value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. June renewals" />
          </div>
        </div>

        <div className="mb-4 grid gap-3 sm:grid-cols-3">
          <div>
            <label className="mb-1 block text-xs font-bold">Quiet hours from</label>
            <input type="number" min={0} max={23} className={input} value={quietStart} onChange={(e) => setQuietStart(Number(e.target.value))} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold">to</label>
            <input type="number" min={0} max={23} className={input} value={quietEnd} onChange={(e) => setQuietEnd(Number(e.target.value))} />
          </div>
          <div>
            <label className="mb-1 block text-xs font-bold">Max attempts</label>
            <input type="number" min={1} max={5} className={input} value={maxAttempts} onChange={(e) => setMaxAttempts(Number(e.target.value))} />
          </div>
        </div>

        {msg ? (
          <p className={`mb-3 text-sm font-bold ${msg.kind === "ok" ? "text-[#0f8a6a]" : "text-danger"}`}>{msg.text}</p>
        ) : null}

        <button
          type="button"
          onClick={openReview}
          disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-2.5 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
          {runNow ? "Review blast" : "Review scheduled blast"}
        </button>
      </div>

      {review ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby={reviewTitleId}
            className="w-full max-w-2xl rounded-xl border border-line bg-white shadow-2xl"
          >
            <div className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
              <div>
                <h3 id={reviewTitleId} className="text-lg font-black">
                  Review {runNow ? "outbound blast" : "scheduled blast"}
                </h3>
                <p className="mt-1 text-sm text-ink-soft">Check the send size before any calls are queued.</p>
              </div>
              <button
                type="button"
                onClick={() => setReview(null)}
                disabled={busy}
                className="rounded-md p-1.5 text-ink-soft hover:bg-card-tint hover:text-ink disabled:opacity-50"
                aria-label="Close review"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="p-5">
              <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
                {[
                  ["Recipients to call", review.recipientCount],
                  ["Duplicates skipped", review.duplicateCount],
                  ["Invalid numbers", review.invalidNumberCount],
                  ["Estimated call attempts", review.estimatedCallAttempts],
                ].map(([label, value]) => (
                  <div key={label} className="bg-white p-3">
                    <dt className="text-xs font-bold text-ink-soft">{label}</dt>
                    <dd className="mt-1 text-xl font-black text-ink">{value}</dd>
                  </div>
                ))}
              </dl>

              {review.duplicateCount || review.invalidNumberCount ? (
                <p className="mt-3 text-sm text-ink-soft">
                  {review.importedCount} CSV rows were checked. Duplicate and invalid numbers will not be queued.
                </p>
              ) : null}

              {getLargeBlastConfirmation(review.recipientCount) ? (
                <div className="mt-5 rounded-lg border border-[#e4b34d] bg-[#fff9e9] p-4">
                  <div className="flex gap-3">
                    <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[#9a6500]" />
                    <div className="w-full">
                      <p className="text-sm font-black text-ink">Large outbound send</p>
                      <label className="mt-1 block text-sm text-ink-soft" htmlFor={`${reviewTitleId}-confirm`}>
                        Type <strong>{getLargeBlastConfirmation(review.recipientCount)}</strong> to confirm.
                      </label>
                      <input
                        id={`${reviewTitleId}-confirm`}
                        autoFocus
                        className={`${input} mt-3 max-w-xs font-mono`}
                        value={typedConfirmation}
                        onChange={(event) => setTypedConfirmation(event.target.value)}
                        autoComplete="off"
                      />
                    </div>
                  </div>
                </div>
              ) : null}

              {msg?.kind === "err" ? <p className="mt-4 text-sm font-bold text-danger">{msg.text}</p> : null}
            </div>

            <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
              <button
                type="button"
                onClick={() => setReview(null)}
                disabled={busy}
                className="rounded-lg border border-line-strong bg-white px-4 py-2 text-sm font-bold text-ink hover:bg-card-tint disabled:opacity-50"
              >
                Go back
              </button>
              <button
                type="button"
                onClick={submit}
                disabled={
                  busy ||
                  (getLargeBlastConfirmation(review.recipientCount) !== null &&
                    typedConfirmation !== getLargeBlastConfirmation(review.recipientCount))
                }
                className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-black text-white hover:bg-[#263130] disabled:cursor-not-allowed disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Phone className="h-4 w-4" />}
                {runNow ? `Start ${review.recipientCount} calls` : `Schedule ${review.recipientCount} calls`}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      <div className={card}>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-lg font-black">Blasts</h3>
          <button type="button" onClick={refresh} className="inline-flex items-center gap-1 text-sm font-bold text-ink-soft hover:text-ink">
            <RefreshCw className="h-4 w-4" /> Refresh
          </button>
        </div>
        {blasts.length === 0 ? (
          <p className="text-sm text-[#8a938f]">No blasts yet.</p>
        ) : (
          <div className="divide-y divide-line">
            {blasts.map((b) => (
              <div key={b.id} className="py-3">
                <div className="flex items-center justify-between gap-3">
                  <button type="button" onClick={() => toggleResults(b.id)} className="text-left">
                    <p className="text-sm font-black">{b.name}</p>
                    <p className="text-xs text-[#8a938f]">
                      {b.status} · {new Date(b.createdAt).toLocaleString("en-GB")}
                    </p>
                  </button>
                  {b.status === "scheduled" || b.status === "running" ? (
                    <button
                      type="button"
                      onClick={async () => {
                        await cancelBlast(b.id);
                        refresh();
                      }}
                      className="text-xs font-bold text-danger hover:underline"
                    >
                      Cancel
                    </button>
                  ) : null}
                </div>
                {openBlast === b.id ? (
                  <div className="mt-2 overflow-x-auto rounded-lg bg-card-tint p-3">
                    {(results[b.id] ?? []).length === 0 ? (
                      <p className="text-xs text-[#8a938f]">Loading…</p>
                    ) : (
                      <table className="w-full text-xs">
                        <tbody>
                          {results[b.id].map((c) => (
                            <tr key={c.id} className="border-b border-line last:border-0">
                              <td className="py-1 pr-3 font-medium">{c.contactName || "-"}</td>
                              <td className="py-1 pr-3 text-ink-soft">{c.toNumber}</td>
                              <td className="py-1 pr-3">{STATUS_LABEL[c.status] ?? c.status}</td>
                              <td className="py-1 text-[#8a938f]">{c.attempts} attempt(s)</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        )}
      </div>

      <div className={card}>
        <div className="mb-1 flex items-center gap-2">
          <Ban className="h-5 w-5 text-ink" />
          <h3 className="text-lg font-black">Do-not-call list</h3>
        </div>
        <p className="mb-3 text-sm text-ink-soft">Numbers here are skipped by every blast. Opt-outs captured on calls land here automatically.</p>
        <div className="mb-3 flex gap-2">
          <input className={input} value={dncNumber} onChange={(e) => setDncNumber(e.target.value)} placeholder="+44…" />
          <button
            type="button"
            onClick={async () => {
              if (!dncNumber.trim()) return;
              await addDnc(dncNumber.trim());
              setDncNumber("");
              const d = await listDnc();
              if (d.ok) setDnc(d.data);
            }}
            className="rounded-lg bg-ink px-4 py-2 text-sm font-black text-white hover:bg-[#263130]"
          >
            Add
          </button>
        </div>
        {dnc.length === 0 ? (
          <p className="text-sm text-[#8a938f]">Empty.</p>
        ) : (
          <ul className="space-y-1">
            {dnc.map((d) => (
              <li key={d.id} className="flex items-center justify-between text-sm">
                <span>
                  {d.number} {d.reason ? <span className="text-[#8a938f]">· {d.reason}</span> : null}
                </span>
                <button
                  type="button"
                  onClick={async () => {
                    await removeDnc(d.id);
                    const r = await listDnc();
                    if (r.ok) setDnc(r.data);
                  }}
                  className="text-danger hover:opacity-70"
                  aria-label="Remove"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
