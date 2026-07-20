"use client";

import { useEffect, useState, useTransition } from "react";
import { ShieldAlert, Plus, Trash2 } from "lucide-react";
import type { StatusFlag, StatusPolicy } from "@/lib/status-flags";
import type { OpsDigestSettings } from "@/lib/ops-digest";
import {
  createStatusFlag,
  deleteStatusFlag,
  getStatusFlagsForAgent,
  setStatusFlagActive,
  updateOpsDigestSettings,
  updateStatusCheckSettings,
} from "@/app/actions/status-flags";

const POLICIES: { value: StatusPolicy; label: string }[] = [
  { value: "warn", label: "Warn" },
  { value: "soft_block", label: "Soft block (no orders/support)" },
  { value: "hard_route", label: "Hard route to team" },
  { value: "allow_with_note", label: "Allow with note" },
];

export function OpsStatusPanel({
  profileId,
  initialFlags = [],
  digest,
  statusCheck,
  defaultEmail,
}: {
  profileId: string;
  initialFlags?: StatusFlag[];
  digest: OpsDigestSettings;
  statusCheck: { enabled: boolean; webhookUrl: string; webhookSecret: string };
  defaultEmail: string;
}) {
  const [flags, setFlags] = useState(initialFlags);
  const [digestState, setDigestState] = useState(digest);
  const [checkState, setCheckState] = useState(statusCheck);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    let cancelled = false;
    void getStatusFlagsForAgent(profileId).then((result) => {
      if (cancelled || !result.ok || !result.flags) return;
      setFlags(result.flags);
    });
    return () => {
      cancelled = true;
    };
  }, [profileId]);

  const [draft, setDraft] = useState({
    flagKey: "overdue_45",
    label: "Overdue account",
    policy: "soft_block" as StatusPolicy,
    matchPhone: "",
    matchEmail: "",
    matchCompany: "",
    agentMessage:
      "I can see there's something outstanding on your account. Please speak with accounts before we can place an order or put you through to support.",
    transferRouteKey: "accounts",
  });

  function run(action: () => Promise<{ ok: boolean; error?: string }>, onOk?: () => void) {
    setError(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) {
        setError(result.error || "Something went wrong.");
        return;
      }
      onOk?.();
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="mb-3 flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-[#0e6b6e]" />
          <h3 className="text-sm font-black uppercase tracking-wide text-ink">Daily ops email</h3>
        </div>
        <p className="mb-4 text-sm text-ink-soft">
          Morning and afternoon overview of outstanding follow-ups to{" "}
          {defaultEmail || "your notification emails"}. Quiet when nothing is open. Leads,
          sales and complaints stay on top.
        </p>
        <div className="flex flex-wrap gap-4 text-sm">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={digestState.enabled}
              onChange={(e) => {
                const enabled = e.target.checked;
                setDigestState((s) => ({ ...s, enabled }));
                run(() =>
                  updateOpsDigestSettings({
                    profileId,
                    enabled,
                    morning: digestState.morning,
                    afternoon: digestState.afternoon,
                  }),
                );
              }}
            />
            Enabled
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={digestState.morning}
              disabled={!digestState.enabled}
              onChange={(e) => {
                const morning = e.target.checked;
                setDigestState((s) => ({ ...s, morning }));
                run(() =>
                  updateOpsDigestSettings({
                    profileId,
                    enabled: digestState.enabled,
                    morning,
                    afternoon: digestState.afternoon,
                  }),
                );
              }}
            />
            Morning
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={digestState.afternoon}
              disabled={!digestState.enabled}
              onChange={(e) => {
                const afternoon = e.target.checked;
                setDigestState((s) => ({ ...s, afternoon }));
                run(() =>
                  updateOpsDigestSettings({
                    profileId,
                    enabled: digestState.enabled,
                    morning: digestState.morning,
                    afternoon,
                  }),
                );
              }}
            />
            Afternoon
          </label>
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h3 className="mb-1 text-sm font-black uppercase tracking-wide text-ink">
          Status checks
        </h3>
        <p className="mb-4 text-sm text-ink-soft">
          Optional gates for overdue accounts, credit holds, VIP routing, or anything you choose.
          Matched callers get a policy before orders or support transfers.
        </p>

        <div className="mb-5 grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block font-bold text-ink">Live lookup webhook (optional)</span>
            <input
              className="w-full rounded-lg border border-line px-3 py-2"
              placeholder="https://your-system.example/wisecall-status"
              value={checkState.webhookUrl}
              onChange={(e) => setCheckState((s) => ({ ...s, webhookUrl: e.target.value }))}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block font-bold text-ink">Webhook secret</span>
            <input
              className="w-full rounded-lg border border-line px-3 py-2"
              type="password"
              placeholder="Bearer token"
              value={checkState.webhookSecret}
              onChange={(e) => setCheckState((s) => ({ ...s, webhookSecret: e.target.value }))}
            />
          </label>
        </div>
        <div className="mb-6 flex flex-wrap items-center gap-3">
          <label className="inline-flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={checkState.enabled}
              onChange={(e) => setCheckState((s) => ({ ...s, enabled: e.target.checked }))}
            />
            Enable live webhook lookup
          </label>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(() =>
                updateStatusCheckSettings({
                  profileId,
                  enabled: checkState.enabled,
                  webhookUrl: checkState.webhookUrl,
                  webhookSecret: checkState.webhookSecret,
                }),
              )
            }
            className="rounded-lg bg-ink px-3 py-1.5 text-xs font-black text-white"
          >
            Save webhook
          </button>
        </div>

        <div className="mb-4 rounded-xl border border-dashed border-line p-4">
          <p className="mb-3 text-xs font-black uppercase tracking-wide text-ink-faint">
            Add manual flag
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <input
              className="rounded-lg border border-line px-3 py-2 text-sm"
              placeholder="Flag key (e.g. overdue_45)"
              value={draft.flagKey}
              onChange={(e) => setDraft((d) => ({ ...d, flagKey: e.target.value }))}
            />
            <input
              className="rounded-lg border border-line px-3 py-2 text-sm"
              placeholder="Label"
              value={draft.label}
              onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            />
            <input
              className="rounded-lg border border-line px-3 py-2 text-sm"
              placeholder="Match phone"
              value={draft.matchPhone}
              onChange={(e) => setDraft((d) => ({ ...d, matchPhone: e.target.value }))}
            />
            <input
              className="rounded-lg border border-line px-3 py-2 text-sm"
              placeholder="Match email"
              value={draft.matchEmail}
              onChange={(e) => setDraft((d) => ({ ...d, matchEmail: e.target.value }))}
            />
            <input
              className="rounded-lg border border-line px-3 py-2 text-sm"
              placeholder="Match company"
              value={draft.matchCompany}
              onChange={(e) => setDraft((d) => ({ ...d, matchCompany: e.target.value }))}
            />
            <select
              className="rounded-lg border border-line px-3 py-2 text-sm"
              value={draft.policy}
              onChange={(e) =>
                setDraft((d) => ({ ...d, policy: e.target.value as StatusPolicy }))
              }
            >
              {POLICIES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
            <input
              className="rounded-lg border border-line px-3 py-2 text-sm md:col-span-2"
              placeholder="Transfer route key (e.g. accounts)"
              value={draft.transferRouteKey}
              onChange={(e) => setDraft((d) => ({ ...d, transferRouteKey: e.target.value }))}
            />
            <textarea
              className="min-h-[72px] rounded-lg border border-line px-3 py-2 text-sm md:col-span-2"
              placeholder="What the agent should say"
              value={draft.agentMessage}
              onChange={(e) => setDraft((d) => ({ ...d, agentMessage: e.target.value }))}
            />
          </div>
          <button
            type="button"
            disabled={pending}
            onClick={() =>
              run(async () => {
                const created = await createStatusFlag({
                  profileId,
                  ...draft,
                });
                if (!created.ok) return created;
                const refreshed = await getStatusFlagsForAgent(profileId);
                if (refreshed.ok && refreshed.flags) setFlags(refreshed.flags);
                return created;
              })
            }
            className="mt-3 inline-flex items-center gap-1.5 rounded-lg bg-ink px-3 py-1.5 text-xs font-black text-white"
          >
            <Plus className="h-3.5 w-3.5" />
            Add flag
          </button>
        </div>

        <ul className="divide-y divide-line">
          {flags.length === 0 ? (
            <li className="py-3 text-sm text-ink-soft">No status flags yet.</li>
          ) : (
            flags.map((flag) => (
              <li key={flag.id} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-bold text-ink">
                    {flag.label}{" "}
                    <span className="text-xs font-medium text-ink-soft">({flag.flagKey})</span>
                  </p>
                  <p className="text-xs text-ink-soft">
                    {flag.policy}
                    {flag.matchPhone ? ` · ${flag.matchPhone}` : ""}
                    {flag.matchEmail ? ` · ${flag.matchEmail}` : ""}
                    {flag.matchCompany ? ` · ${flag.matchCompany}` : ""}
                    {!flag.active ? " · inactive" : ""}
                  </p>
                  {flag.agentMessage ? (
                    <p className="mt-1 text-sm text-ink-soft">{flag.agentMessage}</p>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => setStatusFlagActive(flag.id, !flag.active),
                        () =>
                          setFlags((prev) =>
                            prev.map((f) =>
                              f.id === flag.id ? { ...f, active: !f.active } : f,
                            ),
                          ),
                      )
                    }
                    className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold"
                  >
                    {flag.active ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      run(
                        () => deleteStatusFlag(flag.id),
                        () => setFlags((prev) => prev.filter((f) => f.id !== flag.id)),
                      )
                    }
                    className="inline-flex items-center gap-1 rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-red-700"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    Delete
                  </button>
                </div>
              </li>
            ))
          )}
        </ul>
      </section>

      {error ? <p className="text-sm text-red-700">{error}</p> : null}
    </div>
  );
}
