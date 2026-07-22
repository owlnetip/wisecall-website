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
  Copy,
  CreditCard,
  Flame,
  FileText,
  Grid2X2,
  Hand,
  HelpCircle,
  History,
  Inbox,
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
  Pause,
  Phone,
  PhoneMissed,
  PhoneOutgoing,
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
import { AgentLearningPanel } from "@/components/agent-learning-panel";
import type { EmailChannelUsage, ChannelUsage, CallUsage } from "@/lib/billing";
import {
  createAgent,
  deleteAgent,
  getPendingAgentsStatus,
  provisionNumber,
  setAgentLive,
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
import type { FollowUp } from "@/lib/follow-ups";
import { updateFollowUpStatus } from "@/app/actions/follow-ups";
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
import { ViewingsView } from "./viewings-view";
import { CalendarBookingCard } from "./calendar-booking-card";
import { RaiseTicketModal } from "./raise-ticket-modal";
import {
  FEATURED_CARTESIA_VOICES,
  type CartesiaVoiceOption,
} from "@/lib/cartesia-voices";
import {
  buildEstateAgentGreeting,
  buildEstateAgentPrompt,
  estateAgentDefaultContacts,
  estateAgentKnowledgeFields,
} from "@/lib/estate-agent-template";
import { SupportChatPanel } from "./support-chat-panel";
import { SetupWizard, type WizardResult } from "./setup-wizard";
import type { AgentDraft } from "@/app/actions/wizard";
import { impersonateCustomerForm, stopImpersonating } from "@/app/actions/admin";
import { OutboundManager } from "@/components/outbound-manager";
import { AgentPreviewModal } from "./agent-preview-modal";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  agentOperationalLabel,
  canPauseAgent,
  canResumeAgent,
  getAgentOperationalState,
  type AgentOperationalState,
} from "@/lib/agent-operational-state";

type View = "insights" | "assistants" | "detail" | "calls" | "contacts" | "viewings" | "channels";
type DetailTab = "behaviour" | "knowledge" | "routing" | "outbound" | "technical";

// Provider-agnostic call routing. The portal stays the same whichever telco
// stack wins, only `provider` and the per-provider fields differ. Persisted in
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
  ownerEmail?: string; // admin view only, which customer owns this agent
  ownerId?: string; // admin view only, owner's auth user id (for "log in as")
};

// Per-day office hours. Only OPEN days are present; a missing day = closed.
// Keys are mon,tue,wed,thu,fri,sat,sun. The runtime reads metadata.office_hours
// to switch the agent into after-hours message-taking mode when closed.
export type OfficeHours = Record<string, { open: string; close: string }>;

// Featured voices (always shown). Full en-GB library loads server-side when
// CARTESIA_API_KEY is set — see listCartesiaVoices().
export const cartesiaVoices: CartesiaVoiceOption[] = FEATURED_CARTESIA_VOICES;

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
export function SupportOwl() {
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
    <label className="flex items-center gap-2 text-xs font-bold text-ink">
      <span className="w-20 text-ink-soft">{label}</span>
      <input
        type="color"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="h-8 w-9 cursor-pointer rounded border border-line bg-white p-0.5"
        aria-label={`${label} colour`}
      />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-24 rounded-lg border border-line bg-white px-2 py-1.5 font-mono text-xs text-ink focus:outline-none focus:ring-2 focus:ring-teal/40"
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
    <div className="rounded-xl border border-line bg-card-tint p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="truncate text-sm font-bold text-ink">{assistant.name}</p>
        <a
          href={`https://wisecall.io/widget-demo?agent=${encodeURIComponent(slug)}`}
          target="_blank"
          rel="noopener"
          className="flex-shrink-0 text-xs font-bold text-teal hover:underline"
        >
          Preview
        </a>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <code className="flex-1 overflow-x-auto whitespace-nowrap rounded-lg border border-line bg-[#0e1b1b] px-3 py-2 text-xs font-semibold text-[#7de8eb]">
          {embed}
        </code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-9 items-center rounded-lg bg-ink px-4 text-sm font-black text-white transition hover:bg-[#263130]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* Brand colours + live preview */}
      <div className="mt-3 flex flex-wrap items-start gap-4 border-t border-line pt-3">
        <div className="space-y-2">
          <p className="text-xs font-black uppercase tracking-wide text-ink-faint">Match your brand</p>
          <ColorField label="Accent" value={accent} onChange={setAccent} />
          <ColorField label="Header" value={bg} onChange={setBg} />
          <div className="flex items-center gap-3 pt-1">
            <button
              type="button"
              onClick={saveColors}
              disabled={pending || !dirty}
              className="inline-flex h-8 items-center rounded-lg bg-ink px-4 text-xs font-black text-white transition hover:bg-[#263130] disabled:opacity-50"
            >
              {pending ? "Saving…" : "Save colours"}
            </button>
            {saved && !dirty && <span className="text-xs font-medium text-teal">Saved</span>}
            {err && <span className="text-xs font-medium text-danger">{err}</span>}
          </div>
        </div>

        {/* Mini live preview of the widget */}
        <div className="ml-auto">
          <div className="w-[150px] overflow-hidden rounded-xl border border-line bg-white shadow-sm">
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
              <div className="max-w-[80%] rounded-lg rounded-bl-sm bg-white px-2 py-1 text-[10px] text-ink shadow-sm">
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
          <p className="mt-1 text-center text-[10px] text-ink-faint">Live preview</p>
        </div>
      </div>
    </div>
  );
}

// "Email" channel, expandable to reveal each agent's forwarding address.
function EmailChannel({
  assistants,
  usage,
}: {
  assistants: Assistant[];
  usage?: EmailChannelUsage;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-xl border border-line bg-white">
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
          <p className="font-black text-ink">Email</p>
          <p className="text-sm text-ink-soft">
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
          <span className="self-center flex-shrink-0 rounded-full bg-card-tint px-3 py-1 text-xs font-bold text-ink-soft">
            Start a plan to use
          </span>
        )}
        <ChevronDown
          className={`self-center h-5 w-5 flex-shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-line px-5 pb-5 pt-4">
          <p className="mb-1 text-xs text-ink-soft">
            Set up a forwarding rule in your email provider (Gmail, Outlook, etc.) to the address
            below. The agent will reply using the same knowledge as your phone line.
          </p>
          {assistants.length ? (
            assistants.map((a) => <AgentEmailRow key={a.id} assistant={a} />)
          ) : (
            <p className="text-sm text-ink-soft">Create an agent to get its email forwarding address.</p>
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
    <div className="rounded-xl border border-line bg-card-tint p-3">
      <p className="mb-2 truncate text-sm font-bold text-ink">{assistant.name}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="flex-1 truncate rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink">
          {address}
        </code>
        <button
          type="button"
          onClick={copy}
          className="inline-flex h-9 items-center rounded-lg bg-ink px-4 text-sm font-black text-white transition hover:bg-[#263130]"
        >
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
    </div>
  );
}

// "Website chat" channel, expandable to reveal each agent's embed snippet.
function WebsiteChatChannel({ assistants, usage }: { assistants: Assistant[]; usage?: ChannelUsage }) {
  const [open, setOpen] = useState(false);
  const withSlug = assistants.filter((a) => a.slug);
  return (
    <div className="rounded-xl border border-line bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-start gap-4 px-5 py-4 text-left"
      >
        <div className="mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-teal-wash text-teal">
          <MessageSquareText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-black text-ink">Website chat</p>
          <p className="text-sm text-ink-soft">
            Put your agent on your site as a chat bubble, one line of code.
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
          <span className="self-center flex-shrink-0 rounded-full bg-[#eafaf1] px-3 py-1 text-xs font-bold text-good">
            Included
          </span>
        )}
        <ChevronDown
          className={`self-center h-5 w-5 flex-shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-line px-5 pb-5 pt-4">
          <p className="mb-1 text-xs text-ink-soft">
            Paste this just before <code className="rounded bg-card-tint px-1">&lt;/body&gt;</code> on
            your website. Works on WordPress, Wix, Squarespace or any custom site.
          </p>
          {withSlug.length ? (
            withSlug.map((a) => <WidgetEmbedRow key={a.id} assistant={a} />)
          ) : (
            <p className="text-sm text-ink-soft">Create an agent to get its website embed code.</p>
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
    <div className="rounded-xl border border-line bg-white">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-4 px-5 py-4 text-left"
      >
        <div className="mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#eafaf1] text-good">
          <MessageSquareText className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-black text-ink">WhatsApp</p>
          <p className="text-sm text-ink-soft">
            Add WhatsApp to the same AI agent that handles calls, email and live chat.
          </p>
        </div>
        <div className="self-center flex flex-shrink-0 items-center gap-3">
          {usage?.enabled && usage.allowance > 0 ? (
            <span className="text-xs font-semibold text-ink-soft">
              {usage.used.toLocaleString()}/{usage.allowance.toLocaleString()} messages
              {usage.overage > 0 ? ` · ${usage.overage.toLocaleString()} over` : ""}
            </span>
          ) : null}
          <span className="rounded-full bg-[#fff7df] px-3 py-1 text-xs font-bold text-[#9a6a00]">
            Setup required
          </span>
        </div>
        <ChevronDown
          className={`self-center h-5 w-5 flex-shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>

      {open ? (
        <div className="space-y-4 border-t border-line px-5 pb-5 pt-4">
          <p className="text-sm leading-relaxed text-ink-soft">
            Inbound messages route to the same AI and save to Contacts, just like calls and email. Pick
            a setup route and we&apos;ll handle the Meta connection and webhook.
          </p>

          {assistants.length > 1 ? (
            <label className="block">
              <span className="mb-1 block text-xs font-bold text-ink-soft">Connect to agent</span>
              <select
                value={selectedAssistant?.id ?? ""}
                onChange={(event) => setSelectedAssistantId(event.target.value)}
                className="w-full rounded-xl border border-line bg-white px-3 py-2 text-sm font-semibold text-ink outline-none focus:border-teal focus:ring-2 focus:ring-[#7de8eb]/40"
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
                    selected ? "border-teal bg-[#effcfc]" : "border-line bg-white hover:border-[#7de8eb]"
                  }`}
                >
                  <span
                    className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${
                      selected ? "border-teal bg-teal text-white" : "border-black/20 text-transparent"
                    }`}
                  >
                    <Check className="h-3.5 w-3.5" />
                  </span>
                  <div className="min-w-0">
                    <p className="font-bold text-ink">
                      {option.label}
                      <span className="ml-2 text-xs font-semibold text-ink-soft">{option.badge}</span>
                    </p>
                    <p className="mt-0.5 text-sm leading-relaxed text-ink-soft">{option.summary}</p>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="max-w-md text-xs leading-relaxed text-ink-soft">
              Needs Meta Business admin access.{" "}
              {setupPath === "own"
                ? "Don't move a live number yet, we check it first."
                : "We complete the Meta checks for you."}
            </p>
            <a
              href={buildWhatsAppSetupHref(setupPath, selectedAssistant, userEmail)}
              className="inline-flex items-center justify-center gap-2 rounded-full bg-ink px-4 py-2.5 text-sm font-black text-white hover:bg-[#1f3535]"
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
      <span className="text-xs font-semibold text-ink-soft">
        {used.toLocaleString()}/{allowance.toLocaleString()} {unit}
        {overage && overage > 0 ? ` · ${overage.toLocaleString()} over` : ""}
      </span>
      <span className="rounded-full bg-[#eafaf1] px-3 py-1 text-xs font-bold text-good">
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
    <div className="rounded-xl border border-line bg-card-tint p-3">
      <p className="mb-2 truncate text-sm font-bold text-ink">{assistant.name}</p>
      {smsNumber ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="flex-1 truncate rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink">
            {smsNumber}
          </code>
          <button
            type="button"
            onClick={copy}
            className="inline-flex h-9 items-center rounded-lg bg-ink px-4 text-sm font-black text-white transition hover:bg-[#263130]"
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
    <div className="rounded-xl border border-line bg-card-tint p-3">
      <p className="mb-2 truncate text-sm font-bold text-ink">{assistant.name}</p>
      {live ? (
        <div className="flex flex-wrap items-center gap-2">
          <code className="min-w-0 flex-1 truncate rounded-lg border border-line bg-white px-3 py-2 text-sm font-semibold text-ink">
            {routing.number}
          </code>
          <button
            type="button"
            onClick={copy}
            className="inline-flex h-9 items-center rounded-lg bg-ink px-4 text-sm font-black text-white transition hover:bg-[#263130]"
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
          Setting up your phone number, usually ready within 5 minutes. Refresh to check.
        </div>
      ) : (
        <button
          type="button"
          disabled={isProvisioning}
          onClick={onProvision}
          className="inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
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
    <div className="rounded-xl border border-line bg-white">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-start gap-4 px-5 py-4 text-left"
      >
        <div className="mt-0.5 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-teal-wash text-teal">
          <Phone className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-black text-ink">Phone</p>
          <p className="text-sm text-ink-soft">Your AI receptionist answers and routes calls.</p>
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
          <span className="self-center flex-shrink-0 rounded-full bg-[#eafaf1] px-3 py-1 text-xs font-bold text-good">
            Included
          </span>
        )}
        <ChevronDown
          className={`self-center h-5 w-5 flex-shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-line px-5 pb-5 pt-4">
          <p className="mb-1 text-xs text-ink-soft">
            Each agent gets its own UK phone number. Customers call in and the AI answers -
            every conversation is saved to Call History and Contacts.
          </p>
          {provisionError ? (
            <p className="rounded-xl bg-[#fff0f0] px-4 py-2 text-sm text-danger">{provisionError}</p>
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
            <p className="text-sm text-ink-soft">Create an agent to get a phone number.</p>
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
    <div className="rounded-xl border border-line bg-white">
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
          <p className="font-black text-ink">SMS</p>
          <p className="text-sm text-ink-soft">
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
          <span className="self-center flex-shrink-0 rounded-full bg-[#eafaf1] px-3 py-1 text-xs font-bold text-good">
            Included
          </span>
        )}
        <ChevronDown
          className={`self-center h-5 w-5 flex-shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="space-y-2 border-t border-line px-5 pb-5 pt-4">
          <p className="mb-1 text-xs text-ink-soft">
            Each agent gets its own UK mobile number. Customers text in and the AI replies instantly -
            every conversation is saved to Contacts alongside calls and emails.
          </p>
          {provisionError ? (
            <p className="rounded-xl bg-[#fff0f0] px-4 py-2 text-sm text-danger">{provisionError}</p>
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
            <p className="text-sm text-ink-soft">Create an agent to get an SMS number.</p>
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
        <h1 className="text-2xl font-black text-ink">Channels</h1>
        <p className="mt-1 text-sm text-ink-soft">
          One agent, every channel. Add a way for customers to reach you and the same AI handles it -
          logging every conversation to Contacts.
        </p>
      </div>

      <div className="space-y-3">
        <PhoneChannel assistants={assistants} usage={callUsage} onRoutingUpdate={onRoutingUpdate} />

        {/* Website chat, included, expandable to per-agent embed codes */}
        <WebsiteChatChannel assistants={assistants} usage={livechatChannel} />

        {/* Email, included in every plan; expandable to per-agent forwarding addresses */}
        <EmailChannel assistants={assistants} usage={emailChannel} />

        {/* WhatsApp, included in every plan; number connected during setup */}
        <WhatsAppChannel assistants={assistants} userEmail={userEmail} usage={whatsappChannel} />

        {/* SMS, included in every plan; UK number auto-provisioned via Vonage */}
        <SMSChannel assistants={assistants} usage={smsChannel} initialSmsNumbers={smsNumbers} />

      </div>
    </div>
  );
}

const navItems: { view: View; label: string; icon: LucideIcon }[] = [
  { view: "insights", label: "Home", icon: Sparkles },
  { view: "calls", label: "Inbox", icon: Inbox },
  { view: "contacts", label: "Contacts", icon: Users },
  { view: "viewings", label: "Viewings", icon: CalendarCheck },
  { view: "assistants", label: "Agents", icon: Bot },
  { view: "channels", label: "Channels", icon: Layers },
];

// Agent templates. Receptionist + specialised verticals (Dental, Estate).
// The create / wizard flows pick these up automatically.
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
    description: "Friendly general receptionist: answers FAQs, takes messages and transfers urgent calls.",
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
        "- Take a message: always capture the caller's name, phone number and the reason for their call.",
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
    id: "estate_agent",
    label: "Estate agent",
    description:
      "Sales & lettings receptionist: valuations, owner-confirmed viewings (WhatsApp/SMS to landlords), maintenance triage and branch routing.",
    industry: "Property",
    available: true,
    buildPrompt: buildEstateAgentPrompt,
    buildGreeting: buildEstateAgentGreeting,
    defaultKnowledgeFields: estateAgentKnowledgeFields(),
    defaultContacts: estateAgentDefaultContacts,
  },
  {
    id: "dentally",
    label: "Dental practice (Dentally)",
    description:
      "Dental receptionist with Dentally booking built in, looks up patients, registers new ones, books, reschedules and cancels appointments, and handles emergencies.",
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
  initialFollowUps = [],
  initialSelectedAgentId,
  loadIssues = [],
  availableVoices = FEATURED_CARTESIA_VOICES,
}: {
  initialAssistants?: Assistant[];
  callLogs?: CallLog[];
  contacts?: Contact[];
  userEmail?: string;
  isAdmin?: boolean;
  adminMode?: boolean; // rendered on /admin with every customer's agents
  trial?: { used: number; cap: number; blocked: boolean }; // free-trial call usage
  emailChannel?: EmailChannelUsage;
  callUsage?: CallUsage; // bundled AI-call allowance + usage
  whatsappChannel?: ChannelUsage; // bundled WhatsApp allowance + usage
  livechatChannel?: ChannelUsage; // bundled live-chat allowance + usage
  smsChannel?: ChannelUsage; // bundled SMS allowance + usage
  smsNumbers?: AgentSmsNumber[]; // already-provisioned Vonage SMS numbers
  whatsappNumbers?: AgentWhatsappNumber[]; // already-provisioned WhatsApp numbers
  impersonating?: { email: string; agentName?: string }; // admin viewing as this customer
  initialInsights?: DashboardInsights; // server-aggregated AI Insights (default range)
  analysisEnabled?: boolean; // whether the Claude API key is configured
  initialFollowUps?: FollowUp[];
  initialSelectedAgentId?: string;
  loadIssues?: string[];
  /** Featured + Cartesia en-GB voices (from dashboard server load). */
  availableVoices?: CartesiaVoiceOption[];
}) {
  const [assistants, setAssistants] = useState(initialAssistants ?? []);
  // A real customer with no agents yet has an empty list, don't assume [0] exists.
  const [selectedId, setSelectedId] = useState(
    initialSelectedAgentId ?? initialAssistants?.[0]?.id ?? "",
  );
  const [view, setView] = useState<View>("insights");
  const [detailTab, setDetailTab] = useState<DetailTab>("behaviour");
  const [searchTerm, setSearchTerm] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [ticketOpen, setTicketOpen] = useState(false);
  const [supportChatOpen, setSupportChatOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [greetingOpen, setGreetingOpen] = useState(false);
  const [editAbility, setEditAbility] = useState<"knowledge" | "transfer" | null>(null);
  const [newAssistantName, setNewAssistantName] = useState("");
  const [newBusinessName, setNewBusinessName] = useState("");
  const [newTemplateId, setNewTemplateId] = useState(agentTemplates[0].id);
  const [savedAgentId, setSavedAgentId] = useState<string | null>(null);
  const [dirtyAgentIds, setDirtyAgentIds] = useState<Set<string>>(() => new Set());
  const editRevisionRef = useRef<Map<string, number>>(new Map());
  const [saveError, setSaveError] = useState<string | null>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);
  const [provisionError, setProvisionError] = useState<string | null>(null);
  const [liveError, setLiveError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const [isCreating, startCreate] = useTransition();
  const [isProvisioning, startProvision] = useTransition();
  const [isDeleting, startDelete] = useTransition();
  const [isSettingLive, startSetLive] = useTransition();
  const [followUps, setFollowUps] = useState(initialFollowUps);

  // Warn before a full page unload (tab close, refresh, external navigation)
  // while any agent has unsaved edits, so in-progress configuration isn't lost.
  // In-app view switches keep local edits alive, so they don't need a prompt.
  useEffect(() => {
    if (dirtyAgentIds.size === 0) return;
    function handleBeforeUnload(event: BeforeUnloadEvent) {
      event.preventDefault();
      event.returnValue = "";
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [dirtyAgentIds]);

  function handleFollowUpStatus(followUpId: string, status: FollowUp["status"]) {
    startTransition(async () => {
      const result = await updateFollowUpStatus(followUpId, status);
      if (result.ok) {
        setFollowUps((prev) =>
          prev.map((item) =>
            item.id === followUpId
              ? {
                  ...item,
                  status,
                  completedAt: status === "done" ? new Date().toISOString() : null,
                }
              : item,
          ),
        );
      }
    });
  }

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

  const scopedCallLogs = useMemo(() => {
    if (!adminMode || !selectedAssistant) return callLogs;
    return callLogs.filter((log) => log.profileId === selectedAssistant.id);
  }, [adminMode, selectedAssistant, callLogs]);

  const scopedContacts = useMemo(() => {
    if (!adminMode || !selectedAssistant) return contacts;
    return contacts.filter((contact) => contact.profileId === selectedAssistant.id);
  }, [adminMode, selectedAssistant, contacts]);

  const scopedFollowUps = useMemo(() => {
    if (!adminMode || !selectedAssistant) return followUps;
    return followUps.filter((item) => item.profileId === selectedAssistant.id);
  }, [adminMode, selectedAssistant, followUps]);

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

  function updateSelected(patch: Partial<Assistant>, markDirty = true) {
    if (!selectedAssistant) return;
    setAssistants((current) =>
      current.map((a) => (a.id === selectedAssistant.id ? { ...a, ...patch } : a)),
    );
    if (markDirty) {
      setSavedAgentId(null);
      editRevisionRef.current.set(
        selectedAssistant.id,
        (editRevisionRef.current.get(selectedAssistant.id) ?? 0) + 1,
      );
      setDirtyAgentIds((current) => {
        const next = new Set(current);
        next.add(selectedAssistant.id);
        return next;
      });
    }
  }

  function deleteSelected() {
    startDelete(async () => {
      const result = await deleteAgent(selectedAssistant.id);
      if (!result.ok) return; // leave on page; AssistantDetail shows the error
      setAssistants((current) => current.filter((a) => a.id !== selectedAssistant.id));
      setDirtyAgentIds((current) => {
        const next = new Set(current);
        next.delete(selectedAssistant.id);
        return next;
      });
      editRevisionRef.current.delete(selectedAssistant.id);
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
    const voice = availableVoices[0]?.id || cartesiaVoices[0].id;
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
        templateId: template.id,
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
    const voice = draft.voice || availableVoices[0]?.id || cartesiaVoices[0].id;
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
      templateId: draft.templateId || "receptionist",
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
    const assistantToSave = selectedAssistant;
    if (!assistantToSave) return;
    const revisionAtSave = editRevisionRef.current.get(assistantToSave.id) ?? 0;
    startTransition(async () => {
      const result = await updateAgent(assistantToSave.id, {
        name: assistantToSave.name,
        businessName: assistantToSave.businessName,
        industry: assistantToSave.industry,
        timezone: assistantToSave.timezone,
        prompt: assistantToSave.prompt,
        greeting: assistantToSave.greeting,
        voice: assistantToSave.voice,
        knowledge: assistantToSave.knowledge,
        knowledgeFields: assistantToSave.knowledgeFields,
        defaultEmail: assistantToSave.defaultEmail,
        contacts: assistantToSave.contacts,
        website: assistantToSave.website,
        fallbackEmail: assistantToSave.fallbackEmail,
        transferNumber: assistantToSave.transferNumber,
        officeHours: assistantToSave.officeHours,
        outOfHoursMessage: assistantToSave.outOfHoursMessage,
        ...(isAdmin
          ? {
              phoneNumber: assistantToSave.phoneNumber,
              status: assistantToSave.status,
            }
          : {}),
      });
      if (result.ok) {
        const hasNewerChanges =
          (editRevisionRef.current.get(assistantToSave.id) ?? 0) !== revisionAtSave;
        if (!hasNewerChanges) {
          setDirtyAgentIds((current) => {
            const next = new Set(current);
            next.delete(assistantToSave.id);
            return next;
          });
          setSavedAgentId(assistantToSave.id);
          window.setTimeout(
            () =>
              setSavedAgentId((current) =>
                current === assistantToSave.id ? null : current,
              ),
            1600,
          );
        }
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
        updateSelected(
          {
            routing: result.routing,
            phoneNumber: result.routing.number || "Number pending",
            status: result.routing.status === "live" ? "Live" : "Setup",
          },
          false,
        );
      } else {
        setProvisionError(result.error ?? "Could not assign a number yet.");
      }
    });
  }

  function setLive(live: boolean) {
    if (!selectedAssistant) return;
    setLiveError(null);
    const target = selectedAssistant.id;
    startSetLive(async () => {
      const result = await setAgentLive(target, live);
      if (result.ok) {
        // status feeds getAgentOperationalState: "Live" → live; with a connected
        // number, anything else → paused. This is a persisted change, not a
        // pending edit, so markDirty=false. The runtime already gates on
        // is_active, so the phone agent reflects it immediately.
        updateSelected({ status: live ? "Live" : "Setup" }, false);
      } else {
        setLiveError(
          result.error ?? (live ? "Could not resume the agent." : "Could not pause the agent."),
        );
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
    if (item.view === "assistants") return view === "assistants" || view === "detail";
    return view === item.view;
  }

  return (
    <div className="flex h-screen flex-col bg-surface px-0 py-0 text-ink lg:px-6 lg:py-6">
      {impersonating ? (
        <div className="mx-auto mb-3 flex max-w-[1920px] flex-shrink-0 flex-wrap items-center justify-between gap-3 rounded-xl bg-[#7a2e2e] px-4 py-2.5 text-sm font-semibold text-white">
          <span>
            👁 Viewing as <strong>{impersonating.email}</strong>
            {impersonating.agentName ? (
              <>
                {" "}
                · agent <strong>{impersonating.agentName}</strong>
              </>
            ) : null}
            , changes you make apply to this customer&apos;s account.
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
        <div className="mx-auto mb-3 max-w-[1920px] flex-shrink-0 px-4 lg:px-0">
          <div
            className={`flex flex-col gap-3 rounded-xl px-4 py-2.5 text-sm font-semibold shadow-card sm:flex-row sm:items-center sm:justify-between ${
              trial.blocked
                ? "bg-danger-wash text-danger"
                : "bg-teal-wash text-[#0e4b4d]"
            }`}
          >
            <span>
              {trial.blocked
                ? `Free trial limit reached, ${trial.used}/${trial.cap} calls used. Add a plan to keep taking calls.`
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
      <div className="mx-auto flex min-h-0 w-full flex-1 max-w-[1920px] overflow-hidden bg-white shadow-[0_24px_90px_rgba(17,23,22,0.14)] lg:rounded-[22px] lg:border lg:border-line">
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
                      href="/admin/outreach"
                      className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
                    >
                      <Mail className="h-5 w-5 flex-shrink-0" />
                      Dental outreach
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
                    </>
                  )
                )}
              </nav>
              <div className="mx-4 mb-4 rounded-2xl bg-[#1a3535] p-5 text-center">
                <SupportOwl />
                <p className="text-sm font-bold text-white">Need setup help?</p>
                <button
                  type="button"
                  onClick={() => {
                    setMobileNavOpen(false);
                    setSupportChatOpen(true);
                  }}
                  className="mt-3 rounded-lg bg-[#7de8eb] px-4 py-2 text-sm font-bold text-[#0e1b1b] transition hover:bg-[#5de0e5]"
                >
                  Chat with Ava
                </button>
              </div>
            </aside>
          </div>
        )}

        {/* Sidebar */}
        <aside className="hidden w-[280px] flex-shrink-0 flex-col overflow-y-auto bg-gradient-to-b from-[#172929] to-[#0e1b1b] md:flex">
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
                  href="/admin/outreach"
                  className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
                >
                  <Mail className="h-5 w-5 flex-shrink-0" />
                  Dental outreach
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
                    href="/admin/outreach"
                    className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
                  >
                    <Mail className="h-5 w-5 flex-shrink-0" />
                    Dental outreach
                  </a>
                </>
              )
            )}
          </nav>

          <div className="m-4 rounded-2xl bg-[#1a3535] p-5 text-center">
            <SupportOwl />
            <p className="text-sm font-bold text-white">Need setup help?</p>
            <button
              type="button"
              onClick={() => setSupportChatOpen(true)}
              className="mt-3 rounded-lg bg-[#7de8eb] px-4 py-2 text-sm font-bold text-[#0e1b1b] transition hover:bg-[#5de0e5]"
            >
              Chat with Ava
            </button>
          </div>
        </aside>

        {/* Main */}
        <main className="min-w-0 flex-1 overflow-y-auto bg-white">
          <header className="flex h-[72px] items-center justify-between border-b border-line px-5 lg:px-8">
            <div className="flex min-w-0 max-w-[calc(100vw-7rem)] items-center gap-2 overflow-x-auto whitespace-nowrap text-sm font-semibold text-ink-soft sm:max-w-none">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                aria-label="Open menu"
                className="-ml-1 mr-1 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-ink transition hover:bg-card-tint md:hidden"
              >
                <Menu className="h-5 w-5" />
              </button>
              <button
                type="button"
                onClick={() => setView("insights")}
                className={view === "insights" ? "text-ink" : "transition hover:text-ink"}
              >
                Home
              </button>
              {(view === "assistants" || view === "detail") && (
                <>
                  <ChevronRight className="h-4 w-4" />
                  <span>Agents</span>
                </>
              )}
              {view === "calls" && (
                <>
                  <ChevronRight className="h-4 w-4" />
                  <span>Inbox</span>
                </>
              )}
              {view === "contacts" && (
                <>
                  <ChevronRight className="h-4 w-4" />
                  <span>Contacts</span>
                </>
              )}
              {view === "viewings" && (
                <>
                  <ChevronRight className="h-4 w-4" />
                  <span>Viewings</span>
                </>
              )}
              {view === "channels" && (
                <>
                  <ChevronRight className="h-4 w-4" />
                  <span>Channels</span>
                </>
              )}
              {view === "detail" && selectedAssistant && (
                <>
                  <ChevronRight className="h-4 w-4" />
                  <span className="truncate text-ink">{selectedAssistant.name}</span>
                </>
              )}
            </div>
            <div className="flex items-center gap-3">
              {userEmail && (
                <span className="hidden text-sm text-ink-soft sm:block">{userEmail}</span>
              )}
              <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-card-tint text-sm font-black">
                {userEmail ? userEmail[0].toUpperCase() : "?"}
              </div>
              <form action={signOutAction}>
                <button
                  type="submit"
                  className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-card-tint hover:text-ink"
                  aria-label="Sign out"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </form>
            </div>
          </header>

          <div key={view} className="anim-fade px-4 pb-24 pt-6 sm:px-5 sm:py-8 md:pb-8 lg:px-10">
            {loadIssues.length > 0 && (
              <div
                role="status"
                aria-live="polite"
                className="mb-5 flex flex-col gap-3 rounded-xl border border-warn/25 bg-warn-wash px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between"
              >
                <div className="flex min-w-0 items-start gap-3">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-warn" />
                  <div>
                    <p className="font-black text-ink">Some information could not be refreshed</p>
                    <p className="mt-0.5 text-ink-soft">
                      {loadIssues.join(", ")} may be incomplete. Your saved settings were not changed.
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => window.location.reload()}
                  className="press inline-flex h-9 flex-shrink-0 items-center justify-center gap-2 self-start rounded-lg border border-warn/30 bg-white px-3 text-xs font-black text-ink transition hover:border-warn sm:self-auto"
                >
                  <RefreshCw className="h-3.5 w-3.5" />
                  Refresh data
                </button>
              </div>
            )}
            {view === "insights" && (
              <div className="space-y-6">
                <AiInsights
                  initial={initialInsights}
                  analysisEnabled={analysisEnabled}
                  followUps={scopedFollowUps}
                  onFollowUpStatus={handleFollowUpStatus}
                  onViewCalls={() => setView("calls")}
                  onOpenCall={(callId) => {
                    // One click from an insight straight into the conversation.
                    setSelectedCallId(scopedCallLogs.some((c) => c.id === callId) ? callId : null);
                    setView("calls");
                  }}
                />
                <AgentLearningPanel />
              </div>
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
                  setSaveError(null);
                }}
              />
            )}

            {view === "detail" && selectedAssistant && (
              <AssistantDetail
                assistant={selectedAssistant}
                tab={detailTab}
                dirty={dirtyAgentIds.has(selectedAssistant.id)}
                saved={savedAgentId === selectedAssistant.id}
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
                onSetLive={setLive}
                isSettingLive={isSettingLive}
                liveError={liveError}
                onDelete={isAdmin ? deleteSelected : undefined}
                adminMode={adminMode}
                smsNumber={smsNumbers?.find((n) => n.profileId === selectedAssistant.id)?.smsNumber}
                whatsappNumber={
                  whatsappNumbers?.find((n) => n.profileId === selectedAssistant.id)?.whatsappNumber
                }
                voices={availableVoices}
              />
            )}

            {view === "calls" && (
              <UnifiedInbox
                callLogs={scopedCallLogs}
                followUps={scopedFollowUps}
                onFollowUpStatus={handleFollowUpStatus}
                selectedId={selectedCallId}
                onSelect={setSelectedCallId}
              />
            )}

            {view === "contacts" && (
              <ContactsView contacts={scopedContacts} callLogs={scopedCallLogs} followUps={scopedFollowUps} />
            )}

            {view === "viewings" && (
              <ViewingsView
                agents={assistants.map((a) => ({ id: a.id, name: a.name || "Agent" }))}
              />
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

      {/* Mobile bottom tab bar: the core destinations are always one thumb
          tap away. Secondary items (billing, admin, support) stay in the drawer. */}
      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="mx-auto flex max-w-md items-stretch justify-around">
          {navItems.map((item) => {
            const active = isNavActive(item);
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => setView(item.view)}
                className={`press flex min-w-0 flex-1 flex-col items-center gap-0.5 px-1 pb-2 pt-2.5 text-[10px] font-bold transition ${
                  active ? "text-teal" : "text-ink-faint"
                }`}
              >
                <item.icon className={`h-5 w-5 ${active ? "anim-pop" : ""}`} />
                <span className="truncate">{item.label}</span>
              </button>
            );
          })}
        </div>
      </nav>

      {ticketOpen && <RaiseTicketModal onClose={() => setTicketOpen(false)} />}
      {supportChatOpen && (
        <SupportChatPanel
          onClose={() => setSupportChatOpen(false)}
          onRaiseTicket={() => {
            setSupportChatOpen(false);
            setTicketOpen(true);
          }}
        />
      )}

      {wizardOpen && (
        <SetupWizard
          onClose={() => setWizardOpen(false)}
          onSubmit={createFromDraft}
          onManual={() => {
            setWizardOpen(false);
            setCreateOpen(true);
          }}
          voices={availableVoices}
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

    </div>
  );
}

const MODAL_OVERLAY =
  "anim-fade fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/35 p-4 backdrop-blur-[2px]";
const MODAL_PANEL =
  "anim-scale-in flex max-h-[calc(100dvh-2rem)] w-full flex-col overflow-hidden rounded-2xl bg-white shadow-float";

// One agent = one card. The card answers the three questions that matter at a
// glance — is it live, what number is it on, how busy has it been — and one
// click opens the full editor.
function AgentCard({
  assistant,
  adminMode,
  onOpen,
}: {
  assistant: Assistant;
  adminMode: boolean;
  onOpen: () => void;
}) {
  const operationalState = getAgentOperationalState(assistant);
  const live = operationalState === "live";
  return (
    <button
      type="button"
      onClick={onOpen}
      className="lift press flex w-full flex-col rounded-2xl border border-line bg-card p-5 text-left shadow-card"
    >
      <div className="flex w-full items-start justify-between gap-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#172929] to-[#0e1b1b] text-base font-black text-[#7de8eb]">
          {(assistant.name || "A").charAt(0).toUpperCase()}
        </span>
        <AgentStatePill assistant={assistant} />
      </div>
      <p className="mt-3 truncate text-base font-black text-ink">{assistant.name}</p>
      <p className="mt-0.5 truncate text-sm text-ink-soft">
        {assistant.businessName}
        {assistant.industry ? ` · ${assistant.industry}` : ""}
      </p>
      {adminMode && (
        <p className="mt-0.5 truncate text-xs text-ink-faint">
          {assistant.ownerEmail ?? "Unassigned"}
        </p>
      )}
      <div className="mt-4 flex w-full items-center justify-between gap-2 border-t border-line pt-3">
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-semibold text-ink-soft">
          {live ? <span className="live-dot h-1.5 w-1.5 flex-shrink-0 rounded-full bg-good" /> : <Phone className="h-3.5 w-3.5 flex-shrink-0 text-ink-faint" />}
          <span className="truncate font-mono">{assistant.phoneNumber}</span>
        </span>
        <span className="flex flex-shrink-0 items-center gap-1 text-xs font-bold tabular-nums text-ink-faint">
          {assistant.calls > 0 ? `${assistant.calls} calls` : "No calls yet"}
          <ChevronRight className="h-3.5 w-3.5" />
        </span>
      </div>
    </button>
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
    <div className="anim-rise">
      <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-black text-ink sm:text-3xl">
            {adminMode ? "All agents" : "Agents"}
          </h1>
          <p className="mt-1 text-sm text-ink-soft">
            {adminMode
              ? "Every WiseCall agent across all customers. Open any to edit."
              : "Your AI team — each agent answers its own number, on every channel."}
          </p>
        </div>
        <button
          type="button"
          onClick={onCreate}
          className="press inline-flex items-center justify-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-black text-white shadow-card transition hover:bg-[#263130]"
        >
          <Plus className="h-4 w-4" />
          New agent
        </button>
      </div>

      {(assistants.length > 3 || searchTerm) && (
        <label className="mb-5 flex max-w-md items-center gap-3 rounded-xl border border-line bg-card px-4 py-3 shadow-card transition focus-within:border-teal">
          <Search className="h-4 w-4 text-ink-faint" />
          <input
            value={searchTerm}
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Search agents…"
            className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
          />
        </label>
      )}

      {assistants.length > 0 ? (
        <div className="stagger grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {assistants.map((assistant) => (
            <AgentCard
              key={assistant.id}
              assistant={assistant}
              adminMode={adminMode}
              onOpen={() => onOpen(assistant.id)}
            />
          ))}
        </div>
      ) : searchTerm ? (
        <div className="rounded-2xl border border-line bg-card px-5 py-16 text-center text-ink-soft shadow-card">
          No agents match &ldquo;{searchTerm}&rdquo;.
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-line-strong bg-card px-5 py-20 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal-wash">
            <Bot className="h-7 w-7 text-teal" />
          </div>
          <p className="text-lg font-black text-ink">Create your first AI agent</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
            Paste your website and we&apos;ll draft the whole receptionist — voice, greeting and
            knowledge — in about a minute.
          </p>
          <button
            type="button"
            onClick={onCreate}
            className="press mt-5 inline-flex items-center gap-2 rounded-xl bg-ink px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130]"
          >
            <Sparkles className="h-4 w-4" />
            Set up my receptionist
          </button>
        </div>
      )}
    </div>
  );
}

function AgentNumberSummary({
  icon: Icon,
  label,
  number,
  iconClass,
}: {
  icon: LucideIcon;
  label: string;
  number: string;
  iconClass: string;
}) {
  const [copied, setCopied] = useState(false);

  function copy() {
    navigator.clipboard?.writeText(number).then(
      () => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }

  return (
    <div className="group inline-flex min-w-0 items-center gap-1.5 text-xs">
      <Icon className={`h-3.5 w-3.5 flex-shrink-0 ${iconClass}`} />
      <span className="flex-shrink-0 font-black text-ink">{label}</span>
      <span className="truncate font-mono text-ink-soft">{number}</span>
      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${label} number ${number}`}
        title={`Copy ${label} number`}
        className="press flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-ink-faint opacity-100 transition hover:bg-card-tint hover:text-ink focus-visible:opacity-100 sm:opacity-0 sm:group-hover:opacity-100"
      >
        {copied ? <Check className="h-3.5 w-3.5 text-good" /> : <Copy className="h-3.5 w-3.5" />}
      </button>
    </div>
  );
}

function AssistantDetail({
  assistant,
  tab,
  dirty,
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
  onSetLive,
  isSettingLive = false,
  liveError,
  onDelete,
  adminMode = false,
  smsNumber,
  whatsappNumber,
  voices = FEATURED_CARTESIA_VOICES,
}: {
  assistant: Assistant;
  tab: DetailTab;
  dirty: boolean;
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
  onSetLive: (live: boolean) => void;
  isSettingLive?: boolean;
  liveError?: string | null;
  onDelete?: () => void;
  adminMode?: boolean;
  smsNumber?: string;
  whatsappNumber?: string;
  voices?: CartesiaVoiceOption[];
}) {
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [deleteConfirmationText, setDeleteConfirmationText] = useState("");
  const [previewOpen, setPreviewOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [menuOpen]);

  const operationalState = getAgentOperationalState(assistant);
  const hasPhoneLine = assistant.routing.status === "live" && Boolean(assistant.routing.number);
  const routingLabel =
    operationalState === "live"
      ? "Live and answering"
      : operationalState === "paused"
        ? "Paused · phone line connected"
        : operationalState === "setting_up"
          ? "Number setting up"
          : operationalState === "review"
            ? "Needs review before answering"
            : "Phone line not connected";
  const stateDot =
    operationalState === "live"
      ? "live-dot bg-good"
      : operationalState === "setting_up" || operationalState === "review"
        ? "bg-warn"
        : "bg-ink-faint";

  return (
    <div className="anim-rise mx-auto max-w-5xl">
      <button
        type="button"
        onClick={onBack}
        className="mb-5 inline-flex items-center gap-2 text-sm font-bold text-ink-soft transition hover:text-ink"
      >
        <ArrowLeft className="h-4 w-4" />
        Agents
      </button>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-4">
          <span className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl bg-ink text-xl font-black text-[#7de8eb] shadow-card">
            {(assistant.name || "A").charAt(0).toUpperCase()}
          </span>
          <div className="min-w-0">
            <h1 className="truncate text-2xl font-black text-ink sm:text-3xl">{assistant.name}</h1>
            <p className="mt-0.5 truncate text-sm text-ink-soft">
              {assistant.businessName}
              {assistant.industry ? ` · ${assistant.industry}` : ""}
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button
            type="button"
            onClick={onSave}
            disabled={isPending || !dirty}
            aria-live="polite"
            className={`press inline-flex h-9 min-w-[116px] items-center justify-center gap-1.5 rounded-lg border px-3 text-xs font-black transition disabled:cursor-default ${
              dirty
                ? "border-ink bg-ink text-white hover:bg-[#263130] disabled:opacity-70"
                : "border-line bg-card text-good"
            }`}
            title={dirty ? "Save agent changes" : "All changes are saved"}
          >
            {isPending ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Check className="h-3.5 w-3.5" />
            )}
            {isPending ? "Saving…" : saved || !dirty ? "Saved" : "Save changes"}
          </button>
          <button
            type="button"
            onClick={() => setPreviewOpen(true)}
            className="press inline-flex h-9 items-center gap-1.5 rounded-lg bg-[#7de8eb] px-3 text-xs font-black text-[#0e1b1b] transition hover:bg-[#5de0e5]"
            title="Talk to this agent in your browser — no phone call needed"
          >
            <Phone className="h-3.5 w-3.5" />
            Test agent
          </button>
          {canPauseAgent(operationalState) ? (
            <button
              type="button"
              onClick={() => onSetLive(false)}
              disabled={isSettingLive}
              className="press inline-flex h-9 items-center gap-1.5 rounded-lg border border-line bg-card px-3 text-xs font-black text-ink transition hover:bg-card-tint disabled:opacity-60"
              title="Take this agent offline — it will stop answering calls until you resume it"
            >
              {isSettingLive ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Pause className="h-3.5 w-3.5" />
              )}
              {isSettingLive ? "Pausing…" : "Pause"}
            </button>
          ) : canResumeAgent(operationalState) ? (
            <button
              type="button"
              onClick={() => onSetLive(true)}
              disabled={isSettingLive}
              className="press inline-flex h-9 items-center gap-1.5 rounded-lg bg-good px-3 text-xs font-black text-white transition hover:opacity-90 disabled:opacity-60"
              title="Bring this agent back online so it answers calls again"
            >
              {isSettingLive ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Play className="h-3.5 w-3.5" />
              )}
              {isSettingLive ? "Resuming…" : "Resume"}
            </button>
          ) : null}
          {adminMode && assistant.ownerId ? (
            <form action={impersonateCustomerForm}>
              <input type="hidden" name="ownerId" value={assistant.ownerId} />
              <input type="hidden" name="profileId" value={assistant.id} />
              <button
                type="submit"
                className="press inline-flex h-9 max-w-[11rem] items-center gap-1.5 rounded-lg bg-ink px-3 text-xs font-black text-white transition hover:bg-[#263130]"
                title={`View ${assistant.name} as the customer sees it — inbox scoped to this agent`}
              >
                <LogOut className="h-3.5 w-3.5 shrink-0 rotate-180" />
                <span className="truncate">Login as</span>
              </button>
            </form>
          ) : null}
          {onDelete ? (
            <div ref={menuRef} className="relative">
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                disabled={isDeleting}
                className="press flex h-9 w-9 items-center justify-center rounded-lg transition hover:bg-card-tint disabled:opacity-60"
                aria-label="More actions"
                aria-expanded={menuOpen}
              >
                {isDeleting ? (
                  <Loader2 className="h-4 w-4 animate-spin text-danger" />
                ) : (
                  <MoreHorizontal className="h-5 w-5" />
                )}
              </button>
              {menuOpen && (
                <div className="anim-fade absolute right-0 top-full z-20 mt-1 w-44 overflow-hidden rounded-lg border border-line bg-white py-1 shadow-float">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setDeleteConfirm(true);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm font-bold text-danger transition hover:bg-danger-wash"
                  >
                    <Trash2 className="h-4 w-4" />
                    Delete agent
                  </button>
                </div>
              )}
            </div>
          ) : null}
        </div>
      </div>

      {previewOpen && (
        <AgentPreviewModal
          agentId={assistant.id}
          agentLabel={assistant.receptionistName || assistant.name}
          onClose={() => setPreviewOpen(false)}
        />
      )}

      <Dialog
        open={deleteConfirm}
        onOpenChange={(open) => {
          setDeleteConfirm(open);
          if (!open) setDeleteConfirmationText("");
        }}
        title={`Delete '${assistant.name}'?`}
        description={
          <>
            This permanently deletes the agent and returns its pooled number (+
            {assistant.phoneNumber.replace(/[^\d]/g, "")}) to the pool. This cannot be undone.
          </>
        }
        footer={
          <>
            <Button
              variant="secondary"
              onClick={() => {
                setDeleteConfirm(false);
                setDeleteConfirmationText("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                setDeleteConfirm(false);
                setDeleteConfirmationText("");
                onDelete?.();
              }}
              disabled={isDeleting || deleteConfirmationText !== assistant.name}
            >
              <Trash2 className="h-4 w-4" />
              Delete agent
            </Button>
          </>
        }
      >
        <label className="mb-1.5 block text-sm font-bold text-ink" htmlFor="delete-agent-confirmation">
          Type <strong>{assistant.name}</strong> to confirm
        </label>
        <Input
          id="delete-agent-confirmation"
          data-autofocus
          value={deleteConfirmationText}
          onChange={(event) => setDeleteConfirmationText(event.target.value)}
          autoComplete="off"
        />
      </Dialog>

      <div className="mb-5 divide-y divide-line border-y border-line">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 py-3 text-sm">
          <span className="inline-flex items-center gap-2 font-bold text-ink">
            <span className={`h-2 w-2 rounded-full ${stateDot}`} />
            {routingLabel}
          </span>
          {!hasPhoneLine &&
          (operationalState === "setting_up" || operationalState === "disconnected") ? (
            <button
              type="button"
              onClick={() => onTabChange("routing")}
              className="press inline-flex items-center gap-1 font-black text-teal transition hover:text-teal-deep"
            >
              {operationalState === "setting_up" ? "View status" : "Set up number"}
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          ) : null}
          <span className="text-ink-faint sm:ml-auto">
            {assistant.calls > 0 ? `${assistant.calls} calls handled` : "No calls yet"}
          </span>
        </div>
        {hasPhoneLine || smsNumber || whatsappNumber ? (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 py-2.5">
            {hasPhoneLine ? (
              <AgentNumberSummary
                icon={Phone}
                label="Calls"
                number={assistant.routing.number}
                iconClass="text-teal"
              />
            ) : null}
            {smsNumber ? (
              <AgentNumberSummary
                icon={MessageSquare}
                label="SMS"
                number={smsNumber}
                iconClass="text-[#7c3aed]"
              />
            ) : null}
            {whatsappNumber ? (
              <AgentNumberSummary
                icon={MessageCircle}
                label="WhatsApp"
                number={whatsappNumber}
                iconClass="text-good"
              />
            ) : null}
          </div>
        ) : null}
      </div>

      {saveError ? (
        <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-wash px-4 py-3 text-sm font-semibold text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{saveError} Your changes are still here; try saving again.</span>
        </div>
      ) : null}

      {liveError ? (
        <div role="alert" className="mb-5 flex items-start gap-2 rounded-xl border border-danger/20 bg-danger-wash px-4 py-3 text-sm font-semibold text-danger">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>{liveError}</span>
        </div>
      ) : null}

      {operationalState === "paused" ? (
        <div className="mb-5 flex items-start gap-2 rounded-xl border border-line bg-card-tint px-4 py-3 text-sm font-semibold text-ink-soft">
          <Pause className="mt-0.5 h-4 w-4 flex-shrink-0" />
          <span>
            This agent is paused and won&apos;t answer calls on its number. Resume it when you&apos;re ready to go back live.
          </span>
        </div>
      ) : null}

      <div className="mb-7 flex gap-6 overflow-x-auto border-b border-line">
        {(["behaviour", "knowledge", "routing", "outbound", "technical"] as DetailTab[]).map((item) => (
          <button
            type="button"
            key={item}
            onClick={() => onTabChange(item)}
            className={`press relative whitespace-nowrap border-b-2 px-0.5 pb-3 pt-1 text-sm font-bold transition ${
              tab === item
                ? "border-teal text-ink"
                : "border-transparent text-ink-soft hover:text-ink"
            }`}
          >
            {
              {
                behaviour: "Setup",
                knowledge: "Knowledge",
                routing: "Routing",
                outbound: "Outbound",
                technical: "Advanced",
              }[item]
            }
          </button>
        ))}
      </div>

      {tab === "behaviour" ? (
        <div key="behaviour" className="anim-fade space-y-4">
          <button
            type="button"
            onClick={onGreeting}
            className="lift press flex w-full items-center justify-between gap-4 rounded-2xl border border-line bg-card px-5 py-4 text-left shadow-card"
          >
            <span className="flex min-w-0 items-center gap-3">
              <Hand className="h-5 w-5 flex-shrink-0 text-teal" />
              <span className="min-w-0">
                <span className="block font-black">Greeting message</span>
                <span className="mt-1 block truncate text-sm text-ink-soft">
                  {assistant.greeting || "The first thing callers hear when they connect."}
                </span>
              </span>
            </span>
            <ChevronRight className="h-5 w-5 flex-shrink-0 text-ink-soft" />
          </button>

          <div className="pt-2">
            <p className="mb-3 px-1 text-xs font-black uppercase tracking-wide text-ink-faint">Voice</p>
            <VoicePicker
              selected={assistant.voice}
              greeting={assistant.greeting}
              voices={voices}
              onSelect={(voice) => onChange({ voice })}
            />
          </div>

          <div className="pt-2">
            <p className="mb-3 px-1 text-xs font-black uppercase tracking-wide text-ink-faint">Abilities</p>
            <div className="stagger space-y-3">
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

          <div className="pt-4">
            <p className="mb-3 px-1 text-xs font-black uppercase tracking-wide text-ink-faint">
              Availability
            </p>
            <OfficeHoursCard
              hours={assistant.officeHours}
              message={assistant.outOfHoursMessage}
              businessName={assistant.businessName}
              timezone={assistant.timezone}
              onChange={onChange}
            />
          </div>
        </div>
      ) : tab === "knowledge" ? (
        <div key="knowledge" className="anim-fade">
          <KnowledgeBaseTab assistant={assistant} />
        </div>
      ) : tab === "routing" ? (
        <div key="routing" className="anim-fade">
          {assistant.routing.status !== "live" ? (
            <RoutingCard
              routing={assistant.routing}
              isProvisioning={isProvisioning}
              error={provisionError}
              onProvision={onProvision}
            />
          ) : null}
          <RoutingTab
            contacts={assistant.contacts}
            defaultEmail={assistant.defaultEmail}
            dirty={dirty}
            isPending={isPending}
            saveError={saveError}
            onChange={(contacts) => onChange({ contacts })}
            onDefaultEmailChange={(defaultEmail) => onChange({ defaultEmail })}
            onSave={onSave}
          />
        </div>
      ) : tab === "outbound" ? (
        <div key="outbound" className="anim-fade">
          <OutboundManager profileId={assistant.id} businessName={assistant.businessName} />
        </div>
      ) : (
        <div key="technical" className="anim-fade">
          <CalendarBookingCard agentId={assistant.id} />
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
          {adminMode ? (
            <Field
              label="Phone number"
              value={assistant.phoneNumber}
              onChange={(value) => onChange({ phoneNumber: value })}
            />
          ) : null}
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
              disabled={isPending || !dirty}
              className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
            >
              {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : dirty ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
              {isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
            </button>
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
  if (status === "completed") return "bg-[#eafaf1] text-good";
  if (status === "failed") return "bg-[#fdecec] text-danger";
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
      <section className="rounded-2xl border border-line bg-white">
        <div className="flex flex-col gap-4 border-b border-line px-5 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="flex items-center gap-2 text-xl font-black">
              <FileText className="h-5 w-5 text-teal" />
              Knowledge Base
            </h2>
            <p className="mt-1 text-sm text-ink-soft">
              {sources.length} source{sources.length === 1 ? "" : "s"} · {totalChunks} indexed chunk{totalChunks === 1 ? "" : "s"}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {!hasDemoSources ? (
              <button
                type="button"
                onClick={loadDemoContent}
                disabled={isMutating}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-teal/30 bg-teal-wash px-4 py-2.5 text-sm font-black text-[#0f6b6e] transition hover:bg-[#dff3f3] disabled:opacity-60"
              >
                {isMutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Load demo content
              </button>
            ) : null}
            <button
              type="button"
              onClick={() => void load()}
              disabled={loading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-line bg-white px-4 py-2.5 text-sm font-black text-ink transition hover:bg-card-tint disabled:opacity-60"
            >
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </button>
          </div>
        </div>

        <div className="p-5">
          {loading ? (
            <div className="flex items-center justify-center rounded-xl bg-card-tint px-4 py-12 text-sm font-semibold text-ink-soft">
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              Loading sources
            </div>
          ) : loadError ? (
            <div className="rounded-xl border border-[#e7caca] bg-[#fff7f7] px-4 py-4 text-sm text-danger">
              {loadError}
            </div>
          ) : sources.length ? (
            <div className="overflow-hidden rounded-xl border border-line">
              <div className="grid grid-cols-[1fr_110px_90px_120px_48px] gap-3 border-b border-line bg-card-tint px-4 py-3 text-xs font-black uppercase tracking-wide text-ink-soft max-md:hidden">
                <span>Source</span>
                <span>Category</span>
                <span>Chunks</span>
                <span>Updated</span>
                <span />
              </div>
              <div className="divide-y divide-line">
                {sources.map((source) => (
                  <div
                    key={source.source}
                    className="grid gap-3 px-4 py-4 md:grid-cols-[1fr_110px_90px_120px_48px] md:items-center"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-black text-ink">{source.title}</p>
                      <p className="mt-1 flex min-w-0 items-center gap-1 truncate text-xs text-ink-soft">
                        <Link2 className="h-3.5 w-3.5 flex-shrink-0" />
                        <span className="truncate">{source.source}</span>
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-ink-soft">{source.category}</span>
                    <span className="font-mono text-sm text-ink-soft">{source.chunkCount}</span>
                    <span className="text-xs text-ink-soft">{formatWhen(source.latest)}</span>
                    <button
                      type="button"
                      onClick={() => remove(source)}
                      disabled={isMutating && deletingSource === source.source}
                      aria-label={`Remove ${source.title}`}
                      className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-danger-wash hover:text-danger disabled:opacity-50"
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
            <div className="rounded-xl border border-dashed border-line-strong bg-card-tint px-5 py-12 text-center">
              <FileText className="mx-auto h-8 w-8 text-teal" />
              <p className="mt-3 font-black text-ink">No indexed sources yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-ink-soft">
                Add a web page, sitemap, pasted notes or text file to make retrieval available for this agent.
              </p>
              <button
                type="button"
                onClick={loadDemoContent}
                disabled={isMutating}
                className="mt-5 inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
              >
                {isMutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Load demo content
              </button>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h3 className="text-lg font-black">Add source</h3>
            <p className="mt-1 text-sm text-ink-soft">Content is chunked, embedded and attached to {assistant.name}.</p>
          </div>
          <select
            value={category}
            onChange={(event) => setCategory(event.target.value)}
            className="h-10 rounded-lg border border-line-strong bg-white px-3 text-sm font-bold outline-none focus:border-ink"
          >
            {KB_CATEGORIES.map((item) => (
              <option key={item} value={item}>
                {item}
              </option>
            ))}
          </select>
        </div>

        <div className="mb-5 inline-flex rounded-lg border border-line bg-card-tint p-1">
          {(["paste", "url", "sitemap", "upload"] as KnowledgeBaseSourceType[]).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setSourceType(item)}
              className={`rounded-md px-3 py-2 text-sm font-black transition ${
                sourceType === item ? "bg-ink text-white" : "text-ink-soft hover:bg-white"
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
              <label className="flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed border-black/20 bg-card-tint px-4 py-8 text-center transition hover:bg-card-tint">
                <UploadCloud className="h-7 w-7 text-teal" />
                <span className="mt-2 text-sm font-black text-ink">
                  {filename || "Choose a text file"}
                </span>
                <span className="mt-1 text-xs text-ink-soft">TXT, Markdown, CSV, JSON or HTML</span>
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
                className="w-full resize-y rounded-lg border border-line-strong bg-white px-4 py-3 text-sm leading-6 outline-none transition placeholder:text-ink-faint focus:border-ink"
              />
            </label>
          </div>
        )}

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={ingest}
            disabled={isMutating}
            className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
          >
            {isMutating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
            {isMutating ? "Indexing" : "Add to Knowledge Base"}
          </button>
          {mutationOk ? <span className="text-sm font-bold text-good">{mutationOk}</span> : null}
          {mutationError ? <span className="text-sm font-bold text-danger">{mutationError}</span> : null}
        </div>
      </section>

      <section className="rounded-2xl border border-line bg-white p-5">
        <h3 className="text-lg font-black">Test retrieval</h3>
        <div className="mt-4 flex flex-col gap-3 sm:flex-row">
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") testSearch();
            }}
            placeholder="Ask a question this agent should answer"
            className="h-12 min-w-0 flex-1 rounded-lg border border-line-strong bg-white px-4 text-sm outline-none transition focus:border-ink"
          />
          <button
            type="button"
            onClick={testSearch}
            disabled={isSearching || !query.trim()}
            className="inline-flex h-12 items-center justify-center gap-2 rounded-lg bg-ink px-5 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
          >
            {isSearching ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
            Search
          </button>
        </div>
        {searchError ? <p className="mt-3 text-sm font-bold text-danger">{searchError}</p> : null}
        {searchChunks.length > 0 ? (
          <div className="mt-4 space-y-3">
            {searchChunks.map((chunk, index) => (
              <div key={`${chunk.title}-${index}`} className="rounded-xl border border-line bg-card-tint p-4">
                <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                  <p className="font-black text-ink">{chunk.title || "Untitled"}</p>
                  <span className="font-mono text-xs font-bold text-ink-soft">
                    {chunk.similarity.toFixed(3)}
                  </span>
                </div>
                <p className="text-sm leading-6 text-ink-soft">{truncate(chunk.content, 360)}</p>
              </div>
            ))}
          </div>
        ) : query && !isSearching && !searchError ? (
          <p className="mt-3 text-sm text-ink-soft">No matching chunks yet.</p>
        ) : null}
      </section>

      {jobs.length > 0 ? (
        <section className="rounded-2xl border border-line bg-white p-5">
          <h3 className="text-lg font-black">Recent ingest jobs</h3>
          <div className="mt-4 divide-y divide-line">
            {jobs.map((job) => (
              <div key={job.id} className="flex flex-wrap items-center gap-3 py-3">
                <span className={`rounded-full px-2.5 py-1 text-xs font-black ${statusTone(job.status)}`}>
                  {job.status || "running"}
                </span>
                <span className="font-bold text-ink">
                  {job.sourceTitle || job.sourceUrl || sourceTypeLabel(job.sourceType)}
                </span>
                <span className="text-sm text-ink-soft">
                  {sourceTypeLabel(job.sourceType)} · {job.chunksAdded} chunk{job.chunksAdded === 1 ? "" : "s"} · {formatWhen(job.startedAt)}
                </span>
                {job.errorMessage ? (
                  <span className="basis-full text-sm text-danger">{job.errorMessage}</span>
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
  dirty,
  isPending,
  saveError,
  onChange,
  onDefaultEmailChange,
  onSave,
}: {
  contacts: RoutingContact[];
  defaultEmail: string;
  dirty: boolean;
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
    <div className="anim-fade">
      <div className="mb-5 flex items-start gap-3 rounded-2xl border border-teal/20 bg-teal-wash px-5 py-4">
        <Users className="mt-0.5 h-5 w-5 flex-shrink-0 text-teal" />
        <p className="text-sm text-[#0e4b4d]">
          Add the people or teams calls should reach. When a caller mentions any of a
          contact&apos;s keywords, the agent transfers them to that number and/or emails a
          summary.
        </p>
      </div>

      <div className="mb-6 rounded-2xl border border-line bg-card p-5 shadow-card">
        <span className="flex items-center gap-2 text-sm font-black">
          <Mail className="h-4 w-4 text-teal" />
          Default routing inbox
        </span>
        <p className="mt-1 mb-3 text-sm text-ink-soft">
          A pooled address summaries fall back to, used by any contact set to “send to
          default”, and when no specific contact matches.
        </p>
        <input
          value={defaultEmail}
          onChange={(event) => onDefaultEmailChange(event.target.value)}
          placeholder="info@yourbusiness.co.uk"
          className="h-12 w-full max-w-md rounded-lg border border-line-strong bg-white px-4 text-sm outline-none transition focus:border-ink"
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
        <div className="rounded-xl border border-dashed border-line-strong bg-white px-5 py-10 text-center text-ink-soft">
          No routing contacts yet. Add your first one below.
        </div>
      )}

      <button
        type="button"
        onClick={add}
        className="mt-4 inline-flex items-center gap-2 rounded-lg border border-dashed border-black/20 px-5 py-3 text-sm font-black text-teal transition hover:bg-card-tint"
      >
        <Plus className="h-4 w-4" />
        Add contact
      </button>

      <div className="mt-8 border-t border-line pt-6">
        <button
          type="button"
          onClick={onSave}
          disabled={isPending || !dirty}
          className="inline-flex items-center gap-2 rounded-lg bg-ink px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
        >
          {isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : dirty ? <Save className="h-4 w-4" /> : <Check className="h-4 w-4" />}
          {isPending ? "Saving…" : dirty ? "Save changes" : "Saved"}
        </button>
        {saveError && <p className="mt-2 text-sm text-danger">{saveError}</p>}
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
    <div className="rounded-xl border border-line bg-white p-5">
      <div className="mb-4 flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 font-black">
          <UserRound className="h-4 w-4 text-teal" />
          {contact.name.trim() || "New contact"}
        </span>
        <button
          type="button"
          onClick={onRemove}
          aria-label="Remove contact"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-ink-soft transition hover:bg-danger-wash hover:text-danger"
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
            <div className="flex h-12 items-center rounded-lg border border-dashed border-line-strong bg-card-tint px-4 text-sm text-ink-soft">
              Summaries go to the default inbox
              {defaultEmail ? ` · ${defaultEmail}` : ""}
            </div>
          ) : (
            <input
              value={contact.email}
              onChange={(event) => onChange({ email: event.target.value })}
              placeholder="name@business.co.uk"
              className="h-12 w-full rounded-lg border border-line-strong bg-white px-4 text-sm outline-none transition focus:border-ink"
            />
          )}
          <label className="mt-2 inline-flex cursor-pointer items-center gap-2 text-sm text-ink-soft">
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
          ? "border-teal bg-teal-wash text-[#0f6f72]"
          : "border-line-strong bg-white text-ink-soft hover:bg-card-tint"
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
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-line-strong bg-white px-3 py-2.5 focus-within:border-ink">
      {keywords.map((keyword) => (
        <span
          key={keyword}
          className="inline-flex items-center gap-1.5 rounded-full bg-card-tint px-3 py-1 text-sm font-bold"
        >
          {keyword}
          <button
            type="button"
            onClick={() => onChange(keywords.filter((k) => k !== keyword))}
            aria-label={`Remove ${keyword}`}
            className="text-ink-soft transition hover:text-ink"
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
        className="min-w-[150px] flex-1 bg-transparent text-sm outline-none placeholder:text-ink-faint"
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
  complaint: { label: "Complaint", icon: ThumbsDown, tone: "text-danger bg-[#fdecea]" },
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
    <section className="mt-6 rounded-2xl border border-line bg-card shadow-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-5 py-4 text-left sm:px-6"
      >
        <Icon className="h-5 w-5 flex-shrink-0" style={{ color: accent }} />
        <div className="min-w-0 flex-1">
          <h2 className="flex items-center gap-2 text-lg font-black text-ink">
            {title}
            <span
              className="rounded-full px-2 py-0.5 text-xs font-bold"
              style={{ backgroundColor: `${accent}1a`, color: accent }}
            >
              {count}
            </span>
          </h2>
          {subtitle && !open ? (
            <p className="mt-0.5 truncate text-sm text-ink-soft">{subtitle}</p>
          ) : null}
        </div>
        <ChevronDown
          className={`h-5 w-5 flex-shrink-0 text-ink-faint transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open ? (
        <div className="anim-fade border-t border-line px-5 pb-5 pt-4 sm:px-6">{children}</div>
      ) : null}
    </section>
  );
}

function FollowUpsSection({
  followUps,
  onFollowUpStatus,
  onOpenCall,
}: {
  followUps: FollowUp[];
  onFollowUpStatus: (id: string, status: FollowUp["status"]) => void;
  onOpenCall: (callId: string) => void;
}) {
  const open = followUps.filter((item) => item.status === "open");
  if (open.length === 0) return null;

  return (
    <CollapsibleSection
      title="Open follow-ups"
      icon={CalendarCheck}
      accent="#0e6b6e"
      count={open.length}
      defaultOpen
      subtitle="Tasks extracted from conversations — mark done when handled"
    >
      <ul className="divide-y divide-line">
        {open.map((item) => (
          <li key={item.id} className="flex flex-col gap-3 py-3 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0 flex-1">
              <p className="font-bold text-ink">{item.title}</p>
              <p className="mt-0.5 text-xs text-ink-soft">
                {item.caller} · {item.agentName}
              </p>
              {item.description ? (
                <p className="mt-1 text-sm text-ink-soft">{item.description}</p>
              ) : null}
            </div>
            <div className="flex flex-shrink-0 flex-wrap gap-2">
              {item.callLogId ? (
                <button
                  type="button"
                  onClick={() => onOpenCall(item.callLogId!)}
                  className="press inline-flex h-8 items-center rounded-lg border border-line px-3 text-xs font-bold text-ink-soft hover:border-line-strong hover:text-ink"
                >
                  View conversation
                </button>
              ) : null}
              <button
                type="button"
                onClick={() => onFollowUpStatus(item.id, "snoozed")}
                className="press inline-flex h-8 items-center rounded-lg border border-line px-3 text-xs font-bold text-ink-soft hover:border-line-strong hover:text-ink"
              >
                Snooze
              </button>
              <button
                type="button"
                onClick={() => onFollowUpStatus(item.id, "done")}
                className="press inline-flex h-8 items-center gap-1.5 rounded-lg bg-ink px-3 text-xs font-black text-white hover:bg-[#263130]"
              >
                <Check className="h-3.5 w-3.5" />
                Done
              </button>
            </div>
          </li>
        ))}
      </ul>
    </CollapsibleSection>
  );
}

function AiInsights({
  initial,
  analysisEnabled,
  followUps,
  onFollowUpStatus,
  onViewCalls,
  onOpenCall,
}: {
  initial?: DashboardInsights;
  analysisEnabled: boolean;
  followUps: FollowUp[];
  onFollowUpStatus: (id: string, status: FollowUp["status"]) => void;
  onViewCalls: () => void;
  onOpenCall: (callId: string) => void;
}) {
  const [range, setRange] = useState<InsightsRange>(initial?.range ?? "7d");
  const [insights, setInsights] = useState<DashboardInsights | undefined>(initial);
  const [loading, setLoading] = useState(!initial);
  const [error, setError] = useState<string | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const initialLoadStarted = useRef(false);
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
    initialLoadStarted.current = true;
    setRange(next);
    void load(next);
  }

  // /admin does not have server-rendered tenant insights, so hydrate the
  // default range on mount. Without this, the dashboard stays on skeletons
  // until someone manually changes the date range.
  useEffect(() => {
    if (initialLoadStarted.current) return;
    if (initial || insights) return;
    const timer = window.setTimeout(() => {
      if (initialLoadStarted.current) return;
      initialLoadStarted.current = true;
      void load(range);
    }, 0);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Time-of-day greeting: the dashboard should read like a briefing, not a
  // report. "Good morning — here's what your AI handled."
  const hour = new Date().getHours();
  const dayPart = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";

  const header = (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-black text-ink sm:text-3xl">{dayPart}</h1>
        <p className="mt-1 text-sm text-ink-soft sm:text-base">
          Here&apos;s what your AI receptionist handled and what needs you.
        </p>
      </div>
      <div className="inline-flex self-start rounded-xl border border-line bg-card p-1 shadow-card">
        {INSIGHT_RANGES.map((r) => (
          <button
            key={r.value}
            type="button"
            onClick={() => selectRange(r.value)}
            className={`press rounded-lg px-4 py-2 text-sm font-bold transition ${
              range === r.value
                ? "bg-ink text-white shadow-card"
                : "text-ink-soft hover:bg-card-tint"
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
      <div className="anim-fade">
        {header}
        <div className="skeleton mb-6 h-28 w-full" />
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <div className="skeleton h-32" />
          <div className="skeleton h-32" />
          <div className="skeleton h-32" />
          <div className="skeleton h-32" />
        </div>
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <div className="skeleton h-52" />
          <div className="skeleton h-52" />
        </div>
      </div>
    );
  }

  if (error && !insights) {
    return (
      <div className="anim-rise">
        {header}
        <div className="rounded-2xl border border-line bg-card px-5 py-16 text-center shadow-card">
          <p className="font-black text-ink">We couldn&apos;t load your insights.</p>
          <p className="mt-1 text-sm text-ink-soft">{error}</p>
          <button
            type="button"
            onClick={() => load(range)}
            className="press mt-4 inline-flex items-center gap-2 rounded-lg bg-ink px-4 py-2 text-sm font-black text-white transition hover:bg-[#263130]"
          >
            <RefreshCw className="h-4 w-4" /> Try again
          </button>
        </div>
      </div>
    );
  }

  const i = insights as DashboardInsights;

  // Empty state, no calls at all yet, or none in the chosen range.
  if (i.totalCalls === 0) {
    return (
      <div className="anim-rise">
        {header}
        <div className="rounded-2xl border border-dashed border-line-strong bg-card px-5 py-20 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal-wash">
            <Sparkles className="h-7 w-7 text-teal" />
          </div>
          <p className="text-lg font-black text-ink">
            {i.hasAnyCalls ? "No calls in this period" : "Quiet in here — for now"}
          </p>
          <p className="mx-auto mt-2 max-w-md text-ink-soft">
            {i.hasAnyCalls
              ? "Try a longer date range to see insights from earlier calls."
              : "As soon as your AI agent takes its first call, this becomes your daily briefing: what callers wanted, bookings won and anything that needs you."}
          </p>
        </div>
      </div>
    );
  }

  const analysedKnown = i.analysedCalls > 0;

  return (
    <div className="anim-rise">
      {header}

      {/* AI-generated briefing */}
      <section className="mb-6 rounded-2xl border border-teal/20 bg-gradient-to-br from-[#f0fafa] via-card to-card px-5 py-5 shadow-card sm:px-6">
        <p className="flex items-center gap-2 text-xs font-black uppercase tracking-wide text-teal">
          <Sparkles className="h-4 w-4" />
          Your AI briefing
        </p>
        <p className="mt-2 max-w-3xl text-base leading-relaxed text-ink sm:text-lg">{i.summary}</p>
        {analysing && (
          <p className="mt-3 flex items-center gap-2 text-sm text-ink-soft">
            <Loader2 className="h-4 w-4 animate-spin" />
            Analysing your recent calls… numbers will update shortly.
          </p>
        )}
        {!analysisEnabled && i.pendingAnalysis > 0 && (
          <p className="mt-3 text-sm text-ink-soft">
            {i.pendingAnalysis} call{i.pendingAnalysis === 1 ? "" : "s"} not yet analysed (AI
            analysis isn&apos;t switched on).
          </p>
        )}
      </section>

      {/* Four headline numbers, everything else is a quiet chip row below. */}
      <div className="stagger grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <InsightCard
          label="Conversations"
          value={i.totalCalls}
          icon={Inbox}
          accent="#0f8285"
          onClick={onViewCalls}
        />
        <InsightCard
          label="Bookings won"
          value={i.bookingCount}
          icon={CalendarCheck}
          accent="#12915c"
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
          label="Need your attention"
          value={i.attention.length}
          icon={AlertTriangle}
          accent={i.attention.length > 0 ? "#c2620a" : "#12915c"}
          hint={i.attention.length > 0 ? "See the list below" : "All clear"}
        />
      </div>

      {/* Secondary metrics: present but not shouting. */}
      <div className="mt-4 flex flex-wrap gap-2">
        <StatChip
          icon={Bot}
          label="Handled by AI"
          value={analysedKnown ? `${i.handledByAiRate}%` : "—"}
          title="Calls fully handled by your AI without transfer or callback"
        />
        <StatChip icon={TrendingUp} label="Conversion" value={`${i.conversionRate}%`} />
        <StatChip icon={PhoneMissed} label="Missed / escalated" value={i.missedOrEscalated} />
        <StatChip icon={Flame} label="Urgent" value={i.urgentCount} />
        <StatChip icon={ThumbsDown} label="Complaints" value={i.complaintCount} />
        <StatChip icon={HelpCircle} label="Unanswered" value={i.unansweredQuestions.length} />
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        {/* Sentiment split */}
        <section className="rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6">
          <h2 className="text-lg font-black text-ink">How callers felt</h2>
          {analysedKnown ? (
            <>
              <SentimentBar sentiment={i.sentiment} />
              <div className="mt-4 grid grid-cols-3 gap-3 text-center">
                <SentimentStat
                  icon={ThumbsUp}
                  label="Positive"
                  value={i.sentiment.positive}
                  tone="text-good"
                />
                <SentimentStat
                  icon={MessageSquareText}
                  label="Neutral"
                  value={i.sentiment.neutral}
                  tone="text-ink-soft"
                />
                <SentimentStat
                  icon={ThumbsDown}
                  label="Negative"
                  value={i.sentiment.negative}
                  tone="text-danger"
                />
              </div>
            </>
          ) : (
            <p className="mt-4 text-sm text-ink-soft">
              Sentiment will appear once your calls have been analysed.
            </p>
          )}
        </section>

        {/* Top call reasons */}
        <section className="rounded-2xl border border-line bg-card p-5 shadow-card sm:p-6">
          <h2 className="text-lg font-black text-ink">Top reasons people called</h2>
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
            <p className="mt-4 text-sm text-ink-soft">
              Call reasons will appear once your calls have been analysed.
            </p>
          )}
        </section>
      </div>

      <FollowUpsSection
        followUps={followUps}
        onFollowUpStatus={onFollowUpStatus}
        onOpenCall={onOpenCall}
      />

      {/* Needs attention, open by default (the actionable one) */}
      <CollapsibleSection
        title="Needs attention"
        icon={AlertTriangle}
        accent="#c2620a"
        count={i.attention.length}
        defaultOpen={i.attention.length > 0}
        subtitle="Complaints, urgent calls and unanswered questions"
      >
        {i.attention.length > 0 ? (
          <ul className="divide-y divide-line">
            {i.attention.map((item, idx) => (
              <AttentionRow key={`${item.callId}-${idx}`} item={item} onOpen={onOpenCall} />
            ))}
          </ul>
        ) : (
          <p className="flex items-center justify-center gap-2 rounded-xl bg-good-wash px-4 py-6 text-center text-sm font-semibold text-good">
            <Check className="h-4 w-4" />
            Nothing needs your attention right now.
          </p>
        )}
      </CollapsibleSection>

      {/* Opportunities, collapsed by default */}
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

      {/* Common unanswered questions, collapsed by default */}
      {i.unansweredQuestions.length > 0 && (
        <CollapsibleSection
          title="Common unanswered questions"
          icon={HelpCircle}
          accent="#7a5b00"
          count={i.unansweredQuestions.length}
          subtitle="Questions your agent couldn't answer, worth adding to its knowledge"
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
          className="flex h-9 w-9 items-center justify-center rounded-xl"
          style={{ backgroundColor: `${accent}1a`, color: accent }}
        >
          <Icon className="h-5 w-5" />
        </span>
        {onClick && <ChevronRight className="h-4 w-4 text-ink-faint" />}
      </div>
      <p className="mt-3 text-2xl font-black tabular-nums text-ink sm:text-3xl">{value}</p>
      <p className="mt-0.5 text-sm font-semibold text-ink-soft">{label}</p>
      {hint && <p className="mt-0.5 text-xs text-ink-faint">{hint}</p>}
    </>
  );
  const base =
    "rounded-2xl border border-line bg-card p-4 text-left shadow-card sm:p-5";
  return onClick ? (
    <button type="button" onClick={onClick} className={`${base} lift press w-full`}>
      {inner}
    </button>
  ) : (
    <div className={base}>{inner}</div>
  );
}

// A quiet, secondary metric. Anything not worth a headline card lives here.
function StatChip({
  icon: Icon,
  label,
  value,
  title,
}: {
  icon: LucideIcon;
  label: string;
  value: number | string;
  title?: string;
}) {
  return (
    <span
      title={title}
      className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-3.5 py-1.5 text-xs font-semibold text-ink-soft shadow-card"
    >
      <Icon className="h-3.5 w-3.5 text-ink-faint" />
      {label}
      <span className="font-black tabular-nums text-ink">{value}</span>
    </span>
  );
}

function SentimentBar({
  sentiment,
}: {
  sentiment: { positive: number; neutral: number; negative: number };
}) {
  // Widths animate from zero on mount, a small moment of life that also makes
  // the proportions easier to read as they settle.
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);
  const total = sentiment.positive + sentiment.neutral + sentiment.negative;
  const pct = (n: number) => (total > 0 && mounted ? (n / total) * 100 : 0);
  const seg = "h-full transition-all duration-700 ease-out";
  return (
    <div className="mt-4 flex h-4 w-full overflow-hidden rounded-full bg-card-tint">
      <div style={{ width: `${pct(sentiment.positive)}%` }} className={`${seg} bg-good`} />
      <div style={{ width: `${pct(sentiment.neutral)}%` }} className={`${seg} bg-[#c9d1ce]`} />
      <div style={{ width: `${pct(sentiment.negative)}%` }} className={`${seg} bg-danger`} />
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
    <div className="rounded-lg bg-card-tint py-3">
      <Icon className={`mx-auto h-5 w-5 ${tone}`} />
      <p className="mt-1 text-xl font-black text-ink">{value}</p>
      <p className="text-xs font-semibold text-ink-soft">{label}</p>
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
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const t = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(t);
  }, []);
  const width = max > 0 && mounted ? Math.max(6, (reason.count / max) * 100) : 0;
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        className="group flex w-full items-center gap-3 text-left"
      >
        <span className="w-36 flex-shrink-0 truncate text-sm font-semibold text-ink sm:w-44">
          {reason.label}
        </span>
        <span className="relative h-3 flex-1 overflow-hidden rounded-full bg-card-tint">
          <span
            className="absolute inset-y-0 left-0 rounded-full bg-[#41c9ce] transition-all duration-700 ease-out group-hover:bg-teal"
            style={{ width: `${width}%` }}
          />
        </span>
        <span className="w-8 flex-shrink-0 text-right text-sm font-black tabular-nums text-ink">
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
        className="flex w-full items-start gap-3 py-3 text-left transition hover:bg-card-tint"
      >
        <span
          className={`mt-0.5 flex h-7 items-center gap-1 rounded-full px-2 text-[11px] font-black uppercase tracking-wide ${style.tone}`}
        >
          <Icon className="h-3.5 w-3.5" />
          {style.label}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-semibold text-ink">
            {item.detail}
          </span>
          <span className="mt-0.5 block text-xs text-ink-faint">
            {item.caller} · {formatWhen(item.startedAt)}
          </span>
        </span>
        <ChevronRight className="mt-1 h-4 w-4 flex-shrink-0 text-ink-faint" />
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
        className="flex w-full items-start gap-3 rounded-lg px-3 py-2.5 text-left transition hover:bg-card-tint"
      >
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">{item.detail}</span>
          <span className="mt-0.5 block text-xs text-ink-faint">
            {item.caller} · {formatWhen(item.startedAt)}
          </span>
        </span>
        <ChevronRight className="mt-0.5 h-4 w-4 flex-shrink-0 text-ink-faint" />
      </button>
    </li>
  );
}

// A small channel badge for the history list, at a glance, how the conversation
// arrived (phone / WhatsApp / email / website chat).
const channelMeta: Record<CallChannel, { Icon: LucideIcon; label: string; bg: string; fg: string }> = {
  phone: { Icon: Phone, label: "Phone call", bg: "bg-teal-wash", fg: "text-teal" },
  whatsapp: { Icon: MessageCircle, label: "WhatsApp", bg: "bg-[#eafaf1]", fg: "text-good" },
  sms: { Icon: MessageSquare, label: "SMS", bg: "bg-[#f5f0ff]", fg: "text-[#7c3aed]" },
  email: { Icon: Mail, label: "Email", bg: "bg-[#eef2fb]", fg: "text-[#3b5bb5]" },
  chat: { Icon: MessageSquareText, label: "Website chat", bg: "bg-teal-wash", fg: "text-teal" },
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

// ── Unified Inbox ───────────────────────────────────────────────────────────
// Every conversation the AI has handled — phone, WhatsApp, SMS, email and web
// chat — in one two-pane inbox. Filterable list on the left, the full AI call
// detail (summary, outcome, transcript, quick actions) on the right. On mobile
// the detail slides over the list like a native mail app, so it's always one
// tap from list to conversation and one tap back.

function relativeWhen(iso: string): string {
  if (!iso) return "-";
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "now";
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function looksLikePhone(caller: string): boolean {
  return /^\+?[\d\s()-]{7,}$/.test(caller.trim());
}

function InboxRow({
  log,
  selected,
  onClick,
}: {
  log: CallLog;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`press flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition ${
        selected ? "bg-teal-wash" : "hover:bg-card-tint"
      }`}
    >
      <ChannelIcon channel={log.channel} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className="truncate text-sm font-bold text-ink">{log.caller || "Unknown"}</span>
          <span className="flex-shrink-0 text-xs tabular-nums text-ink-faint">
            {relativeWhen(log.startedAt)}
          </span>
        </span>
        <span className="mt-0.5 block truncate text-xs text-ink-soft">
          {log.summary || friendlyOutcome(log.outcome)}
        </span>
      </span>
    </button>
  );
}

function CopyChip({ value, label }: { value: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() =>
        navigator.clipboard?.writeText(value).then(
          () => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1500);
          },
          () => {},
        )
      }
      className="press inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-card px-3 text-xs font-bold text-ink-soft transition hover:border-line-strong hover:text-ink"
    >
      {copied ? <Check className="anim-pop h-3.5 w-3.5 text-good" /> : <Copy className="h-3.5 w-3.5" />}
      {copied ? "Copied" : label}
    </button>
  );
}

function ConversationDetail({
  log,
  followUps,
  onFollowUpStatus,
  onBack,
}: {
  log: CallLog;
  followUps: FollowUp[];
  onFollowUpStatus: (id: string, status: FollowUp["status"]) => void;
  onBack: () => void;
}) {
  const meta = channelMeta[log.channel] ?? channelMeta.phone;
  const isPhone = looksLikePhone(log.caller);
  const callFollowUps = followUps.filter((item) => item.callLogId === log.id && item.status === "open");
  const actionItems = log.actionItems.length ? log.actionItems : callFollowUps.map((item) => item.title);
  const primarySummary = log.aiInsightSummary || log.summary;
  const outcomeLabel = friendlyOutcome(log.outcome);
  const [transcriptOpen, setTranscriptOpen] = useState(!primarySummary);
  return (
    <div key={log.id} className="anim-fade flex h-full min-h-0 flex-col overflow-y-auto">
      {/* Mobile back */}
      <div className="sticky top-0 z-10 border-b border-line bg-card px-3 py-2 lg:hidden">
        <button
          type="button"
          onClick={onBack}
          className="inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm font-bold text-teal"
        >
          <ArrowLeft className="h-4 w-4" />
          Inbox
        </button>
      </div>

      <div className="border-b border-line px-4 py-4 sm:px-6 sm:py-5">
        <div className="flex flex-wrap items-center gap-3">
          <ChannelIcon channel={log.channel} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-black text-ink">{log.caller || "Unknown"}</h2>
            <p className="text-xs text-ink-soft">
              {meta.label} · {formatWhen(log.startedAt)}
              {log.durationLabel && log.durationLabel !== "-" ? ` · ${log.durationLabel}` : ""}
              {log.agentName ? ` · answered by ${log.agentName}` : ""}
            </p>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          {isPhone && (
            <a
              href={`tel:${log.caller.replace(/[^\d+]/g, "")}`}
              className="press inline-flex h-9 items-center gap-2 rounded-lg bg-ink px-4 text-xs font-black text-white transition hover:bg-[#263130]"
            >
              <PhoneOutgoing className="h-3.5 w-3.5" />
              Call back
            </a>
          )}
          {log.caller && (
            <CopyChip value={log.caller} label={isPhone ? "Copy number" : "Copy address"} />
          )}
        </div>
      </div>

      <div className="grid border-b border-line bg-card-tint/70 sm:grid-cols-3">
        <div className="border-b border-line px-4 py-3 sm:border-b-0 sm:border-r sm:px-6">
          <p className="text-[10px] font-black uppercase tracking-wide text-ink-faint">Outcome</p>
          <p className="mt-1 truncate text-sm font-black text-ink">
            {outcomeLabel === "-" ? "Conversation recorded" : outcomeLabel}
          </p>
        </div>
        <div className="border-b border-line px-4 py-3 sm:border-b-0 sm:border-r sm:px-6">
          <p className="text-[10px] font-black uppercase tracking-wide text-ink-faint">Next step</p>
          <p className={`mt-1 truncate text-sm font-black ${actionItems.length ? "text-teal-deep" : "text-good"}`}>
            {actionItems.length
              ? `${actionItems.length} follow-up${actionItems.length === 1 ? "" : "s"} needed`
              : "No follow-up needed"}
          </p>
        </div>
        <div className="px-4 py-3 sm:px-6">
          <p className="text-[10px] font-black uppercase tracking-wide text-ink-faint">Handled by</p>
          <p className="mt-1 truncate text-sm font-black text-ink">{log.agentName || "WiseCall"}</p>
        </div>
      </div>

      <div className="flex-1 space-y-5 px-4 py-4 sm:px-6 sm:py-5">
        {actionItems.length > 0 && (
          <div className="rounded-xl border border-teal/20 bg-teal-wash px-4 py-3">
            <p className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-teal">
              <CalendarCheck className="h-3.5 w-3.5" />
              Follow-up needed
            </p>
            <ul className="space-y-2">
              {callFollowUps.length > 0
                ? callFollowUps.map((item) => (
                    <li key={item.id} className="flex items-start justify-between gap-3 text-sm text-[#0e4b4d]">
                      <span>{item.title}</span>
                      <button
                        type="button"
                        onClick={() => onFollowUpStatus(item.id, "done")}
                        className="press inline-flex h-7 flex-shrink-0 items-center gap-1 rounded-lg bg-ink px-2.5 text-[11px] font-black text-white"
                      >
                        <Check className="h-3 w-3" />
                        Done
                      </button>
                    </li>
                  ))
                : actionItems.map((item) => (
                    <li key={item} className="text-sm text-[#0e4b4d]">
                      {item}
                    </li>
                  ))}
            </ul>
          </div>
        )}
        {primarySummary && (
          <section aria-labelledby={`conversation-summary-${log.id}`}>
            <h3
              id={`conversation-summary-${log.id}`}
              className="mb-2 flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wide text-ink-faint"
            >
              <Sparkles className="h-3.5 w-3.5" />
              What happened
            </h3>
            <p className="max-w-3xl text-sm leading-6 text-ink-soft">{primarySummary}</p>
          </section>
        )}
        {log.transcript ? (
          <details
            open={transcriptOpen}
            onToggle={(event) => setTranscriptOpen(event.currentTarget.open)}
            className="group border-t border-line pt-1"
          >
            <summary className="press flex cursor-pointer list-none items-center justify-between gap-3 py-3 text-sm font-black text-ink marker:content-none">
              <span>Conversation transcript</span>
              <ChevronDown className="h-4 w-4 text-ink-faint transition group-open:rotate-180" />
            </summary>
            <div className="pb-2">
              <TranscriptView transcript={log.transcript} />
            </div>
          </details>
        ) : (
          <p className="rounded-xl bg-card-tint px-4 py-6 text-center text-sm text-ink-faint">
            No transcript was recorded for this conversation.
          </p>
        )}
      </div>
    </div>
  );
}

const INBOX_FILTERS: { value: "all" | CallChannel; label: string }[] = [
  { value: "all", label: "All" },
  { value: "phone", label: "Calls" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "sms", label: "SMS" },
  { value: "email", label: "Email" },
  { value: "chat", label: "Web chat" },
];

function UnifiedInbox({
  callLogs,
  followUps,
  onFollowUpStatus,
  selectedId,
  onSelect,
}: {
  callLogs: CallLog[];
  followUps: FollowUp[];
  onFollowUpStatus: (id: string, status: FollowUp["status"]) => void;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
}) {
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<"all" | CallChannel>("all");
  // When arriving from an insight with a call pre-selected, mobile should land
  // straight on the conversation, not the list.
  const [mobileDetail, setMobileDetail] = useState(Boolean(selectedId));

  const present = useMemo(() => new Set(callLogs.map((l) => l.channel)), [callLogs]);
  const filters = INBOX_FILTERS.filter((f) => f.value === "all" || present.has(f.value));

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return callLogs.filter((log) => {
      if (filter !== "all" && log.channel !== filter) return false;
      if (!q) return true;
      return [log.caller, log.summary, log.agentName, friendlyOutcome(log.outcome)]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [callLogs, search, filter]);

  // Zero-click default: on desktop the newest conversation is open as soon as
  // you land, mobile still starts on the list.
  const selected = callLogs.find((l) => l.id === selectedId) ?? filtered[0] ?? null;

  if (callLogs.length === 0) {
    return (
      <div className="anim-rise mx-auto max-w-2xl">
        <h1 className="text-2xl font-black text-ink sm:text-3xl">Inbox</h1>
        <div className="mt-6 rounded-2xl border border-dashed border-line-strong bg-card px-5 py-20 text-center">
          <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-teal-wash">
            <Inbox className="h-7 w-7 text-teal" />
          </div>
          <p className="text-lg font-black text-ink">Your inbox is ready</p>
          <p className="mx-auto mt-2 max-w-sm text-sm text-ink-soft">
            Every call, WhatsApp, SMS, email and web chat your AI handles will land here, with
            a summary and full transcript. Try calling your agent&apos;s number to see it work.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="anim-rise">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-black text-ink sm:text-3xl">Inbox</h1>
          <p className="mt-1 text-sm text-ink-soft">
            Every conversation your AI has handled, on every channel.
          </p>
        </div>
      </div>

      <div className="flex flex-col overflow-hidden rounded-2xl border border-line bg-card shadow-card lg:h-[calc(100dvh-13.5rem)] lg:min-h-[540px] lg:flex-row">
        {/* List pane */}
        <div
          className={`flex min-h-0 flex-col border-line lg:w-[360px] lg:flex-shrink-0 lg:border-r ${
            mobileDetail ? "hidden lg:flex" : "flex"
          }`}
        >
          <div className="border-b border-line p-3">
            <div className="flex items-center gap-2 rounded-lg border border-line bg-card-tint px-3 py-2.5 transition focus-within:border-teal">
              <Search className="h-4 w-4 flex-shrink-0 text-ink-faint" />
              <input
                type="search"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search conversations…"
                className="min-w-0 flex-1 bg-transparent text-base text-ink outline-none placeholder:text-ink-faint sm:text-sm"
              />
            </div>
            {filters.length > 2 && (
              <div className="mt-2 flex gap-1.5 overflow-x-auto pb-0.5">
                {filters.map((f) => (
                  <button
                    key={f.value}
                    type="button"
                    onClick={() => setFilter(f.value)}
                    className={`press flex-shrink-0 rounded-full px-3 py-1 text-xs font-bold transition ${
                      filter === f.value
                        ? "bg-ink text-white"
                        : "bg-card-tint text-ink-soft hover:bg-card-tint"
                    }`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {filtered.length > 0 ? (
              filtered.map((log) => (
                <InboxRow
                  key={log.id}
                  log={log}
                  selected={log.id === selected?.id}
                  onClick={() => {
                    onSelect(log.id);
                    setMobileDetail(true);
                  }}
                />
              ))
            ) : (
              <p className="px-3 py-8 text-center text-sm text-ink-faint">
                No conversations match.
              </p>
            )}
          </div>
        </div>

        {/* Detail pane */}
        <div
          className={`min-h-0 flex-1 overflow-hidden ${
            mobileDetail ? "flex flex-col" : "hidden lg:flex lg:flex-col"
          }`}
        >
          {selected ? (
            <ConversationDetail
              key={selected.id}
              log={selected}
              followUps={followUps}
              onFollowUpStatus={onFollowUpStatus}
              onBack={() => setMobileDetail(false)}
            />
          ) : (
            <div className="hidden h-full min-h-[240px] items-center justify-center px-4 lg:flex">
              <div className="text-center">
                <History className="mx-auto mb-2 h-6 w-6 text-ink-faint" />
                <p className="text-sm text-ink-faint">Select a conversation to read it</p>
              </div>
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
    <div className="stagger space-y-2.5 rounded-xl bg-card-tint p-4">
      {turns.map((turn, index) => {
        const isCaller = turn.speaker === "caller";
        return (
          <div key={index} className={`flex ${isCaller ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-[82%] rounded-2xl px-4 py-2.5 ${
                isCaller
                  ? "rounded-br-sm bg-[#172929] text-white"
                  : "rounded-bl-sm border border-line bg-card text-ink shadow-card"
              }`}
            >
              <p
                className={`mb-0.5 text-[11px] font-black uppercase tracking-wide ${
                  isCaller ? "text-[#7de8eb]" : "text-teal"
                }`}
              >
                {isCaller ? "Caller" : "AI agent"}
              </p>
              <p className="whitespace-pre-line text-sm leading-relaxed">{turn.text}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// One row per connected line: icon, number with a pulsing live dot, purpose,
// and a copy affordance that appears on hover / keyboard focus.
function NumberRow({
  icon: Icon,
  iconClass,
  number,
  purpose,
  live = true,
  pendingDot = false,
}: {
  icon: LucideIcon;
  iconClass: string;
  number: string;
  purpose: string;
  live?: boolean;
  pendingDot?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const copyable = /\d/.test(number);
  return (
    <div className="group flex items-center gap-3 py-2.5">
      <span className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${iconClass}`}>
        <Icon className="h-5 w-5" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-2 font-black text-ink">
          <span
            className={`h-2 w-2 flex-shrink-0 rounded-full ${
              live ? "live-dot bg-good" : pendingDot ? "bg-warn" : "bg-ink-faint"
            }`}
          />
          <span className="truncate font-mono text-[15px]">{number}</span>
        </p>
        <p className="mt-0.5 text-xs text-ink-soft">{purpose}</p>
      </div>
      {copyable && (
        <button
          type="button"
          onClick={() =>
            navigator.clipboard?.writeText(number).then(
              () => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              },
              () => {},
            )
          }
          aria-label={`Copy ${number}`}
          className="press flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-ink-faint opacity-0 transition hover:bg-card-tint hover:text-ink focus-visible:opacity-100 group-hover:opacity-100"
        >
          {copied ? <Check className="anim-pop h-4 w-4 text-good" /> : <Copy className="h-4 w-4" />}
        </button>
      )}
    </div>
  );
}

function RoutingCard({
  routing,
  isProvisioning,
  error,
  onProvision,
}: {
  routing: AgentRouting;
  isProvisioning: boolean;
  error: string | null;
  onProvision: () => void;
}) {
  const live = routing.status === "live";
  const pending = routing.status === "pending";

  return (
    <div className="mb-6 rounded-2xl border border-line bg-card px-5 py-3 shadow-card">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <div className="min-w-0 divide-y divide-line sm:flex-1">
          <NumberRow
            icon={Phone}
            iconClass="bg-teal-wash text-teal"
            number={live ? routing.number : pending ? "Setting up…" : "No number yet"}
            purpose={
              live
                ? "Live and answering calls"
                : pending
                  ? "Provisioning — usually ready within 5 minutes"
                  : "Assign a number to put this agent on a phone line"
            }
            live={live}
            pendingDot={pending}
          />
        </div>
        {live ? null : (
          <button
            type="button"
            onClick={onProvision}
            disabled={isProvisioning || pending}
            className="press inline-flex flex-shrink-0 items-center justify-center gap-2 rounded-xl bg-ink px-4 py-2.5 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
          >
            {isProvisioning ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" /> Assigning…
              </>
            ) : (
              "Assign number"
            )}
          </button>
        )}
      </div>
      {error && <p className="mt-3 text-sm text-warn">{error}</p>}
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
      className={`flex w-full items-center gap-4 rounded-2xl border bg-card px-5 py-4 text-left shadow-card ${
        enabled ? "border-line" : "border-dashed border-line-strong"
      } ${isButton ? "lift press" : ""}`}
    >
      <span
        className={`flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-xl ${
          enabled ? "bg-teal-wash text-teal" : "bg-card-tint text-ink-faint"
        }`}
      >
        <Icon className="h-5 w-5" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-black text-ink">{title}</span>
        <span className="mt-0.5 block truncate text-sm text-ink-soft">{body}</span>
      </span>
      {enabled ? (
        <span className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-good-wash px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-good">
          <Check className="h-3.5 w-3.5" />
          On
        </span>
      ) : (
        <span className="flex flex-shrink-0 items-center gap-1.5 rounded-full bg-card-tint px-2.5 py-1 text-[11px] font-black uppercase tracking-wide text-ink-soft">
          <CirclePlus className="h-3.5 w-3.5" />
          Set up
        </span>
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
      <div className="anim-scale-in max-h-[calc(100dvh-2rem)] w-full max-w-xl overflow-y-auto rounded-2xl bg-white p-5 shadow-float sm:p-7">
        <div className="mb-6 flex items-center justify-between gap-4">
          <h2 className="text-2xl font-black">Create Assistant</h2>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-card-tint hover:text-ink"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <p className="mb-3 text-sm font-bold text-ink-soft">Start from a template</p>
        <div className="mb-6 space-y-3">
          {agentTemplates.map((template) => {
            const selected = template.id === templateId;
            return (
              <button
                type="button"
                key={template.id}
                disabled={!template.available}
                onClick={() => onTemplateChange(template.id)}
                className={`flex w-full items-start gap-3 rounded-xl border px-5 py-4 text-left transition ${
                  selected
                    ? "border-teal bg-teal-wash"
                    : "border-line bg-white hover:bg-card-tint"
                } ${template.available ? "" : "cursor-not-allowed opacity-50"}`}
              >
                <span
                  className={`mt-0.5 flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border ${
                    selected ? "border-teal bg-teal" : "border-black/20"
                  }`}
                >
                  {selected && <Check className="h-3.5 w-3.5 text-white" />}
                </span>
                <span className="min-w-0">
                  <span className="block font-black">{template.label}</span>
                  <span className="mt-1 block text-sm text-ink-soft">
                    {template.description}
                  </span>
                </span>
              </button>
            );
          })}
          <p className="px-1 text-xs text-ink-faint">
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

        {error && <p className="mt-4 text-sm text-danger">{error}</p>}

        <p className="mt-5 flex items-start gap-2 rounded-xl bg-card-tint px-4 py-3 text-xs font-semibold text-ink-soft">
          <Phone className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-teal" />
          <span>
            Your first agent gets a phone number and goes live straight away. You can pause it
            any time from its page.
          </span>
        </p>

        <div className="mt-5 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            disabled={isCreating}
            className="rounded-lg bg-card-tint px-5 py-3 text-sm font-black transition hover:bg-[#e7ebe9] disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onCreate}
            disabled={isCreating}
            className="rounded-lg bg-ink px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130] disabled:opacity-60"
          >
            {isCreating ? "Creating…" : "Create & go live"}
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
        <div className="flex items-center justify-between border-b border-line px-7 py-5">
          <div>
            <h2 className="text-2xl font-black">Custom Prompts</h2>
            <p className="mt-1 text-sm text-ink-soft">{assistant.name}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-card-tint hover:text-ink"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <button
          type="button"
          className="flex items-center justify-between border-b border-line px-7 py-4 text-left font-black text-[#4c3bbd]"
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
        <div className="flex justify-end gap-3 border-t border-line px-7 py-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-card-tint px-5 py-3 text-sm font-black transition hover:bg-[#e7ebe9]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-ink px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130]"
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
  voices,
  onSelect,
}: {
  selected: string;
  greeting: string;
  voices: CartesiaVoiceOption[];
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
      <div className="stagger grid max-h-[min(420px,50vh)] gap-3 overflow-y-auto pr-1 sm:grid-cols-2">
        {voices.map((voice) => {
          const isSelected = voice.id === selected;
          const isLoading = loadingVoice === voice.id;
          const isPlaying = playingVoice === voice.id;
          return (
            <div
              key={voice.id}
              className={`lift flex items-center gap-2 rounded-2xl border px-4 py-3 shadow-card transition ${
                isSelected ? "border-teal bg-teal-wash ring-1 ring-teal" : "border-line bg-card"
              }`}
            >
              <button
                type="button"
                onClick={() => onSelect(voice.id)}
                className="press flex min-w-0 flex-1 items-center gap-3 text-left"
              >
                <span
                  className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full border transition ${
                    isSelected ? "border-teal bg-teal" : "border-line-strong"
                  }`}
                >
                  {isSelected && <Check className="anim-pop h-3.5 w-3.5 text-white" />}
                </span>
                <span className="min-w-0">
                  <span className="block font-black text-ink">{voice.label}</span>
                  <span className="mt-0.5 block truncate text-xs text-ink-soft">
                    {voice.blurb}
                  </span>
                </span>
              </button>
              <button
                type="button"
                onClick={() => (isPlaying ? stop() : test(voice.id))}
                disabled={isLoading}
                aria-label={isPlaying ? `Stop ${voice.label}` : `Test ${voice.label}`}
                className={`press flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full border transition disabled:opacity-60 ${
                  isPlaying
                    ? "border-teal bg-teal text-white"
                    : "border-line bg-white text-teal hover:border-teal"
                }`}
              >
                {isLoading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : isPlaying ? (
                  <Volume2 className="h-4 w-4 animate-pulse" />
                ) : (
                  <Play className="h-4 w-4" />
                )}
              </button>
            </div>
          );
        })}
      </div>
      {error && <p className="mt-3 text-sm text-warn">{error}</p>}
      <p className="mt-3 px-1 text-xs text-ink-faint">
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
      <div className="anim-scale-in max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-float">
        <div className="flex items-center justify-between border-b border-line px-7 py-5">
          <div>
            <h2 className="text-2xl font-black">{title}</h2>
            <p className="mt-1 text-sm text-ink-soft">{subtitle}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-card-tint hover:text-ink"
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
              className="min-h-[180px] w-full resize-none rounded-lg border border-line-strong bg-white px-4 py-3 text-base leading-7 outline-none transition focus:border-ink"
            />
          ) : (
            <input
              value={value}
              autoFocus
              onChange={(event) => onChange(event.target.value)}
              placeholder={placeholder}
              className="h-12 w-full rounded-lg border border-line-strong bg-white px-4 text-sm outline-none transition focus:border-ink"
            />
          )}
        </div>
        <div className="flex justify-end gap-3 border-t border-line px-7 py-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-card-tint px-5 py-3 text-sm font-black transition hover:bg-[#e7ebe9]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-ink px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130]"
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
        <div className="flex items-start justify-between border-b border-line px-7 py-5">
          <div>
            <h2 className="text-2xl font-black">Answer Questions</h2>
            <p className="mt-1 text-sm text-ink-soft">
              Fill in what {assistant.name} should be able to tell callers. Leave any section
              blank if it doesn&apos;t apply.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg text-ink-soft transition hover:bg-card-tint hover:text-ink"
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
                className="w-full resize-none rounded-lg border border-line-strong bg-white px-4 py-3 text-sm leading-6 outline-none transition focus:border-ink placeholder:text-ink-faint"
              />
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-3 border-t border-line px-7 py-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-card-tint px-5 py-3 text-sm font-black transition hover:bg-[#e7ebe9]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-ink px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130]"
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
      <div className="anim-scale-in max-h-[calc(100dvh-2rem)] w-full max-w-2xl overflow-y-auto rounded-2xl bg-white shadow-float">
        <div className="flex items-center justify-between border-b border-line px-7 py-5">
          <div>
            <h2 className="text-2xl font-black">Greeting message</h2>
            <p className="mt-1 text-sm text-ink-soft">
              The first thing callers hear when {assistant.name} answers.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="flex h-9 w-9 items-center justify-center rounded-lg text-ink-soft transition hover:bg-card-tint hover:text-ink"
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
            className="min-h-[140px] w-full resize-none rounded-lg border border-line-strong bg-white px-4 py-3 text-base leading-7 outline-none transition focus:border-ink"
          />
          <p className="mt-3 text-xs text-ink-faint">
            Keep it short and natural, one or two sentences works best on the phone.
          </p>
        </div>
        <div className="flex justify-end gap-3 border-t border-line px-7 py-5">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-card-tint px-5 py-3 text-sm font-black transition hover:bg-[#e7ebe9]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSave}
            className="rounded-lg bg-ink px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130]"
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
        className="h-12 w-full rounded-lg border border-line-strong bg-white px-4 text-sm outline-none transition placeholder:text-ink-faint focus:border-ink"
      />
    </label>
  );
}

function AgentStatePill({ assistant }: { assistant: Assistant }) {
  const state = getAgentOperationalState(assistant);
  const styles: Record<AgentOperationalState, string> = {
    live: "bg-good-wash text-good",
    paused: "bg-card-tint text-ink-soft",
    setting_up: "bg-warn-wash text-warn",
    review: "bg-warn-wash text-warn",
    disconnected: "bg-card-tint text-ink-soft",
  };
  const dot: Record<AgentOperationalState, string> = {
    live: "live-dot bg-good",
    paused: "bg-ink-faint",
    setting_up: "bg-warn",
    review: "bg-warn",
    disconnected: "bg-ink-faint",
  };

  return (
    <span
      className={`inline-flex flex-shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide ${styles[state]}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${dot[state]}`} />
      {agentOperationalLabel(state)}
    </span>
  );
}
