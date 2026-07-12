"use client";

import { useState, useTransition } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleDashed,
  FlaskConical,
  Loader2,
  PauseCircle,
  Plus,
  Save,
  Trash2,
  Webhook,
  XCircle,
} from "lucide-react";
import { updateAgent } from "@/app/actions/agents";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import {
  testIntegrationWebhook,
  type IntegrationWebhookTestResult,
} from "@/app/actions/integration-webhooks";
import {
  type IntegrationWebhook,
  type WebhookCondition,
  type WebhookHttpMethod,
  newIntegrationWebhook,
  slugifyWebhookName,
  validateIntegrationWebhooks,
  webhookConditions,
  webhookMethods,
  webhookTemplateTokens,
  webhookVerificationState,
} from "@/lib/integration-webhooks";

const CONNECTION_FIELDS = new Set<keyof IntegrationWebhook>([
  "name",
  "condition",
  "method",
  "url",
  "headers",
  "parameters",
]);

function formatTestTime(value?: string): string {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function VerificationStatus({ hook }: { hook: IntegrationWebhook }) {
  const state = webhookVerificationState(hook);
  const testedAt = formatTestTime(hook.lastTestedAt);
  if (state === "passing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-good">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Test passed{testedAt ? ` · ${testedAt}` : ""}
      </span>
    );
  }
  if (state === "failing") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-danger">
        <XCircle className="h-3.5 w-3.5" />
        Test failed{testedAt ? ` · ${testedAt}` : ""}
      </span>
    );
  }
  if (state === "disabled") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-ink-faint">
        <PauseCircle className="h-3.5 w-3.5" /> Disabled
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#8a5a00]">
      <CircleDashed className="h-3.5 w-3.5" /> Not tested
    </span>
  );
}

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

  return (
    <div>
      <span className="mb-1 block text-sm font-black">{label}</span>
      {hint ? <p className="mb-2 text-xs text-ink-soft">{hint}</p> : null}
      {rows.length > 0 ? (
        <div className="space-y-2">
          {rows.map((row, index) => (
            <div key={index} className="flex flex-wrap items-center gap-2">
              <input
                aria-label={`${label} key ${index + 1}`}
                value={row.key}
                onChange={(event) => update(index, { key: event.target.value })}
                placeholder="Key"
                className="h-10 min-w-[7rem] flex-1 rounded-lg border border-line-strong bg-white px-3 text-sm outline-none focus:border-ink"
              />
              <input
                aria-label={`${label} value ${index + 1}`}
                value={row.value}
                onChange={(event) => update(index, { value: event.target.value })}
                placeholder={valuePlaceholder}
                className="h-10 min-w-[10rem] flex-[2] rounded-lg border border-line-strong bg-white px-3 text-sm outline-none focus:border-ink"
              />
              <button
                type="button"
                onClick={() => onChange(rows.filter((_, i) => i !== index))}
                aria-label={`Remove ${label.toLowerCase()} row ${index + 1}`}
                className="flex h-10 w-10 items-center justify-center rounded-lg text-ink-soft transition hover:bg-danger-wash hover:text-danger"
              >
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-ink-faint">None added.</p>
      )}
      <button
        type="button"
        onClick={() => onChange([...rows, { key: "", value: "" }])}
        className="mt-2 inline-flex items-center gap-1 text-xs font-bold text-teal transition hover:text-teal-deep"
      >
        <Plus className="h-3.5 w-3.5" />
        Add {label.toLowerCase()}
      </button>
    </div>
  );
}

function WebhookCard({
  hook,
  dirty,
  testBusy,
  testing,
  testResult,
  onChange,
  onRemove,
  onTest,
}: {
  hook: IntegrationWebhook;
  dirty: boolean;
  testBusy: boolean;
  testing: boolean;
  testResult?: IntegrationWebhookTestResult;
  onChange: (patch: Partial<IntegrationWebhook>) => void;
  onRemove: () => void;
  onTest: () => void;
}) {
  const [expanded, setExpanded] = useState(!hook.url.trim());
  const [removeConfirmOpen, setRemoveConfirmOpen] = useState(false);
  const testDisabled = dirty || testBusy || !hook.enabled || hook.method === "DELETE";
  const displayedTestError =
    testResult?.error ||
    (webhookVerificationState(hook) === "failing" ? hook.lastTestError : undefined);
  const testTitle = dirty
    ? "Save changes before sending a test"
    : testBusy
      ? "Wait for the current test to finish"
      : !hook.enabled
        ? "Enable this integration before testing"
        : hook.method === "DELETE"
          ? "DELETE integrations are not test-fired"
          : "Send a test request";

  return (
    <div className="rounded-xl border border-line bg-white">
      <div className="flex flex-col gap-3 px-4 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <p className="truncate font-black text-ink">
              {hook.friendlyName.trim() || "New integration"}
            </p>
            <VerificationStatus hook={hook} />
          </div>
          <p className="mt-1 truncate text-xs text-ink-soft">
            {webhookConditions.find((item) => item.value === hook.condition)?.label}
            {hook.url.trim() ? ` · ${hook.method} ${hook.url}` : " · Endpoint not configured"}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="inline-flex min-h-9 cursor-pointer items-center gap-2 px-1 text-xs font-bold text-ink-soft">
            <input
              type="checkbox"
              checked={hook.enabled}
              onChange={(event) => onChange({ enabled: event.target.checked })}
              className="h-4 w-4 rounded border-black/30 accent-[#148b8e]"
            />
            Enabled
          </label>
          <button
            type="button"
            onClick={onTest}
            disabled={testDisabled}
            title={testTitle}
            aria-label={`Test ${hook.friendlyName.trim() || "integration"}`}
            className="press inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-black text-ink transition hover:border-teal hover:text-teal disabled:cursor-not-allowed disabled:opacity-45"
          >
            {testing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <FlaskConical className="h-3.5 w-3.5" />}
            {testing ? "Testing…" : "Test"}
          </button>
          <button
            type="button"
            onClick={() => setExpanded((current) => !current)}
            aria-expanded={expanded}
            aria-label={`${expanded ? "Close" : "Configure"} ${hook.friendlyName.trim() || "integration"}`}
            className="press inline-flex h-9 items-center gap-1.5 rounded-lg bg-card-tint px-3 text-xs font-black text-ink transition hover:bg-[#e7ebe9]"
          >
            Configure
            <ChevronDown className={`h-3.5 w-3.5 transition ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {displayedTestError ? (
        <div className="border-t border-danger/15 bg-danger-wash px-4 py-2.5 text-sm font-semibold text-danger" role="status">
          {displayedTestError}
        </div>
      ) : null}

      {expanded ? (
        <div className="anim-fade border-t border-line px-4 py-5">
          <div className="grid gap-4 sm:grid-cols-2">
            <label className="block sm:col-span-2">
              <span className="mb-2 block text-sm font-black">Display name</span>
              <input
                value={hook.friendlyName}
                onChange={(event) => {
                  const friendlyName = event.target.value;
                  const oldAutoName = slugifyWebhookName(hook.friendlyName) || "new_webhook";
                  onChange({
                    friendlyName,
                    name:
                      !hook.name || hook.name === oldAutoName || hook.name === "new_webhook"
                        ? slugifyWebhookName(friendlyName)
                        : hook.name,
                  });
                }}
                placeholder="Update patient record"
                className="h-11 w-full rounded-lg border border-line-strong bg-white px-3 text-sm outline-none focus:border-ink"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-black">Tool name</span>
              <input
                value={hook.name}
                onChange={(event) => onChange({ name: slugifyWebhookName(event.target.value) })}
                placeholder="update_patient"
                className="h-11 w-full rounded-lg border border-line-strong bg-white px-3 font-mono text-sm outline-none focus:border-ink"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-black">When it runs</span>
              <select
                value={hook.condition}
                onChange={(event) => onChange({ condition: event.target.value as WebhookCondition })}
                className="h-11 w-full rounded-lg border border-line-strong bg-white px-3 text-sm outline-none focus:border-ink"
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
                onChange={(event) => onChange({ description: event.target.value })}
                rows={2}
                placeholder={
                  hook.condition === "during_call"
                    ? "Tell the agent when to use this action."
                    : "Optional note for your team."
                }
                className="w-full rounded-lg border border-line-strong bg-white px-3 py-2.5 text-sm outline-none focus:border-ink"
              />
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-black">Method</span>
              <select
                value={hook.method}
                onChange={(event) => onChange({ method: event.target.value as WebhookHttpMethod })}
                className="h-11 w-full rounded-lg border border-line-strong bg-white px-3 text-sm outline-none focus:border-ink"
              >
                {webhookMethods.map((method) => (
                  <option key={method} value={method}>
                    {method}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-2 block text-sm font-black">Endpoint URL</span>
              <input
                type="url"
                value={hook.url}
                onChange={(event) => onChange({ url: event.target.value })}
                placeholder="https://api.yourcrm.com/wisecall"
                className="h-11 w-full rounded-lg border border-line-strong bg-white px-3 text-sm outline-none focus:border-ink"
              />
            </label>
          </div>

          <div className="mt-5 grid gap-5 md:grid-cols-2">
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
                  ? "Leave a value empty when the agent should collect it from the caller."
                  : "Use a call token or a fixed value."
              }
              rows={hook.parameters}
              onChange={(parameters) => onChange({ parameters })}
              valuePlaceholder="{{caller_id}} or fixed value"
            />
          </div>

          <details className="mt-5 border-t border-line pt-3 text-xs text-ink-soft">
            <summary className="cursor-pointer font-bold text-ink">Available call tokens</summary>
            <div className="mt-2 flex flex-wrap gap-2">
              {webhookTemplateTokens.map((item) => (
                <code key={item.token} title={item.label} className="rounded bg-card-tint px-2 py-1">
                  {item.token}
                </code>
              ))}
            </div>
          </details>

          <div className="mt-5 flex justify-end border-t border-line pt-4">
            <button
              type="button"
              onClick={() => setRemoveConfirmOpen(true)}
              className="press inline-flex h-9 items-center gap-2 rounded-lg px-3 text-xs font-black text-danger transition hover:bg-danger-wash"
            >
              <Trash2 className="h-3.5 w-3.5" /> Remove integration
            </button>
          </div>
        </div>
      ) : null}

      <Dialog
        open={removeConfirmOpen}
        onOpenChange={setRemoveConfirmOpen}
        title={`Remove ${hook.friendlyName.trim() || "integration"}?`}
        description="This removes the integration from your draft. Save changes afterwards to apply the removal to the live agent."
        footer={
          <>
            <Button variant="secondary" onClick={() => setRemoveConfirmOpen(false)}>
              Keep integration
            </Button>
            <Button
              variant="danger"
              data-autofocus
              onClick={() => {
                setRemoveConfirmOpen(false);
                onRemove();
              }}
            >
              <Trash2 className="h-4 w-4" />
              Remove integration
            </Button>
          </>
        }
      />
    </div>
  );
}

function IntegrationSummary({ webhooks, dirty }: { webhooks: IntegrationWebhook[]; dirty: boolean }) {
  if (dirty) {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[#8a5a00]">
        <AlertTriangle className="h-3.5 w-3.5" /> Unsaved changes
      </span>
    );
  }
  const enabled = webhooks.filter((hook) => hook.enabled);
  const failing = enabled.filter((hook) => webhookVerificationState(hook) === "failing").length;
  const untested = enabled.filter((hook) => webhookVerificationState(hook) === "untested").length;
  if (!enabled.length) return <span className="text-xs font-bold text-ink-faint">Not configured</span>;
  if (failing) return <span className="text-xs font-bold text-danger">{failing} need attention</span>;
  if (untested) return <span className="text-xs font-bold text-[#8a5a00]">{untested} need testing</span>;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-bold text-good">
      <CheckCircle2 className="h-3.5 w-3.5" /> All tests passed
    </span>
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
  const [dirty, setDirty] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [testResults, setTestResults] = useState<Record<string, IntegrationWebhookTestResult>>({});
  const [isSaving, startSave] = useTransition();
  const [isTesting, startTest] = useTransition();
  const enabledCount = webhooks.filter((hook) => hook.enabled).length;

  function update(id: string, patch: Partial<IntegrationWebhook>) {
    const invalidatesTest = Object.keys(patch).some((key) =>
      CONNECTION_FIELDS.has(key as keyof IntegrationWebhook),
    );
    setSaved(false);
    setDirty(true);
    setError(null);
    if (invalidatesTest) {
      setTestResults((current) => {
        const next = { ...current };
        delete next[id];
        return next;
      });
    }
    setWebhooks((current) =>
      current.map((hook) => {
        if (hook.id !== id) return hook;
        return {
          ...hook,
          ...patch,
          ...(invalidatesTest
            ? {
                lastTestedAt: undefined,
                lastTestOk: undefined,
                lastTestStatus: undefined,
                lastTestError: undefined,
              }
            : {}),
        };
      }),
    );
  }

  function remove(id: string) {
    setWebhooks((current) => current.filter((hook) => hook.id !== id));
    setDirty(true);
    setSaved(false);
  }

  function add() {
    setWebhooks((current) => [...current, newIntegrationWebhook()]);
    setDirty(true);
    setSaved(false);
  }

  function save() {
    setError(null);
    const validationError = validateIntegrationWebhooks(webhooks);
    if (validationError) {
      setError(validationError);
      return;
    }
    startSave(async () => {
      try {
        const result = await updateAgent(agentId, { integrationWebhooks: webhooks });
        if (result.ok) {
          setDirty(false);
          setSaved(true);
          window.setTimeout(() => setSaved(false), 1600);
        } else {
          setError(result.error ?? "Could not save integrations.");
        }
      } catch {
        setError("WiseCall could not save these integrations. Your changes are still here.");
      }
    });
  }

  function testHook(id: string) {
    setTestingId(id);
    setTestResults((current) => {
      const next = { ...current };
      delete next[id];
      return next;
    });
    startTest(async () => {
      let result: IntegrationWebhookTestResult;
      try {
        result = await testIntegrationWebhook(agentId, id);
      } catch {
        result = { ok: false, error: "WiseCall could not start the test. Try again." };
      }
      setTestingId(null);
      setTestResults((current) => ({ ...current, [id]: result }));
      if (result.testedAt) {
        setWebhooks((current) =>
          current.map((hook) =>
            hook.id === id
              ? {
                  ...hook,
                  lastTestedAt: result.testedAt,
                  lastTestOk: result.ok,
                  lastTestStatus: result.httpStatus,
                  lastTestError: result.error,
                }
              : hook,
          ),
        );
      }
    });
  }

  return (
    <section className="mb-8 rounded-xl border border-line bg-white">
      <div className="flex flex-col gap-3 border-b border-line px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-teal-wash text-teal">
            <Webhook className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h3 className="font-black text-ink">Custom integrations</h3>
              <IntegrationSummary webhooks={webhooks} dirty={dirty} />
            </div>
            <p className="mt-1 text-sm text-ink-soft">
              {enabledCount
                ? `${enabledCount} enabled across the call workflow.`
                : "Send call data to your CRM, booking system or automation."}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={add}
            disabled={webhooks.length >= 10}
            className="press inline-flex h-9 items-center gap-1.5 rounded-lg border border-line px-3 text-xs font-black text-teal transition hover:border-teal disabled:opacity-45"
          >
            <Plus className="h-3.5 w-3.5" /> Add
          </button>
          <button
            type="button"
            onClick={save}
            disabled={isSaving || isTesting || !dirty}
            className="press inline-flex h-9 min-w-[104px] items-center justify-center gap-1.5 rounded-lg bg-ink px-3 text-xs font-black text-white transition hover:bg-[#263130] disabled:cursor-default disabled:opacity-45"
          >
            {isSaving ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : saved || !dirty ? (
              <Check className="h-3.5 w-3.5" />
            ) : (
              <Save className="h-3.5 w-3.5" />
            )}
            {isSaving ? "Saving…" : saved || !dirty ? "Saved" : "Save changes"}
          </button>
        </div>
      </div>

      {dirty && webhooks.some((hook) => hook.enabled) ? (
        <div className="border-b border-[#f3dfae] bg-[#fff8eb] px-5 py-2.5 text-xs font-semibold text-[#8a5a00]">
          Save changes before sending a test request.
        </div>
      ) : null}
      {error ? (
        <div role="alert" className="border-b border-danger/15 bg-danger-wash px-5 py-3 text-sm font-semibold text-danger">
          {error}
        </div>
      ) : null}

      <div className="p-4 sm:p-5">
        {webhooks.length ? (
          <div className="space-y-3">
            {webhooks.map((hook) => (
              <WebhookCard
                key={hook.id}
                hook={hook}
                dirty={dirty}
                testBusy={isTesting}
                testing={testingId === hook.id}
                testResult={testResults[hook.id]}
                onChange={(patch) => update(hook.id, patch)}
                onRemove={() => remove(hook.id)}
                onTest={() => testHook(hook.id)}
              />
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-line-strong bg-card-tint px-5 py-9 text-center">
            <p className="font-black text-ink">No custom integrations</p>
            <p className="mt-1 text-sm text-ink-soft">Add one when WiseCall needs to read or update another system.</p>
            <button
              type="button"
              onClick={add}
              className="press mt-4 inline-flex h-9 items-center gap-2 rounded-lg bg-ink px-4 text-xs font-black text-white"
            >
              <Plus className="h-3.5 w-3.5" /> Add integration
            </button>
          </div>
        )}
      </div>
    </section>
  );
}
