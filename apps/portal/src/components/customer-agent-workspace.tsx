"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import {
  ArrowLeft,
  Bot,
  Check,
  ChevronRight,
  CirclePlus,
  CreditCard,
  Grid2X2,
  Hand,
  History,
  Layers,
  Loader2,
  LogOut,
  Mail,
  Menu,
  MessageSquareText,
  MoreHorizontal,
  Phone,
  Play,
  Plus,
  Save,
  Search,
  ShieldCheck,
  Sparkles,
  Trash2,
  UserRound,
  Users,
  Volume2,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { signOutAction } from "@/app/actions/auth";
import { EmailChannelCheckoutButton } from "@/app/billing/start-trial-button";
import type { EmailChannelUsage } from "@/lib/billing";
import {
  createAgent,
  provisionNumber,
  testVoice,
  updateAgent,
} from "@/app/actions/agents";
import type { CallLog } from "@/lib/agents";
import type { Contact } from "@/lib/contacts";
import { OfficeHoursCard } from "./office-hours-card";
import { ContactsView } from "./contacts-view";
import { SetupWizard, type WizardResult } from "./setup-wizard";
import type { AgentDraft } from "@/app/actions/wizard";
import { impersonateUser, stopImpersonating } from "@/app/actions/admin";

type View = "home" | "assistants" | "detail" | "calls" | "contacts" | "channels";
type DetailTab = "behaviour" | "routing" | "technical";

// Provider-agnostic call routing. The portal stays the same whichever telco
// stack wins — only `provider` and the per-provider fields differ. Persisted in
// metadata.routing on wisecall_profiles.
export type RoutingProvider = "telnyx" | "mor_openai";
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
  ownerEmail?: string; // admin view only — which customer owns this agent
  ownerId?: string; // admin view only — owner's auth user id (for "log in as")
};

// Per-day office hours. Only OPEN days are present; a missing day = closed.
// Keys are mon,tue,wed,thu,fri,sat,sun. The runtime reads metadata.office_hours
// to switch the agent into after-hours message-taking mode when closed.
export type OfficeHours = Record<string, { open: string; close: string }>;

// The voices we offer today — Cartesia's latest model. Labels are what the
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

// The Channels hub: one place to see and enable every way an agent can talk to
// customers. Phone is included; Email is the first paid add-on; WhatsApp + SMS
// land here as they ship. Reuses Cursor's email billing data + checkout button.
function ChannelsHub({ emailChannel }: { emailChannel?: EmailChannelUsage }) {
  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6">
        <h1 className="text-2xl font-black text-[#111716]">Channels</h1>
        <p className="mt-1 text-sm text-[#66716e]">
          One agent, every channel. Add a way for customers to reach you and the same AI handles it —
          logging every conversation to Contacts.
        </p>
      </div>

      <div className="space-y-3">
        {/* Phone — always included */}
        <div className="flex items-center gap-4 rounded-[14px] border border-black/10 bg-white px-5 py-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#eefbfb] text-[#148b8e]">
            <Phone className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-black text-[#111716]">Phone</p>
            <p className="text-sm text-[#66716e]">Your AI receptionist answers and routes calls.</p>
          </div>
          <span className="flex-shrink-0 rounded-full bg-[#eafaf1] px-3 py-1 text-xs font-bold text-[#14823f]">
            Included
          </span>
        </div>

        {/* Email — first paid add-on */}
        <div className="flex flex-wrap items-center gap-4 rounded-[14px] border border-black/10 bg-white px-5 py-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#eefbfb] text-[#148b8e]">
            <Mail className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-black text-[#111716]">Email</p>
            <p className="text-sm text-[#66716e]">
              Forward your inbox — the same agent replies to emails and logs every contact.
            </p>
          </div>
          {emailChannel?.enabled ? (
            <div className="flex flex-shrink-0 items-center gap-3">
              <span className="text-xs font-semibold text-[#66716e]">
                {emailChannel.used}/{emailChannel.allowance} replies used
                {emailChannel.overage > 0 ? ` · ${emailChannel.overage} overage` : ""}
              </span>
              <span className="rounded-full bg-[#eafaf1] px-3 py-1 text-xs font-bold text-[#14823f]">
                Active
              </span>
            </div>
          ) : emailChannel?.canPurchase ? (
            <div className="flex flex-shrink-0 flex-col items-end gap-1">
              <span className="text-xs font-semibold text-[#66716e]">
                £{emailChannel.monthlyPriceGbp}/mo · {emailChannel.allowance} replies incl.
              </span>
              <EmailChannelCheckoutButton />
            </div>
          ) : (
            <span className="flex-shrink-0 rounded-full bg-[#f2f4f3] px-3 py-1 text-xs font-bold text-[#7a8582]">
              Start a plan to add
            </span>
          )}
        </div>

        {/* WhatsApp — coming soon */}
        <div className="flex items-center gap-4 rounded-[14px] border border-dashed border-black/10 bg-[#fafbfb] px-5 py-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#f2f4f3] text-[#9aa5a2]">
            <MessageSquareText className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-black text-[#111716]">WhatsApp</p>
            <p className="text-sm text-[#66716e]">Let customers message your business on WhatsApp.</p>
          </div>
          <span className="flex-shrink-0 rounded-full bg-[#f2f4f3] px-3 py-1 text-xs font-bold text-[#7a8582]">
            Coming soon
          </span>
        </div>

        {/* SMS — coming soon */}
        <div className="flex items-center gap-4 rounded-[14px] border border-dashed border-black/10 bg-[#fafbfb] px-5 py-4">
          <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-[#f2f4f3] text-[#9aa5a2]">
            <MessageSquareText className="h-5 w-5" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-black text-[#111716]">SMS</p>
            <p className="text-sm text-[#66716e]">Two-way texts, handled and logged like every other channel.</p>
          </div>
          <span className="flex-shrink-0 rounded-full bg-[#f2f4f3] px-3 py-1 text-xs font-bold text-[#7a8582]">
            Coming soon
          </span>
        </div>
      </div>
    </div>
  );
}

const navItems: { view: View; label: string; icon: LucideIcon }[] = [
  { view: "home", label: "Home", icon: Grid2X2 },
  { view: "assistants", label: "Assistants", icon: Bot },
  { view: "calls", label: "Call History", icon: History },
  { view: "contacts", label: "Contacts", icon: Users },
  { view: "channels", label: "Channels", icon: Layers },
];

// Agent templates. For now there's one — a general Receptionist. Future
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
    description: "Friendly general receptionist — answers FAQs, takes messages and transfers urgent calls.",
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
        "- Take a message — always capture the caller's name, phone number and the reason for their call.",
        "- Note appointment or callback requests and pass them to the team.",
        "- Transfer urgent calls to a team member when needed.",
        "",
        "Always be polite, concise and reassuring. If you don't know an answer, take a message and let the caller know someone will get back to them shortly. Confirm the caller's name and number before ending the call.",
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
      "Dental receptionist with Dentally booking built in — looks up patients, registers new ones, books, reschedules and cancels appointments, and handles emergencies.",
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
  impersonating,
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
  impersonating?: { email: string }; // admin viewing as this customer
}) {
  const [assistants, setAssistants] = useState(initialAssistants ?? demoAssistants);
  // A real customer with no agents yet has an empty list — don't assume [0] exists.
  const [selectedId, setSelectedId] = useState(
    (initialAssistants ?? demoAssistants)[0]?.id ?? "",
  );
  const [view, setView] = useState<View>("assistants");
  const [detailTab, setDetailTab] = useState<DetailTab>("behaviour");
  const [searchTerm, setSearchTerm] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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

  const totalCalls = assistants.reduce((total, assistant) => total + assistant.calls, 0);

  function updateSelected(patch: Partial<Assistant>) {
    setAssistants((current) =>
      current.map((a) => (a.id === selectedAssistant.id ? { ...a, ...patch } : a)),
    );
  }

  function createAssistant() {
    const template =
      agentTemplates.find((t) => t.id === newTemplateId) ?? agentTemplates[0];
    const receptionist = newAssistantName.trim() || "Receptionist";
    const business = newBusinessName.trim() || "New business";
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
      const assistant: Assistant = {
        id: result.id,
        name: receptionist,
        businessName: business,
        industry: template.industry,
        phoneNumber: "Number pending",
        status: "Setup",
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
        routing: { provider: null, number: "", status: "unprovisioned" },
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
    const voice = cartesiaVoices[0].id;
    const result = await createAgent({
      name: draft.receptionistName || "Receptionist",
      businessName: draft.businessName || "New business",
      industry: draft.industry || "General",
      prompt: draft.prompt,
      greeting: draft.greeting,
      voice,
      knowledge: draft.knowledge,
      knowledgeFields: draft.knowledgeFields,
      contacts: [],
    });
    if (!result.ok || !result.id) {
      return { ok: false, error: result.error ?? "Could not create the assistant." };
    }

    const hasHours = Object.keys(draft.officeHours ?? {}).length > 0;
    if (draft.website || hasHours) {
      await updateAgent(result.id, {
        website: draft.website,
        officeHours: draft.officeHours,
      });
    }

    const assistant: Assistant = {
      id: result.id,
      name: draft.receptionistName || "Receptionist",
      businessName: draft.businessName || "New business",
      industry: draft.industry || "General",
      phoneNumber: "Number pending",
      status: "Setup",
      receptionistName: draft.receptionistName || "Receptionist",
      prompt: draft.prompt,
      greeting: draft.greeting,
      voice,
      knowledge: draft.knowledge,
      knowledgeFields: draft.knowledgeFields,
      defaultEmail: "",
      contacts: [],
      website: draft.website,
      timezone: "Europe/London",
      fallbackEmail: "",
      transferNumber: "",
      officeHours: hasHours ? draft.officeHours : undefined,
      calls: 0,
      cost: "GBP 0.00",
      routing: { provider: null, number: "", status: "unprovisioned" },
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

  function isNavActive(item: { view: View; label: string }): boolean {
    if (item.label === "Assistants") return view === "assistants" || view === "detail";
    if (item.label === "Call History") return view === "calls";
    if (item.label === "Home") return view === "home";
    if (item.label === "Contacts") return view === "contacts";
    if (item.label === "Channels") return view === "channels";
    return false;
  }

  return (
    <div className="min-h-screen bg-[#e9efed] px-0 py-0 text-[#111716] lg:px-6 lg:py-6">
      {impersonating ? (
        <div className="mx-auto mb-3 flex max-w-[1920px] flex-wrap items-center justify-between gap-3 rounded-xl bg-[#7a2e2e] px-4 py-2.5 text-sm font-semibold text-white">
          <span>
            👁 Viewing as <strong>{impersonating.email}</strong> — changes you make apply to this customer&apos;s account.
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
                ? `Free trial limit reached — ${trial.used}/${trial.cap} calls used. Add a plan to keep taking calls.`
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
                  <a
                    href="/dashboard"
                    className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
                  >
                    <Grid2X2 className="h-5 w-5 flex-shrink-0" />
                    My dashboard
                  </a>
                ) : (
                  isAdmin && (
                    <a
                      href="/admin"
                      className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
                    >
                      <ShieldCheck className="h-5 w-5 flex-shrink-0" />
                      Admin
                    </a>
                  )
                )}
              </nav>
              <div className="mx-4 mb-4 rounded-[18px] bg-[#1a3535] p-5 text-center">
                <SupportOwl />
                <p className="text-sm font-bold text-white">Need setup help?</p>
                <button
                  type="button"
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
              <a
                href="/dashboard"
                className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
              >
                <Grid2X2 className="h-5 w-5 flex-shrink-0" />
                My dashboard
              </a>
            ) : (
              isAdmin && (
                <a
                  href="/admin"
                  className="relative flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-bold text-[#94b4b2] transition hover:bg-white/5 hover:text-white"
                >
                  <ShieldCheck className="h-5 w-5 flex-shrink-0" />
                  Admin
                </a>
              )
            )}
          </nav>

          <div className="m-4 rounded-[18px] bg-[#1a3535] p-5 text-center">
            <SupportOwl />
            <p className="text-sm font-bold text-white">Need setup help?</p>
            <button
              type="button"
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
              <span>Home</span>
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
            {view === "home" && (
              <HomeOverview
                totalCalls={totalCalls}
                assistants={assistants.length}
                onOpenAssistants={() => setView("assistants")}
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
                adminMode={adminMode}
                planName={planName}
                emailChannel={emailChannel}
              />
            )}

            {view === "calls" && (
              <CallHistory callLogs={callLogs} onOpen={(log) => setSelectedCall(log)} />
            )}

            {view === "contacts" && (
              <ContactsView contacts={contacts} callLogs={callLogs} />
            )}

            {view === "channels" && <ChannelsHub emailChannel={emailChannel} />}
          </div>
        </main>
      </div>

      {wizardOpen && (
        <SetupWizard
          onClose={() => setWizardOpen(false)}
          onSubmit={createFromDraft}
          onManual={() => {
            setWizardOpen(false);
            setCreateOpen(true);
          }}
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

function HomeOverview({
  totalCalls,
  assistants,
  onOpenAssistants,
}: {
  totalCalls: number;
  assistants: number;
  onOpenAssistants: () => void;
}) {
  return (
    <div>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-black">Home</h1>
          <p className="mt-2 text-[#66716e]">Your WiseCall activity for this month.</p>
        </div>
        <button
          type="button"
          onClick={onOpenAssistants}
          className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#111716] px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130]"
        >
          Open assistants
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>

      <section className="rounded-[18px] border border-black/10 bg-white">
        <div className="grid border-b border-black/10 sm:grid-cols-[1fr_120px_120px]">
          <div className="p-6">
            <h2 className="text-2xl font-black">Call History</h2>
            <p className="mt-1 text-[#7a8582]">June 2026</p>
          </div>
          <StatCell label="Calls" value={totalCalls} />
          <StatCell label="Agents" value={assistants} />
        </div>
        <div className="h-[280px] p-6">
          <div className="relative h-full overflow-hidden rounded-lg bg-[#f7f8f7]">
            <svg viewBox="0 0 640 220" className="h-full w-full">
              <path
                d="M30 176 C140 176 214 176 300 176 C342 176 350 128 382 128 C416 128 408 176 432 176 C462 176 448 66 480 56"
                fill="none"
                stroke="#41c9ce"
                strokeWidth="4"
                strokeLinecap="round"
              />
              <path
                d="M30 176 C140 176 214 176 300 176 C342 176 350 128 382 128 C416 128 408 176 432 176 C462 176 448 66 480 56 L480 205 L30 205 Z"
                fill="url(#chartFill)"
              />
              <defs>
                <linearGradient id="chartFill" x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor="#41c9ce" stopOpacity="0.24" />
                  <stop offset="100%" stopColor="#41c9ce" stopOpacity="0" />
                </linearGradient>
              </defs>
            </svg>
          </div>
        </div>
      </section>
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
  onBack,
  onTabChange,
  onChange,
  onPrompt,
  onGreeting,
  onAbility,
  onSave,
  onProvision,
  adminMode = false,
  planName,
  emailChannel,
}: {
  assistant: Assistant;
  tab: DetailTab;
  saved: boolean;
  isPending: boolean;
  saveError: string | null;
  isProvisioning: boolean;
  provisionError: string | null;
  onBack: () => void;
  onTabChange: (tab: DetailTab) => void;
  onChange: (patch: Partial<Assistant>) => void;
  onPrompt: () => void;
  onGreeting: () => void;
  onAbility: (key: "knowledge" | "transfer") => void;
  onSave: () => void;
  onProvision: () => void;
  adminMode?: boolean;
  planName?: string;
  emailChannel?: EmailChannelUsage;
}) {
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
          <button
            type="button"
            className="flex h-10 w-10 items-center justify-center rounded-lg transition hover:bg-[#f2f4f3]"
            aria-label="More actions"
          >
            <MoreHorizontal className="h-5 w-5" />
          </button>
        </div>
      </div>

      <RoutingCard
        routing={assistant.routing}
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

      {emailChannel?.enabled && assistant.emailAddress ? (
        <EmailChannelCard
          address={assistant.emailAddress}
          used={emailChannel.used}
          allowance={emailChannel.allowance}
          overage={emailChannel.overage}
        />
      ) : emailChannel?.canPurchase && !adminMode ? (
        <EmailChannelUpsell
          monthlyPrice={emailChannel.monthlyPriceGbp}
          allowance={emailChannel.allowance}
          overagePrice={emailChannel.overagePriceGbp}
        />
      ) : null}

      <div className="mb-8 flex border-b border-black/10">
        {(["behaviour", "routing", "technical"] as DetailTab[]).map((item) => (
          <button
            type="button"
            key={item}
            onClick={() => onTabChange(item)}
            className={`border-b-2 px-4 py-3 text-sm font-black capitalize transition ${
              tab === item
                ? "border-[#111716] text-[#111716]"
                : "border-transparent text-[#7a8582] hover:text-[#111716]"
            }`}
          >
            {item}
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
      ) : (
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
      )}
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
          A pooled address summaries fall back to — used by any contact set to “send to
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
  if (!iso) return "—";
  return new Date(iso).toLocaleString("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
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
                  <div>
                    <span className="block font-black">{log.caller}</span>
                    <span className="mt-1 block text-xs text-[#66716e]">{formatWhen(log.startedAt)}</span>
                  </div>
                  <MobileField label="Summary">
                    <span className="text-sm text-[#66716e]">{log.summary || "—"}</span>
                  </MobileField>
                  <div className="grid grid-cols-2 gap-3">
                    <MobileField label="Outcome">
                      <span className="text-sm text-[#66716e]">{log.outcome || "—"}</span>
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
                  <span>
                    <span className="block font-black">{log.caller}</span>
                    <span className="mt-1 block text-xs text-[#66716e]">{formatWhen(log.startedAt)}</span>
                  </span>
                  <span className="truncate text-sm text-[#66716e]">{log.summary || "—"}</span>
                  <span className="text-sm text-[#66716e]">{log.outcome || "—"}</span>
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
              <p className="text-sm">{log.outcome}</p>
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

// Transcripts are stored line-by-line as "assistant: …" / "user: …". Parse into
// turns so we can colour each speaker. Lines without a known prefix are folded
// into the previous turn.
function parseTranscript(raw: string): TranscriptTurn[] {
  const turns: TranscriptTurn[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const text = line.trim();
    if (!text) continue;
    const match = text.match(/^(assistant|agent|ai|bot|user|caller|customer|human)\s*:\s*(.*)$/i);
    if (match) {
      const role = match[1].toLowerCase();
      const speaker = ["user", "caller", "customer", "human"].includes(role)
        ? "caller"
        : "agent";
      turns.push({ speaker, text: match[2] });
    } else if (turns.length > 0) {
      turns[turns.length - 1].text += ` ${text}`;
    } else {
      turns.push({ speaker: "agent", text });
    }
  }
  return turns;
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

function EmailChannelCard({
  address,
  used,
  allowance,
  overage,
}: {
  address: string;
  used: number;
  allowance: number;
  overage: number;
}) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard?.writeText(address).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      },
      () => {},
    );
  }
  return (
    <div className="mb-8 rounded-[14px] border border-black/10 bg-white px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-2 font-black text-[#111716]">
            <Mail className="h-4 w-4 text-[#148b8e]" />
            Email channel
          </p>
          <p className="mt-1 max-w-xl text-sm text-[#66716e]">
            Forward your business inbox to the address below and the agent will reply to emails just
            like it answers calls — using the same knowledge, and logging every contact.
          </p>
          <p className="mt-2 text-xs font-semibold text-[#148b8e]">
            {used}/{allowance} AI replies this period
            {overage > 0 ? ` · ${overage} overage` : ""}
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="flex-1 truncate rounded-lg border border-black/10 bg-[#f8fafa] px-3 py-2 text-sm font-semibold text-[#111716]">
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
      <p className="mt-2 text-xs text-[#9aa5a2]">
        Set up a forwarding rule in your email provider (Gmail, Outlook, etc.) to this address.
      </p>
    </div>
  );
}

function EmailChannelUpsell({
  monthlyPrice,
  allowance,
  overagePrice,
}: {
  monthlyPrice: number;
  allowance: number;
  overagePrice: number;
}) {
  return (
    <div className="mb-8 rounded-[14px] border border-dashed border-[#148b8e]/40 bg-[#f3fbfb] px-5 py-4">
      <p className="flex items-center gap-2 font-black text-[#111716]">
        <Mail className="h-4 w-4 text-[#148b8e]" />
        Email channel
      </p>
      <p className="mt-1 max-w-xl text-sm text-[#66716e]">
        Add AI email replies — forward support@ and the same agent handles email alongside phone
        calls. £{monthlyPrice}/mo includes {allowance} replies, then £{overagePrice.toFixed(2)} each.
      </p>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <EmailChannelCheckoutButton />
        <a href="/billing" className="text-sm font-bold text-[#148b8e] underline">
          View on billing
        </a>
      </div>
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
  const dot = live ? "bg-[#16a66a]" : pending ? "bg-[#d9920a]" : "bg-[#9aa4a1]";
  const heading = live
    ? routing.number
    : pending
      ? "Number requested — setting up"
      : "No phone number assigned yet";
  const sub = live
    ? "Live and answering calls"
    : pending
      ? "We're provisioning the line for this agent."
      : "Assign a number to put this agent on a phone line.";

  return (
    <div className="mb-8 rounded-[14px] border border-black/10 bg-[#fbfcfc] px-5 py-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
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
            Keep it short and natural — one or two sentences works best on the phone.
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
  autoFocus = false,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  autoFocus?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-2 block text-sm font-black">{label}</span>
      <input
        value={value}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        className="h-12 w-full rounded-lg border border-black/15 bg-white px-4 text-sm outline-none transition focus:border-[#111716]"
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

function StatCell({ label, value }: { label: string; value: number }) {
  return (
    <div className="border-t border-black/10 p-6 sm:border-l sm:border-t-0">
      <p className="text-sm font-bold text-[#7a8582]">{label}</p>
      <p className="mt-2 text-3xl font-black">{value}</p>
    </div>
  );
}
