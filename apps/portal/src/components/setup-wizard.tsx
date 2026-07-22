"use client";

import { useState, useTransition, useEffect, useRef } from "react";
import {
  Loader2,
  Sparkles,
  X,
  ArrowLeft,
  ArrowRight,
  Check,
  Globe,
  Mail,
  Plus,
  Trash2,
  PhoneForwarded,
  Play,
  Square,
  Bot,
  Stethoscope,
  ShieldCheck,
  Home,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { draftAgentFromWebsite, draftAgentFromInputs, type AgentDraft, type BusinessInputs } from "@/app/actions/wizard";
import { testVoice } from "@/app/actions/agents";
import { OfficeHoursGrid } from "./office-hours-card";
import type { AgentTemplate, RoutingContact } from "./customer-agent-workspace";

type Step =
  | "website"
  | "basics"
  | "template"
  | "review"
  | "hours"
  | "voice"
  | "handoff";

type Voice = { id: string; label: string; blurb: string };

export type WizardResult = { ok: boolean; id?: string; error?: string };

const STEP_TITLES: Record<Step, string> = {
  website: "Your website",
  basics: "Your business",
  template: "Assistant type",
  review: "Review the draft",
  hours: "Opening hours",
  voice: "Voice & greeting",
  handoff: "Messages & team",
};

// Presentation metadata per template: an icon and the plain-English list of
// what the assistant will actually do. The dental template reads like a
// workflow, not a prompt: patients are looked up, booked, rescheduled and
// triaged without the practice lifting a finger.
const TEMPLATE_META: Record<string, { icon: LucideIcon; chips: string[]; note?: string }> = {
  receptionist: {
    icon: Bot,
    chips: ["Answers FAQs", "Takes messages", "Routes urgent calls"],
  },
  dentally: {
    icon: Stethoscope,
    chips: [
      "Looks up patients",
      "Books, reschedules & cancels",
      "Registers new patients",
      "Emergency triage",
    ],
    note: "Connects to your Dentally diary — real appointments, booked live on the call.",
  },
  estate_agent: {
    icon: Home,
    chips: [
      "Valuation capture",
      "Owner-confirm viewings",
      "WhatsApp / SMS to owners",
      "Maintenance triage",
    ],
    note: "Viewings text the owner for YES/NO, then confirm the viewer. Optional Cal.com diary check for negotiator availability.",
  },
};

// Re-applies a template's prompt/greeting (and seeds its starter contacts +
// knowledge) onto the draft. For the general receptionist we keep the AI-written
// prompt from the website scan when we have one, it's more tailored than the
// generic template, and only fall back to the template text in manual mode.
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
    industry: template.industry || draft.industry,
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
  const [generatingManual, startGenerateManual] = useTransition();
  const [submitting, startSubmit] = useTransition();
  const [loadingPhase, setLoadingPhase] = useState(0);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [manualInputs, setManualInputs] = useState<BusinessInputs>({
    businessName: "",
    industry: "",
    services: "",
    address: "",
    openingHoursText: "",
    pricing: "",
    payments: "",
    extra: "",
  });
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
      return;
    }
    const timings = [0, 4000, 10000, 18000];
    const timers = timings.map((delay, i) =>
      setTimeout(() => setLoadingPhase(i), delay),
    );
    return () => timers.forEach(clearTimeout);
  }, [generating]);

  const flow: Step[] = manualMode
    ? ["basics", "template", "review", "hours", "voice", "handoff"]
    : ["website", "template", "review", "hours", "voice", "handoff"];
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
    setLoadingPhase(0);
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
    const email = draft.defaultEmail.trim();
    if (email && !email.includes("@")) {
      setError("That doesn't look like a valid email address.");
      return;
    }
    setError(null);
    startSubmit(async () => {
      const res = await onSubmit(draft);
      if (!res.ok) setError(res.error ?? "Couldn't create the agent.");
      // On success the parent closes the wizard.
    });
  }

  const selectedVoiceId = draft?.voice || voices[0]?.id || "";

  async function previewVoice(voiceId: string, e: React.MouseEvent) {
    e.stopPropagation();
    if (playingVoice === voiceId) {
      audioRef.current?.pause();
      setPlayingVoice(null);
      return;
    }
    audioRef.current?.pause();
    setPlayingVoice(voiceId);
    const res = await testVoice(voiceId);
    if (!res.ok || !res.audio) {
      setPlayingVoice(null);
      return;
    }
    const mime = res.mime || "audio/mp3";
    const audio = new Audio(`data:${mime};base64,${res.audio}`);
    audioRef.current = audio;
    audio.onended = () => setPlayingVoice(null);
    audio.onerror = () => setPlayingVoice(null);
    audio.play().catch(() => setPlayingVoice(null));
  }

  return (
    <div className="fixed inset-0 z-50 flex bg-surface">
      {/* Step rail: where you are, what's left, and why it's safe. */}
      <aside className="hidden w-[300px] flex-shrink-0 flex-col bg-gradient-to-b from-[#172929] to-[#0e1b1b] px-7 py-8 lg:flex">
        <span className="text-xl font-black text-white">
          Wise<span className="text-[#7de8eb]">Call</span>
        </span>
        <p className="mt-6 text-lg font-black leading-snug text-white">
          Set up your AI receptionist
        </p>
        <p className="mt-1.5 text-sm leading-relaxed text-[#94b4b2]">
          A few minutes now, then your phone answers itself.
        </p>

        <ol className="mt-8 flex-1 space-y-1">
          {flow.map((s, idx) => {
            const done = idx < stepIndex;
            const current = idx === stepIndex;
            return (
              <li
                key={s}
                className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-bold transition ${
                  current ? "bg-[#7de8eb]/10 text-white" : done ? "text-[#7de8eb]" : "text-[#5f7a78]"
                }`}
              >
                <span
                  className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-black transition ${
                    done
                      ? "bg-[#7de8eb] text-[#0e1b1b]"
                      : current
                        ? "border-2 border-[#7de8eb] text-[#7de8eb]"
                        : "border border-[#3a5250] text-[#5f7a78]"
                  }`}
                >
                  {done ? <Check className="anim-pop h-3.5 w-3.5" /> : idx + 1}
                </span>
                {STEP_TITLES[s]}
              </li>
            );
          })}
        </ol>

        <div className="rounded-xl bg-[#1a3535] px-4 py-3.5">
          <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-[#7de8eb]">
            <ShieldCheck className="h-4 w-4" />
            You control the final step
          </p>
          <p className="mt-1 text-xs leading-relaxed text-[#94b4b2]">
            Nothing changes while you review. The final button clearly tells you when your first
            number will be connected and ready for calls.
          </p>
        </div>
      </aside>

      {/* Content column */}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center justify-between gap-4 border-b border-line bg-card px-4 py-3 sm:px-8">
          <div className="min-w-0">
            <p className="text-sm font-black text-ink">{STEP_TITLES[step]}</p>
            <p className="text-xs text-ink-soft">
              Step {stepIndex + 1} of {totalSteps}
            </p>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden h-1.5 w-36 overflow-hidden rounded-full bg-card-tint sm:block">
              <div
                className="h-full rounded-full bg-teal transition-all duration-500 ease-out"
                style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
              />
            </div>
            <button
              type="button"
              onClick={onClose}
              className="press flex h-9 w-9 items-center justify-center rounded-lg text-ink-faint transition hover:bg-card-tint hover:text-ink"
              aria-label="Close setup"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </header>
        {/* Mobile progress */}
        <div className="h-1 w-full bg-card-tint sm:hidden">
          <div
            className="h-1 rounded-r-full bg-teal transition-all duration-500 ease-out"
            style={{ width: `${((stepIndex + 1) / totalSteps) * 100}%` }}
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          <div key={step} className="anim-rise mx-auto w-full max-w-2xl px-4 py-8 sm:px-8 sm:py-12">
            {/* STEP: website */}
            {step === "website" && (
              <div>
                <h2 className="text-2xl font-black text-ink sm:text-3xl">
                  Paste your website, we&apos;ll do the rest
                </h2>
                <p className="mt-2 text-ink-soft">
                  We read your site and draft the whole receptionist — what it says, what it
                  knows, even your opening hours. You review everything before it answers a
                  single call.
                </p>
                <div className="mt-6 flex items-center gap-2 rounded-xl border border-line-strong bg-card px-3 shadow-card transition focus-within:border-teal">
                  <Globe className="h-4 w-4 flex-shrink-0 text-ink-faint" />
                  <input
                    type="url"
                    value={website}
                    onChange={(e) => setWebsite(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && website.trim() && !generating) generate();
                    }}
                    placeholder="yourbusiness.co.uk"
                    className="h-14 w-full bg-transparent text-lg text-ink outline-none placeholder:text-ink-faint"
                    autoFocus
                  />
                </div>
                {error && <p className="mt-3 text-sm font-medium text-danger">{error}</p>}
                <button
                  type="button"
                  onClick={generate}
                  disabled={generating || !website.trim()}
                  className="press mt-5 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink px-5 font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
                >
                  {generating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" /> {loadingSteps[loadingPhase]}
                    </>
                  ) : (
                    <>
                      <Sparkles className="h-4 w-4" /> Build my receptionist
                    </>
                  )}
                </button>
                {generating && (
                  <p className="anim-fade mt-3 text-center text-xs text-ink-faint">
                    This usually takes 15–30 seconds
                  </p>
                )}
                <button
                  type="button"
                  onClick={startManual}
                  className="mt-4 w-full text-center text-sm font-semibold text-ink-soft underline-offset-2 hover:underline"
                >
                  No website? Set up manually instead
                </button>
              </div>
            )}

            {/* STEP: basics (manual only) */}
            {step === "basics" && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-2xl font-black text-ink sm:text-3xl">Tell us about your business</h2>
                  <p className="mt-2 text-ink-soft">
                    Fill in what you know, we&apos;ll use it to build your receptionist. Leave
                    anything blank that doesn&apos;t apply.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Business name *"
                    value={manualInputs.businessName}
                    placeholder="e.g. Northwind Dental"
                    onChange={(v) => setManualInputs((p) => ({ ...p, businessName: v }))}
                  />
                  <Field
                    label="Industry / type of business"
                    value={manualInputs.industry}
                    placeholder="e.g. Dental practice, Law firm, Estate agent"
                    onChange={(v) => setManualInputs((p) => ({ ...p, industry: v }))}
                  />
                </div>
                <TextArea
                  label="Services & treatments"
                  value={manualInputs.services}
                  placeholder="e.g. General dentistry, implants, orthodontics, whitening"
                  onChange={(v) => setManualInputs((p) => ({ ...p, services: v }))}
                  rows={3}
                />
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Address & parking"
                    value={manualInputs.address}
                    placeholder="e.g. 12 High Street, Leeds LS1 4AB"
                    onChange={(v) => setManualInputs((p) => ({ ...p, address: v }))}
                  />
                  <Field
                    label="Opening hours"
                    value={manualInputs.openingHoursText}
                    placeholder="e.g. Mon–Fri 9am–5:30pm, Sat 9am–1pm"
                    onChange={(v) => setManualInputs((p) => ({ ...p, openingHoursText: v }))}
                  />
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field
                    label="Pricing"
                    value={manualInputs.pricing}
                    placeholder="e.g. Consultation from £50, implants from £1,800"
                    onChange={(v) => setManualInputs((p) => ({ ...p, pricing: v }))}
                  />
                  <Field
                    label="Payments, insurance & registration"
                    value={manualInputs.payments}
                    placeholder="e.g. NHS & private, card, finance plans"
                    onChange={(v) => setManualInputs((p) => ({ ...p, payments: v }))}
                  />
                </div>
                <TextArea
                  label="Anything else callers commonly ask"
                  value={manualInputs.extra}
                  placeholder="e.g. Free parking on-site, wheelchair accessible, new patients welcome"
                  onChange={(v) => setManualInputs((p) => ({ ...p, extra: v }))}
                  rows={2}
                />
                {error && <p className="text-sm font-medium text-danger">{error}</p>}
                <button
                  type="button"
                  onClick={() => {
                    if (!manualInputs.businessName.trim()) {
                      setError("Add your business name to continue.");
                      return;
                    }
                    setError(null);
                    startGenerateManual(async () => {
                      const res = await draftAgentFromInputs(manualInputs);
                      if (!res.ok || !res.draft) {
                        setError(res.error ?? "Couldn't build the agent.");
                        return;
                      }
                      aiRef.current = { prompt: res.draft.prompt, greeting: res.draft.greeting };
                      setDraft(res.draft);
                      goNext();
                    });
                  }}
                  disabled={generatingManual || !manualInputs.businessName.trim()}
                  className="press mt-1 inline-flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-ink px-5 font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
                >
                  {generatingManual ? (
                    <><Loader2 className="h-4 w-4 animate-spin" /> Building your receptionist…</>
                  ) : (
                    <><Sparkles className="h-4 w-4" /> Build my receptionist</>
                  )}
                </button>
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      setManualMode(false);
                      setStep("website");
                    }}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink"
                  >
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                </div>
              </div>
            )}

            {/* STEP: template */}
            {step === "template" && draft && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl font-black text-ink sm:text-3xl">
                    What kind of assistant is this?
                  </h2>
                  <p className="mt-2 text-ink-soft">
                    We pre-selected the best match. This sets what your assistant can actually
                    do on a call — you can fine-tune everything next.
                  </p>
                </div>
                <div className="stagger grid gap-3">
                  {availableTemplates.map((t) => {
                    const active = draft.templateId === t.id;
                    const meta = TEMPLATE_META[t.id] ?? TEMPLATE_META.receptionist;
                    const MetaIcon = meta.icon;
                    const suggested =
                      t.id !== "receptionist" &&
                      `${draft.industry}`.toLowerCase().includes(t.industry.toLowerCase());
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => selectTemplate(t)}
                        className={`press rounded-2xl border p-5 text-left transition ${
                          active
                            ? "border-teal bg-teal-wash ring-1 ring-teal"
                            : "border-line bg-card shadow-card hover:border-teal/50"
                        }`}
                      >
                        <div className="flex items-start gap-3">
                          <span
                            className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
                              active ? "bg-teal text-white" : "bg-card-tint text-teal"
                            }`}
                          >
                            <MetaIcon className="h-5 w-5" />
                          </span>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-black text-ink">{t.label}</span>
                              <span className="flex items-center gap-2">
                                {suggested && (
                                  <span className="rounded-full bg-good-wash px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-good">
                                    Suggested for you
                                  </span>
                                )}
                                {active && (
                                  <span className="anim-pop flex h-5 w-5 items-center justify-center rounded-full bg-teal text-white">
                                    <Check className="h-3 w-3" />
                                  </span>
                                )}
                              </span>
                            </div>
                            <p className="mt-1 text-sm text-ink-soft">{t.description}</p>
                            <div className="mt-3 flex flex-wrap gap-1.5">
                              {meta.chips.map((chip) => (
                                <span
                                  key={chip}
                                  className={`rounded-full px-2.5 py-1 text-[11px] font-bold ${
                                    active ? "bg-white text-teal-deep" : "bg-card-tint text-ink-soft"
                                  }`}
                                >
                                  {chip}
                                </span>
                              ))}
                            </div>
                            {meta.note && (
                              <p className="mt-2.5 flex items-center gap-1.5 text-xs font-semibold text-teal-deep">
                                <Sparkles className="h-3.5 w-3.5" />
                                {meta.note}
                              </p>
                            )}
                          </div>
                        </div>
                      </button>
                    );
                  })}
                </div>
                <WizardFooter
                  onBack={() => (manualMode ? goBack() : setStep("website"))}
                  onNext={goNext}
                  nextLabel="Review the draft"
                />
              </div>
            )}

            {/* STEP: review */}
            {step === "review" && draft && (
              <div className="space-y-4">
                <div>
                  <h2 className="text-2xl font-black text-ink sm:text-3xl">Here&apos;s the draft</h2>
                  <p className="mt-2 text-ink-soft">
                    Tweak anything — this is exactly how your assistant behaves and what it
                    knows.
                  </p>
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Field label="Business name" value={draft.businessName} onChange={(v) => patchDraft({ businessName: v })} />
                  <Field label="Assistant name" value={draft.receptionistName} onChange={(v) => patchDraft({ receptionistName: v })} />
                </div>
                <TextArea label="How it should behave (prompt)" value={draft.prompt} onChange={(v) => patchDraft({ prompt: v })} rows={10} />
                <TextArea label="What it knows about your business" value={draft.knowledge} onChange={(v) => patchDraft({ knowledge: v })} rows={6} />
                {error && <p className="text-sm font-medium text-danger">{error}</p>}
                <WizardFooter onBack={goBack} onNext={goNext} nextLabel="Opening hours" />
              </div>
            )}

            {/* STEP: hours */}
            {step === "hours" && draft && (
              <div>
                <h2 className="text-2xl font-black text-ink sm:text-3xl">When are you open?</h2>
                <p className="mt-2 mb-5 text-ink-soft">
                  Outside these hours the receptionist takes a detailed message and emails it to
                  you — no missed enquiries. We pre-filled anything we found on your site. Leave
                  all days closed to skip after-hours handling.
                </p>
                <OfficeHoursGrid
                  hours={draft.officeHours}
                  onChange={(officeHours) => patchDraft({ officeHours })}
                />
                {error && <p className="mt-3 text-sm font-medium text-danger">{error}</p>}
                <WizardFooter onBack={goBack} onNext={goNext} nextLabel="Pick a voice" />
              </div>
            )}

            {/* STEP: voice & greeting */}
            {step === "voice" && draft && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-2xl font-black text-ink sm:text-3xl">How should it sound?</h2>
                  <p className="mt-2 text-ink-soft">
                    Tap play to hear each voice. This is how your assistant sounds to callers,
                    and you can change it any time.
                  </p>
                </div>
                <div className="stagger grid gap-2 sm:grid-cols-2">
                  {voices.map((v) => {
                    const active = selectedVoiceId === v.id;
                    const isPlaying = playingVoice === v.id;
                    return (
                      <button
                        key={v.id}
                        type="button"
                        onClick={() => patchDraft({ voice: v.id })}
                        className={`press flex items-center justify-between rounded-xl border px-4 py-3 text-left transition ${
                          active
                            ? "border-teal bg-teal-wash ring-1 ring-teal"
                            : "border-line bg-card shadow-card hover:border-teal/50"
                        }`}
                      >
                        <span>
                          <span className="block font-bold text-ink">{v.label}</span>
                          <span className="block text-xs text-ink-soft">{v.blurb}</span>
                        </span>
                        <span className="flex items-center gap-2">
                          <span
                            role="button"
                            onClick={(e) => previewVoice(v.id, e)}
                            className="press flex h-8 w-8 items-center justify-center rounded-full border border-line bg-card text-ink-soft transition hover:border-teal hover:text-teal"
                            title={isPlaying ? "Stop" : "Preview voice"}
                          >
                            {isPlaying ? (
                              <Square className="h-3 w-3 fill-current" />
                            ) : (
                              <Play className="h-3 w-3 fill-current" />
                            )}
                          </span>
                          {active && (
                            <span className="anim-pop flex h-5 w-5 items-center justify-center rounded-full bg-teal text-white">
                              <Check className="h-3 w-3" />
                            </span>
                          )}
                        </span>
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
                {error && <p className="text-sm font-medium text-danger">{error}</p>}
                <WizardFooter onBack={goBack} onNext={goNext} nextLabel="Messages & team" />
              </div>
            )}

            {/* STEP: handoff — where messages go + who calls can reach. One step,
                because they answer the same question: "when the AI needs a human,
                what happens?" */}
            {step === "handoff" && draft && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-2xl font-black text-ink sm:text-3xl">
                    When the AI needs a human
                  </h2>
                  <p className="mt-2 text-ink-soft">
                    Tell us where messages should land and who urgent calls can reach. You can
                    skip the team part and add people later.
                  </p>
                </div>

                <label className="block">
                  <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">
                    Main email for messages &amp; transcripts
                  </span>
                  <div className="flex items-center gap-2 rounded-xl border border-line-strong bg-card px-3 shadow-card transition focus-within:border-teal">
                    <Mail className="h-4 w-4 flex-shrink-0 text-ink-faint" />
                    <input
                      type="email"
                      value={draft.defaultEmail}
                      onChange={(e) => patchDraft({ defaultEmail: e.target.value })}
                      placeholder="you@yourbusiness.co.uk"
                      className="h-12 w-full bg-transparent text-ink outline-none placeholder:text-ink-faint"
                    />
                  </div>
                </label>

                <div>
                  <p className="mb-2 text-xs font-bold uppercase tracking-wide text-ink-soft">
                    Colleagues for transfers &amp; alerts (optional)
                  </p>
                  <TeamEditor
                    contacts={draft.contacts}
                    onChange={(contacts) => patchDraft({ contacts })}
                  />
                </div>

                <div className="rounded-xl border border-teal/20 bg-teal-wash px-4 py-3 text-sm text-[#1f5f60]">
                  <span className="font-bold">Last step.</span> When you finish, we create your
                  assistant and connect a phone number automatically — it&apos;ll be ready to
                  take calls.
                </div>

                {error && <p className="text-sm font-medium text-danger">{error}</p>}
                <div className="flex items-center justify-between pt-1">
                  <button
                    type="button"
                    onClick={goBack}
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft hover:text-ink disabled:opacity-50"
                  >
                    <ArrowLeft className="h-4 w-4" /> Back
                  </button>
                  <button
                    type="button"
                    onClick={finish}
                    disabled={submitting}
                    className="press inline-flex h-12 items-center gap-2 rounded-xl bg-good px-6 font-black text-white transition hover:bg-[#0e7a4d] disabled:opacity-60"
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
                  className="w-full text-center text-xs font-semibold text-ink-faint underline-offset-2 hover:underline"
                >
                  Prefer the classic editor? Switch to advanced setup
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function WizardFooter({
  onBack,
  onNext,
  nextLabel,
}: {
  onBack: () => void;
  onNext: () => void;
  nextLabel: string;
}) {
  return (
    <div className="flex items-center justify-between pt-2">
      <button
        type="button"
        onClick={onBack}
        className="inline-flex items-center gap-1.5 text-sm font-semibold text-ink-soft transition hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" /> Back
      </button>
      <button
        type="button"
        onClick={onNext}
        className="press inline-flex h-11 items-center gap-2 rounded-xl bg-ink px-5 font-black text-white transition hover:bg-[#263130]"
      >
        {nextLabel}
        <ArrowRight className="h-4 w-4" />
      </button>
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
        <div key={c.id} className="anim-scale-in rounded-xl border border-line bg-card p-3 shadow-card">
          <div className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-xs font-bold uppercase tracking-wide text-ink-soft">
              <PhoneForwarded className="h-3.5 w-3.5" /> Colleague
            </span>
            <button
              type="button"
              onClick={() => remove(c.id)}
              className="press flex h-7 w-7 items-center justify-center rounded-lg text-ink-faint transition hover:bg-danger-wash hover:text-danger"
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
              className="h-10 w-full rounded-lg border border-line bg-card px-3 text-sm text-ink outline-none transition focus:border-teal"
            />
            <input
              value={c.phone}
              onChange={(e) => update(c.id, { phone: e.target.value })}
              placeholder="Mobile / phone (for transfers)"
              className="h-10 w-full rounded-lg border border-line bg-card px-3 text-sm text-ink outline-none transition focus:border-teal"
            />
            <input
              value={c.email}
              onChange={(e) => update(c.id, { email: e.target.value })}
              placeholder="Email (for message alerts)"
              className="h-10 w-full rounded-lg border border-line bg-card px-3 text-sm text-ink outline-none transition focus:border-teal"
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
              className="h-10 w-full rounded-lg border border-line bg-card px-3 text-sm text-ink outline-none transition focus:border-teal"
            />
          </div>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="press inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-dashed border-teal/40 text-sm font-bold text-teal transition hover:bg-teal-wash"
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
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">{label}</span>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-11 w-full rounded-xl border border-line-strong bg-card px-3 text-ink outline-none transition focus:border-teal"
      />
    </label>
  );
}

function TextArea({
  label,
  value,
  onChange,
  placeholder,
  rows,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  rows: number;
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-bold uppercase tracking-wide text-ink-soft">{label}</span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        rows={rows}
        className="w-full rounded-xl border border-line-strong bg-card px-3 py-2 text-sm leading-relaxed text-ink outline-none transition focus:border-teal"
      />
    </label>
  );
}
