"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import {
  Loader2,
  Sparkles,
  X,
  ArrowLeft,
  Check,
  Globe,
  Mic,
  Mail,
  Users,
  Plus,
  Trash2,
  PhoneForwarded,
} from "lucide-react";
import { draftAgentFromWebsite, type AgentDraft } from "@/app/actions/wizard";
import { OfficeHoursGrid } from "./office-hours-card";
import type { AgentTemplate, RoutingContact } from "./customer-agent-workspace";

type Step =
  | "website"
  | "basics"
  | "template"
  | "review"
  | "hours"
  | "voice"
  | "email"
  | "team";

type Voice = { id: string; label: string; blurb: string };

export type WizardResult = { ok: boolean; id?: string; error?: string };

const STEP_TITLES: Record<Step, string> = {
  website: "Your website",
  basics: "Your business",
  template: "Assistant type",
  review: "Review the draft",
  hours: "Opening hours",
  voice: "Voice & greeting",
  email: "Messages inbox",
  team: "Your team",
};

// Re-applies a template's prompt/greeting (and seeds its starter contacts +
// knowledge) onto the draft. For the general receptionist we keep the AI-written
// prompt from the website scan when we have one — it's more tailored than the
// generic template — and only fall back to the template text in manual mode.
function applyTemplate(
  draft: AgentDraft,
  template: AgentTemplate,
  ai: { prompt: string; greeting: string } | null,
): AgentDraft {
  if (template.id === "receptionist") {
    return {
      ...draft,
      templateId: template.id,
      prompt: ai ? ai.prompt : template.buildPrompt(draft.businessName, draft.receptionistName),
      greeting: ai
        ? ai.greeting
        : template.buildGreeting(draft.businessName, draft.receptionistName),
    };
  }

  const seeded = template.defaultContacts ? template.defaultContacts() : [];
  const existingNames = new Set(draft.contacts.map((c) => c.name.toLowerCase()));
  const contacts = [
    ...draft.contacts,
    ...seeded.filter((c) => !existingNames.has(c.name.toLowerCase())),
  ];

  return {
    ...draft,
    templateId: template.id,
    prompt: template.buildPrompt(draft.businessName, draft.receptionistName),
    greeting: template.buildGreeting(draft.businessName, draft.receptionistName),
    knowledgeFields: { ...(template.defaultKnowledgeFields ?? {}), ...draft.knowledgeFields },
    contacts,
  };
}

function blankDraft(defaultEmail: string): AgentDraft {
  return {
    businessName: "",
    receptionistName: "",
    industry: "General",
    greeting: "",
    prompt: "",
    knowledge: "",
    knowledgeFields: {},
    officeHours: {},
    website: "",
    templateId: "receptionist",
    voice: "",
    defaultEmail,
    contacts: [],
  };
}

export function SetupWizard({
  onClose,
  onSubmit,
  onManual,
  voices,
  templates,
  accountEmail = "",
}: {
  onClose: () => void;
  // Parent creates the agent (createAgent + applies website/hours/email/contacts)
  // and does the optimistic list add. Returns the new agent id or an error.
  onSubmit: (draft: AgentDraft) => Promise<WizardResult>;
  // Escape hatch to the classic full editor.
  onManual: () => void;
  voices: Voice[];
  templates: AgentTemplate[];
  accountEmail?: string;
}) {
  const [step, setStep] = useState<Step>("website");
  const [manualMode, setManualMode] = useState(false);
  const [website, setWebsite] = useState("");
  const [draft, setDraft] = useState<AgentDraft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generating, startGenerate] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [loadingPhase, setLoadingPhase] = useState(0);
  // The original AI-written prompt/greeting, kept so switching back to the
  // general receptionist template restores it instead of the generic text.
  const aiRef = useRef<{ prompt: string; greeting: string } | null>(null);

  const availableTemplates = templates.filter((t) => t.available);

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

  const flow: Step[] = manualMode
    ? ["basics", "template", "review", "hours", "voice", "email", "team"]
    : ["website", "template", "review", "hours", "voice", "email", "team"];
  const stepIndex = Math.max(0, flow.indexOf(step));
  const totalSteps = flow.length;

  function goNext() {
    const next = flow[stepIndex + 1];
    if (next) setStep(next);
  }
  function goBack() {
    const prev = flow[stepIndex - 1];
    if (prev) setStep(prev);
  }

  function generate() {
    setError(null);
    startGenerate(async () => {
      const res = await draftAgentFromWebsite(website);
      if (!res.ok || !res.draft) {
        setError(res.error ?? "Couldn't build your agent. Try again or set up manually.");
        return;
      }
      aiRef.current = { prompt: res.draft.prompt, greeting: res.draft.greeting };
      // If the scan matched a specialised template, apply it now (the AI prompt
      // is a generic receptionist; the template carries the real skill flow).
      let next = res.draft;
      if (accountEmail && !next.defaultEmail) next = { ...next, defaultEmail: accountEmail };
      const matched = availableTemplates.find((t) => t.id === next.templateId);
      if (matched && matched.id !== "receptionist") {
        next = applyTemplate(next, matched, aiRef.current);
      }
      setDraft(next);
      setStep("template");
    });
  }

  function startManual() {
    setError(null);
    aiRef.current = null;
    setManualMode(true);
    setDraft(blankDraft(accountEmail));
    setStep("basics");
  }

  function patchDraft(patch: Partial<AgentDraft>) {
    setDraft((d) => (d ? { ...d, ...patch } : d));
  }

  function selectTemplate(t: AgentTemplate) {
    setDraft((d) => (d ? applyTemplate(d, t, aiRef.current) : d));
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

  const selectedVoiceId = draft?.voice || voices[0]?.id || "";

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
                Step {stepIndex + 1} of {totalSteps} · {STEP_TITLES[step]}
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

        {/* Progress bar */}
        <div className="h-1 w-full bg-[#eef1f0]">
          <div
            className="h-1 rounded-r-full bg-[#148b8e] transition-all"
            style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
          />
        </div>

        <div className="px-6 py-6">
          {/* STEP — website */}
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
                onClick={startManual}
                className="mt-3 w-full text-center text-sm font-semibold text-[#66716e] underline-offset-2 hover:underline"
              >
                No website? Set up manually instead
              </button>
            </div>
          )}

          {/* STEP — basics (manual only) */}
          {step === "basics" && draft && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-black text-[#111716]">Tell us about your business</h3>
                <p className="mt-1 text-sm text-[#66716e]">
                  We&apos;ll use this to name your assistant and shape how it answers.
                </p>
              </div>
              <Field
                label="Business name"
                value={draft.businessName}
                placeholder="e.g. Northwind Dental"
                onChange={(v) =>
                  patchDraft({
                    businessName: v,
                    // Keep the assistant identity as "{business} assistant".
                    receptionistName: v ? `${v} assistant` : "",
                  })
                }
              />
              <Field
                label="Industry"
                value={draft.industry}
                placeholder="e.g. Dental practice, Law firm, Estate agent"
                onChange={(v) => patchDraft({ industry: v })}
              />
              {error && <p className="text-sm font-medium text-red-600">{error}</p>}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => {
                    setManualMode(false);
                    setStep("website");
                  }}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#66716e] hover:text-[#111716]"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    if (!draft.businessName.trim()) {
                      setError("Add your business name to continue.");
                      return;
                    }
                    setError(null);
                    goNext();
                  }}
                  className="inline-flex h-10 items-center rounded-xl bg-[#111716] px-5 font-black text-white transition hover:bg-[#263130]"
                >
                  Next: assistant type
                </button>
              </div>
            </div>
          )}

          {/* STEP — template */}
          {step === "template" && draft && (
            <div className="space-y-4">
              <div>
                <h3 className="text-lg font-black text-[#111716]">What kind of assistant is this?</h3>
                <p className="mt-1 text-sm text-[#66716e]">
                  We pre-selected the best match. This sets what your assistant can do — you can
                  fine-tune everything next.
                </p>
              </div>
              <div className="grid gap-3">
                {availableTemplates.map((t) => {
                  const active = draft.templateId === t.id;
                  const suggested =
                    t.id !== "receptionist" &&
                    `${draft.industry}`.toLowerCase().includes(t.industry.toLowerCase());
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => selectTemplate(t)}
                      className={`rounded-xl border p-4 text-left transition ${
                        active
                          ? "border-[#148b8e] bg-[#148b8e]/[0.06] ring-1 ring-[#148b8e]"
                          : "border-black/10 hover:border-[#148b8e]/50"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="font-black text-[#111716]">{t.label}</span>
                        <span className="flex items-center gap-2">
                          {suggested && (
                            <span className="rounded-full bg-[#16a66a]/12 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-[#16a66a]">
                              Suggested
                            </span>
                          )}
                          {active && (
                            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#148b8e] text-white">
                              <Check className="h-3 w-3" />
                            </span>
                          )}
                        </span>
                      </div>
                      <p className="mt-1 text-sm text-[#66716e]">{t.description}</p>
                    </button>
                  );
                })}
              </div>
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={() => (manualMode ? goBack() : setStep("website"))}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#66716e] hover:text-[#111716]"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex h-10 items-center rounded-xl bg-[#111716] px-5 font-black text-white transition hover:bg-[#263130]"
                >
                  Next: review
                </button>
              </div>
            </div>
          )}

          {/* STEP — review */}
          {step === "review" && draft && (
            <div className="space-y-4">
              <p className="text-sm text-[#66716e]">
                Here&apos;s the draft. Tweak anything — this is exactly how your assistant behaves and
                what it knows.
              </p>
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Business name" value={draft.businessName} onChange={(v) => patchDraft({ businessName: v })} />
                <Field label="Assistant name" value={draft.receptionistName} onChange={(v) => patchDraft({ receptionistName: v })} />
              </div>
              <TextArea label="How it should behave (prompt)" value={draft.prompt} onChange={(v) => patchDraft({ prompt: v })} rows={6} />
              <TextArea label="What it knows about your business" value={draft.knowledge} onChange={(v) => patchDraft({ knowledge: v })} rows={4} />
              {error && <p className="text-sm font-medium text-red-600">{error}</p>}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={goBack}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#66716e] hover:text-[#111716]"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex h-10 items-center rounded-xl bg-[#111716] px-5 font-black text-white transition hover:bg-[#263130]"
                >
                  Next: opening hours
                </button>
              </div>
            </div>
          )}

          {/* STEP — hours */}
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
                  onClick={goBack}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#66716e] hover:text-[#111716]"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex h-10 items-center rounded-xl bg-[#111716] px-5 font-black text-white transition hover:bg-[#263130]"
                >
                  Next: voice
                </button>
              </div>
            </div>
          )}

          {/* STEP — voice & greeting */}
          {step === "voice" && draft && (
            <div className="space-y-4">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-black text-[#111716]">
                  <Mic className="h-4 w-4 text-[#148b8e]" /> Pick a voice
                </h3>
                <p className="mt-1 text-sm text-[#66716e]">
                  This is how your assistant sounds to callers. You can change it any time.
                </p>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                {voices.map((v) => {
                  const active = selectedVoiceId === v.id;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => patchDraft({ voice: v.id })}
                      className={`flex items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                        active
                          ? "border-[#148b8e] bg-[#148b8e]/[0.06] ring-1 ring-[#148b8e]"
                          : "border-black/10 hover:border-[#148b8e]/50"
                      }`}
                    >
                      <span>
                        <span className="block font-bold text-[#111716]">{v.label}</span>
                        <span className="block text-xs text-[#66716e]">{v.blurb}</span>
                      </span>
                      {active && (
                        <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[#148b8e] text-white">
                          <Check className="h-3 w-3" />
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <TextArea
                label="Greeting (the first thing callers hear)"
                value={draft.greeting}
                onChange={(v) => patchDraft({ greeting: v })}
                rows={3}
              />
              {error && <p className="text-sm font-medium text-red-600">{error}</p>}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={goBack}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#66716e] hover:text-[#111716]"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={goNext}
                  className="inline-flex h-10 items-center rounded-xl bg-[#111716] px-5 font-black text-white transition hover:bg-[#263130]"
                >
                  Next: messages
                </button>
              </div>
            </div>
          )}

          {/* STEP — messages email */}
          {step === "email" && draft && (
            <div className="space-y-4">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-black text-[#111716]">
                  <Mail className="h-4 w-4 text-[#148b8e]" /> Where should messages go?
                </h3>
                <p className="mt-1 text-sm text-[#66716e]">
                  We&apos;ll email call messages, voicemails and transcripts here. You can add more
                  recipients per colleague in the next step.
                </p>
              </div>
              <label className="block">
                <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#66716e]">
                  Main email for messages &amp; transcripts
                </span>
                <div className="flex items-center gap-2 rounded-xl border border-black/10 px-3 focus-within:border-[#148b8e]">
                  <Mail className="h-4 w-4 flex-shrink-0 text-[#9aa5a2]" />
                  <input
                    type="email"
                    value={draft.defaultEmail}
                    onChange={(e) => patchDraft({ defaultEmail: e.target.value })}
                    placeholder="you@yourbusiness.co.uk"
                    className="h-11 w-full bg-transparent text-[#111716] outline-none placeholder:text-[#9aa5a2]"
                    autoFocus
                  />
                </div>
              </label>
              {error && <p className="text-sm font-medium text-red-600">{error}</p>}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={goBack}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#66716e] hover:text-[#111716]"
                >
                  <ArrowLeft className="h-4 w-4" /> Back
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const email = draft.defaultEmail.trim();
                    if (email && !email.includes("@")) {
                      setError("That doesn't look like a valid email address.");
                      return;
                    }
                    setError(null);
                    goNext();
                  }}
                  className="inline-flex h-10 items-center rounded-xl bg-[#111716] px-5 font-black text-white transition hover:bg-[#263130]"
                >
                  Next: your team
                </button>
              </div>
            </div>
          )}

          {/* STEP — team */}
          {step === "team" && draft && (
            <div className="space-y-4">
              <div>
                <h3 className="flex items-center gap-2 text-lg font-black text-[#111716]">
                  <Users className="h-4 w-4 text-[#148b8e]" /> Add your team
                </h3>
                <p className="mt-1 text-sm text-[#66716e]">
                  Colleagues the assistant can transfer urgent calls to or email messages about. Add
                  keywords (e.g. &quot;accounts&quot;, &quot;emergency&quot;) and we&apos;ll route the
                  right calls to the right person. Optional — you can skip and add people later.
                </p>
              </div>

              <TeamEditor
                contacts={draft.contacts}
                onChange={(contacts) => patchDraft({ contacts })}
              />

              <div className="rounded-xl border border-[#148b8e]/20 bg-[#148b8e]/[0.05] px-4 py-3 text-sm text-[#1f5f60]">
                <span className="font-bold">Last step.</span> When you finish, we&apos;ll create your
                assistant and connect a phone number automatically — it&apos;ll be ready to take calls.
              </div>

              {error && <p className="text-sm font-medium text-red-600">{error}</p>}
              <div className="flex items-center justify-between pt-1">
                <button
                  type="button"
                  onClick={goBack}
                  disabled={submitting}
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#66716e] hover:text-[#111716] disabled:opacity-50"
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
                      <Loader2 className="h-4 w-4 animate-spin" /> Setting up &amp; connecting number…
                    </>
                  ) : (
                    <>
                      <Check className="h-4 w-4" /> Finish &amp; connect number
                    </>
                  )}
                </button>
              </div>
              <button
                type="button"
                onClick={onManual}
                className="w-full text-center text-xs font-semibold text-[#9aa5a2] underline-offset-2 hover:underline"
              >
                Prefer the classic editor? Switch to advanced setup
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// Compact staff/colleague editor for the wizard. Each colleague becomes a
// RoutingContact: a phone makes them transfer-able, an email gets them notified.
function TeamEditor({
  contacts,
  onChange,
}: {
  contacts: RoutingContact[];
  onChange: (contacts: RoutingContact[]) => void;
}) {
  function add() {
    onChange([
      ...contacts,
      {
        id: crypto.randomUUID(),
        name: "",
        phone: "",
        email: "",
        keywords: [],
        transfer: true,
        notify: true,
        useDefaultEmail: false,
      },
    ]);
  }

  function update(id: string, patch: Partial<RoutingContact>) {
    onChange(
      contacts.map((c) => {
        if (c.id !== id) return c;
        const next = { ...c, ...patch };
        // Keep the transfer/notify intent in sync with what they've entered.
        next.transfer = Boolean((patch.phone ?? next.phone).trim());
        next.notify = Boolean((patch.email ?? next.email).trim());
        return next;
      }),
    );
  }

  function remove(id: string) {
    onChange(contacts.filter((c) => c.id !== id));
  }

  return (
    <div className="space-y-3">
      {contacts.map((c) => (
        <div key={c.id} className="rounded-xl border border-black/10 p-3">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-[#66716e]">
              <PhoneForwarded className="h-3.5 w-3.5" /> Colleague
            </span>
            <button
              type="button"
              onClick={() => remove(c.id)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-[#9aa5a2] transition hover:bg-[#f2f4f3] hover:text-red-600"
              aria-label="Remove colleague"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <input
              value={c.name}
              onChange={(e) => update(c.id, { name: e.target.value })}
              placeholder="Name (e.g. Practice manager)"
              className="h-10 w-full rounded-lg border border-black/10 px-3 text-sm text-[#111716] outline-none focus:border-[#148b8e]"
            />
            <input
              value={c.phone}
              onChange={(e) => update(c.id, { phone: e.target.value })}
              placeholder="Mobile / phone (for transfers)"
              className="h-10 w-full rounded-lg border border-black/10 px-3 text-sm text-[#111716] outline-none focus:border-[#148b8e]"
            />
            <input
              value={c.email}
              onChange={(e) => update(c.id, { email: e.target.value })}
              placeholder="Email (for message alerts)"
              className="h-10 w-full rounded-lg border border-black/10 px-3 text-sm text-[#111716] outline-none focus:border-[#148b8e]"
            />
            <input
              value={c.keywords.join(", ")}
              onChange={(e) =>
                update(c.id, {
                  keywords: e.target.value
                    .split(",")
                    .map((k) => k.trim())
                    .filter(Boolean),
                })
              }
              placeholder="Keywords (accounts, emergency…)"
              className="h-10 w-full rounded-lg border border-black/10 px-3 text-sm text-[#111716] outline-none focus:border-[#148b8e]"
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-[#148b8e]/40 text-sm font-bold text-[#148b8e] transition hover:bg-[#148b8e]/[0.05]"
      >
        <Plus className="h-4 w-4" /> Add a colleague
      </button>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-[#66716e]">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
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
