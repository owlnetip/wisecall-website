"use client";

import { useState, useTransition } from "react";
import { Loader2, Plus, Trash2, Webhook } from "lucide-react";
import { updateAgent } from "@/app/actions/agents";
import {
  type IntegrationWebhook,
  type WebhookCondition,
  type WebhookHttpMethod,
  newIntegrationWebhook,
  slugifyWebhookName,
  webhookConditions,
  webhookMethods,
  webhookTemplateTokens,
} from "@/lib/integration-webhooks";

function KeyValueEditor({
  label,
  hint,
  rows,
  onChange,
  valuePlaceholder = "Value",
}: {
  label: string;
  hint?: string;
  rows: { key: string; value: string }[];
  onChange: (rows: { key: string; value: string }[]) => void;
  valuePlaceholder?: string;
}) {
  function update(index: number, patch: Partial<{ key: string; value: string }>) {
    onChange(rows.map((row, i) => (i === index ? { ...row, ...patch } : row)));
  }
  function add() {
    onChange([...rows, { key: "", value: "" }]);
  }
  function remove(index: number) {
    onChange(rows.filter((_, i) => i !== index));
  }

  return (
    <div>
      <span className="mb-1 block text-sm font-black">{label}</span>
      {hint ? <p className="mb-2 text-xs text-[#7a8582]">{hint}</p> : null}
      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <input
                value={row.key}
                onChange={(e) => update(index, { key: e.target.value })}
                placeholder="key"
                className="h-10 min-w-[7rem] flex-1 rounded-lg border border-black/15 bg-white px-3 text-sm outline-none focus:border-[#111716]"
              />
              <input
                value={row.value}
                onChange={(e) => update(index, { value: e.target.value })}
                placeholder={valuePlaceholder}
                className="h-10 min-w-[10rem] flex-[2] rounded-lg border border-black/15 bg-white px-3 text-sm outline-none focus:border-[#111716]"
              />
              <button
                type="button"
                onClick={() => remove(index)}
                aria-label="Remove row"
                className="flex h-10 w-10 items-center justify-center rounded-lg text-[#7a8582] transition hover:bg-[#fdeaea] hover:text-[#c0392b]"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-[#9aa5a2]">None yet.</p>
      )}
      <button
        type="button"
        onClick={add}
        className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-[#148b8e] hover:underline"
      >
        <Plus className="h-3.5 w-3.5" />
        Add {label.toLowerCase()}
      </button>
    </div>
  );
}

function WebhookCard({
  hook,
  onChange,
  onRemove,
}: {
  hook: IntegrationWebhook;
  onChange: (patch: Partial<IntegrationWebhook>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-[14px] border border-black/10 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-black">{hook.friendlyName.trim() || "New webhook"}</p>
          <p className="mt-0.5 text-xs text-[#7a8582]">
            {webhookConditions.find((c) => c.value === hook.condition)?.label ?? hook.condition}
            {" · "}
            {hook.method}
            {hook.name ? ` · ${hook.name}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 text-sm text-[#66716e]">
            <input
              type="checkbox"
              checked={hook.enabled}
              onChange={(e) => onChange({ enabled: e.target.checked })}
              className="h-4 w-4 rounded border-black/30 accent-[#148b8e]"
            />
            Enabled
          </label>
          <button
            type="button"
            onClick={onRemove}
            aria-label="Remove webhook"
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#7a8582] transition hover:bg-[#fdeaea] hover:text-[#c0392b]"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block sm:col-span-2">
          <span className="mb-2 block text-sm font-black">Display name</span>
          <input
            value={hook.friendlyName}
            onChange={(e) => {
              const friendlyName = e.target.value;
              onChange({
                friendlyName,
                name: hook.name ? hook.name : slugifyWebhookName(friendlyName),
              });
            }}
            placeholder="Look up patient"
            className="h-12 w-full rounded-lg border border-black/15 bg-white px-4 text-sm outline-none focus:border-[#111716]"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-black">Tool name</span>
          <input
            value={hook.name}
            onChange={(e) => onChange({ name: slugifyWebhookName(e.target.value) })}
            placeholder="lookup_patient"
            className="h-12 w-full rounded-lg border border-black/15 bg-white px-4 text-sm outline-none focus:border-[#111716]"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-black">When</span>
          <select
            value={hook.condition}
            onChange={(e) => onChange({ condition: e.target.value as WebhookCondition })}
            className="h-12 w-full rounded-lg border border-black/15 bg-white px-4 text-sm outline-none focus:border-[#111716]"
          >
            {webhookConditions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <label className="block sm:col-span-2">
          <span className="mb-2 block text-sm font-black">Description</span>
          <textarea
            value={hook.description}
            onChange={(e) => onChange({ description: e.target.value })}
            rows={2}
            placeholder={
              hook.condition === "during_call"
                ? "What this does — helps the AI know when to call it."
                : "Optional note for your team."
            }
            className="w-full rounded-lg border border-black/15 bg-white px-4 py-3 text-sm outline-none focus:border-[#111716]"
          />
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-black">Method</span>
          <select
            value={hook.method}
            onChange={(e) => onChange({ method: e.target.value as WebhookHttpMethod })}
            className="h-12 w-full rounded-lg border border-black/15 bg-white px-4 text-sm outline-none focus:border-[#111716]"
          >
            {webhookMethods.map((method) => (
              <option key={method} value={method}>
                {method}
              </option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-2 block text-sm font-black">URL</span>
          <input
            value={hook.url}
            onChange={(e) => onChange({ url: e.target.value })}
            placeholder="https://api.yourcrm.com/hooks/wisecall"
            className="h-12 w-full rounded-lg border border-black/15 bg-white px-4 text-sm outline-none focus:border-[#111716]"
          />
        </label>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <KeyValueEditor
          label="Headers"
          rows={hook.headers}
          onChange={(headers) => onChange({ headers })}
          valuePlaceholder="Header value"
        />
        <KeyValueEditor
          label="Parameters"
          hint={
            hook.condition === "during_call"
              ? "Leave value empty for fields the AI should extract from the conversation."
              : "Use template tokens like {{caller_id}} or leave empty for AI extraction on during-call hooks."
          }
          rows={hook.parameters}
          onChange={(parameters) => onChange({ parameters })}
          valuePlaceholder="{{caller_id}} or leave empty"
        />
      </div>

      <details className="mt-4 rounded-lg border border-black/10 bg-[#fbfcfc] px-4 py-3 text-xs text-[#66716e]">
        <summary className="cursor-pointer font-bold text-[#111716]">Template tokens</summary>
        <ul className="mt-2 space-y-1">
          {webhookTemplateTokens.map((item) => (
            <li key={item.token}>
              <code className="rounded bg-white px-1">{item.token}</code> — {item.label}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

export function IntegrationWebhooksCard({
  agentId,
  initial,
}: {
  agentId: string;
  initial: IntegrationWebhook[];
}) {
  const [webhooks, setWebhooks] = useState(initial);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function update(id: string, patch: Partial<IntegrationWebhook>) {
    setWebhooks((current) => current.map((hook) => (hook.id === id ? { ...hook, ...patch } : hook)));
  }
  function remove(id: string) {
    setWebhooks((current) => current.filter((hook) => hook.id !== id));
  }
  function add() {
    setWebhooks((current) => [...current, newIntegrationWebhook()]);
  }

  function save() {
    setError(null);
    startTransition(async () => {
      const result = await updateAgent(agentId, { integrationWebhooks: webhooks });
      if (result.ok) {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1600);
      } else {
        setError(result.error ?? "Could not save webhooks.");
      }
    });
  }

  return (
    <div className="mb-8 rounded-[14px] border border-black/10 bg-white p-5">
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <Webhook className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#148b8e]" />
        <div className="min-w-0 flex-1">
          <p className="font-black">Custom integrations</p>
          <p className="mt-1 text-sm text-[#66716e]">
            Connect your CRM, practice software or automation — like Fonio and Telzino.
            Configure webhooks that run before, during or after each call.
          </p>
        </div>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        {webhookConditions.map((item) => (
          <div
            key={item.value}
            className="rounded-lg border border-black/10 bg-[#fbfcfc] px-4 py-3 text-sm"
          >
            <p className="font-black text-[#111716]">{item.label}</p>
            <p className="mt-1 text-[#66716e]">{item.blurb}</p>
          </div>
        ))}
      </div>

      {webhooks.length > 0 ? (
        <div className="space-y-4">
          {webhooks.map((hook) => (
            <WebhookCard
              key={hook.id}
              hook={hook}
              onChange={(patch) => update(hook.id, patch)}
              onRemove={() => remove(hook.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-[14px] border border-dashed border-black/15 bg-[#fbfcfc] px-5 py-8 text-center text-sm text-[#66716e]">
          No integration webhooks yet. Add one to POST caller data to your systems.
        </div>
      )}

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={add}
          className="inline-flex items-center gap-2 rounded-lg border border-dashed border-black/20 px-4 py-2.5 text-sm font-black text-[#148b8e] transition hover:bg-[#f7f8f7]"
        >
          <Plus className="h-4 w-4" />
          Add webhook
        </button>
        <button
          type="button"
          onClick={save}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-[#111716] px-5 py-2.5 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
          {isPending ? "Saving…" : saved ? "Saved" : "Save integrations"}
        </button>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
      </div>
    </div>
  );
}
