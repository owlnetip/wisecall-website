"use client";

import { useEffect, useMemo, useRef, useState, useTransition, type ReactNode } from "react";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  CalendarCheck,
  Check,
  ChevronDown,
  ChevronRight,
  CirclePlus,
  CreditCard,
  Flame,
  FileText,
  Grid2X2,
  Hand,
  HelpCircle,
  History,
  Layers,
  Link2,
  Loader2,
  LogOut,
  Mail,
  Menu,
  MessageCircle,
  MessageSquare,
  MessageSquareText,
  MoreHorizontal,
  Phone,
  PhoneMissed,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  Trash2,
  TrendingUp,
  UploadCloud,
  UserRound,
  Users,
  Volume2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import type { EmailChannelUsage, ChannelUsage, CallUsage } from "@/lib/billing";
import {
  createAgent,
  deleteAgent,
  getPendingAgentsStatus,
  provisionNumber,
  testVoice,
  updateAgent,
} from "@/app/actions/agents";
import { provisionSmsNumber } from "@/app/actions/sms";
import type { AgentSmsNumber, AgentWhatsappNumber } from "@/lib/agents";
import {
  deleteKnowledgeBaseSource,
  ingestKnowledgeBaseSource,
  listKnowledgeBaseSources,
  searchKnowledgeBase,
  seedDemoKnowledgeBase,
  type KnowledgeBaseJob,
  type KnowledgeBaseSource,
  type KnowledgeBaseSourceType,
  type KnowledgeSearchChunk,
} from "@/app/actions/knowledge-base";
import { DEMO_KB_TITLE_PREFIX } from "@/lib/demo-knowledge-base";
import type { CallLog, CallChannel } from "@/lib/agents";
import { friendlyOutcome } from "@/lib/agents";
import type { Contact } from "@/lib/contacts";
import type {
  AttentionItem,
  CallReference,
  DashboardInsights,
  InsightsRange,
  LabelCount,
} from "@/lib/insights";
import { OfficeHoursCard } from "./office-hours-card";
import { IntegrationWebhooksCard } from "./integration-webhooks-card";
import { PbxExtensionCard } from "./pbx-extension-card";
import type { IntegrationWebhook } from "@/lib/integration-webhooks";
import { CALLER_INTAKE_PROMPT } from "@/lib/caller-intake";
import { ContactsView } from "./contacts-view";
import { RaiseTicketModal } from "./raise-ticket-modal";
import { SetupWizard, type WizardResult } from "./setup-wizard";
import type { AgentDraft } from "@/app/actions/wizard";
import { impersonateUser, stopImpersonating } from "@/app/actions/admin";
import { OutboundManager } from "@/components/outbound-manager";

type View = "insights" | "assistants" | "detail" | "calls" | "contacts" | "channels";
type DetailTab = "behaviour" | "knowledge" | "routing" | "outbound" | "technical";

// Provider-agnostic call routing. The portal stays the same whichever telco
// stack wins - only `provider` and the per-provider fields differ. Persisted in
// metadata.routing on wisecall_profiles.
export type RoutingProvider = "telnyx" | "mor_openai" | "mor_sip";
export type RoutingStatus = "unprovisioned" | "pending" | "live";
export type AgentRouting = {
  provider: RoutingProvider | null;
  number: string; // E.164 DDI, "" while unprovisioned
  status: RoutingStatus;
  // Telnyx pipeline (DDI → Telnyx → Deepgram/Cartesia)
  telnyxApplicationId?: string;
  // MOR SIP → OpenAI Realtime
  sipRoute?: string;
  openaiVoice?: string;
};

// One routing contact: a person/queue that keywords can route to. A contact can
// take a live transfer (phone), an emailed summary (email), or both. Persisted in
// metadata.routing_contacts; phone contacts are also mirrored to the legacy
// transfer_routes so the existing call pipeline keeps working.
export type RoutingContact = {
  id: string;
  name: string;
  phone: string; // mobile / DDI, E.164
  email: string;
  keywords: string[];
  transfer: boolean; // route the live call to phone
  notify: boolean; // email a summary
  useDefaultEmail: boolean; // when notifying, send to the agent's pooled inbox
};

// Business knowledge captured as friendly, labelled sections instead of one
// freeform box. Stored structured (metadata.knowledge_fields) and also composed
// into the plain `knowledge` text the voice agent reads.
export type KnowledgeFields = {
  openingHours?: string;
  address?: string;
  services?: string;
  pricing?: string;
  payments?: string;
  other?: string;
};

export const knowledgeSections: {
  key: keyof KnowledgeFields;
  label: string;
  placeholder: string;
}[] = [
  {
    key: "openingHours",
    label: "Opening hours",
    placeholder: "Mon–Fri 9am–5:30pm, Sat 9am–1pm, closed Sunday",
  },
  {
    key: "address",
    label: "Address & parking",
    placeholder: "12 High Street, Leeds LS1 4AB. Parking on-site / pay & display nearby.",
  },
  {
    key: "services",
    label: "Services & treatments",
    placeholder: "Check-ups, hygiene, whitening, implants, Invisalign, emergency appointments",
  },
  {
    key: "pricing",
    label: "Pricing",
    placeholder: "New patient exam £xx, hygiene £xx, emergency appointment £xx",
  },
  {
    key: "payments",
    label: "Payments, insurance & registration",
    placeholder: "NHS & private patients welcome. New patients accepted. Card & finance plans taken.",
  },
  {
    key: "other",
    label: "Anything else",
    placeholder: "Any other FAQs the receptionist should be able to answer.",
  },
];

// Turns the labelled sections into the plain knowledge text the agent reads.
export function composeKnowledge(fields: KnowledgeFields): string {
  return knowledgeSections
    .map((section) => {
      const value = (fields[section.key] ?? "").trim();
      return value ? `${section.label}:\n${value}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

function hasKnowledgeFields(fields?: KnowledgeFields): boolean {
  return Boolean(fields && Object.values(fields).some((v) => (v ?? "").trim()));
}

export type Assistant = {
  id: string;
  slug?: string; // used for the website chat widget embed + live-chat backend
  chatAccentColor?: string; // website chat widget theming (metadata.chat_accent_color)
  chatBackgroundColor?: string; // metadata.chat_background_color
  name: string;
  businessName: string;
  industry: string;
  phoneNumber: string;
  status: "Live" | "Setup" | "Review";
  receptionistName: string;
  prompt: string;
  greeting: string;
  voice: string;
  knowledge: string;
  knowledgeFields?: KnowledgeFields;
  website: string;
  timezone: string;
  fallbackEmail: string;
  transferNumber: string;
  defaultEmail: string; // pooled inbox used when a contact opts for "send to default"
  contacts: RoutingContact[];
  calls: number;
  cost: string;
  routing: AgentRouting;
  officeHours?: OfficeHours;
  outOfHoursMessage?: string;
  emailAddress?: string; // forwarding address for the email channel
  emailChannelEnabled?: boolean;
  integrationWebhooks?: IntegrationWebhook[];
  ownerEmail?: string; // admin view only - which customer owns this agent
  ownerId?: string; // admin view only - owner's auth user id (for "log in as")
};

// Per-day office hours. Only OPEN days are present; a missing day = closed.
// Keys are mon,tue,wed,thu,fri,sat,sun. The runtime reads metadata.office_hours
// to switch the agent into after-hours message-taking mode when closed.
export type OfficeHours = Record<string, { open: string; close: string }>;

// The voices we offer today - Cartesia's latest model. Labels are what the
// customer sees; the real Cartesia voice ids are mapped server-side (env) so
// they never reach the browser.
export const cartesiaVoices: { id: string; label: string; blurb: string }[] = [
  { id: "Gemma", label: "Gemma", blurb: "Warm British female" },
  { id: "Hugo", label: "Hugo", blurb: "Friendly British male" },
  { id: "Archie", label: "Archie", blurb: "Bright, upbeat male" },
  { id: "Victoria", label: "Victoria", blurb: "Polished, professional female" },
  { id: "Benedict", label: "Benedict", blurb: "Calm, reassuring male" },
  { id: "Julia", label: "Julia", blurb: "Clear, approachable female" },
];

export const demoAssistants: Assistant[] = [
  {
    id: "sophie-dental",
    name: "Sophie",
    businessName: "RinseDental",
    industry: "Dental",
    phoneNumber: "+44 113 522 1606",
    status: "Live",
    receptionistName: "Sophie",
    prompt:
      "Answer as Sophie from RinseDental. Help with new patient enquiries, appointments, emergency questions and cancellations. Ask for name, phone number and preferred appointment time before escalating.",
    greeting: "Hello, thanks for calling RinseDental, you're through to Sophie. How can I help you today?",
    voice: "Gemma",
    knowledge:
      "Opening hours: Mon-Fri 8:30am-5:30pm, Sat 9am-1pm. We're a private and NHS dental practice in Leeds. New patients welcome. We offer check-ups, hygiene, whitening, implants and emergency appointments. Parking available on-site.",
    website: "https://rinsedental.example",
    timezone: "Europe/London",
    fallbackEmail: "reception@rinsedental.example",
    transferNumber: "+44 113 522 1606",
    defaultEmail: "info@rinsedental.example",
    contacts: [
      {
        id: "emergencies",
        name: "On-call dentist",
        phone: "+44 113 522 1606",
        email: "",
        keywords: ["emergency", "severe pain", "swelling", "knocked out", "bleeding"],
        transfer: true,
        notify: false,
        useDefaultEmail: false,
      },
      {
        id: "reception",
        name: "Reception",
        phone: "",
        email: "reception@rinsedental.example",
        keywords: ["appointment", "booking", "cancel", "reschedule"],
        transfer: false,
        notify: true,
        useDefaultEmail: false,
      },
    ],
    calls: 14,
    cost: "GBP 0.21",
    routing: { provider: "telnyx", number: "+44 113 522 1606", status: "live" },
  },
  {
    id: "maya-property",
    name: "Maya",
    businessName: "The Home Cloud",
    industry: "Property",
    phoneNumber: "+44 113 522 1666",
    status: "Live",
    receptionistName: "Maya",
    prompt:
      "Answer as Maya from The Home Cloud. Identify whether the caller is a tenant, landlord, buyer or seller. Capture valuation leads and maintenance details clearly.",
    greeting: "Hi, you've reached The Home Cloud, this is Maya. How can I help?",
    voice: "Victoria",
    knowledge:
      "We're an estate and lettings agency. We handle sales, rentals, valuations and property management. Free valuations can be booked over the phone. Office hours Mon-Fri 9am-6pm, Sat 10am-2pm.",
    website: "https://thehomecloud.example",
    timezone: "Europe/London",
    fallbackEmail: "hello@thehomecloud.example",
    transferNumber: "+44 113 522 1666",
    defaultEmail: "info@thehomecloud.example",
    contacts: [
      {
        id: "maintenance",
        name: "Maintenance team",
        phone: "+44 113 522 1666",
        email: "repairs@thehomecloud.example",
        keywords: ["maintenance", "repair", "leak", "boiler", "locked out"],
        transfer: true,
        notify: true,
        useDefaultEmail: false,
      },
    ],
    calls: 11,
    cost: "GBP 0.18",
    routing: { provider: "telnyx", number: "+44 113 522 1666", status: "live" },
  },
  {
    id: "leo-legal",
    name: "Leo",
    businessName: "Northline Legal",
    industry: "Legal",
    phoneNumber: "Number pending",
    status: "Setup",
    receptionistName: "Leo",
    prompt:
      "Answer as Leo from Northline Legal. Capture the matter type, urgency, name and contact details. Do not give legal advice.",
    greeting: "Good afternoon, Northline Legal, Leo speaking. How can I help you today?",
    voice: "Benedict",
    knowledge:
      "We're a law firm covering conveyancing, family law, wills & probate and dispute resolution. We can't give legal advice over the phone but can book an initial consultation. Office hours Mon-Fri 9am-5:30pm.",
    website: "https://northlinelegal.example",
    timezone: "Europe/London",
    fallbackEmail: "intake@northlinelegal.example",
    transferNumber: "+44 113 522 2277",
    defaultEmail: "info@northlinelegal.example",
    contacts: [
      {
        id: "intake",
        name: "Intake team",
        phone: "",
        email: "",
        keywords: ["new matter", "enquiry", "consultation"],
        transfer: false,
        notify: true,
        useDefaultEmail: true,
      },
    ],
    calls: 0,
    cost: "GBP 0.00",
    routing: { provider: null, number: "", status: "unprovisioned" },
  },
];

// Only the sections that actually work today. We'll add Knowledge Base, Phone
// Numbers, Payments etc. back as each one is wired up.
// A small, lively version of the login-page owl for the "Need setup help?" card.
// Idle-bobs, blinks on a random cadence, and peeks/wiggles on hover.
function SupportOwl() {
  const [blinking, setBlinking] = useState(false);
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const loop = () => {
      const delay = 2500 + Math.random() * 3500;
      t = setTimeout(() => {
        setBlinking(true);
        setTimeout(() => {
          setBlinking(false);
          loop();
        }, 160);
      }, delay);
    };
    loop();
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="support-owl mx-auto mb-3 flex h-14 w-14 items-center justify-center">
      <svg viewBox="0 0 120 140" width="54" height="63" fill="none" xmlns="http://www.w3.org/2000/svg">
        {/* wings (flap on hover) */}
        <g className="owl-wing-l">
          <ellipse cx="26" cy="108" rx="14" ry="26" fill="#1f3535" transform="rotate(-10 26 108)" />
          <ellipse cx="24" cy="106" rx="9" ry="19" fill="#2a4545" transform="rotate(-10 24 106)" />
        </g>
        <g className="owl-wing-r">
          <ellipse cx="94" cy="108" rx="14" ry="26" fill="#1f3535" transform="rotate(10 94 108)" />
          <ellipse cx="96" cy="106" rx="9" ry="19" fill="#2a4545" transform="rotate(10 96 106)" />
        </g>
        {/* body */}
        <ellipse cx="60" cy="104" rx="36" ry="38" fill="#1f3535" />
        <ellipse cx="60" cy="112" rx="26" ry="28" fill="#2a4545" />
        {/* ear tufts */}
        <ellipse cx="42" cy="56" rx="7" ry="12" fill="#1f3535" transform="rotate(-16 42 56)" />
        <ellipse cx="78" cy="56" rx="7" ry="12" fill="#1f3535" transform="rotate(16 78 56)" />
        {/* head */}
        <circle cx="60" cy="72" r="32" fill="#1f3535" />
        <circle cx="60" cy="72" r="28" fill="#2a4545" />
        <circle cx="46" cy="70" r="12" fill="#172929" />
        <circle cx="74" cy="70" r="12" fill="#172929" />
        <circle cx="46" cy="70" r="10" fill="#ffffff" />
        <circle cx="74" cy="70" r="10" fill="#ffffff" />
        <circle cx="46" cy="70" r="6" fill="#7de8eb" />
        <circle cx="74" cy="70" r="6" fill="#7de8eb" />
        {!blinking ? (
          <>
            <circle cx="46" cy="70" r="3.2" fill="#172929" />
            <circle cx="74" cy="70" r="3.2" fill="#172929" />
            <circle cx="47.5" cy="67.8" r="1.1" fill="white" opacity="0.85" />
            <circle cx="75.5" cy="67.8" r="1.1" fill="white" opacity="0.85" />
          </>
        ) : (
          <>
            <ellipse cx="46" cy="70" rx="10" ry="1.5" fill="#2a4545" />
            <ellipse cx="74" cy="70" rx="10" ry="1.5" fill="#2a4545" />
          </>
        )}
        {/* beak */}
        <path d="M60 79 L56 86 L64 86 Z" fill="#7de8eb" stroke="#7de8eb" strokeWidth="3.5" strokeLinejoin="round" opacity="0.9" />
        <path d="M60 83.5 L56 86 L64 86 Z" fill="#4db8bb" stroke="#4db8bb" strokeWidth="3.5" strokeLinejoin="round" />
      </svg>
      <style>{`
        @keyframes owlBob { 0%,100% { transform: translateY(0) } 50% { transform: translateY(-3px) } }
        @keyframes owlFlapL { 0%,100% { transform: rotate(0deg) } 50% { transform: rotate(-14deg) } }
        @keyframes owlFlapR { 0%,100% { transform: rotate(0deg) } 50% { transform: rotate(14deg) } }
        .support-owl svg { animation: owlBob 3s ease-in-out infinite; transition: transform .3s cubic-bezier(0.34,1.56,0.64,1); cursor: pointer; }
        .support-owl:hover svg { transform: scale(1.1) rotate(-4deg); }
        .support-owl .owl-wing-l { transform-origin: 26px 90px; }
        .support-owl .owl-wing-r { transform-origin: 94px 90px; }
        .support-owl:hover .owl-wing-l { animation: owlFlapL .35s ease-in-out infinite; }
        .support-owl:hover .owl-wing-r { animation: owlFlapR .35s ease-in-out infinite; }
      `}</style>
    </div>
  );
}

// The Channels hub: one place to see every way an agent can talk to customers.
// Voice, email, WhatsApp and live chat are bundled; the plan controls usage.
// A combined colour input: a swatch (native colour picker) + a hex text field.
function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="flex items-center gap-2 text-xs font-bold text-[#111716]">
      <span className="w-20 text-[#66716e]">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-9 cursor-pointer rounded border border-black/10 bg-white p-0.5"
        aria-label={`${label} colour`}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 rounded-lg border border-black/10 bg-white px-2 py-1.5 font-mono text-xs text-[#111716] focus:outline-none focus:ring-2 focus:ring-[#148b8e]/40"
      />
    </label>
  );
}

// One agent's website-widget: embed snippet (copy), brand colours (save) + a
// live preview of the bubble so customers can match it to their site.
function WidgetEmbedRow({ assistant }: { assistant: Assistant }) {
  const slug = assistant.slug!;
  const [copied, setCopied] = useState(false);
  const [accent, setAccent] = useState(assistant.chatAccentColor || "#7de8eb");
  const [bg, setBg] = useState(assistant.chatBackgroundColor || "#172929");
  const [pending, start] = useTransition();
  const [saved, setSaved] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const embed = `<script src="https://wisecall.io/widget.js" data-agent="${slug}" async></script>`;
  const dirty =
    accent !== (assistant.chatAccentColor || "#7de8eb") ||
    bg !== (assistant.chatBackgroundColor || "#172929");

  function copy() {
    navigator.clipboard?.writeText(embed).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1600);
      },
      () => {},
    );
  }
  function saveColors() {
    setErr(null);
    setSaved(false);
    start(async () => {
      const r = await updateAgent(assistant.id, { chatAccentColor: accent, chatBackgroundColor: bg });
      if (r.ok) setSaved(true);
      else setErr(r.error ?? "Couldn't save.");
    });
  }

  return (
    <div className="rounded-xl border border-black/10 bg-[#f8fafa] p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-sm font-bold text-[#111716]">{assistant.name}</p>
        <a
          href={`https://wisecall.io/widget-demo?agent=${encodeURIComponent(slug)}`}
          target="_blank"
          rel="noopener"
          className="flex-shrink-0 text-xs font-bold text-[#148b8e] hover:underline"
        >
          Preview
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-black/10 bg-[#0e1b1b] px-3 py-2 text-xs font-semibold text-[#7de8eb]">
          {embed}
        </code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-9 items-center rounded-lg bg-[#111716] px-4 text-sm font-black text-white transition hover:bg-[#263130]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Brand colours + live preview */}
      <div className="mt-3 flex flex-wrap items-start gap-4 border-t border-black/5 pt-3">
        <div className="space-y-2">
          <p className="text-xs font-black uppercase tracking-wide text-[#9aa5a2]">Match your brand</p>
          <ColorField label="Accent" value={accent} onChange={setAccent} />
          <ColorField label="Header" value={bg} onChange={setBg} />
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={saveColors}
              disabled={pending || !dirty}
              className="inline-flex h-8 items-center rounded-lg bg-[#111716] px-4 text-xs font-black text-white transition hover:bg-[#263130] disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save colours"}
            </button>
            {saved && !dirty && <span className="text-xs font-medium text-[#148b8e]">Saved</span>}
            {err && <span className="text-xs font-medium text-red-600">{err}</span>}
          </div>
        </div>

        {/* Mini live preview of the widget */}
        <div className="ml-auto">
          <div className="w-[150px] overflow-hidden rounded-xl border border-black/10 bg-white shadow-sm">
            <div className="flex items-center gap-2 px-3 py-2" style={{ background: bg }}>
              <span
                className="flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-black"
                style={{ background: accent, color: "#0e1b1b" }}
              >
                {(assistant.name || "A").charAt(0).toUpperCase()}
              </span>
              <span className="truncate text-[11px] font-bold text-white">{assistant.name}</span>
            </div>
            <div className="space-y-1.5 bg-[#f6f8f8] p-2">
              <div className="max-w-[80%] rounded-lg rounded-bl-sm bg-white px-2 py-1 text-[10px] text-[#111716] shadow-sm">
                Hi! How can I help?
              </div>
              <div
                className="ml-auto max-w-[80%] rounded-lg rounded-br-sm px-2 py-1 text-[10px]"
                style={{ background: accent, color: "#0e1b1b" }}
              >
                Do you do free quotes?
              </div>
            </div>
          </div>
          <p className="mt-1 text-center text-[10px] text-[#9aa5a2]">Live preview</p>
        </div>
      </div>
    </div>
  );
}

// "Email" channel - expandable to reveal each agent's forwarding address.
function EmailChannel({
  assistants,
  usage,
}: {
  assistants: Assistant[];
  usage?: EmailChannelUsage;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-[14px] border border-black/10 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-4 px-5 py-4 text-left"
      >
        <div className="mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#eef2fb] text-[#3b5bb5]">
          <Mail className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-black text-[#111716]">Email</p>
          <p className="text-sm text-[#66716e]">
            Forward your inbox and the same agent replies to emails and logs every contact.
          </p>
        </div>
        {usage?.enabled ? (
          <div className="self-center">
            <ChannelUsageBadge
              used={usage.used}
              allowance={usage.allowance}
              overage={usage.overage}
              unit="replies"
            />
          </div>
        ) : (
          <span className="self-center flex-shrink-0 rounded-full bg-[#f2f4f3] px-3 py-1 text-xs font-bold text-[#7a8582]">
            Start a plan to use
          </span>
        )}
        <ChevronDown
          className={`self-center h-5 w-5 flex-shrink-0 text-[#9aa5a2] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-black/5 px-5 pb-5 pt-4">
          <p className="mb-1 text-xs text-[#66716e]">
            Set up a forwarding rule in your email provider (Gmail, Outlook, etc.) to the address
            below. The agent will reply using the same knowledge as your phone line.
          </p>
          {assistants.length ? (
            assistants.map((a) => <AgentEmailRow key={a.id} assistant={a} />)
          ) : (
            <p className="text-sm text-[#66716e]">Create an agent to get its email forwarding address.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function AgentEmailRow({ assistant }: { assistant: Assistant }) {
  const [copied, setCopied] = useState(false);
  const address = assistant.emailAddress ?? "";
  function copy() {
    navigator.clipboard?.writeText(address).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => {},
    );
  }
  return (
    <div className="rounded-xl border border-black/10 bg-[#f8fafa] p-3">
      <p className="mb-2 truncate text-sm font-bold text-[#111716]">{assistant.name}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="flex-1 truncate rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-[#111716]">
          {address}
        </code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-9 items-center rounded-lg bg-[#111716] px-4 text-sm font-black text-white transition hover:bg-[#263130]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// "Website chat" channel - expandable to reveal each agent's embed snippet.
function WebsiteChatChannel({ assistants, usage }: { assistants: Assistant[]; usage?: ChannelUsage }) {
  const [open, setOpen] = useState(false);
  const withSlug = assistants.filter((a) => a.slug);
  return (
    <div className="rounded-[14px] border border-black/10 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-4 px-5 py-4 text-left"
      >
        <div className="mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#eefbfb] text-[#148b8e]">
          <MessageSquareText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-black text-[#111716]">Website chat</p>
          <p className="text-sm text-[#66716e]">
            Put your agent on your site as a chat bubble - one line of code.
          </p>
        </div>
        {usage?.enabled ? (
          <div className="self-center">
            <ChannelUsageBadge
              used={usage.used}
              allowance={usage.allowance}
              overage={usage.overage}
              unit="chats"
            />
          </div>
        ) : (
          <span className="self-center flex-shrink-0 rounded-full bg-[#eafaf1] px-3 py-1 text-xs font-bold text-[#14823f]">
            Included
          </span>
        )}
        <ChevronDown
          className={`self-center h-5 w-5 flex-shrink-0 text-[#9aa5a2] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-black/5 px-5 pb-5 pt-4">
          <p className="mb-1 text-xs text-[#66716e]">
            Paste this just before <code className="rounded bg-[#f2f4f3] px-1">&lt;/body&gt;</code> on
            your website. Works on WordPress, Wix, Squarespace or any custom site.
          </p>
          {withSlug.length ? (
            withSlug.map((a) => <WidgetEmbedRow key={a.id} assistant={a} />)
          ) : (
            <p className="text-sm text-[#66716e]">Create an agent to get its website embed code.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

type WhatsAppSetupPath = "included" | "own";

const whatsappSetupOptions: {
  id: WhatsAppSetupPath;
  label: string;
  badge: string;
  summary: string;
  points: string[];
}[] = [
  {
    id: "included",
    label: "Get a new WiseCall number",
    badge: "Recommended",
    summary: "Fastest route for most businesses. We provide the WhatsApp-ready number and connect it to your agent.",
    points: [
      "Number included with your plan",
      "No migration from an existing WhatsApp app",
      "WiseCall maps the number to your selected agent",
    ],
  },
  {
    id: "own",
    label: "Bring my own number",
    badge: "Migration",
    summary: "Use an existing business number after we confirm it can be moved safely to the WhatsApp Business Platform.",
    points: [
      "Best for established customer-facing numbers",
      "May require removing the number from the WhatsApp mobile app",
      "We confirm the migration route before anything changes",
    ],
  },
];

function buildWhatsAppSetupHref(path: WhatsAppSetupPath, assistant: Assistant | undefined, userEmail?: string) {
  const optionLabel =
    path === "included" ? "Get a new WiseCall WhatsApp number" : "Bring my own WhatsApp number";
  const subject =
    path === "included"
      ? "Set up my included WiseCall WhatsApp number"
      : "Bring my own WhatsApp number to WiseCall";
  const body = [
    "Please start WhatsApp setup for my WiseCall agent.",
    "",
    `Option: ${optionLabel}`,
    userEmail ? `Customer email: ${userEmail}` : "",
    assistant ? `Agent: ${assistant.name}` : "",
    assistant ? `Business: ${assistant.businessName}` : "",
    assistant?.id ? `Agent ID: ${assistant.id}` : "",
    assistant?.slug ? `Agent slug: ${assistant.slug}` : "",
    "",
    path === "own"
      ? "Existing WhatsApp number to connect: [please enter number here]"
      : "Please provide a new WiseCall WhatsApp-ready number for this agent.",
    "",
    "I understand this uses Meta WhatsApp Business setup and I may need admin access to my Meta Business Portfolio.",
  ]
    .filter(Boolean)
    .join("\n");

  return `mailto:info@wisecall.io?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
}

function WhatsAppChannel({
  assistants,
  userEmail,
  usage,
}: {
  assistants: Assistant[];
  userEmail?: string;
  usage?: ChannelUsage;
}) {
  const [open, setOpen] = useState(true);
  const [setupPath, setSetupPath] = useState<WhatsAppSetupPath>("included");
  const [selectedAssistantId, setSelectedAssistantId] = useState(assistants[0]?.id ?? "");
  const selectedAssistant = assistants.find((assistant) => assistant.id === selectedAssistantId) ?? assistants[0];

  return (
    <div className="rounded-[14px] border border-black/10 bg-white">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-4 px-5 py-4 text-left"
      >
        <div className="mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#eafaf1] text-[#14823f]">
          <MessageSquareText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-black text-[#111716]">WhatsApp</p>
          <p className="text-sm text-[#66716e]">
            Add WhatsApp to the same AI agent that handles calls, email and live chat.
          </p>
        </div>
        <div className="self-center flex flex-shrink-0 items-center gap-3">
          {usage?.enabled && usage.allowance > 0 ? (
            <span className="text-xs font-semibold text-[#66716e]">
              {usage.used.toLocaleString()}/{usage.allowance.toLocaleString()} messages
              {usage.overage > 0 ? ` · ${usage.overage.toLocaleString()} over` : ""}
            </span>
          ) : null}
          <span className="rounded-full bg-[#fff7df] px-3 py-1 text-xs font-bold text-[#9a6a00]">
            Setup required
          </span>
        </div>
        <ChevronDown
          className={`self-center h-5 w-5 flex-shrink-0 text-[#9aa5a2] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="space-y-4 border-t border-black/5 px-5 pb-5 pt-4">
          <p className="text-sm leading-relaxed text-[#66716e]">
            Inbound messages route to the same AI and save to Contacts, just like calls and email. Pick
            a setup route and we&apos;ll handle the Meta connection and webhook.
          </p>

          {assistants.length > 1 ? (
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-[#7a8582]">Connect to agent</span>
              <select
                value={selectedAssistant?.id ?? ""}
                onChange={(event) => setSelectedAssistantId(event.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-[#111716] outline-none focus:border-[#148b8e] focus:ring-2 focus:ring-[#7de8eb]/40"
              >
                {assistants.map((assistant) => (
                  <option key={assistant.id} value={assistant.id}>
                    {assistant.name} - {assistant.businessName}
                  </option>
                ))}
              </select>
            </label>
          ) : null}

          <div className="space-y-2">
            {whatsappSetupOptions.map((option) => {
              const selected = setupPath === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  onClick={() => setSetupPath(option.id)}
                  className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left transition ${
                    selected ? "border-[#148b8e] bg-[#effcfc]" : "border-black/10 bg-white hover:border-[#7de8eb]"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${
                      selected ? "border-[#148b8e] bg-[#148b8e] text-white" : "border-black/20 text-transparent"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold text-[#111716]">
                      {option.label}
                      <span className="ml-2 text-xs font-semibold text-[#7a8582]">{option.badge}</span>
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-[#66716e]">{option.summary}</p>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-md text-xs leading-relaxed text-[#7a8582]">
              Needs Meta Business admin access.{" "}
              {setupPath === "own"
                ? "Don't move a live number yet - we check it first."
                : "We complete the Meta checks for you."}
            </p>
            <a
              href={buildWhatsAppSetupHref(setupPath, selectedAssistant, userEmail)}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-[#111716] px-4 py-2.5 text-sm font-black text-white hover:bg-[#1f3535]"
            >
              Request setup
              <ChevronRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      ) : null}
    </div>
  );
}

// A consistent "used / allowance" badge for the bundled channels, so every plan
// reads as fully inclusive with a clear monthly limit. Shows an "over allowance"
// note when usage has run past the included amount.
function ChannelUsageBadge({
  used,
  allowance,
  overage,
  unit,
}: {
  used: number;
  allowance: number;
  overage?: number;
  unit: string;
}) {
  return (
    <div className="flex flex-shrink-0 items-center gap-3">
      <span className="text-xs font-semibold text-[#66716e]">
        {used.toLocaleString()}/{allowance.toLocaleString()} {unit}
        {overage && overage > 0 ? ` · ${overage.toLocaleString()} over` : ""}
      </span>
      <span className="rounded-full bg-[#eafaf1] px-3 py-1 text-xs font-bold text-[#14823f]">
        Included
      </span>
    </div>
  );
}

function AgentSmsRow({
  assistant,
  smsNumber,
  isProvisioning,
  onProvision,
}: {
  assistant: Assistant;
  smsNumber?: string;
  isProvisioning: boolean;
  onProvision: () => void;
}) {
  const [copied, setCopied] = useState(false);
  function copy() {
    if (!smsNumber) return;
    navigator.clipboard?.writeText(smsNumber).then(
      () => { setCopied(true); setTimeout(() => setCopied(false), 1500); },
      () => {},
    );
  }
  return (
    <div className="rounded-xl border border-black/10 bg-[#f8fafa] p-3">
      <p className="mb-2 truncate text-sm font-bold text-[#111716]">{assistant.name}</p>
      {smsNumber ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="flex-1 truncate rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-[#111716]">
            {smsNumber}
          </code>
          <button
            type="button"
            onClick={copy}
            className="inline-flex h-9 items-center rounded-lg bg-[#111716] px-4 text-sm font-black text-white transition hover:bg-[#263130]"
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
      ) : (
        <button
          type="button"
          disabled={isProvisioning}
          onClick={onProvision}
          className="inline-flex items-center gap-2 rounded-lg bg-[#7c3aed] px-4 py-2 text-sm font-black text-white transition hover:bg-[#6d28d9] disabled:opacity-60"
        >
          {isProvisioning ? "Getting number…" : "Get SMS number"}
          {!isProvisioning && <ChevronRight className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

function AgentPhoneRow({
  assistant,
  isProvisioning,
  onProvision,
}: {
  assistant: Assistant;
  isProvisioning: boolean;
  onProvision: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const routing = assistant.routing;
  const live = routing.status === "live" && Boolean(routing.number);
  const pending = routing.status === "pending";

  function copy() {
    if (!routing.number) return;
    navigator.clipboard?.writeText(routing.number).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }

  return (
    <div className="rounded-xl border border-black/10 bg-[#f8fafa] p-3">
      <p className="mb-2 truncate text-sm font-bold text-[#111716]">{assistant.name}</p>
      {live ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-black/10 bg-white px-3 py-2 text-sm font-semibold text-[#111716]">
            {routing.number}
          </code>
          <button
            type="button"
            onClick={copy}
            className="inline-flex h-9 items-center rounded-lg bg-[#111716] px-4 text-sm font-black text-white transition hover:bg-[#263130]"
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <a
            href={`tel:${routing.number.replace(/[^\d+]/g, "")}`}
            className="inline-flex h-9 items-center gap-2 rounded-lg bg-[#7de8eb] px-4 text-sm font-black text-[#0c1717] transition hover:opacity-90"
          >
            <Phone className="h-4 w-4" />
            Call to test
          </a>
        </div>
      ) : pending ? (
        <div className="rounded-lg border border-[#f3dfae] bg-[#fff8eb] px-3 py-2 text-sm text-[#8a5a00]">
          Setting up your phone number - usually ready within 5 minutes. Refresh to check.
        </div>
      ) : (
        <button
          type="button"
          disabled={isProvisioning}
          onClick={onProvision}
          className="inline-flex items-center gap-2 rounded-lg bg-[#111716] px-4 py-2 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
        >
          {isProvisioning ? "Assigning…" : "Assign number"}
          {!isProvisioning && <ChevronRight className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

function PhoneChannel({
  assistants,
  usage,
  onRoutingUpdate,
}: {
  assistants: Assistant[];
  usage?: CallUsage;
  onRoutingUpdate: (profileId: string, routing: AgentRouting) => void;
}) {
  const [open, setOpen] = useState(false);
  const [provisioningId, setProvisioningId] = useState<string | null>(null);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  async function handleProvision(profileId: string) {
    setProvisioningId(profileId);
    setProvisionError(null);
    const result = await provisionNumber(profileId);
    if (result.ok && result.routing) {
      onRoutingUpdate(profileId, result.routing);
    } else {
      setProvisionError(result.error ?? "Could not assign a number yet.");
    }
    setProvisioningId(null);
  }

  return (
    <div className="rounded-[14px] border border-black/10 bg-white">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-4 px-5 py-4 text-left"
      >
        <div className="mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#eefbfb] text-[#148b8e]">
          <Phone className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-black text-[#111716]">Phone</p>
          <p className="text-sm text-[#66716e]">Your AI receptionist answers and routes calls.</p>
        </div>
        {usage ? (
          <div className="self-center">
            <ChannelUsageBadge
              used={usage.used}
              allowance={usage.allowance}
              overage={usage.overage}
              unit="calls"
            />
          </div>
        ) : (
          <span className="self-center flex-shrink-0 rounded-full bg-[#eafaf1] px-3 py-1 text-xs font-bold text-[#14823f]">
            Included
          </span>
        )}
        <ChevronDown
          className={`self-center h-5 w-5 flex-shrink-0 text-[#9aa5a2] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-black/5 px-5 pb-5 pt-4">
          <p className="mb-1 text-xs text-[#66716e]">
            Each agent gets its own UK phone number. Customers call in and the AI answers -
            every conversation is saved to Call History and Contacts.
          </p>
          {provisionError ? (
            <p className="rounded-xl bg-[#fff0f0] px-4 py-2 text-sm text-[#c0392b]">{provisionError}</p>
          ) : null}
          {assistants.length ? (
            assistants.map((assistant) => (
              <AgentPhoneRow
                key={assistant.id}
                assistant={assistant}
                isProvisioning={provisioningId === assistant.id}
                onProvision={() => void handleProvision(assistant.id)}
              />
            ))
          ) : (
            <p className="text-sm text-[#66716e]">Create an agent to get a phone number.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SMSChannel({
  assistants,
  usage,
  initialSmsNumbers,
}: {
  assistants: Assistant[];
  usage?: ChannelUsage;
  initialSmsNumbers: AgentSmsNumber[];
}) {
  const [open, setOpen] = useState(false);
  const [smsNumbers, setSmsNumbers] = useState(initialSmsNumbers);
  const [provisioningId, setProvisioningId] = useState<string | null>(null);
  const [provisionError, setProvisionError] = useState<string | null>(null);

  async function handleProvision(profileId: string) {
    setProvisioningId(profileId);
    setProvisionError(null);
    const result = await provisionSmsNumber(profileId);
    if (result.ok) {
      setSmsNumbers((prev) => [
        ...prev.filter((n) => n.profileId !== profileId),
        { profileId, smsNumber: result.smsNumber },
      ]);
    } else {
      setProvisionError(result.error);
    }
    setProvisioningId(null);
  }

  return (
    <div className="rounded-[14px] border border-black/10 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-4 px-5 py-4 text-left"
      >
        <div className="mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#f5f0ff] text-[#7c3aed]">
          <MessageSquare className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-black text-[#111716]">SMS</p>
          <p className="text-sm text-[#66716e]">
            Reply to text messages using the same AI agent that handles calls, email and chat.
          </p>
        </div>
        {usage?.enabled ? (
          <div className="self-center">
            <ChannelUsageBadge
              used={usage.used}
              allowance={usage.allowance}
              overage={usage.overage}
              unit="messages"
            />
          </div>
        ) : (
          <span className="self-center flex-shrink-0 rounded-full bg-[#eafaf1] px-3 py-1 text-xs font-bold text-[#14823f]">
            Included
          </span>
        )}
        <ChevronDown
          className={`self-center h-5 w-5 flex-shrink-0 text-[#9aa5a2] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-black/5 px-5 pb-5 pt-4">
          <p className="mb-1 text-xs text-[#66716e]">
            Each agent gets its own UK mobile number. Customers text in and the AI replies instantly -
            every conversation is saved to Contacts alongside calls and emails.
          </p>
          {provisionError ? (
            <p className="rounded-xl bg-[#fff0f0] px-4 py-2 text-sm text-[#c0392b]">{provisionError}</p>
          ) : null}
          {assistants.length ? (
            assistants.map((a) => {
              const assigned = smsNumbers.find((n) => n.profileId === a.id);
              return (
                <AgentSmsRow
                  key={a.id}
                  assistant={a}
                  smsNumber={assigned?.smsNumber}
                  isProvisioning={provisioningId === a.id}
                  onProvision={() => handleProvision(a.id)}
                />
              );
            })
          ) : (
            <p className="text-sm text-[#66716e]">Create an agent to get an SMS number.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function ChannelsHub({
  emailChannel,
  callUsage,
  whatsappChannel,
  livechatChannel,
  smsChannel,
  smsNumbers,
  assistants,
  userEmail,
  onRoutingUpdate,
}: {
  emailChannel?: EmailChannelUsage;
  callUsage?: CallUsage;
  whatsappChannel?: ChannelUsage;
  livechatChannel?: ChannelUsage;
  smsChannel?: ChannelUsage;
  smsNumbers: AgentSmsNumber[];
  assistants: Assistant[];
  userEmail?: string;
  onRoutingUpdate: (profileId: string, routing: AgentRouting) => void;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-[#111716]">Channels</h1>
        <p className="mt-1 text-sm text-[#66716e]">
          One agent, every channel. Add a way for customers to reach you and the same AI handles it -
          logging every conversation to Contacts.
        </p>
      </div>

      <div className="space-y-3">
        <PhoneChannel assistants={assistants} usage={callUsage} onRoutingUpdate={onRoutingUpdate} />

        {/* Website chat - included, expandable to per-agent embed codes */}
        <WebsiteChatChannel assistants={assistants} usage={livechatChannel} />

        {/* Email - included in every plan; expandable to per-agent forwarding addresses */}
        <EmailChannel assistants={assistants} usage={emailChannel} />

        {/* WhatsApp - included in every plan; number connected during setup */}
        <WhatsAppChannel assistants={assistants} userEmail={userEmail} usage={whatsappChannel} />

        {/* SMS - included in every plan; UK number auto-provisioned via Vonage */}
        <SMSChannel assistants={assistants} usage={smsChannel} initialSmsNumbers={smsNumbers} />

      </div>
    </div>
  );
}

const navItems: { view: View; label: string; icon: LucideIcon }[] = [
  { view: "insights", label: "AI Insights", icon: Sparkles },
  { view: "assistants", label: "Assistants", icon: Bot },
  { view: "calls", label: "Call History", icon: History },
  { view: "contacts", label: "Contacts", icon: Users },
  { view: "channels", label: "Channels", icon: Layers },
];

// Agent templates. For now there's one - a general Receptionist. Future
// templates (Dental, Property, Legal, integration-specific) slot in here and
// the create flow picks them up automatically.
export type AgentTemplate = {
  id: string;
  label: string;
  description: string;
  industry: string;
  available: boolean;
  buildPrompt: (business: string, receptionist: string) => string;
  buildGreeting: (business: string, receptionist: string) => string;
  // Optional starter content seeded onto the agent at creation time.
  defaultKnowledgeFields?: KnowledgeFields;
  defaultContacts?: () => RoutingContact[];
};

export const agentTemplates: AgentTemplate[] = [
  {
    id: "receptionist",
    label: "Receptionist",
    description: "Friendly general receptionist - answers FAQs, takes messages and transfers urgent calls.",
    industry: "General",
    available: true,
    buildPrompt: (business, receptionist) => {
      const who = receptionist || "the receptionist";
      const biz = business || "the business";
      return [
        `You are ${who}, the friendly virtual receptionist for ${biz}.`,
        "",
        "Greet every caller warmly and professionally, and find out how you can help.",
        "",
        "You can:",
        `- Answer common questions about ${biz} (opening hours, location, services and pricing).`,
        "- Take a message - always capture the caller's name, phone number and the reason for their call.",
        "- Note appointment or callback requests and pass them to the team.",
        "- Transfer urgent calls to a team member when needed.",
        "",
        CALLER_INTAKE_PROMPT,
        "",
        "Always be polite, concise and reassuring. If you don't know an answer, take a message and let the caller know someone will get back to them shortly.",
      ].join("\n");
    },
    buildGreeting: (business, receptionist) => {
      const who = receptionist || "the receptionist";
      const biz = business || "the business";
      return `Hi, thanks for calling ${biz}, you're through to ${who}. How can I help you today?`;
    },
  },
  {
    id: "dentally",
    label: "Dental practice (Dentally)",
    description:
      "Dental receptionist with Dentally booking built in - looks up patients, registers new ones, books, reschedules and cancels appointments, and handles emergencies.",
    industry: "Dental",
    available: true,
    buildPrompt: (business, receptionist) => {
      const who = receptionist || "the receptionist";
      const biz = business || "the practice";
      return [
        `You are ${who}, a warm, professional AI receptionist for ${biz}, a dental practice. Your job is to help patients book, reschedule, or cancel appointments and answer questions about the practice.`,
        "",
        "OPENING HOURS: [Add the practice opening hours here]",
        "PRACTITIONER(S): [Add the dentist / hygienist names here]",
        "",
        "CALL FLOW",
        "",
        "Step 1 - Identify the caller",
        "Use the resolve_patient result from the start of the call.",
        "- If a single patient was found: greet by first name.",
        "- If disambiguation_required: ask for date of birth, then call resolve_patient again with phone + date_of_birth.",
        "- If phone + DOB still does not match a single record: ask for first and last name, then call resolve_patient again with phone + firstname + lastname + date_of_birth.",
        "- If no record is found and the caller confirms they are a new patient: collect firstname, lastname, date_of_birth and title, then call resolve_patient again with create_if_not_found=true.",
        "",
        "Step 2 - Understand what they need",
        '- "book" / "make an appointment" -> booking flow',
        '- "reschedule" / "change" -> reschedule flow',
        '- "cancel" -> cancellation flow',
        "- a question about the practice (hours, location, treatments, pricing, NHS vs private) -> answer it, then ask if they would like to book.",
        "",
        "Step 3a - Booking",
        "1. Call get_appointment_reasons and offer the options.",
        "2. Ask what date and time suits them.",
        "3. Call get_availability for that date.",
        "4. Offer up to 3 slots.",
        "5. Once the caller confirms a slot you already offered, call create_appointment exactly once using patient_id from resolve_patient and the exact slot details from get_availability (especially start_time, practitioner_id and reason_id).",
        "6. Only after create_appointment returns success may you say the appointment is booked.",
        "",
        "Step 3b - Reschedule",
        "1. Call get_patient_appointments to find their booking.",
        "2. Follow the booking flow to find a new slot.",
        "3. Cancel the old appointment, then create the new one.",
        "",
        "Step 3c - Cancellation",
        "1. Call get_patient_appointments.",
        "2. Confirm the details and ask them to confirm cancellation.",
        "3. Call cancel_appointment only after they confirm.",
        "",
        "DENTAL EMERGENCIES",
        "- If the caller describes severe pain, swelling, bleeding, trauma or a knocked-out tooth, treat it as urgent: capture their name and number and follow the practice's emergency process (transfer or take an urgent message).",
        "",
        CALLER_INTAKE_PROMPT,
        "",
        "RULES",
        "- Always confirm appointment details before booking or cancelling.",
        "- Never tell the caller they are booked unless create_appointment succeeds.",
        "- Never tell the caller they are cancelled unless cancel_appointment succeeds.",
        "- Do not re-run get_availability after the caller has confirmed an offered slot unless searching a different date or time.",
        "- Keep responses short because this is a phone call.",
        "- If there is no availability, apologise and offer the next available day.",
      ].join("\n");
    },
    buildGreeting: (business, receptionist) => {
      const who = receptionist || "the receptionist";
      const biz = business || "the practice";
      return `Hi, thanks for calling ${biz}, you're through to ${who}. Are you calling to book, change or cancel an appointment, or is it something else?`;
    },
    defaultContacts: () => [
      {
        id: crypto.randomUUID(),
        name: "Dental emergencies",
        phone: "",
        email: "",
        keywords: [
          "emergency",
          "severe pain",
          "swelling",
          "bleeding",
          "knocked out",
          "trauma",
          "abscess",
        ],
        transfer: true,
        notify: false,
        useDefaultEmail: false,
      },
    ],
  },
];

export function CustomerAgentWorkspace({
  initialAssistants,
  callLogs = [],
  contacts = [],
  userEmail,
  isAdmin = false,
  adminMode = false,
  trial,
  planName,
  emailChannel,
  callUsage,
  whatsappChannel,
  livechatChannel,
  smsChannel,
  smsNumbers,
  whatsappNumbers,
  impersonating,
  initialInsights,
  analysisEnabled = false,
}: {
  initialAssistants?: Assistant[];
  callLogs?: CallLog[];
  contacts?: Contact[];
  userEmail?: string;
  isAdmin?: boolean;
  adminMode?: boolean; // rendered on /admin with every customer's agents
  trial?: { used: number; cap: number; blocked: boolean }; // free-trial call usage
  planName?: string; // subscription plan label (Core / Growth / Pro)
  emailChannel?: EmailChannelUsage;
  callUsage?: CallUsage; // bundled AI-call allowance + usage
  whatsappChannel?: ChannelUsage; // bundled WhatsApp allowance + usage
  livechatChannel?: ChannelUsage; // bundled live-chat allowance + usage
  smsChannel?: ChannelUsage; // bundled SMS allowance + usage
  smsNumbers?: AgentSmsNumber[]; // already-provisioned Vonage SMS numbers
  whatsappNumbers?: AgentWhatsappNumber[]; // already-provisioned WhatsApp numbers
  impersonating?: { email: string }; // admin viewing as this customer
  initialInsights?: DashboardInsights; // server-aggregated AI Insights (default range)
  analysisEnabled?: boolean; // whether the Claude API key is configured
}) {
  const [assistants, setAssistants] = useState(initialAssistants ?? demoAssistants);
  // A real customer with no agents yet has an empty list - don't assume [0] exists.
  const [selectedId, setSelectedId] = useState(
    (initialAssistants ?? demoAssistants)[0]?.id ?? "",
  );
  const [view, setView] = useState<View>("insights");
  const [detailTab, setDetailTab] = useState<DetailTab>("behaviour");
  const [searchTerm, setSearchTerm] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [greetingOpen, setGreetingOpen] = useState(false);
  const [editAbility, setEditAbility] = useState<"knowledge" | "transfer" | null>(null);
  const [newAssistantName, setNewAssistantName] = useState("");
  const [newBusinessName, setNewBusinessName] = useState("");
  const [newTemplateId, setNewTemplateId] = useState(agentTemplates[0].id);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedCall, setSelectedCall] = useState<CallLog | null>(null);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isCreating, startCreate] = useTransition();
  const [isProvisioning, startProvision] = useTransition();
  const [isDeleting, startDelete] = useTransition();

  // Poll for number assignment on agents that are still awaiting one. Only runs
  // while at least one agent is pending; clears itself once all are live.
  useEffect(() => {
    const pendingIds = assistants
      .filter((a) => a.routing.status === "pending")
      .map((a) => a.id);
    if (!pendingIds.length) return;
    const interval = setInterval(async () => {
      const updates = await getPendingAgentsStatus(pendingIds);
      const live = Object.entries(updates).filter(([, r]) => r.status === "live");
      if (!live.length) return;
      setAssistants((current) =>
        current.map((a) => {
          const update = updates[a.id];
          if (!update || update.status !== "live") return a;
          return {
            ...a,
            phoneNumber: update.number,
            status: "Live",
            routing: { ...a.routing, number: update.number, status: "live" as const },
          };
        }),
      );
    }, 10000);
    return () => clearInterval(interval);
  }, [assistants]);

  const selectedAssistant =
    assistants.find((assistant) => assistant.id === selectedId) ?? assistants[0];

  const filteredAssistants = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return assistants;
    return assistants.filter((assistant) =>
      [assistant.name, assistant.businessName, assistant.industry, assistant.phoneNumber]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [assistants, searchTerm]);

  function updateSelected(patch: Partial<Assistant>) {
    setAssistants((current) =>
      current.map((a) => (a.id === selectedAssistant.id ? { ...a, ...patch } : a)),
    );
  }

  function deleteSelected() {
    startDelete(async () => {
      const result = await deleteAgent(selectedAssistant.id);
      if (!result.ok) return; // leave on page; AssistantDetail shows the error
      setAssistants((current) => current.filter((a) => a.id !== selectedAssistant.id));
      setView("assistants");
    });
  }

  function createAssistant() {
    const template =
      agentTemplates.find((t) => t.id === newTemplateId) ?? agentTemplates[0];
    const business = newBusinessName.trim() || "New business";
    // The assistant always identifies as "{business} assistant", never a
    // personal name (an optional typed name is used only as an internal label).
    const receptionist = `${business} assistant`;
    const prompt = template.buildPrompt(business, receptionist);
    const greeting = template.buildGreeting(business, receptionist);
    const voice = cartesiaVoices[0].id;
    const knowledgeFields = template.defaultKnowledgeFields ?? {};
    const knowledge = composeKnowledge(knowledgeFields);
    const contacts = template.defaultContacts?.() ?? [];
    setCreateError(null);
    startCreate(async () => {
      const result = await createAgent({
        name: receptionist,
        businessName: business,
        industry: template.industry,
        prompt,
        greeting,
        voice,
        knowledge,
        knowledgeFields,
        contacts,
      });
      if (!result.ok || !result.id) {
        setCreateError(result.error ?? "Could not create the assistant.");
        return;
      }
      const routing = result.routing ?? { provider: null as null, number: "", status: "unprovisioned" as const };
      const assistant: Assistant = {
        id: result.id,
        slug: result.slug ?? "",
        name: receptionist,
        businessName: business,
        industry: template.industry,
        phoneNumber: routing.number || (routing.status === "pending" ? "Setting up…" : "Number pending"),
        status: routing.status === "live" ? "Live" : "Setup",
        receptionistName: receptionist,
        prompt,
        greeting,
        voice,
        knowledge,
        knowledgeFields,
        defaultEmail: "",
        contacts,
        website: "",
        timezone: "Europe/London",
        fallbackEmail: "",
        transferNumber: "",
        calls: 0,
        cost: "GBP 0.00",
        routing,
      };
      setAssistants((current) => [assistant, ...current]);
      setSelectedId(result.id);
      setView("detail");
      setDetailTab("behaviour");
      setCreateOpen(false);
      setNewAssistantName("");
      setNewBusinessName("");
      setNewTemplateId(agentTemplates[0].id);
    });
  }

  // AI setup wizard finish: create the drafted agent, then apply the fields
  // createAgent doesn't take (website + office hours), and open it for review.
  async function createFromDraft(draft: AgentDraft): Promise<WizardResult> {
    const voice = draft.voice || cartesiaVoices[0].id;
    const contacts = draft.contacts ?? [];
    const defaultEmail = (draft.defaultEmail ?? "").trim();
    const result = await createAgent({
      name: draft.receptionistName || "Receptionist",
      businessName: draft.businessName || "New business",
      industry: draft.industry || "General",
      prompt: draft.prompt,
      greeting: draft.greeting,
      voice,
      knowledge: draft.knowledge,
      knowledgeFields: draft.knowledgeFields,
      contacts,
    });
    if (!result.ok || !result.id) {
      return { ok: false, error: result.error ?? "Could not create the assistant." };
    }

    // Persist the remaining wizard answers that createAgent doesn't take
    // directly (website, opening hours, messages inbox). Contacts are already
    // saved by createAgent; defaultEmail must go through updateAgent.
    const hasHours = Object.keys(draft.officeHours ?? {}).length > 0;
    if (draft.website || hasHours || defaultEmail) {
      await updateAgent(result.id, {
        website: draft.website,
        officeHours: draft.officeHours,
        defaultEmail,
      });
    }

    const routing = result.routing ?? { provider: null as null, number: "", status: "unprovisioned" as const };
    const assistant: Assistant = {
      id: result.id,
      slug: result.slug ?? "",
      name: draft.receptionistName || "Receptionist",
      businessName: draft.businessName || "New business",
      industry: draft.industry || "General",
      phoneNumber: routing.number || (routing.status === "pending" ? "Setting up…" : "Number pending"),
      status: routing.status === "live" ? "Live" : "Setup",
      receptionistName: draft.receptionistName || "Receptionist",
      prompt: draft.prompt,
      greeting: draft.greeting,
      voice,
      knowledge: draft.knowledge,
      knowledgeFields: draft.knowledgeFields,
      defaultEmail,
      contacts,
      website: draft.website,
      timezone: "Europe/London",
      fallbackEmail: "",
      transferNumber: "",
      officeHours: hasHours ? draft.officeHours : undefined,
      calls: 0,
      cost: "GBP 0.00",
      routing,
    };
    setAssistants((current) => [assistant, ...current]);
    setSelectedId(result.id);
    setView("detail");
    setDetailTab("behaviour");
    setWizardOpen(false);
    return { ok: true, id: result.id };
  }

  function save() {
    setSaveError(null);
    startTransition(async () => {
      const result = await updateAgent(selectedAssistant.id, {
        name: selectedAssistant.name,
        businessName: selectedAssistant.businessName,
        industry: selectedAssistant.industry,
        phoneNumber: selectedAssistant.phoneNumber,
        timezone: selectedAssistant.timezone,
        prompt: selectedAssistant.prompt,
        greeting: selectedAssistant.greeting,
        voice: selectedAssistant.voice,
        knowledge: selectedAssistant.knowledge,
        knowledgeFields: selectedAssistant.knowledgeFields,
        defaultEmail: selectedAssistant.defaultEmail,
        contacts: selectedAssistant.contacts,
        website: selectedAssistant.website,
        fallbackEmail: selectedAssistant.fallbackEmail,
        transferNumber: selectedAssistant.transferNumber,
        status: selectedAssistant.status,
      });
      if (result.ok) {
        setSaved(true);
        window.setTimeout(() => setSaved(false), 1600);
      } else {
        setSaveError(result.error ?? "Save failed.");
      }
    });
  }

  function provision() {
    setProvisionError(null);
    startProvision(async () => {
      const result = await provisionNumber(selectedAssistant.id);
      if (result.ok && result.routing) {
        updateSelected({
          routing: result.routing,
          phoneNumber: result.routing.number || "Number pending",
          status: result.routing.status === "live" ? "Live" : "Setup",
        });
      } else {
        setProvisionError(result.error ?? "Could not assign a number yet.");
      }
    });
  }

  function updateAssistantRouting(profileId: string, routing: AgentRouting) {
    setAssistants((prev) =>
      prev.map((assistant) =>
        assistant.id === profileId
          ? {
              ...assistant,
              routing,
              phoneNumber: routing.number || (routing.status === "pending" ? "Setting up…" : "Number pending"),
              status: routing.status === "live" ? "Live" : "Setup",
            }
          : assistant,
      ),
    );
  }

  function isNavActive(item: { view: View; label: string }): boolean {
    if (item.label === "Assistants") return view === "assistants" || view === "detail";
    if (item.label === "Call History") return view === "calls";
    if (item.label === "AI Insights") return view === "insights";
    if (item.label === "Contacts") return view === "contacts";
    if (item.label === "Channels") return view === "channels";
    return false;
  }

  return (
    <div className="min-h-screen bg-[#e9efed] px-0 py-0 text-[#111716] lg:px-6 lg:py-6">
      {impersonating ? (
        <div className="mx-auto mb-3 flex max-w-[1920px] flex-wrap items-center justify-between gap-3 rounded-xl bg-[#7a2e2e] px-4 py-2.5 text-sm font-semibold text-white">
          <span>
            👁 Viewing as <strong>{impersonating.email}</strong> - changes you make apply to this customer&apos;s account.
          </span>
          <form action={stopImpersonating}>
            <button
              type="submit"
              className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-bold text-white transition hover:bg-white/25"
            >
              Exit customer view
            </button>
          </form>
        </div>
      ) : null}
      {trial ? (
        <div className="mx-auto mb-3 max-w-[1920px] px-4 lg:px-0">
          <div
            className={`flex flex-col gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold sm:flex-row sm:items-center sm:justify-between ${
              trial.blocked
                ? "bg-[#fdecec] text-[#9b1c1c]"
                : "bg-[#eefbfb] text-[#0e4b4d]"
            }`}
          >
            <span>
              {trial.blocked
                ? `Free trial limit reached - ${trial.used}/${trial.cap} calls used. Add a plan to keep taking calls.`
                : `Free trial: ${trial.used}/${trial.cap} AI calls used.`}
            </span>
            {trial.blocked ? (
              <a
                href="/billing"
                className="flex-shrink-0 rounded-lg bg-[#9b1c1c] px-3 py-1.5 text-xs font-bold text-white"
              >
                Choose a plan
              </a>
            ) : null}
          </div>
        </div>
      ) : null}
      <div className="mx-auto flex min-h-screen max-w-[1920px] overflow-hidden bg-white shadow-[0_24px_90px_rgba(17,23,22,0.14)] lg:min-h-[calc(100vh-48px)] lg:rounded-[22px] lg:border lg:border-black/10">
        {/* Mobile nav drawer */}
        {mobileNavOpen && (
          <div className="fixed inset-0 z-50 md:hidden">
            <div
              className="absolute inset-0 bg-black/50"
              onClick={() => setMobileNavOpen(false)}
            />
            <aside className="absolute left-0 top-0 flex h-full w-[270px] flex-col bg-gradient-to-b from-[#172929] to-[#0e1b1b]">
              <div className="flex h-[72px] items-center justify-between pl-6 pr-3">
                <span className="text-2xl font-black tracking-normal text-white">
                  Wise<span className="text-[#7de8eb]">Call</span>
                </span>
                <button
                  type="button"
                  onClick={() => setMobileNavOpen(false)}
                  aria-label="Close menu"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav className="flex-1 space-y-1 px-4 py-4">
                {navItems.map((item) => {
                  const active = isNavActive(item);
                  return (
                    <button
                      type="button"
                      key={item.label}
                      onClick={() => {
                        setView(item.view);
                        setMobileNavOpen(false);
                      }}
                      className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold transition ${
                        active ? "bg-[#7de8eb]/10 text-white" : "text-[#94b4b2] hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      <item.icon className="h-5 w-5 flex-shrink-0" />
                      {item.label}
                    </button>
                  );
                })}
                {!adminMode && (
                  <a
                    href="/billing"
                    className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
                  >
                    <CreditCard className="h-5 w-5 flex-shrink-0" />
                    Billing & plan
                  </a>
                )}
                {adminMode ? (
                  <>
                    <a
                      href="/dashboard"
                      className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
                    >
                      <Grid2X2 className="h-5 w-5 flex-shrink-0" />
                      My dashboard
                    </a>
                    <a
                      href="/admin/partners"
                      className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
                    >
                      <Users className="h-5 w-5 flex-shrink-0" />
                      Partners
                    </a>
                  </>
                ) : (
                  isAdmin && (
                    <>
                      <a
                        href="/admin"
                        className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
                      >
                        <ShieldCheck className="h-5 w-5 flex-shrink-0" />
                        Admin
                      </a>
                      <a
                        href="/admin/partners"
                        className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
                      >
                        <Users className="h-5 w-5 flex-shrink-0" />
                        Partners
                      </a>
                    </>
                  )
                )}
              </nav>
              <div className="mx-4 mb-4 rounded-[18px] bg-[#1a3535] p-5 text-center">
                <SupportOwl />
                <p className="text-sm font-bold text-white">Need setup help?</p>
                <button
                  type="button"
                  onClick={() => {
                    setMobileNavOpen(false);
                    setTicketOpen(true);
                  }}
                  className="mt-3 rounded-lg bg-[#7de8eb] px-4 py-2 text-sm font-bold text-[#0e1b1b] transition hover:bg-[#5de0e5]"
                >
                  Raise a ticket
                </button>
              </div>
            </aside>
          </div>
        )}

        {/* Sidebar */}
        <aside className="hidden w-[280px] flex-shrink-0 flex-col bg-gradient-to-b from-[#172929] to-[#0e1b1b] md:flex">
          <div className="flex h-[72px] items-center gap-3 px-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/owl-logo.png" alt="" className="h-8 w-8 object-contain" />
            <span className="text-2xl font-black tracking-normal text-white">
              Wise<span className="text-[#7de8eb]">Call</span>
            </span>
          </div>

          <nav className="flex-1 space-y-1 px-4 py-4">
            {navItems.map((item) => {
              const active = isNavActive(item);
              return (
                <button
                  type="button"
                  key={item.label}
                  onClick={() => setView(item.view)}
                  className={`relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold transition ${
                    active
                      ? "bg-[#7de8eb]/10 text-white"
                      : "text-[#94b4b2] hover:bg-white/5 hover:text-white"
                  }`}
                >
                  {active && (
                    <span className="absolute left-0 top-1 h-[calc(100%-8px)] w-0.5 rounded-r-full bg-[#7de8eb]" />
                  )}
                  <item.icon className="h-5 w-5 flex-shrink-0" />
                  {item.label}
                </button>
              );
            })}

            {!adminMode && (
              <a
                href="/billing"
                className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
              >
                <CreditCard className="h-5 w-5 flex-shrink-0" />
                Billing & plan
              </a>
            )}

            {adminMode ? (
              <>
                <a
                  href="/dashboard"
                  className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
                >
                  <Grid2X2 className="h-5 w-5 flex-shrink-0" />
                  My dashboard
                </a>
                <a
                  href="/admin/partners"
                  className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
                >
                  <Users className="h-5 w-5 flex-shrink-0" />
                  Partners
                </a>
              </>
            ) : (
              isAdmin && (
                <>
                  <a
                    href="/admin"
                    className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
                  >
                    <ShieldCheck className="h-5 w-5 flex-shrink-0" />
                    Admin
                  </a>
                  <a
                    href="/admin/partners"
                    className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
                  >
                    <Users className="h-5 w-5 flex-shrink-0" />
                    Partners
                  </a>
                </>
              )
            )}
          </nav>

          <div className="m-4 rounded-[18px] bg-[#1a3535] p-5 text-center">
            <SupportOwl />
            <p className="text-sm font-bold text-white">Need setup help?</p>
            <button
              type="button"
              onClick={() => setTicketOpen(true)}
              className="mt-3 rounded-lg bg-[#7de8eb] px-4 py-2 text-sm font-bold text-[#0e1b1b] transition hover:bg-[#5de0e5]"
            >
              Raise a ticket
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1 bg-white">
          <header className="flex h-[72px] items-center justify-between border-b border-black/10 px-5 lg:px-8">
            <div className="flex min-w-0 max-w-[calc(100vw-7rem)] items-center gap-2 overflow-x-auto whitespace-nowrap text-sm font-semibold text-[#7a8582] sm:max-w-none">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open menu"
                className="-ml-1 mr-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-[#111716] transition hover:bg-[#f2f4f3] md:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setView("insights")}
                className={view === "insights" ? "text-[#111716]" : "transition hover:text-[#111716]"}
              >
                Home
              </button>
              {(view === "assistants" || view === "detail") && (
                <>
                  <ChevronRight className="h-4 w-4" />
                  <span>Assistants</span>
                </>
              )}
              {view === "calls" && (
                <>
                  <ChevronRight className="h-4 w-4" />
                  <span>Call History</span>
                </>
              )}
              {view === "contacts" && (
                <>
                  <ChevronRight className="h-4 w-4" />
                  <span>Contacts</span>
                </>
              )}
              {view === "channels" && (
                <>
                  <ChevronRight className="h-4 w-4" />
                  <span>Channels</span>
                </>
              )}
              {view === "detail" && (
                <>
                  <ChevronRight className="h-4 w-4" />
                  <span className="truncate text-[#111716]">{selectedAssistant.name}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              {userEmail && (
                <span className="hidden text-sm text-[#7a8582] sm:block">{userEmail}</span>
              )}
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 bg-[#f2f4f3] text-sm font-black">
                {userEmail ? userEmail[0].toUpperCase() : "?"}
              </div>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-[#7a8582] transition hover:bg-[#f2f4f3] hover:text-[#111716]"
                  aria-label="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </form>
            </div>
          </header>

          <div className="px-5 py-8 lg:px-10">
            {view === "insights" && (
              <AiInsights
                initial={initialInsights}
                analysisEnabled={analysisEnabled}
                onViewCalls={() => setView("calls")}
                onOpenCall={(callId) => {
                  const log = callLogs.find((c) => c.id === callId);
                  if (log) setSelectedCall(log);
                  else setView("calls");
                }}
              />
            )}

            {(view === "assistants") && (
              <AssistantsList
                assistants={filteredAssistants}
                searchTerm={searchTerm}
                adminMode={adminMode}
                onSearch={setSearchTerm}
                onCreate={() => setWizardOpen(true)}
                onOpen={(assistantId) => {
                  setSelectedId(assistantId);
                  setView("detail");
                  setDetailTab("behaviour");
                }}
              />
            )}

            {view === "detail" && (
              <AssistantDetail
                assistant={selectedAssistant}
                tab={detailTab}
                saved={saved}
                isPending={isPending}
                saveError={saveError}
                isProvisioning={isProvisioning}
                provisionError={provisionError}
                isDeleting={isDeleting}
                onBack={() => setView("assistants")}
                onTabChange={setDetailTab}
                onChange={updateSelected}
                onPrompt={() => setPromptOpen(true)}
                onGreeting={() => setGreetingOpen(true)}
                onAbility={(key) => {
                  // First time editing structured knowledge: fold any legacy
                  // freeform text into the "Anything else" section so it isn't lost.
                  if (
                    key === "knowledge" &&
                    !hasKnowledgeFields(selectedAssistant.knowledgeFields) &&
                    selectedAssistant.knowledge.trim()
                  ) {
                    updateSelected({
                      knowledgeFields: { other: selectedAssistant.knowledge },
                    });
                  }
                  setEditAbility(key);
                }}
                onSave={save}
                onProvision={provision}
                onDelete={isAdmin ? deleteSelected : undefined}
                adminMode={adminMode}
                planName={planName}
                smsNumber={smsNumbers?.find((n) => n.profileId === selectedAssistant.id)?.smsNumber}
                whatsappNumber={
                  whatsappNumbers?.find((n) => n.profileId === selectedAssistant.id)?.whatsappNumber
                }
              />
            )}

            {view === "calls" && (
              <CallHistory callLogs={callLogs} onOpen={(log) => setSelectedCall(log)} />
            )}

            {view === "contacts" && (
              <ContactsView contacts={contacts} callLogs={callLogs} />
            )}

            {view === "channels" && (
              <ChannelsHub
                emailChannel={emailChannel}
                callUsage={callUsage}
                whatsappChannel={whatsappChannel}
                livechatChannel={livechatChannel}
                smsChannel={smsChannel}
                smsNumbers={smsNumbers ?? []}
                assistants={assistants}
                userEmail={userEmail}
                onRoutingUpdate={updateAssistantRouting}
              />
            )}
          </div>
        </main>
      </div>

      {ticketOpen && <RaiseTicketModal onClose={() => setTicketOpen(false)} />}

      {wizardOpen && (
        <SetupWizard
          onClose={() => setWizardOpen(false)}
          onSubmit={createFromDraft}
          onManual={() => {
            setWizardOpen(false);
            setCreateOpen(true);
          }}
          voices={cartesiaVoices}
          templates={agentTemplates}
          accountEmail={userEmail ?? ""}
        />
      )}

      {createOpen && (
        <CreateAssistantModal
          name={newAssistantName}
          businessName={newBusinessName}
          templateId={newTemplateId}
          isCreating={isCreating}
          error={createError}
          onNameChange={setNewAssistantName}
          onBusinessChange={setNewBusinessName}
          onTemplateChange={setNewTemplateId}
          onClose={() => {
            setCreateOpen(false);
            setCreateError(null);
          }}
          onCreate={createAssistant}
        />
      )}

      {promptOpen && (
        <PromptModal
          assistant={selectedAssistant}
          onChange={(prompt) => updateSelected({ prompt })}
          onClose={() => setPromptOpen(false)}
          onSave={() => {
            save();
            setPromptOpen(false);
          }}
        />
      )}

      {greetingOpen && (
        <GreetingModal
          assistant={selectedAssistant}
          onChange={(patch) => updateSelected(patch)}
          onClose={() => setGreetingOpen(false)}
          onSave={() => {
            save();
            setGreetingOpen(false);
          }}
        />
      )}

      {editAbility === "knowledge" && (
        <KnowledgeModal
          assistant={selectedAssistant}
          onChange={(fields) =>
            updateSelected({
              knowledgeFields: fields,
              knowledge: composeKnowledge(fields),
            })
          }
          onClose={() => setEditAbility(null)}
          onSave={() => {
            save();
            setEditAbility(null);
          }}
        />
      )}

      {editAbility === "transfer" && (
        <AbilityEditorModal
          title="Transfer Calls"
          subtitle={`Where ${selectedAssistant.name} forwards urgent calls`}
          label="Transfer number"
          placeholder="+44 113 522 1606"
          value={selectedAssistant.transferNumber}
          onChange={(value) => updateSelected({ transferNumber: value })}
          onClose={() => setEditAbility(null)}
          onSave={() => {
            save();
            setEditAbility(null);
          }}
        />
      )}

      {selectedCall && (
        <CallDetailModal log={selectedCall} onClose={() => setSelectedCall(null)} />
      )}
    </div>
  );
}

const MODAL_OVERLAY =
  "fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/35 p-4";
const MODAL_PANEL =
  "flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-[18px] bg-white shadow-2xl";

function MobileField({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-bold uppercase tracking-wide text-[#9aa5a2]">{label}</span>
      {children}
    </div>
  );
}

function AssistantsList({
  assistants,
  searchTerm,
  adminMode = false,
  onSearch,
  onCreate,
  onOpen,
}: {
  assistants: Assistant[];
  searchTerm: string;
  adminMode?: boolean;
  onSearch: (value: string) => void;
  onCreate: () => void;
  onOpen: (assistantId: string) => void;
}) {
  return (
    <div>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-black">{adminMode ? "All agents" : "Assistants"}</h1>
          <p className="mt-2 text-[#66716e]">
            {adminMode
              ? "Every WiseCall agent across all customers. Open any to edit."
              : "Create and manage the agents on your account."}
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#111716] px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130]"
        >
          <Plus className="h-4 w-4" />
          Create Assistant
        </button>
      </div>

      <label className="mb-5 flex max-w-xl items-center gap-3 rounded-lg border border-black/10 bg-white px-4 py-3 shadow-sm">
        <Search className="h-4 w-4 text-[#7a8582]" />
        <input
          value={searchTerm}
          onChange={(event) => onSearch(event.target.value)}
          placeholder="Search"
          className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-[#9aa4a1]"
        />
      </label>

      <section className="overflow-hidden rounded-[18px] border border-black/10 bg-white">
        <div
          className={`grid border-b border-black/10 bg-[#fbfcfc] px-5 py-4 text-sm font-bold text-[#66716e] max-md:hidden ${
            adminMode
              ? "grid-cols-[1fr_190px_180px_120px_60px]"
              : "grid-cols-[1fr_210px_130px_70px]"
          }`}
        >
          <span>Name</span>
          <span>Phone Number</span>
          {adminMode && <span>Owner</span>}
          <span>Status</span>
          <span />
        </div>
        {assistants.length > 0 ? (
          <>
            {/* Mobile: labelled cards */}
            <div className="divide-y divide-black/10 md:hidden">
              {assistants.map((assistant) => (
                <button
                  type="button"
                  key={assistant.id}
                  onClick={() => onOpen(assistant.id)}
                  className="flex w-full flex-col gap-3 px-4 py-4 text-left transition hover:bg-[#f7f8f7]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <span>
                      <span className="block font-black">{assistant.name}</span>
                      <span className="mt-1 block text-sm text-[#66716e]">
                        {assistant.businessName} - {assistant.industry}
                      </span>
                    </span>
                    <ChevronRight className="mt-1 h-5 w-5 flex-shrink-0 text-[#7a8582]" />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <MobileField label="Phone">
                      <span className="font-mono text-sm text-[#66716e]">{assistant.phoneNumber}</span>
                    </MobileField>
                    {adminMode ? (
                      <MobileField label="Owner">
                        <span className="truncate text-sm text-[#66716e]">
                          {assistant.ownerEmail ?? "Unassigned"}
                        </span>
                      </MobileField>
                    ) : null}
                    <MobileField label="Status">
                      <StatusPill status={assistant.status} />
                    </MobileField>
                  </div>
                </button>
              ))}
            </div>
            {/* Desktop: table rows */}
            <div className="hidden divide-y divide-black/10 md:block">
              {assistants.map((assistant) => (
                <button
                  type="button"
                  key={assistant.id}
                  onClick={() => onOpen(assistant.id)}
                  className={`grid w-full gap-4 px-5 py-5 text-left transition hover:bg-[#f7f8f7] ${
                    adminMode
                      ? "grid-cols-[1fr_190px_180px_120px_60px]"
                      : "grid-cols-[1fr_210px_130px_70px]"
                  }`}
                >
                  <span>
                    <span className="block font-black">{assistant.name}</span>
                    <span className="mt-1 block text-sm text-[#66716e]">
                      {assistant.businessName} - {assistant.industry}
                    </span>
                  </span>
                  <span className="font-mono text-sm text-[#66716e]">{assistant.phoneNumber}</span>
                  {adminMode && (
                    <span className="truncate text-sm text-[#66716e]">
                      {assistant.ownerEmail ?? "Unassigned"}
                    </span>
                  )}
                  <span>
                    <StatusPill status={assistant.status} />
                  </span>
                  <span className="flex items-center justify-end">
                    <ChevronRight className="h-5 w-5 text-[#7a8582]" />
                  </span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="px-5 py-16 text-center text-[#66716e]">No assistants found</div>
        )}
      </section>
    </div>
  );
}

function AssistantDetail({
  assistant,
  tab,
  saved,
  isPending,
  saveError,
  isProvisioning,
  provisionError,
  isDeleting = false,
  onBack,
  onTabChange,
  onChange,
  onPrompt,
  onGreeting,
  onAbility,
  onSave,
  onProvision,
  onDelete,
  adminMode = false,
  planName,
  smsNumber,
  whatsappNumber,
}: {
  assistant: Assistant;
  tab: DetailTab;
  saved: boolean;
  isPending: boolean;
  saveError: string | null;
  isProvisioning: boolean;
  provisionError: string | null;
  isDeleting?: boolean;
  onBack: () => void;
  onTabChange: (tab: DetailTab) => void;
  onChange: (patch: Partial<Assistant>) => void;
  onPrompt: () => void;
  onGreeting: () => void;
  onAbility: (key: "knowledge" | "transfer") => void;
  onSave: () => void;
  onProvision: () => void;
  onDelete?: () => void;
  adminMode?: boolean;
  planName?: string;
  smsNumber?: string;
  whatsappNumber?: string;
}) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <button
            type="button"
            onClick={onBack}
            className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-[#66716e] transition hover:text-[#111716]"
          >
            <ArrowLeft className="h-4 w-4" />
            Assistants
          </button>
          <h1 className="text-2xl font-black sm:text-4xl">Edit &apos;{assistant.name}&apos;</h1>
        </div>
        <div className="flex items-center gap-2">
          {adminMode && assistant.ownerId ? (
            <form action={impersonateUser.bind(null, assistant.ownerId)}>
              <button
                type="submit"
                className="inline-flex items-center gap-2 rounded-lg bg-[#111716] px-4 py-2.5 text-sm font-black text-white transition hover:bg-[#263130]"
                title={`Open ${assistant.ownerEmail ?? "this customer"}'s account`}
              >
                <LogOut className="h-4 w-4 rotate-180" />
                Log in as {assistant.ownerEmail ?? "owner"}
              </button>
            </form>
          ) : null}
          {onDelete ? (
            <button
              type="button"
              onClick={() => setDeleteConfirm(true)}
              disabled={isDeleting}
              className="inline-flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm font-black text-red-700 transition hover:bg-red-100 disabled:opacity-60"
            >
              {isDeleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
              {isDeleting ? "Deleting…" : "Delete agent"}
            </button>
          ) : null}
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-lg transition hover:bg-[#f2f4f3]"
            aria-label="More actions"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
      </div>

      {deleteConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-sm">
          <div className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-2xl">
            <h2 className="text-lg font-black text-[#111716]">Delete &apos;{assistant.name}&apos;?</h2>
            <p className="mt-2 text-sm text-[#66716e]">
              This will permanently delete the agent. If it has a pooled number (+{assistant.phoneNumber.replace(/[^\d]/g, "")}), that number will be returned to the pool automatically.
            </p>
            <p className="mt-2 text-sm font-bold text-red-700">This cannot be undone.</p>
            <div className="mt-5 flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setDeleteConfirm(false)}
                className="rounded-lg border border-black/10 px-4 py-2 text-sm font-bold text-[#66716e] transition hover:bg-[#f2f4f3]"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => { setDeleteConfirm(false); onDelete?.(); }}
                disabled={isDeleting}
                className="inline-flex items-center gap-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-black text-white transition hover:bg-red-700 disabled:opacity-60"
              >
                <Trash2 className="h-4 w-4" />
                Yes, delete it
              </button>
            </div>
          </div>
        </div>
      )}

      <RoutingCard
        routing={assistant.routing}
        smsNumber={smsNumber}
        whatsappNumber={whatsappNumber}
        isProvisioning={isProvisioning}
        error={provisionError}
        onProvision={onProvision}
      />

      <OfficeHoursCard
        agentId={assistant.id}
        initial={assistant.officeHours}
        initialMessage={assistant.outOfHoursMessage}
        businessName={assistant.businessName}
        timezone={assistant.timezone}
      />

      <div className="mb-8 flex overflow-x-auto border-b border-black/10">
        {(["behaviour", "knowledge", "routing", "outbound", "technical"] as DetailTab[]).map((item) => (
          <button
            type="button"
            key={item}
            onClick={() => onTabChange(item)}
            className={`whitespace-nowrap border-b-2 px-4 py-3 text-sm font-black transition ${
              tab === item
                ? "border-[#111716] text-[#111716]"
                : "border-transparent text-[#7a8582] hover:text-[#111716]"
            }`}
          >
            {
              {
                behaviour: "Behaviour",
                knowledge: "Knowledge Base",
                routing: "Routing",
                outbound: "Outbound",
                technical: "Technical",
              }[item]
            }
          </button>
        ))}
      </div>

      {tab === "behaviour" ? (
        <div className="space-y-4">
          <a
            href="/billing"
            className="flex w-full items-center justify-between rounded-[14px] border border-black/10 bg-white px-5 py-4 text-left transition hover:bg-[#f7f8f7]"
          >
            <span className="flex items-center gap-3">
              <Bot className="h-5 w-5 text-[#148b8e]" />
              <span className="font-black">Plan</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="rounded-full border border-black/10 px-3 py-1 text-sm font-bold">
                {planName ?? "Choose plan"}
              </span>
              <ChevronRight className="h-5 w-5 text-[#7a8582]" />
            </span>
          </a>

          <button
            type="button"
            onClick={onGreeting}
            className="flex w-full items-center justify-between gap-4 rounded-[14px] border border-black/10 bg-white px-5 py-4 text-left transition hover:bg-[#f7f8f7]"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Hand className="h-5 w-5 flex-shrink-0 text-[#148b8e]" />
              <span className="min-w-0">
                <span className="block font-black">Greeting message</span>
                <span className="mt-1 block truncate text-sm text-[#7a8582]">
                  {assistant.greeting || "The first thing callers hear when they connect."}
                </span>
              </span>
            </span>
            <ChevronRight className="h-5 w-5 flex-shrink-0 text-[#7a8582]" />
          </button>

          <div className="pt-2">
            <p className="mb-3 px-1 text-sm font-bold text-[#7a8582]">Voice</p>
            <VoicePicker
              selected={assistant.voice}
              greeting={assistant.greeting}
              onSelect={(voice) => onChange({ voice })}
            />
          </div>

          <div className="pt-2">
            <p className="mb-3 px-1 text-sm font-bold text-[#7a8582]">Abilities</p>
            <div className="space-y-3">
              <AbilityRow
                icon={MessageSquareText}
                title="Answer Questions"
                body={
                  assistant.knowledge.trim()
                    ? truncate(assistant.knowledge, 70)
                    : "Add FAQs and business info for callers."
                }
                enabled={Boolean(assistant.knowledge.trim())}
                onClick={() => onAbility("knowledge")}
              />
              <AbilityRow
                icon={FileText}
                title="Knowledge Base"
                body="Documents, URLs and pasted notes for retrieval."
                enabled
                onClick={() => onTabChange("knowledge")}
              />
              <AbilityRow
                icon={Phone}
                title="Transfer Calls"
                body={
                  assistant.transferNumber.trim()
                    ? `Forwards urgent calls to ${assistant.transferNumber}`
                    : "Add a number to forward urgent calls."
                }
                enabled={Boolean(assistant.transferNumber.trim())}
                onClick={() => onAbility("transfer")}
              />
              <AbilityRow
                icon={Sparkles}
                title="Custom Prompt / Instructions"
                body="Control behaviour, tone and edge cases."
                enabled
                onClick={onPrompt}
              />
            </div>
          </div>
        </div>
      ) : tab === "knowledge" ? (
        <KnowledgeBaseTab assistant={assistant} />
      ) : tab === "routing" ? (
        <RoutingTab
          contacts={assistant.contacts}
          defaultEmail={assistant.defaultEmail}
          saved={saved}
          isPending={isPending}
          saveError={saveError}
          onChange={(contacts) => onChange({ contacts })}
          onDefaultEmailChange={(defaultEmail) => onChange({ defaultEmail })}
          onSave={onSave}
        />
      ) : tab === "outbound" ? (
        <OutboundManager profileId={assistant.id} businessName={assistant.businessName} />
      ) : (
        <div>
          <PbxExtensionCard agentId={assistant.id} />
          <IntegrationWebhooksCard
            agentId={assistant.id}
            initial={assistant.integrationWebhooks ?? []}
          />
          <div className="grid gap-5 md:grid-cols-2">
          <Field
            label="Assistant name"
            value={assistant.name}
            onChange={(value) => onChange({ name: value })}
          />
          <Field
            label="Business name"
            value={assistant.businessName}
            onChange={(value) => onChange({ businessName: value })}
          />
          <Field
            label="Industry"
            value={assistant.industry}
            onChange={(value) => onChange({ industry: value })}
          />
          <Field
            label="Phone number"
            value={assistant.phoneNumber}
            onChange={(value) => onChange({ phoneNumber: value })}
          />
          <Field
            label="Website"
            value={assistant.website}
            onChange={(value) => onChange({ website: value })}
          />
          <Field
            label="Timezone"
            value={assistant.timezone}
            onChange={(value) => onChange({ timezone: value })}
          />
          <Field
            label="Transfer number"
            value={assistant.transferNumber}
            onChange={(value) => onChange({ transferNumber: value })}
          />
          <Field
            label="Fallback email"
            value={assistant.fallbackEmail}
            onChange={(value) => onChange({ fallbackEmail: value })}
          />
          <div className="md:col-span-2">
            <button
              type="button"
              onClick={onSave}
              disabled={isPending}
              className="inline-flex items-center gap-2 rounded-lg bg-[#111716] px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
            >
              {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {isPending ? "Saving…" : saved ? "Saved" : "Save changes"}
            </button>
            {saveError && (
              <p className="mt-2 text-sm text-red-600">{saveError}</p>
            )}
          </div>
          </div>
        </div>
      )}
    </div>
  );
}

const KB_CATEGORIES = [
  "General",
  "OwlnetPBX",
  "Yeastar",
  "SIP",
  "Phones",
  "Internet",
  "NumberPorting",
  "OWLnetApp",
];

function sourceTypeLabel(value: string): string {
  if (value === "url") return "URL";
  if (value === "sitemap") return "Sitemap";
  if (value === "paste") return "Text";
  if (value === "upload") return "File";
  return value || "Source";
}

function statusTone(status: string): string {
  if (status === "completed") return "bg-[#eafaf1] text-[#14823f]";
  if (status === "failed") return "bg-[#fdecec] text-[#9b1c1c]";
  return "bg-[#fff6e5] text-[#8a5a00]";
}

function KnowledgeBaseTab({ assistant }: { assistant: Assistant }) {
  const [sources, setSources] = useState<KnowledgeBaseSource[]>([]);
  const [jobs, setJobs] = useState<KnowledgeBaseJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [sourceType, setSourceType] = useState<KnowledgeBaseSourceType>("paste");
  const [category, setCategory] = useState("General");
  const [sourceUrl, setSourceUrl] = useState("");
  const [title, setTitle] = useState("");
  const [text, setText] = useState("");
  const [filename, setFilename] = useState("");
  const [mutationError, setMutationError] = useState<string | null>(null);
  const [mutationOk, setMutationOk] = useState<string | null>(null);
  const [deletingSource, setDeletingSource] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchChunks, setSearchChunks] = useState<KnowledgeSearchChunk[]>([]);
  const [isMutating, startMutation] = useTransition();
  const [isSearching, startSearch] = useTransition();

  const totalChunks = sources.reduce((sum, source) => sum + source.chunkCount, 0);
  const hasDemoSources = sources.some((source) => source.title.startsWith(DEMO_KB_TITLE_PREFIX));

  async function load() {
    setLoading(true);
    setLoadError(null);
    const result = await listKnowledgeBaseSources(assistant.id);
    if (result.ok) {
      setSources(result.sources);
      setJobs(result.jobs);
    } else {
      setLoadError(result.error ?? "Could not load the knowledge base.");
    }
    setLoading(false);
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [assistant.id]);

  async function readFile(file: File | undefined) {
    if (!file) return;
    setFilename(file.name);
    if (!title.trim()) setTitle(file.name.replace(/\.[^.]+$/, ""));
    setText(await file.text());
  }

  function ingest() {
    setMutationError(null);
    setMutationOk(null);
    startMutation(async () => {
      const result = await ingestKnowledgeBaseSource({
        agentId: assistant.id,
        sourceType,
        sourceUrl,
        title,
        text,
        filename,
        category,
      });
      if (!result.ok) {
        setMutationError(result.error ?? "Could not add this source.");
        return;
      }
      setMutationOk(
        `${result.chunksAdded ?? 0} chunk${result.chunksAdded === 1 ? "" : "s"} indexed`,
      );
      if (sourceType === "url" || sourceType === "sitemap") setSourceUrl("");
      else {
        setTitle("");
        setText("");
        setFilename("");
      }
      await load();
    });
  }

  function remove(source: KnowledgeBaseSource) {
    setMutationError(null);
    setMutationOk(null);
    setDeletingSource(source.source);
    startMutation(async () => {
      const result = await deleteKnowledgeBaseSource(assistant.id, source.source);
      setDeletingSource(null);
      if (!result.ok) {
        setMutationError(result.error ?? "Could not remove this source.");
        return;
      }
      setMutationOk("Source removed");
      await load();
    });
  }

  function testSearch() {
    const clean = query.trim();
    if (!clean) return;
    setSearchError(null);
    startSearch(async () => {
      const result = await searchKnowledgeBase(assistant.id, clean);
      if (!result.ok) {
        setSearchChunks([]);
        setSearchError(result.error ?? "Search failed.");
        return;
      }
      setSearchChunks(result.chunks);
    });
  }

  function loadDemoContent() {
    setMutationError(null);
    setMutationOk(null);
    startMutation(async () => {
      const result = await seedDemoKnowledgeBase(assistant.id);
      if (!result.ok) {
        setMutationError(result.error ?? "Could not load demo content.");
        return;
      }
      if (result.added === 0) {
        setMutationOk("Demo content is already loaded");
      } else {
        setMutationOk(
          `${result.added} demo source${result.added === 1 ? "" : "s"} indexed (${result.totalChunks} chunk${result.totalChunks === 1 ? "" : "s"})`,
        );
      }
      await load();
    });
  }

  return (
    <div className="space-y-6">
      <section className="rounded-[18px] border border-black/10 bg-white">
        <div className="flex flex-col gap-4 border-b border-black/10 px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-black">
              <FileText className="h-5 w-5 text-[#148b8e]" />
              Knowledge Base
            </h2>
            <p className="mt-1 text-sm text-[#66716e]">
              {sources.length} source{sources.length === 1 ? "" : "s"} · {totalChunks} indexed chunk{totalChunks === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!hasDemoSources ? (
              <button
                type="button"
                onClick={loadDemoContent}
                disabled={isMutating}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-[#148b8e]/30 bg-[#eaf8f8] px-4 py-2.5 text-sm font-black text-[#0f6b6e] transition hover:bg-[#dff3f3] disabled:opacity-60"
              >
                {isMutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Load demo content
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-black/10 bg-white px-4 py-2.5 text-sm font-black text-[#111716] transition hover:bg-[#f7f8f7] disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="flex items-center justify-center rounded-[14px] bg-[#f7f8f7] px-4 py-12 text-sm font-semibold text-[#66716e]">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading sources
            </div>
          ) : loadError ? (
            <div className="rounded-[14px] border border-[#e7caca] bg-[#fff7f7] px-4 py-4 text-sm text-[#9b1c1c]">
              {loadError}
            </div>
          ) : sources.length ? (
            <div className="overflow-hidden rounded-[14px] border border-black/10">
              <div className="grid grid-cols-[1fr_110px_90px_120px_48px] gap-3 border-b border-black/10 bg-[#fbfcfc] px-4 py-3 text-xs font-black uppercase tracking-wide text-[#66716e] max-md:hidden">
                <span>Source</span>
                <span>Category</span>
                <span>Chunks</span>
                <span>Updated</span>
                <span />
              </div>
              <div className="divide-y divide-black/10">
                {sources.map((source) => (
                  <div
                    key={source.source}
                    className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_110px_90px_120px_48px] md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-black text-[#111716]">{source.title}</p>
                      <p className="mt-1 flex min-w-0 items-center gap-1 truncate text-xs text-[#66716e]">
                        <Link2 className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="truncate">{source.source}</span>
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-[#66716e]">{source.category}</span>
                    <span className="font-mono text-sm text-[#66716e]">{source.chunkCount}</span>
                    <span className="text-xs text-[#66716e]">{formatWhen(source.latest)}</span>
                    <button
                      type="button"
                      onClick={() => remove(source)}
                      disabled={isMutating && deletingSource === source.source}
                      aria-label={`Remove ${source.title}`}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-[#7a8582] transition hover:bg-[#fdeaea] hover:text-[#c0392b] disabled:opacity-50"
                    >
                      {isMutating && deletingSource === source.source ? (
                        <Loader2 className="h-4 w-4 animate-spin" />
                      ) : (
                        <Trash2 className="h-4 w-4" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="rounded-[14px] border border-dashed border-black/15 bg-[#fbfcfc] px-5 py-12 text-center">
              <FileText className="mx-auto h-8 w-8 text-[#148b8e]" />
              <p className="mt-3 font-black text-[#111716]">No indexed sources yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-[#66716e]">
                Add a web page, sitemap, pasted notes or text file to make retrieval available for this agent.
              </p>
              <button
                type="button"
                onClick={loadDemoContent}
                disabled={isMutating}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-[#111716] px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
              >
                {isMutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Load demo content
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-[18px] border border-black/10 bg-white p-5">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-black">Add source</h3>
            <p className="mt-1 text-sm text-[#66716e]">Content is chunked, embedded and attached to {assistant.name}.</p>
          </div>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="h-10 rounded-lg border border-black/15 bg-white px-3 text-sm font-bold outline-none focus:border-[#111716]"
          >
            {KB_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-5 inline-flex rounded-lg border border-black/10 bg-[#f7f8f7] p-1">
          {(["paste", "url", "sitemap", "upload"] as KnowledgeBaseSourceType[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setSourceType(item)}
              className={`rounded-md px-3 py-2 text-sm font-black transition ${
                sourceType === item ? "bg-[#111716] text-white" : "text-[#66716e] hover:bg-white"
              }`}
            >
              {sourceTypeLabel(item)}
            </button>
          ))}
        </div>

        {sourceType === "url" || sourceType === "sitemap" ? (
          <Field
            label={sourceType === "sitemap" ? "Sitemap URL" : "Page URL"}
            value={sourceUrl}
            onChange={setSourceUrl}
            placeholder={sourceType === "sitemap" ? "https://example.com/sitemap.xml" : "https://example.com/help"}
          />
        ) : (
          <div className="space-y-4">
            <Field
              label={sourceType === "upload" ? "Display title" : "Title"}
              value={title}
              onChange={setTitle}
              placeholder="Refund policy"
            />
            {sourceType === "upload" ? (
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-[14px] border border-dashed border-black/20 bg-[#fbfcfc] px-4 py-8 text-center transition hover:bg-[#f7f8f7]">
                <UploadCloud className="h-7 w-7 text-[#148b8e]" />
                <span className="mt-2 text-sm font-black text-[#111716]">
                  {filename || "Choose a text file"}
                </span>
                <span className="mt-1 text-xs text-[#66716e]">TXT, Markdown, CSV, JSON or HTML</span>
                <input
                  type="file"
                  accept=".txt,.md,.markdown,.csv,.json,.html,.htm,text/*,application/json"
                  className="sr-only"
                  onChange={(event) => void readFile(event.target.files?.[0])}
                />
              </label>
            ) : null}
            <label className="block">
              <span className="mb-2 block text-sm font-black">Text</span>
              <textarea
                value={text}
                onChange={(event) => setText(event.target.value)}
                placeholder="Paste the policy, FAQ or notes here."
                rows={8}
                className="w-full resize-y rounded-lg border border-black/15 bg-white px-4 py-3 text-sm leading-6 outline-none transition placeholder:text-[#9aa4a1] focus:border-[#111716]"
              />
            </label>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={ingest}
            disabled={isMutating}
            className="inline-flex items-center gap-2 rounded-lg bg-[#111716] px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
          >
            {isMutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {isMutating ? "Indexing" : "Add to Knowledge Base"}
          </button>
          {mutationOk ? <span className="text-sm font-bold text-[#14823f]">{mutationOk}</span> : null}
          {mutationError ? <span className="text-sm font-bold text-[#9b1c1c]">{mutationError}</span> : null}
        </div>
      </section>

      <section className="rounded-[18px] border border-black/10 bg-white p-5">
        <h3 className="text-lg font-black">Test retrieval</h3>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") testSearch();
            }}
            placeholder="Ask a question this agent should answer"
            className="h-12 min-w-0 flex-1 rounded-lg border border-black/15 bg-white px-4 text-sm outline-none transition focus:border-[#111716]"
          />
          <button
            type="button"
            onClick={testSearch}
            disabled={isSearching || !query.trim()}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-[#111716] px-5 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
          >
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </button>
        </div>
        {searchError ? <p className="mt-3 text-sm font-bold text-[#9b1c1c]">{searchError}</p> : null}
        {searchChunks.length > 0 ? (
          <div className="mt-4 space-y-3">
            {searchChunks.map((chunk, index) => (
              <div key={`${chunk.title}-${index}`} className="rounded-[14px] border border-black/10 bg-[#fbfcfc] p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-black text-[#111716]">{chunk.title || "Untitled"}</p>
                  <span className="font-mono text-xs font-bold text-[#66716e]">
                    {chunk.similarity.toFixed(3)}
                  </span>
                </div>
                <p className="text-sm leading-6 text-[#66716e]">{truncate(chunk.content, 360)}</p>
              </div>
            ))}
          </div>
        ) : query && !isSearching && !searchError ? (
          <p className="mt-3 text-sm text-[#66716e]">No matching chunks yet.</p>
        ) : null}
      </section>

      {jobs.length > 0 ? (
        <section className="rounded-[18px] border border-black/10 bg-white p-5">
          <h3 className="text-lg font-black">Recent ingest jobs</h3>
          <div className="mt-4 divide-y divide-black/10">
            {jobs.map((job) => (
              <div key={job.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className={`rounded-full px-2.5 py-1 text-xs font-black ${statusTone(job.status)}`}>
                  {job.status || "running"}
                </span>
                <span className="font-bold text-[#111716]">
                  {job.sourceTitle || job.sourceUrl || sourceTypeLabel(job.sourceType)}
                </span>
                <span className="text-sm text-[#66716e]">
                  {sourceTypeLabel(job.sourceType)} · {job.chunksAdded} chunk{job.chunksAdded === 1 ? "" : "s"} · {formatWhen(job.startedAt)}
                </span>
                {job.errorMessage ? (
                  <span className="basis-full text-sm text-[#9b1c1c]">{job.errorMessage}</span>
                ) : null}
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}

function RoutingTab({
  contacts,
  defaultEmail,
  saved,
  isPending,
  saveError,
  onChange,
  onDefaultEmailChange,
  onSave,
}: {
  contacts: RoutingContact[];
  defaultEmail: string;
  saved: boolean;
  isPending: boolean;
  saveError: string | null;
  onChange: (contacts: RoutingContact[]) => void;
  onDefaultEmailChange: (value: string) => void;
  onSave: () => void;
}) {
  function update(id: string, patch: Partial<RoutingContact>) {
    onChange(contacts.map((c) => (c.id === id ? { ...c, ...patch } : c)));
  }
  function remove(id: string) {
    onChange(contacts.filter((c) => c.id !== id));
  }
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
        notify: false,
        useDefaultEmail: false,
      },
    ]);
  }

  return (
    <div>
      <div className="mb-5 flex items-start gap-3 rounded-[14px] border border-black/10 bg-[#fbfcfc] px-5 py-4">
        <Users className="mt-0.5 h-5 w-5 flex-shrink-0 text-[#148b8e]" />
        <p className="text-sm text-[#66716e]">
          Add the people or teams calls should reach. When a caller mentions any of a
          contact&apos;s keywords, the agent transfers them to that number and/or emails a
          summary.
        </p>
      </div>

      <div className="mb-6 rounded-[14px] border border-black/10 bg-white p-5">
        <span className="flex items-center gap-2 text-sm font-black">
          <Mail className="h-4 w-4 text-[#148b8e]" />
          Default routing inbox
        </span>
        <p className="mt-1 mb-3 text-sm text-[#7a8582]">
          A pooled address summaries fall back to - used by any contact set to “send to
          default”, and when no specific contact matches.
        </p>
        <input
          value={defaultEmail}
          onChange={(event) => onDefaultEmailChange(event.target.value)}
          placeholder="info@yourbusiness.co.uk"
          className="h-12 w-full max-w-md rounded-lg border border-black/15 bg-white px-4 text-sm outline-none transition focus:border-[#111716]"
        />
      </div>

      {contacts.length > 0 ? (
        <div className="space-y-4">
          {contacts.map((contact) => (
            <ContactCard
              key={contact.id}
              contact={contact}
              defaultEmail={defaultEmail}
              onChange={(patch) => update(contact.id, patch)}
              onRemove={() => remove(contact.id)}
            />
          ))}
        </div>
      ) : (
        <div className="rounded-[14px] border border-dashed border-black/15 bg-white px-5 py-10 text-center text-[#66716e]">
          No routing contacts yet. Add your first one below.
        </div>
      )}

      <button
        type="button"
        onClick={add}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-dashed border-black/20 px-5 py-3 text-sm font-black text-[#148b8e] transition hover:bg-[#f7f8f7]"
      >
        <Plus className="h-4 w-4" />
        Add contact
      </button>

      <div className="mt-8 border-t border-black/10 pt-6">
        <button
          type="button"
          onClick={onSave}
          disabled={isPending}
          className="inline-flex items-center gap-2 rounded-lg bg-[#111716] px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
        >
          {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
          {isPending ? "Saving…" : saved ? "Saved" : "Save routing"}
        </button>
        {saveError && <p className="mt-2 text-sm text-red-600">{saveError}</p>}
      </div>
    </div>
  );
}

function ContactCard({
  contact,
  defaultEmail,
  onChange,
  onRemove,
}: {
  contact: RoutingContact;
  defaultEmail: string;
  onChange: (patch: Partial<RoutingContact>) => void;
  onRemove: () => void;
}) {
  return (
    <div className="rounded-[14px] border border-black/10 bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-black">
          <UserRound className="h-4 w-4 text-[#148b8e]" />
          {contact.name.trim() || "New contact"}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove contact"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#7a8582] transition hover:bg-[#fdeaea] hover:text-[#c0392b]"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Name" value={contact.name} onChange={(v) => onChange({ name: v })} />
        <Field
          label="Mobile / DDI"
          value={contact.phone}
          onChange={(v) => onChange({ phone: v })}
        />
        <div className="sm:col-span-2">
          <span className="mb-2 block text-sm font-black">Email</span>
          {contact.useDefaultEmail ? (
            <div className="flex h-12 items-center rounded-lg border border-dashed border-black/15 bg-[#fbfcfc] px-4 text-sm text-[#66716e]">
              Summaries go to the default inbox
              {defaultEmail ? ` · ${defaultEmail}` : ""}
            </div>
          ) : (
            <input
              value={contact.email}
              onChange={(event) => onChange({ email: event.target.value })}
              placeholder="name@business.co.uk"
              className="h-12 w-full rounded-lg border border-black/15 bg-white px-4 text-sm outline-none transition focus:border-[#111716]"
            />
          )}
          <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-sm text-[#66716e]">
            <input
              type="checkbox"
              checked={contact.useDefaultEmail}
              onChange={(event) => onChange({ useDefaultEmail: event.target.checked })}
              className="h-4 w-4 rounded border-black/30 accent-[#148b8e]"
            />
            Send to default inbox instead
          </label>
        </div>
      </div>

      <div className="mt-4">
        <span className="mb-2 block text-sm font-black">Keywords</span>
        <KeywordInput
          keywords={contact.keywords}
          onChange={(keywords) => onChange({ keywords })}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        <RouteToggle
          active={contact.transfer}
          icon={Phone}
          label="Transfer call"
          onClick={() => onChange({ transfer: !contact.transfer })}
        />
        <RouteToggle
          active={contact.notify}
          icon={Mail}
          label="Email summary"
          onClick={() => onChange({ notify: !contact.notify })}
        />
      </div>
    </div>
  );
}

function RouteToggle({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: LucideIcon;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-bold transition ${
        active
          ? "border-[#148b8e] bg-[#e6fbfc] text-[#0f6f72]"
          : "border-black/15 bg-white text-[#7a8582] hover:bg-[#f7f8f7]"
      }`}
    >
      <Icon className="h-4 w-4" />
      {label}
      {active && <Check className="h-3.5 w-3.5" />}
    </button>
  );
}

function KeywordInput({
  keywords,
  onChange,
}: {
  keywords: string[];
  onChange: (keywords: string[]) => void;
}) {
  const [draft, setDraft] = useState("");

  function commit(value: string) {
    const next = value.replace(/,/g, "").trim();
    if (!next) {
      setDraft("");
      return;
    }
    if (!keywords.some((k) => k.toLowerCase() === next.toLowerCase())) {
      onChange([...keywords, next]);
    }
    setDraft("");
  }

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-black/15 bg-white px-3 py-2.5 focus-within:border-[#111716]">
      {keywords.map((keyword) => (
        <span
          key={keyword}
          className="inline-flex items-center gap-1.5 rounded-full bg-[#eef1f0] px-3 py-1 text-sm font-bold"
        >
          {keyword}
          <button
            type="button"
            onClick={() => onChange(keywords.filter((k) => k !== keyword))}
            aria-label={`Remove ${keyword}`}
            className="text-[#7a8582] transition hover:text-[#111716]"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(event) => {
          const value = event.target.value;
          if (value.endsWith(",")) commit(value);
          else setDraft(value);
        }}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            event.preventDefault();
            commit(draft);
          } else if (event.key === "Backspace" && !draft && keywords.length) {
            onChange(keywords.slice(0, -1));
          }
        }}
        onBlur={() => commit(draft)}
        placeholder={keywords.length ? "Add another…" : "Type a keyword and press Enter"}
        className="min-w-[150px] flex-1 bg-transparent text-sm outline-none placeholder:text-[#9aa4a1]"
      />
    </div>
  );
}

function formatWhen(iso: string): string {
  if (!iso) return "-";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// ── AI Insights ─────────────────────────────────────────────────────────────
// Plain-English business insights rolled up from each call's AI analysis. The
// heavy lifting (aggregation, tenant scoping) happens server-side in
// /api/insights; this component only renders, switches date range, and kicks off
// a one-time backfill for any un-analysed history.

const INSIGHT_RANGES: { value: InsightsRange; label: string }[] = [
  { value: "today", label: "Today" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
];

const ATTENTION_STYLE: Record<
  AttentionItem["kind"],
  { label: string; icon: LucideIcon; tone: string }
> = {
  complaint: { label: "Complaint", icon: ThumbsDown, tone: "text-[#c0392b] bg-[#fdecea]" },
  urgent: { label: "Urgent", icon: Flame, tone: "text-[#c2620a] bg-[#fdf1e3]" },
  unanswered: { label: "Unanswered", icon: HelpCircle, tone: "text-[#7a5b00] bg-[#fdf7e3]" },
};

// A collapsible card used for the detail-heavy insight lists, so the page stays
// scannable: a header (title + icon + count) you click to expand the contents.
function CollapsibleSection({
  title,
  icon: Icon,
  accent,
  count,
  subtitle,
  defaultOpen = false,
  children,
}: {
  title: string;
  icon: LucideIcon;
  accent: string;
  count: number;
  subtitle?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="mt-6 rounded-[18px] border border-black/10 bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left sm:px-6"
      >
        <Icon className="h-5 w-5 flex-shrink-0" style={{ color: accent }} />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-black text-[#111716]">
            {title}
            <span
              className="rounded-full px-2 py-0.5 text-xs font-bold"
              style={{ backgroundColor: `${accent}1a`, color: accent }}
            >
              {count}
            </span>
          </h2>
          {subtitle && !open ? (
            <p className="mt-0.5 truncate text-sm text-[#66716e]">{subtitle}</p>
          ) : null}
        </div>
        <ChevronDown
          className={`h-5 w-5 flex-shrink-0 text-[#9aa5a2] transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? <div className="border-t border-black/5 px-5 pb-5 pt-4 sm:px-6">{children}</div> : null}
    </section>
  );
}

function AiInsights({
  initial,
  analysisEnabled,
  onViewCalls,
  onOpenCall,
}: {
  initial?: DashboardInsights;
  analysisEnabled: boolean;
  onViewCalls: () => void;
  onOpenCall: (callId: string) => void;
}) {
  const [range, setRange] = useState<InsightsRange>(initial?.range ?? "7d");
  const [insights, setInsights] = useState<DashboardInsights | undefined>(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const backfillStarted = useRef(false);

  async function load(next: InsightsRange) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/insights?range=${next}`, { cache: "no-store" });
      const data = await res.json();
      if (!res.ok || !data.ok) throw new Error(data.error || "Could not load insights.");
      setInsights(data.insights as DashboardInsights);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load insights.");
    } finally {
      setLoading(false);
    }
  }

  function selectRange(next: InsightsRange) {
    if (next === range) return;
    setRange(next);
    void load(next);
  }

  // One-time backfill: if there's call history that has never been analysed,
  // analyse it in small batches, then refresh. Runs at most once per mount.
  useEffect(() => {
    if (backfillStarted.current) return;
    if (!analysisEnabled) return;
    if (!insights || insights.pendingAnalysis <= 0) return;
    backfillStarted.current = true;

    let cancelled = false;
    (async () => {
      setAnalysing(true);
      try {
        for (let i = 0; i < 12; i += 1) {
          const res = await fetch("/api/insights/backfill", { method: "POST" });
          const data = await res.json().catch(() => ({}));
          if (cancelled || !res.ok || !data.ok) break;
          if (data.analysed === 0 || data.remaining === 0) break;
        }
        if (!cancelled) await load(range);
      } finally {
        if (!cancelled) setAnalysing(false);
      }
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisEnabled, insights?.pendingAnalysis]);

  const header = (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-black sm:text-4xl">
          <Sparkles className="h-6 w-6 text-[#148b8e]" />
          AI Insights
        </h1>
        <p className="mt-2 text-[#66716e]">
          What your callers wanted, and what needs your attention.
        </p>
      </div>
      <div className="inline-flex rounded-lg border border-black/10 bg-white p-1">
        {INSIGHT_RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => selectRange(r.value)}
            className={`rounded-md px-4 py-2 text-sm font-bold transition ${
              range === r.value
                ? "bg-[#111716] text-white"
                : "text-[#66716e] hover:bg-[#f2f4f3]"
            }`}
          >
            {r.label}
          </button>
        ))}
      </div>
    </div>
  );

  if (loading && !insights) {
    return (
      <div>
        {header}
        <div className="flex items-center justify-center rounded-[18px] border border-black/10 bg-white px-5 py-24 text-[#66716e]">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading insights…
        </div>
      </div>
    );
  }

  if (error && !insights) {
    return (
      <div>
        {header}
        <div className="rounded-[18px] border border-black/10 bg-white px-5 py-16 text-center">
          <p className="font-black text-[#111716]">We couldn&apos;t load your insights.</p>
          <p className="mt-1 text-sm text-[#66716e]">{error}</p>
          <button
            type="button"
            onClick={() => load(range)}
            className="mt-4 inline-flex items-center gap-2 rounded-lg bg-[#111716] px-4 py-2 text-sm font-black text-white transition hover:bg-[#263130]"
          >
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        </div>
      </div>
    );
  }

  const i = insights as DashboardInsights;

  // Empty state - no calls at all yet, or none in the chosen range.
  if (i.totalCalls === 0) {
    return (
      <div>
        {header}
        <div className="rounded-[18px] border border-dashed border-black/15 bg-white px-5 py-20 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-[#e6fbfc]">
            <Sparkles className="h-7 w-7 text-[#148b8e]" />
          </div>
          <p className="text-lg font-black text-[#111716]">
            {i.hasAnyCalls ? "No calls in this period" : "No insights yet"}
          </p>
          <p className="mx-auto mt-2 max-w-md text-[#66716e]">
            {i.hasAnyCalls
              ? "Try a longer date range to see insights from earlier calls."
              : "Once your AI agent has handled calls, insights will appear here."}
          </p>
        </div>
      </div>
    );
  }

  const analysedKnown = i.analysedCalls > 0;

  return (
    <div>
      {header}

      {/* AI-generated weekly summary */}
      <section className="mb-6 rounded-[18px] border border-[#148b8e]/25 bg-gradient-to-br from-[#f3fbfb] to-white px-5 py-5 sm:px-6">
        <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-[#148b8e]">
          <Sparkles className="h-4 w-4" />
          Here&apos;s what changed in your calls
        </p>
        <p className="mt-2 text-base leading-relaxed text-[#111716] sm:text-lg">{i.summary}</p>
        {analysing && (
          <p className="mt-3 flex items-center gap-2 text-sm text-[#66716e]">
            <Loader2 className="h-4 w-4 animate-spin" />
            Analysing your recent calls… numbers will update shortly.
          </p>
        )}
        {!analysisEnabled && i.pendingAnalysis > 0 && (
          <p className="mt-3 text-sm text-[#66716e]">
            {i.pendingAnalysis} call{i.pendingAnalysis === 1 ? "" : "s"} not yet analysed (AI
            analysis isn&apos;t switched on).
          </p>
        )}
      </section>

      {/* Headline cards */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <InsightCard
          label="Calls handled"
          value={i.totalCalls}
          icon={PhoneMissed}
          accent="#148b8e"
          onClick={onViewCalls}
        />
        <InsightCard
          label="Missed / escalated"
          value={i.missedOrEscalated}
          icon={AlertTriangle}
          accent="#c2620a"
          onClick={onViewCalls}
        />
        <InsightCard
          label="Bookings"
          value={i.bookingCount}
          icon={CalendarCheck}
          accent="#16a66a"
          onClick={onViewCalls}
        />
        <InsightCard
          label="New leads"
          value={i.leadCount}
          icon={TrendingUp}
          accent="#2d6cdf"
          onClick={onViewCalls}
        />
        <InsightCard
          label="Conversion rate"
          value={`${i.conversionRate}%`}
          icon={TrendingUp}
          accent="#16a66a"
          hint="Bookings + leads"
        />
        <InsightCard
          label="Urgent calls"
          value={i.urgentCount}
          icon={Flame}
          accent="#c2620a"
        />
        <InsightCard
          label="Complaints"
          value={i.complaintCount}
          icon={ThumbsDown}
          accent="#c0392b"
        />
        <InsightCard
          label="Unanswered questions"
          value={i.unansweredQuestions.length}
          icon={HelpCircle}
          accent="#7a5b00"
        />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Sentiment split */}
        <section className="rounded-[18px] border border-black/10 bg-white p-5 sm:p-6">
          <h2 className="text-lg font-black text-[#111716]">How callers felt</h2>
          {analysedKnown ? (
            <>
              <SentimentBar sentiment={i.sentiment} />
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <SentimentStat
                  icon={ThumbsUp}
                  label="Positive"
                  value={i.sentiment.positive}
                  tone="text-[#16a66a]"
                />
                <SentimentStat
                  icon={MessageSquareText}
                  label="Neutral"
                  value={i.sentiment.neutral}
                  tone="text-[#66716e]"
                />
                <SentimentStat
                  icon={ThumbsDown}
                  label="Negative"
                  value={i.sentiment.negative}
                  tone="text-[#c0392b]"
                />
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-[#66716e]">
              Sentiment will appear once your calls have been analysed.
            </p>
          )}
        </section>

        {/* Top call reasons */}
        <section className="rounded-[18px] border border-black/10 bg-white p-5 sm:p-6">
          <h2 className="text-lg font-black text-[#111716]">Top reasons people called</h2>
          {i.topReasons.length > 0 ? (
            <ul className="mt-4 space-y-3">
              {i.topReasons.map((reason) => (
                <TopReasonRow
                  key={reason.label}
                  reason={reason}
                  max={i.topReasons[0].count}
                  onClick={onViewCalls}
                />
              ))}
            </ul>
          ) : (
            <p className="mt-4 text-sm text-[#66716e]">
              Call reasons will appear once your calls have been analysed.
            </p>
          )}
        </section>
      </div>

      {/* Needs attention - open by default (the actionable one) */}
      <CollapsibleSection
        title="Needs attention"
        icon={AlertTriangle}
        accent="#c2620a"
        count={i.attention.length}
        defaultOpen={i.attention.length > 0}
        subtitle="Complaints, urgent calls and unanswered questions"
      >
        {i.attention.length > 0 ? (
          <ul className="divide-y divide-black/5">
            {i.attention.map((item, idx) => (
              <AttentionRow key={`${item.callId}-${idx}`} item={item} onOpen={onOpenCall} />
            ))}
          </ul>
        ) : (
          <p className="rounded-lg bg-[#f3fbf6] px-4 py-6 text-center text-sm font-semibold text-[#16a66a]">
            Nothing needs your attention right now. 🎉
          </p>
        )}
      </CollapsibleSection>

      {/* Opportunities - collapsed by default */}
      {i.opportunities.length > 0 && (
        <CollapsibleSection
          title="Opportunities & lost sales"
          icon={TrendingUp}
          accent="#2d6cdf"
          count={i.opportunities.length}
          subtitle="Leads and enquiries worth a follow-up"
        >
          <ul className="space-y-2">
            {i.opportunities.map((opp, idx) => (
              <CallRefRow key={`${opp.callId}-${idx}`} item={opp} onOpen={onOpenCall} />
            ))}
          </ul>
        </CollapsibleSection>
      )}

      {/* Common unanswered questions - collapsed by default */}
      {i.unansweredQuestions.length > 0 && (
        <CollapsibleSection
          title="Common unanswered questions"
          icon={HelpCircle}
          accent="#7a5b00"
          count={i.unansweredQuestions.length}
          subtitle="Questions your agent couldn't answer - worth adding to its knowledge"
        >
          <ul className="space-y-2">
            {i.unansweredQuestions.map((q, idx) => (
              <CallRefRow key={`${q.callId}-${idx}`} item={q} onOpen={onOpenCall} />
            ))}
          </ul>
        </CollapsibleSection>
      )}
    </div>
  );
}

function InsightCard({
  label,
  value,
  icon: Icon,
  accent,
  hint,
  onClick,
}: {
  label: string;
  value: number | string;
  icon: LucideIcon;
  accent: string;
  hint?: string;
  onClick?: () => void;
}) {
  const inner = (
    <>
      <div className="flex items-start justify-between">
        <span
          className="flex h-9 w-9 items-center justify-center rounded-lg"
          style={{ backgroundColor: `${accent}1a`, color: accent }}
        >
          <Icon className="h-5 w-5" />
        </span>
        {onClick && <ChevronRight className="h-4 w-4 text-[#9aa5a2]" />}
      </div>
      <p className="mt-3 text-2xl font-black text-[#111716] sm:text-3xl">{value}</p>
      <p className="mt-0.5 text-sm font-semibold text-[#66716e]">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-[#9aa5a2]">{hint}</p>}
    </>
  );
  const base =
    "rounded-[16px] border border-black/10 bg-white p-4 text-left transition sm:p-5";
  return onClick ? (
    <button type="button" onClick={onClick} className={`${base} hover:bg-[#f7f8f7]`}>
      {inner}
    </button>
  ) : (
    <div className={base}>{inner}</div>
  );
}

function SentimentBar({
  sentiment,
}: {
  sentiment: { positive: number; neutral: number; negative: number };
}) {
  const total = sentiment.positive + sentiment.neutral + sentiment.negative;
  const pct = (n: number) => (total > 0 ? (n / total) * 100 : 0);
  return (
    <div className="mt-4 flex h-4 w-full overflow-hidden rounded-full bg-[#f2f4f3]">
      <div style={{ width: `${pct(sentiment.positive)}%` }} className="bg-[#16a66a]" />
      <div style={{ width: `${pct(sentiment.neutral)}%` }} className="bg-[#c9d1ce]" />
      <div style={{ width: `${pct(sentiment.negative)}%` }} className="bg-[#c0392b]" />
    </div>
  );
}

function SentimentStat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  tone: string;
}) {
  return (
    <div className="rounded-lg bg-[#f7f8f7] py-3">
      <Icon className={`mx-auto h-5 w-5 ${tone}`} />
      <p className="mt-1 text-xl font-black text-[#111716]">{value}</p>
      <p className="text-xs font-semibold text-[#66716e]">{label}</p>
    </div>
  );
}

function TopReasonRow({
  reason,
  max,
  onClick,
}: {
  reason: LabelCount;
  max: number;
  onClick: () => void;
}) {
  const width = max > 0 ? Math.max(6, (reason.count / max) * 100) : 0;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-center gap-3 text-left"
      >
        <span className="w-36 flex-shrink-0 truncate text-sm font-semibold text-[#111716] sm:w-44">
          {reason.label}
        </span>
        <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-[#f2f4f3]">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-[#41c9ce] transition-all group-hover:bg-[#148b8e]"
            style={{ width: `${width}%` }}
          />
        </span>
        <span className="w-8 flex-shrink-0 text-right text-sm font-black text-[#111716]">
          {reason.count}
        </span>
      </button>
    </li>
  );
}

function AttentionRow({
  item,
  onOpen,
}: {
  item: AttentionItem;
  onOpen: (callId: string) => void;
}) {
  const style = ATTENTION_STYLE[item.kind];
  const Icon = style.icon;
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item.callId)}
        className="flex w-full items-start gap-3 py-3 text-left transition hover:bg-[#f7f8f7]"
      >
        <span
          className={`mt-0.5 flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-black uppercase tracking-wide ${style.tone}`}
        >
          <Icon className="h-3.5 w-3.5" />
          {style.label}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-[#111716]">
            {item.detail}
          </span>
          <span className="mt-0.5 block text-xs text-[#9aa5a2]">
            {item.caller} · {formatWhen(item.startedAt)}
          </span>
        </span>
        <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-[#9aa5a2]" />
      </button>
    </li>
  );
}

function CallRefRow({
  item,
  onOpen,
}: {
  item: CallReference;
  onOpen: (callId: string) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(item.callId)}
        className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-[#f7f8f7]"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-[#111716]">{item.detail}</span>
          <span className="mt-0.5 block text-xs text-[#9aa5a2]">
            {item.caller} · {formatWhen(item.startedAt)}
          </span>
        </span>
        <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-[#9aa5a2]" />
      </button>
    </li>
  );
}

// A small channel badge for the history list - at a glance, how the conversation
// arrived (phone / WhatsApp / email / website chat).
const channelMeta: Record<CallChannel, { Icon: LucideIcon; label: string; bg: string; fg: string }> = {
  phone: { Icon: Phone, label: "Phone call", bg: "bg-[#eefbfb]", fg: "text-[#148b8e]" },
  whatsapp: { Icon: MessageCircle, label: "WhatsApp", bg: "bg-[#eafaf1]", fg: "text-[#14823f]" },
  sms: { Icon: MessageSquare, label: "SMS", bg: "bg-[#f5f0ff]", fg: "text-[#7c3aed]" },
  email: { Icon: Mail, label: "Email", bg: "bg-[#eef2fb]", fg: "text-[#3b5bb5]" },
  chat: { Icon: MessageSquareText, label: "Website chat", bg: "bg-[#eefbfb]", fg: "text-[#148b8e]" },
};

function ChannelIcon({ channel }: { channel: CallChannel }) {
  const { Icon, label, bg, fg } = channelMeta[channel] ?? channelMeta.phone;
  return (
    <span
      title={label}
      aria-label={label}
      className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl ${bg} ${fg}`}
    >
      <Icon className="h-4 w-4" />
    </span>
  );
}

function CallHistory({
  callLogs,
  onOpen,
}: {
  callLogs: CallLog[];
  onOpen: (log: CallLog) => void;
}) {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-black sm:text-4xl">Call History</h1>
        <p className="mt-2 text-[#66716e]">
          {callLogs.length} call{callLogs.length !== 1 ? "s" : ""} handled by your agents.
        </p>
      </div>

      <section className="overflow-hidden rounded-[18px] border border-black/10 bg-white">
        <div className="grid grid-cols-[1fr_200px_130px_80px] border-b border-black/10 bg-[#fbfcfc] px-5 py-4 text-sm font-bold text-[#66716e] max-md:hidden">
          <span>Caller</span>
          <span>Summary</span>
          <span>Outcome</span>
          <span>Length</span>
        </div>
        {callLogs.length > 0 ? (
          <>
            <div className="divide-y divide-black/10 md:hidden">
              {callLogs.map((log) => (
                <button
                  type="button"
                  key={log.id}
                  onClick={() => onOpen(log)}
                  className="flex w-full flex-col gap-3 px-4 py-4 text-left transition hover:bg-[#f7f8f7]"
                >
                  <div className="flex items-center gap-3">
                    <ChannelIcon channel={log.channel} />
                    <div>
                      <span className="block font-black">{log.caller}</span>
                      <span className="mt-1 block text-xs text-[#66716e]">{formatWhen(log.startedAt)}</span>
                    </div>
                  </div>
                  <MobileField label="Summary">
                    <span className="text-sm text-[#66716e]">{log.summary || "-"}</span>
                  </MobileField>
                  <div className="grid grid-cols-2 gap-3">
                    <MobileField label="Outcome">
                      <span className="text-sm text-[#66716e]">{friendlyOutcome(log.outcome)}</span>
                    </MobileField>
                    <MobileField label="Length">
                      <span className="font-mono text-sm text-[#66716e]">{log.durationLabel}</span>
                    </MobileField>
                  </div>
                </button>
              ))}
            </div>
            <div className="hidden divide-y divide-black/10 md:block">
              {callLogs.map((log) => (
                <button
                  type="button"
                  key={log.id}
                  onClick={() => onOpen(log)}
                  className="grid w-full grid-cols-[1fr_200px_130px_80px] gap-4 px-5 py-4 text-left transition hover:bg-[#f7f8f7]"
                >
                  <span className="flex items-center gap-3">
                    <ChannelIcon channel={log.channel} />
                    <span>
                      <span className="block font-black">{log.caller}</span>
                      <span className="mt-1 block text-xs text-[#66716e]">{formatWhen(log.startedAt)}</span>
                    </span>
                  </span>
                  <span className="truncate text-sm text-[#66716e]">{log.summary || "-"}</span>
                  <span className="text-sm text-[#66716e]">{friendlyOutcome(log.outcome)}</span>
                  <span className="font-mono text-sm text-[#66716e]">{log.durationLabel}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="px-5 py-16 text-center text-[#66716e]">No calls yet.</div>
        )}
      </section>
    </div>
  );
}

function CallDetailModal({ log, onClose }: { log: CallLog; onClose: () => void }) {
  return (
    <div className={MODAL_OVERLAY}>
      <div className={`${MODAL_PANEL} max-w-2xl`}>
        <div className="flex items-start justify-between border-b border-black/10 px-7 py-5">
          <div>
            <h2 className="text-xl font-black">{log.caller}</h2>
            <p className="mt-1 text-sm text-[#66716e]">
              {formatWhen(log.startedAt)} · {log.durationLabel}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#7a8582] transition hover:bg-[#f2f4f3] hover:text-[#111716]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-5 overflow-y-auto px-7 py-6">
          {log.outcome && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7a8582]">
                Outcome
              </p>
              <p className="text-sm">{friendlyOutcome(log.outcome)}</p>
            </div>
          )}
          {log.summary && (
            <div>
              <p className="mb-1 text-xs font-bold uppercase tracking-wide text-[#7a8582]">
                Summary
              </p>
              <p className="text-sm leading-relaxed">{log.summary}</p>
            </div>
          )}
          {log.transcript && (
            <div>
              <p className="mb-3 text-xs font-bold uppercase tracking-wide text-[#7a8582]">
                Transcript
              </p>
              <TranscriptView transcript={log.transcript} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

type TranscriptTurn = { speaker: "agent" | "caller"; text: string };

const CALLER_LABEL =
  /^(?:customer(?:\s*\([^)]+\))?|user|caller|human|visitor)\s*:\s*([\s\S]*)$/i;
const AGENT_LABEL = /^(?:assistant|agent|ai|bot|wisecall)\s*:\s*([\s\S]*)$/i;
const CHANNEL_CUSTOMER = /(?:^|\n)(Customer(?:\s*\([^)]+\))?\s*:\s*)/gi;

function speakerFromLabel(label: string): TranscriptTurn["speaker"] {
  const role = label.replace(/\s*\([^)]*\)/, "").trim().toLowerCase();
  return ["user", "caller", "customer", "human", "visitor"].includes(role) ? "caller" : "agent";
}

function parseSpeakerSegment(segment: string): TranscriptTurn | null {
  const trimmed = segment.trim();
  if (!trimmed) return null;
  const labelMatch = trimmed.match(
    /^(Customer(?:\s*\([^)]+\))?|User|Caller|Visitor|Human|Assistant|Agent|AI|Bot|WiseCall)\s*:\s*([\s\S]*)$/i,
  );
  if (labelMatch) {
    return {
      speaker: speakerFromLabel(labelMatch[1]),
      text: labelMatch[2].trim(),
    };
  }
  const caller = trimmed.match(CALLER_LABEL);
  if (caller) return { speaker: "caller", text: caller[1].trim() };
  const agent = trimmed.match(AGENT_LABEL);
  if (agent) return { speaker: "agent", text: agent[1].trim() };
  return { speaker: "agent", text: trimmed };
}

function pushTurn(turns: TranscriptTurn[], speaker: TranscriptTurn["speaker"], text: string) {
  const cleaned = text.trim();
  if (!cleaned) return;
  const last = turns[turns.length - 1];
  if (last && last.speaker === speaker) {
    last.text = `${last.text}\n\n${cleaned}`;
    return;
  }
  turns.push({ speaker, text: cleaned });
}

// Multi-turn SMS / WhatsApp test logs often alternate:
//   Customer (SMS): …
//   [agent reply paragraphs]
//   Customer (SMS): …
function parseChannelThread(body: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  const markers: { index: number; length: number }[] = [];
  for (const match of body.matchAll(CHANNEL_CUSTOMER)) {
    if (match.index != null) markers.push({ index: match.index, length: match[0].length });
  }
  if (!markers.length) return [];

  let cursor = 0;
  for (let i = 0; i < markers.length; i += 1) {
    const marker = markers[i];
    const agentBefore = body.slice(cursor, marker.index).trim();
    if (agentBefore) pushTurn(turns, "agent", agentBefore);

    const sliceEnd = i + 1 < markers.length ? markers[i + 1].index : body.length;
    const block = body.slice(marker.index + marker.length, sliceEnd).trim();
    if (!block) {
      cursor = sliceEnd;
      continue;
    }

    const newline = block.indexOf("\n");
    if (newline === -1) {
      pushTurn(turns, "caller", block);
    } else {
      pushTurn(turns, "caller", block.slice(0, newline).trim());
      pushTurn(turns, "agent", block.slice(newline + 1).trim());
    }
    cursor = sliceEnd;
  }

  const tail = body.slice(cursor).trim();
  if (tail) pushTurn(turns, "agent", tail);
  return turns;
}

function parseLineTranscript(body: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const line of body.split(/\n/)) {
    const lineText = line.trim();
    if (!lineText) continue;
    const parsed = parseSpeakerSegment(lineText);
    if (!parsed) continue;
    const hasExplicitLabel =
      CALLER_LABEL.test(lineText) ||
      AGENT_LABEL.test(lineText) ||
      /^Customer(?:\s*\([^)]+\))?\s*:/i.test(lineText);
    const last = turns[turns.length - 1];
    if (last && !hasExplicitLabel) {
      last.text += ` ${parsed.text}`;
    } else {
      turns.push(parsed);
    }
  }
  return turns;
}

function parseParagraphTranscript(body: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const block of body.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean)) {
    const parsed = parseSpeakerSegment(block);
    if (!parsed) continue;
    const hasLabel =
      /^(Customer(?:\s*\([^)]+\))?|User|Caller|Visitor|Human|Assistant|Agent|AI|Bot|WiseCall)\s*:/i.test(
        block,
      );
    pushTurn(turns, hasLabel ? parsed.speaker : "agent", hasLabel ? parsed.text : block);
  }
  return turns;
}

// Transcripts are stored line-by-line as "assistant: …" / "user: …", as channel
// sections ("--- Their message ---"), or as labelled turns like "Customer (SMS):".
// Normalise every format into caller/agent chat turns for the detail modal.
function parseTranscript(raw: string): TranscriptTurn[] {
  const text = raw.replace(/\r\n/g, "\n").trim();
  if (!text) return [];

  // Email / SMS / WhatsApp single-exchange logs.
  if (/---\s*their message\s*---/i.test(text) && /---\s*wisecall reply\s*---/i.test(text)) {
    const their = text
      .match(/---\s*their message\s*---\s*([\s\S]*?)\s*---\s*wisecall reply\s*---/i)?.[1]
      ?.trim();
    const reply = text.match(/---\s*wisecall reply\s*---\s*([\s\S]*)$/i)?.[1]?.trim();
    const out: TranscriptTurn[] = [];
    if (their) out.push({ speaker: "caller", text: their });
    if (reply) out.push({ speaker: "agent", text: reply });
    if (out.length) return out;
  }

  // Drop envelope headers (FROM:/SUBJECT:/TO:) before parsing turns.
  const body = text.replace(/^(?:FROM|SUBJECT|TO):\s*.+\n?/gim, "").trim();

  if (/Customer\s*(?:\([^)]+\))?\s*:/i.test(body)) {
    const threaded = parseChannelThread(body);
    if (threaded.length) return threaded;
  }

  if (/^(?:user|assistant|caller|agent)\s*:/im.test(body)) {
    const lined = parseLineTranscript(body);
    if (lined.length) return lined;
  }

  if (/^(?:Visitor|WiseCall)\s*:/im.test(body)) {
    const lined = parseLineTranscript(body);
    if (lined.length) return lined;
  }

  const paragraphs = parseParagraphTranscript(body);
  if (paragraphs.length) return paragraphs;

  const single = parseSpeakerSegment(body);
  return single ? [single] : [];
}

function TranscriptView({ transcript }: { transcript: string }) {
  const turns = parseTranscript(transcript);
  return (
    <div className="space-y-2.5 rounded-lg bg-[#f7f8f7] p-4">
      {turns.map((turn, index) => {
        const isCaller = turn.speaker === "caller";
        return (
          <div key={index} className={`flex ${isCaller ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[82%] rounded-2xl px-4 py-2.5 ${
                isCaller
                  ? "rounded-br-sm bg-[#172929] text-white"
                  : "rounded-bl-sm bg-[#e6fbfc] text-[#111716]"
              }`}
            >
              <p
                className={`mb-0.5 text-[11px] font-black uppercase tracking-wide ${
                  isCaller ? "text-[#7de8eb]" : "text-[#148b8e]"
                }`}
              >
                {isCaller ? "Caller" : "Agent"}
              </p>
              <p className="text-sm leading-relaxed">{turn.text}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function RoutingCard({
  routing,
  smsNumber,
  whatsappNumber,
  isProvisioning,
  error,
  onProvision,
}: {
  routing: AgentRouting;
  smsNumber?: string;
  whatsappNumber?: string;
  isProvisioning: boolean;
  error: string | null;
  onProvision: () => void;
}) {
  const live = routing.status === "live";
  const pending = routing.status === "pending";
  const dot = live ? "bg-[#16a66a]" : pending ? "bg-[#d9920a]" : "bg-[#9aa4a1]";
  const heading = live
    ? routing.number
    : pending
      ? "Setting up your phone number"
      : "No phone number assigned yet";
  const sub = live
    ? "Live and answering calls"
    : pending
      ? "WiseCall is provisioning your number - usually ready within 5 minutes. Refresh the page to check."
      : "Assign a number to put this agent on a phone line.";

  return (
    <div className="mb-8 rounded-[14px] border border-black/10 bg-[#fbfcfc] px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <Phone className="h-5 w-5 text-[#148b8e]" />
            <div>
              <p className="flex items-center gap-2 font-black">
                <span className={`h-2 w-2 rounded-full ${dot}`} />
                {heading}
              </p>
              <p className="mt-0.5 text-sm text-[#66716e]">{sub}</p>
            </div>
          </div>
          {smsNumber ? (
            <div className="flex items-center gap-3">
              <MessageSquare className="h-5 w-5 text-[#7c3aed]" />
              <div>
                <p className="flex items-center gap-2 font-black">
                  <span className="h-2 w-2 rounded-full bg-[#16a66a]" />
                  {smsNumber}
                </p>
                <p className="mt-0.5 text-sm text-[#66716e]">SMS messages &amp; notifications</p>
              </div>
            </div>
          ) : null}
          {whatsappNumber ? (
            <div className="flex items-center gap-3">
              <MessageCircle className="h-5 w-5 text-[#14823f]" />
              <div>
                <p className="flex items-center gap-2 font-black">
                  <span className="h-2 w-2 rounded-full bg-[#16a66a]" />
                  {whatsappNumber}
                </p>
                <p className="mt-0.5 text-sm text-[#66716e]">WhatsApp messaging</p>
              </div>
            </div>
          ) : null}
        </div>
        {live && (
          <a
            href={`tel:${routing.number.replace(/[^\d+]/g, "")}`}
            className="inline-flex items-center gap-2 rounded-lg bg-[#7de8eb] px-4 py-2.5 text-sm font-black text-[#0c1717] transition hover:opacity-90"
          >
            <Phone className="h-4 w-4" />
            Call to test
          </a>
        )}
        {!live && (
          <button
            type="button"
            onClick={onProvision}
            disabled={isProvisioning || pending}
            className="inline-flex items-center gap-2 rounded-lg bg-[#111716] px-4 py-2.5 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
          >
            {isProvisioning ? "Assigning…" : "Assign number"}
          </button>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-[#a3791b]">{error}</p>}
    </div>
  );
}

function AbilityRow({
  icon: Icon,
  title,
  body,
  enabled,
  onClick,
}: {
  icon: LucideIcon;
  title: string;
  body: string;
  enabled: boolean;
  onClick?: () => void;
}) {
  const isButton = Boolean(onClick);
  const Wrapper = isButton ? "button" : "div";

  return (
    <Wrapper
      type={isButton ? "button" : undefined}
      onClick={onClick}
      className={`flex w-full items-center gap-4 rounded-[14px] border border-dashed border-black/12 bg-white px-5 py-4 text-left transition ${
        isButton ? "hover:bg-[#f7f8f7]" : ""
      }`}
    >
      <Icon className="h-5 w-5 flex-shrink-0 text-[#148b8e]" />
      <span className="min-w-0 flex-1">
        <span className="block font-black">{title}</span>
        <span className="mt-1 block truncate text-sm text-[#7a8582]">{body}</span>
      </span>
      {enabled ? (
        <Check className="h-5 w-5 flex-shrink-0 text-[#16a66a]" />
      ) : (
        <CirclePlus className="h-5 w-5 flex-shrink-0 text-[#16a66a]" />
      )}
    </Wrapper>
  );
}

function CreateAssistantModal({
  name,
  businessName,
  templateId,
  isCreating,
  error,
  onNameChange,
  onBusinessChange,
  onTemplateChange,
  onClose,
  onCreate,
}: {
  name: string;
  businessName: string;
  templateId: string;
  isCreating: boolean;
  error: string | null;
  onNameChange: (value: string) => void;
  onBusinessChange: (value: string) => void;
  onTemplateChange: (value: string) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  return (
    <div className={MODAL_OVERLAY}>
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-[18px] bg-white p-5 shadow-2xl sm:p-7">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 className="text-2xl font-black">Create Assistant</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#7a8582] transition hover:bg-[#f2f4f3] hover:text-[#111716]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-3 text-sm font-bold text-[#7a8582]">Start from a template</p>
        <div className="mb-6 space-y-3">
          {agentTemplates.map((template) => {
            const selected = template.id === templateId;
            return (
              <button
                type="button"
                key={template.id}
                disabled={!template.available}
                onClick={() => onTemplateChange(template.id)}
                className={`flex w-full items-start gap-3 rounded-[14px] border px-5 py-4 text-left transition ${
                  selected
                    ? "border-[#148b8e] bg-[#e6fbfc]"
                    : "border-black/10 bg-white hover:bg-[#f7f8f7]"
                } ${template.available ? "" : "cursor-not-allowed opacity-50"}`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${
                    selected ? "border-[#148b8e] bg-[#148b8e]" : "border-black/20"
                  }`}
                >
                  {selected && <Check className="h-3.5 w-3.5 text-white" />}
                </span>
                <span className="min-w-0">
                  <span className="block font-black">{template.label}</span>
                  <span className="mt-1 block text-sm text-[#66716e]">
                    {template.description}
                  </span>
                </span>
              </button>
            );
          })}
          <p className="px-1 text-xs text-[#9aa4a1]">
            More industry &amp; integration templates coming soon.
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Receptionist name"
            value={name}
            onChange={onNameChange}
            autoFocus
          />
          <Field label="Business name" value={businessName} onChange={onBusinessChange} />
        </div>

        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isCreating}
            className="rounded-lg bg-[#f2f4f3] px-5 py-3 text-sm font-black transition hover:bg-[#e7ebe9] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={isCreating}
            className="rounded-lg bg-[#111716] px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
          >
            {isCreating ? "Creating…" : "Create Assistant"}
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptModal({
  assistant,
  onChange,
  onClose,
  onSave,
}: {
  assistant: Assistant;
  onChange: (prompt: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className={MODAL_OVERLAY}>
      <div className={`${MODAL_PANEL} max-w-4xl`}>
        <div className="flex items-center justify-between border-b border-black/10 px-7 py-5">
          <div>
            <h2 className="text-2xl font-black">Custom Prompts</h2>
            <p className="mt-1 text-sm text-[#66716e]">{assistant.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#7a8582] transition hover:bg-[#f2f4f3] hover:text-[#111716]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <button
          type="button"
          className="flex items-center justify-between border-b border-black/10 px-7 py-4 text-left font-black text-[#4c3bbd]"
        >
          <span className="inline-flex items-center gap-3">
            <Sparkles className="h-5 w-5" />
            Insert Prompt Template
          </span>
          <ChevronRight className="h-5 w-5 rotate-90" />
        </button>
        <textarea
          value={assistant.prompt}
          onChange={(event) => onChange(event.target.value)}
          className="min-h-0 flex-1 resize-none border-0 px-7 py-6 text-base leading-7 outline-none"
        />
        <div className="flex justify-end gap-3 border-t border-black/10 px-7 py-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#f2f4f3] px-5 py-3 text-sm font-black transition hover:bg-[#e7ebe9]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-[#111716] px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// Lets the customer pick a Cartesia voice and hear a sample. The sample reads
// the agent's own greeting, so they preview exactly what callers will hear. All
// synthesis happens server-side (testVoice); we just play the returned mp3.
function VoicePicker({
  selected,
  greeting,
  onSelect,
}: {
  selected: string;
  greeting: string;
  onSelect: (voice: string) => void;
}) {
  const [loadingVoice, setLoadingVoice] = useState<string | null>(null);
  const [playingVoice, setPlayingVoice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [, startTest] = useTransition();

  function stop() {
    if (audioRef.current) {
      audioRef.current.pause();
      audioRef.current = null;
    }
    setPlayingVoice(null);
  }

  function test(voice: string) {
    setError(null);
    stop();
    setLoadingVoice(voice);
    startTest(async () => {
      const result = await testVoice(voice, greeting);
      setLoadingVoice(null);
      if (!result.ok || !result.audio) {
        setError(result.error ?? "Could not play this voice.");
        return;
      }
      const audio = new Audio(
        `data:${result.mime ?? "audio/mpeg"};base64,${result.audio}`,
      );
      audioRef.current = audio;
      setPlayingVoice(voice);
      audio.onended = () => setPlayingVoice(null);
      audio.onerror = () => {
        setError("Could not play this voice.");
        setPlayingVoice(null);
      };
      void audio.play().catch(() => {
        setError("Could not play this voice.");
        setPlayingVoice(null);
      });
    });
  }

  return (
    <div>
      <div className="grid gap-3 sm:grid-cols-2">
        {cartesiaVoices.map((voice) => {
          const isSelected = voice.id === selected;
          const isLoading = loadingVoice === voice.id;
          const isPlaying = playingVoice === voice.id;
          return (
            <div
              key={voice.id}
              className={`flex items-center gap-2 rounded-[14px] border px-4 py-3 transition ${
                isSelected ? "border-[#148b8e] bg-[#e6fbfc]" : "border-black/10 bg-white"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(voice.id)}
                className="flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${
                    isSelected ? "border-[#148b8e] bg-[#148b8e]" : "border-black/20"
                  }`}
                >
                  {isSelected && <Check className="h-3.5 w-3.5 text-white" />}
                </span>
                <span className="min-w-0">
                  <span className="block font-black">{voice.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-[#7a8582]">
                    {voice.blurb}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => (isPlaying ? stop() : test(voice.id))}
                disabled={isLoading}
                aria-label={isPlaying ? `Stop ${voice.label}` : `Test ${voice.label}`}
                className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg border border-black/10 bg-white text-[#148b8e] transition hover:bg-[#f2f4f3] disabled:opacity-60"
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isPlaying ? (
                  <Volume2 className="h-4 w-4" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </button>
            </div>
          );
        })}
      </div>
      {error && <p className="mt-3 text-sm text-[#a3791b]">{error}</p>}
      <p className="mt-3 px-1 text-xs text-[#9aa4a1]">
        Tap a name to choose the voice, or the play button to hear it read this
        agent&apos;s greeting.
      </p>
    </div>
  );
}

function truncate(value: string, max: number): string {
  const clean = value.replace(/\s+/g, " ").trim();
  return clean.length > max ? `${clean.slice(0, max)}…` : clean;
}

// A small, reusable editor used by the clickable ability rows (Answer Questions,
// Transfer Calls). Single-line by default, or a textarea when `multiline`.
function AbilityEditorModal({
  title,
  subtitle,
  label,
  placeholder,
  value,
  multiline = false,
  onChange,
  onClose,
  onSave,
}: {
  title: string;
  subtitle: string;
  label: string;
  placeholder?: string;
  value: string;
  multiline?: boolean;
  onChange: (value: string) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className={MODAL_OVERLAY}>
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[18px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/10 px-7 py-5">
          <div>
            <h2 className="text-2xl font-black">{title}</h2>
            <p className="mt-1 text-sm text-[#66716e]">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#7a8582] transition hover:bg-[#f2f4f3] hover:text-[#111716]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-7 py-6">
          <span className="mb-2 block text-sm font-black">{label}</span>
          {multiline ? (
            <textarea
              value={value}
              autoFocus
              onChange={(event) => onChange(event.target.value)}
              placeholder={placeholder}
              className="min-h-[180px] w-full resize-none rounded-lg border border-black/15 bg-white px-4 py-3 text-base leading-7 outline-none transition focus:border-[#111716]"
            />
          ) : (
            <input
              value={value}
              autoFocus
              onChange={(event) => onChange(event.target.value)}
              placeholder={placeholder}
              className="h-12 w-full rounded-lg border border-black/15 bg-white px-4 text-sm outline-none transition focus:border-[#111716]"
            />
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-black/10 px-7 py-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#f2f4f3] px-5 py-3 text-sm font-black transition hover:bg-[#e7ebe9]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-[#111716] px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// Friendly, sectioned editor for the agent's business knowledge. Each labelled
// box prompts the user (opening hours, address, pricing…) instead of one blank
// freeform field.
function KnowledgeModal({
  assistant,
  onChange,
  onClose,
  onSave,
}: {
  assistant: Assistant;
  onChange: (fields: KnowledgeFields) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  const fields = assistant.knowledgeFields ?? {};
  return (
    <div className={MODAL_OVERLAY}>
      <div className={`${MODAL_PANEL} max-w-2xl`}>
        <div className="flex items-start justify-between border-b border-black/10 px-7 py-5">
          <div>
            <h2 className="text-2xl font-black">Answer Questions</h2>
            <p className="mt-1 text-sm text-[#66716e]">
              Fill in what {assistant.name} should be able to tell callers. Leave any section
              blank if it doesn&apos;t apply.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-[#7a8582] transition hover:bg-[#f2f4f3] hover:text-[#111716]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-7 py-6">
          {knowledgeSections.map((section) => (
            <label key={section.key} className="block">
              <span className="mb-2 block text-sm font-black">{section.label}</span>
              <textarea
                value={fields[section.key] ?? ""}
                onChange={(event) =>
                  onChange({ ...fields, [section.key]: event.target.value })
                }
                placeholder={section.placeholder}
                rows={section.key === "other" ? 3 : 2}
                className="w-full resize-none rounded-lg border border-black/15 bg-white px-4 py-3 text-sm leading-6 outline-none transition focus:border-[#111716] placeholder:text-[#9aa4a1]"
              />
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-3 border-t border-black/10 px-7 py-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#f2f4f3] px-5 py-3 text-sm font-black transition hover:bg-[#e7ebe9]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-[#111716] px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function GreetingModal({
  assistant,
  onChange,
  onClose,
  onSave,
}: {
  assistant: Assistant;
  onChange: (patch: Partial<Assistant>) => void;
  onClose: () => void;
  onSave: () => void;
}) {
  return (
    <div className={MODAL_OVERLAY}>
      <div className="max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-[18px] bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-black/10 px-7 py-5">
          <div>
            <h2 className="text-2xl font-black">Greeting message</h2>
            <p className="mt-1 text-sm text-[#66716e]">
              The first thing callers hear when {assistant.name} answers.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-[#7a8582] transition hover:bg-[#f2f4f3] hover:text-[#111716]"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-7 py-6">
          <textarea
            value={assistant.greeting}
            autoFocus
            onChange={(event) => onChange({ greeting: event.target.value })}
            placeholder="Hi, thanks for calling. How can I help you today?"
            className="min-h-[140px] w-full resize-none rounded-lg border border-black/15 bg-white px-4 py-3 text-base leading-7 outline-none transition focus:border-[#111716]"
          />
          <p className="mt-3 text-xs text-[#9aa4a1]">
            Keep it short and natural - one or two sentences works best on the phone.
          </p>
        </div>
        <div className="flex justify-end gap-3 border-t border-black/10 px-7 py-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#f2f4f3] px-5 py-3 text-sm font-black transition hover:bg-[#e7ebe9]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-[#111716] px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130]"
          >
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-black">{label}</span>
      <input
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-lg border border-black/15 bg-white px-4 text-sm outline-none transition placeholder:text-[#9aa4a1] focus:border-[#111716]"
      />
    </label>
  );
}

function StatusPill({ status }: { status: Assistant["status"] }) {
  const styles = {
    Live: "bg-[#e7f8ef] text-[#117a4d]",
    Setup: "bg-[#e6fbfc] text-[#148b8e]",
    Review: "bg-[#fff3d8] text-[#835c00]",
  };

  return (
    <span className={`inline-flex rounded-full px-3 py-1 text-xs font-black ${styles[status]}`}>
      {status}
    </span>
  );
}
