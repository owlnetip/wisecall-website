"use client";

import { useEffect, useState, useTransition } from "react";
import { Check, Link2, Loader2, RefreshCw, Unplug } from "lucide-react";
import {
  connectPropertyCrm,
  disconnectPropertyCrm,
  listCrmConnections,
  syncPropertyCrm,
  type CrmConnectionRow,
} from "@/app/actions/property-crm";
import {
  propertyCrmPartnerOnly,
  propertyCrmProviders,
  type PropertyCrmProvider,
  type PropertyCrmProviderId,
} from "@/lib/property-crm-providers";

export function PropertyCrmCard({
  agentId,
  onSynced,
}: {
  agentId: string;
  onSynced?: () => void;
}) {
  const [connections, setConnections] = useState<CrmConnectionRow[]>([]);
  const [selectedId, setSelectedId] = useState<PropertyCrmProviderId>("reapit");
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const [secret, setSecret] = useState("");
  const [secondSecret, setSecondSecret] = useState("");
  const [configValues, setConfigValues] = useState<Record<string, string>>({});

  const provider = propertyCrmProviders.find((p) => p.id === selectedId)!;
  const active = connections.find((c) => c.provider === selectedId && c.connected);

  function load() {
    startTransition(async () => {
      setError(null);
      const res = await listCrmConnections(agentId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      setConnections(res.connections);
    });
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentId]);

  function resetForm() {
    setSecret("");
    setSecondSecret("");
    setConfigValues({});
  }

  return (
    <section className="mb-5 rounded-xl border border-line bg-card p-5">
      <div className="mb-3 flex items-start gap-3">
        <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-line bg-card-tint">
          <Link2 className="h-4 w-4 text-ink-soft" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="font-black text-ink">CRM connectors</h3>
          <p className="mt-1 text-sm text-ink-soft">
            Sync your property register from Reapit, Street, AgentOS or Jupix — each listing
            maps address to owner mobile for viewing confirmations.
          </p>
        </div>
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

      <div className="mb-4 flex flex-wrap gap-2">
        {propertyCrmProviders.map((p) => {
          const connected = connections.some((c) => c.provider === p.id && c.connected);
          return (
            <button
              key={p.id}
              type="button"
              onClick={() => {
                setSelectedId(p.id);
                resetForm();
                setError(null);
                setNote(null);
              }}
              className={`rounded-full border px-3 py-1.5 text-xs font-bold transition ${
                selectedId === p.id
                  ? "border-ink bg-ink text-white"
                  : connected
                    ? "border-emerald-300 bg-emerald-50 text-emerald-900"
                    : "border-line bg-white text-ink-soft hover:text-ink"
              }`}
            >
              {p.label}
              {connected ? " ✓" : ""}
            </button>
          );
        })}
      </div>

      <ProviderPanel
        provider={provider}
        active={active}
        secret={secret}
        secondSecret={secondSecret}
        configValues={configValues}
        isPending={isPending}
        onSecret={setSecret}
        onSecondSecret={setSecondSecret}
        onConfig={(key, val) => setConfigValues((prev) => ({ ...prev, [key]: val }))}
        onConnect={() => {
          startTransition(async () => {
            setError(null);
            setNote(null);
            const res = await connectPropertyCrm({
              profileId: agentId,
              provider: selectedId,
              secret,
              secondSecret: secondSecret || undefined,
              config: configValues,
            });
            if (!res.ok) {
              setError(res.error);
              return;
            }
            setNote(`${provider.label} connected.`);
            resetForm();
            load();
          });
        }}
        onDisconnect={() => {
          startTransition(async () => {
            setError(null);
            setNote(null);
            const res = await disconnectPropertyCrm(agentId, selectedId);
            if (!res.ok) {
              setError(res.error);
              return;
            }
            setNote(`${provider.label} disconnected.`);
            load();
          });
        }}
        onSync={() => {
          startTransition(async () => {
            setError(null);
            setNote(null);
            const res = await syncPropertyCrm(agentId, selectedId);
            if (!res.ok) {
              setError(res.error);
              load();
              return;
            }
            setNote(
              `Synced ${res.imported} propert${res.imported === 1 ? "y" : "ies"} with owner mobiles` +
                (res.total > res.imported
                  ? ` (${res.total - res.imported} skipped — no owner mobile on record)`
                  : "") +
                ".",
            );
            load();
            onSynced?.();
          });
        }}
      />

      <div className="mt-5 border-t border-line pt-4">
        <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-soft">
          Partner-only CRMs
        </p>
        <ul className="space-y-2">
          {propertyCrmPartnerOnly.map((p) => (
            <li key={p.id} className="text-sm text-ink-soft">
              <strong className="text-ink">{p.label}</strong> — {p.description}{" "}
              <a
                href={p.docsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-teal underline"
              >
                Learn more
              </a>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function ProviderPanel({
  provider,
  active,
  secret,
  secondSecret,
  configValues,
  isPending,
  onSecret,
  onSecondSecret,
  onConfig,
  onConnect,
  onDisconnect,
  onSync,
}: {
  provider: PropertyCrmProvider;
  active?: CrmConnectionRow;
  secret: string;
  secondSecret: string;
  configValues: Record<string, string>;
  isPending: boolean;
  onSecret: (v: string) => void;
  onSecondSecret: (v: string) => void;
  onConfig: (key: string, val: string) => void;
  onConnect: () => void;
  onDisconnect: () => void;
  onSync: () => void;
}) {
  if (active) {
    return (
      <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/50 p-4">
        <div className="inline-flex items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-2.5 py-1 text-xs font-semibold text-emerald-800">
          <Check className="h-3.5 w-3.5" />
          Connected{active.accountLabel ? ` · ${active.accountLabel}` : ""}
        </div>
        {active.lastSyncAt && (
          <p className="text-xs text-ink-soft">
            Last sync: {new Date(active.lastSyncAt).toLocaleString("en-GB")}
            {active.lastSyncCount != null ? ` · ${active.lastSyncCount} properties` : ""}
          </p>
        )}
        {active.lastSyncError && (
          <p className="text-xs text-rose-700">Last error: {active.lastSyncError}</p>
        )}
        <div className="flex flex-wrap gap-2">
          {provider.syncSupported && (
            <button
              type="button"
              disabled={isPending}
              onClick={onSync}
              className="inline-flex h-9 items-center gap-2 rounded-lg bg-ink px-3 text-sm font-black text-white disabled:opacity-40"
            >
              {isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <RefreshCw className="h-4 w-4" />
              )}
              Sync properties
            </button>
          )}
          <button
            type="button"
            disabled={isPending}
            onClick={onDisconnect}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-white px-3 text-sm font-semibold"
          >
            <Unplug className="h-4 w-4" />
            Disconnect
          </button>
          <a
            href={provider.docsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex h-9 items-center px-3 text-sm font-semibold text-teal underline"
          >
            API docs
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-lg border border-line bg-card-tint/40 p-4">
      <p className="text-sm text-ink-soft">{provider.description}</p>
      {provider.setupNote && (
        <p className="text-xs text-ink-soft">{provider.setupNote}</p>
      )}

      <label className="block text-sm">
        <span className="mb-1 block font-semibold text-ink">{provider.secretField.label}</span>
        <input
          type={provider.secretField.type}
          value={secret}
          onChange={(e) => onSecret(e.target.value)}
          placeholder={provider.secretField.placeholder}
          className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm"
          autoComplete="off"
        />
      </label>

      {provider.secondSecretField && (
        <label className="block text-sm">
          <span className="mb-1 block font-semibold text-ink">
            {provider.secondSecretField.label}
          </span>
          <input
            type={provider.secondSecretField.type}
            value={secondSecret}
            onChange={(e) => onSecondSecret(e.target.value)}
            placeholder={provider.secondSecretField.placeholder}
            className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm"
            autoComplete="off"
          />
        </label>
      )}

      {provider.configFields.map((field) => (
        <label key={field.key} className="block text-sm">
          <span className="mb-1 block font-semibold text-ink">
            {field.label}
            {field.required ? " *" : ""}
          </span>
          <input
            type={field.type}
            value={configValues[field.key] || ""}
            onChange={(e) => onConfig(field.key, e.target.value)}
            placeholder={field.placeholder}
            className="h-10 w-full rounded-lg border border-line bg-white px-3 text-sm"
            autoComplete="off"
          />
          {field.help && <span className="mt-1 block text-xs text-ink-soft">{field.help}</span>}
        </label>
      ))}

      <button
        type="button"
        disabled={isPending || !secret.trim()}
        onClick={onConnect}
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-ink px-4 text-sm font-black text-white disabled:opacity-40"
      >
        {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        Connect {provider.label}
      </button>
    </div>
  );
}
