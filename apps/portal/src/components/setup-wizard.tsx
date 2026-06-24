"use client";

import { useState, useTransition, useEffect } from "react";
import { Loader2, Sparkles, X, ArrowLeft, Check, Globe } from "lucide-react";
import { draftAgentFromWebsite, type AgentDraft } from "@/app/actions/wizard";
import { OfficeHoursGrid } from "./office-hours-card";

type Step = "website" | "review" | "hours";

export type WizardResult = { ok: boolean; id?: string; error?: string };

export function SetupWizard({
  onClose,
  onSubmit,
  onManual,
}: {
  onClose: () => void;
  // Parent creates the agent (createAgent + applies website/office hours) and
  // does the optimistic list add. Returns the new agent id or an error.
  onSubmit: (draft: AgentDraft) => Promise<WizardResult>;
  onManual: () => void;
}) {
  const [step, setStep] = useState<Step>("website");
  const [website, setWebsite] = useState("");
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, startGenerate] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [loadingPhase, setLoadingPhase] = useState(0);

  const loadingSteps = [
    "Reading your website…",
    "Understanding your business…",
    "Drafting your receptionist…",
    "Almost there…",
  ];

  useEffect(() => {
    if (!generating) {
      setLoadingPhase(0);
      return;
    }
    const timings = [0, 4000, 10000, 18000];
    const timers = timings.map((delay, i) =>
      setTimeout(() => setLoadingPhase(i), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [generating]);

  function generate() {
    setError(null);
    startGenerate(async () => {
      const res = await draftAgentFromWebsite(website);
      if (!res.ok || !res.draft) {
        setError(res.error ?? "Couldn't build your agent. Try again or set up manually.");
        return;
      }
      setDraft(res.draft);
      setStep("review");
    });
  }

  function patchDraft(patch: Partial<AgentDraft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function finish() {
    if (!draft) return;
    setError(null);
    startSubmit(async () => {
      const res = await onSubmit(draft);
      if (!res.ok) setError(res.error ?? "Couldn't create the agent.");
      // On success the parent closes the wizard.
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4 backdrop-blur-sm">
      <div className="mt-8 w-full max-w-2xl rounded-2xl bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-black/10 px-6 py-4">
          <div className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#148b8e]/12 text-[#148b8e]">
              <Sparkles className="h-4 w-4" />
            </span>
            <div>
              <p className="font-black text-[#111716]">Set up your AI receptionist</p>
              <p className="text-xs text-[#66716e]">
                {step === "website" && "Step 1 of 3 · Your website"}
                {step === "review" && "Step 2 of 3 · Review the draft"}
                {step === "hours" && "Step 3 of 3 · Opening hours"}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-8 w-8 items-center justify-center rounded-lg text-[#7a8582] transition hover:bg-[#f2f4f3]"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-6 py-6">
          {/* STEP 1 — website */}
          {step === "website" && (
            <div>
              <h3 className="text-lg font-black text-[#111716]">Paste your business website</h3>
              <p className="mt-1 text-sm text-[#66716e]">
                We&apos;ll read it and draft your receptionist — business details, what it says, how it
                answers and your opening hours. You review everything before it goes live.
              </p>
              <div className="mt-4 flex items-center gap-2 rounded-xl border border-black/10 px-3 focus-within:border-[#148b8e]">
                <Globe className="h-4 w-4 flex-shrink-0 text-[#9aa5a2]" />
                <input
                  type="url"
                  value={website}
                  onChange={(e) => setWebsite(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && website.trim() && !generating) generate();
                  }}
                  placeholder="yourbusiness.co.uk"
                  className="h-12 w-full bg-transparent text-[#111716] outline-none placeholder:text-[#9aa5a2]"
                  autoFocus
                />
              </div>
              {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
              <button
                type="button"
                onClick={generate}
                disabled={generating || !website.trim()}
                className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-[#111716] px-5 font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
              >
                {generating ? (
                  <>
                    <Loader2 className="h-4 w-4 animate-spin" /> {loadingSteps[loadingPhase]}
                  </>
                ) : (
                  <>
                    <Sparkles className="h-4 w-4" /> Generate my receptionist
                  </>
                )}
              </button>
              {generating && (
                <p className="mt-3 text-center text-xs text-[#9aa5a2]">
                  This usually takes 15–30 seconds
                </p>
              )}
              <button
                type="button"
                onClick={onManual}
                className="mt-3 w-full text-center text-sm font-semibold text-[#66716e] underline-offset-2 hover:underline"
              >
                No website? Set up manually instead
              </button>
            </div>
          )}

          {/* STEP 2 — review */}
          {step === "review" && draft && (
            <div className="space-y-4">
              <p className="text-sm text-[#66716e]">
                Here&apos;s the draft from your website. Tweak anything — this is exactly what callers
                will hear.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business name" value={draft.businessName} onChange={(v) => patchDraft({ businessName: v })} />
                <Field label="Receptionist name" value={draft.receptionistName} onChange={(v) => patchDraft({ receptionistName: v })} />
              </div>
              <Field label="Greeting (the first thing callers hear)" value={draft.greeting} onChange={(v) => patchDraft({ greeting: v })} />
              <TextArea label="How it should behave (prompt)" value={draft.prompt} onChange={(v) => patchDraft({ prompt: v })} rows={6} />
              <TextArea label="What it knows about your business" value={draft.knowledge} onChange={(v) => patchDraft({ knowledge: v })} rows={4} />
              {error && <p className="text-sm font-medium text-red-600">{error}</p>}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => setStep("website")}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#66716e] hover:text-[#111716]"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => setStep("hours")}
                  className="inline-flex h-10 items-center rounded-xl bg-[#111716] px-5 font-black text-white transition hover:bg-[#263130]"
                >
                  Next: opening hours
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — hours */}
          {step === "hours" && draft && (
            <div>
              <h3 className="text-lg font-black text-[#111716]">When are you open?</h3>
              <p className="mt-1 mb-4 text-sm text-[#66716e]">
                Outside these hours the receptionist takes a detailed message and emails it to you — no
                missed enquiries. We pre-filled anything we found on your site. Leave all days closed to
                skip after-hours handling.
              </p>
              <OfficeHoursGrid
                hours={draft.officeHours}
                onChange={(officeHours) => patchDraft({ officeHours })}
              />
              {error && <p className="mt-3 text-sm font-medium text-red-600">{error}</p>}
              <div className="mt-6 flex items-center justify-between">
                <button
                  type="button"
                  onClick={() => setStep("review")}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#66716e] hover:text-[#111716]"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={finish}
                  disabled={submitting}
                  className="inline-flex h-11 items-center gap-2 rounded-xl bg-[#16a66a] px-6 font-black text-white transition hover:bg-[#138a58] disabled:opacity-60"
                >
                  {submitting ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> Creating…
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" /> Create my receptionist
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#66716e]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-11 w-full rounded-xl border border-black/10 px-3 text-[#111716] outline-none focus:border-[#148b8e]"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  rows: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#66716e]">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={rows}
        className="w-full rounded-xl border border-black/10 px-3 py-2 text-sm leading-relaxed text-[#111716] outline-none focus:border-[#148b8e]"
      />
    </label>
  );
}
