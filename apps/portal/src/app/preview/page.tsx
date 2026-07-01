// Staging-only design preview: rich demo data so the redesign can be reviewed
// without Supabase credentials. Not linked from production nav — visit /preview
// directly on a preview deployment or locally.
import { CustomerAgentWorkspace } from "@/components/customer-agent-workspace";
import type { CallLog } from "@/lib/agents";
import type { Contact } from "@/lib/contacts";
import type { DashboardInsights } from "@/lib/insights";

const now = Date.now();
const iso = (minsAgo: number) => new Date(now - minsAgo * 60000).toISOString();

const callLogs: CallLog[] = [
  {
    id: "c1",
    profileId: "sophie-dental",
    agentName: "Sophie",
    caller: "+44 7911 123456",
    summary: "Severe toothache since last night, needs an emergency appointment today.",
    outcome: "transfer",
    startedAt: iso(24),
    durationLabel: "3m 12s",
    transcript:
      "assistant: Hello, thanks for calling RinseDental, you're through to Sophie. How can I help you today?\nuser: Hi, I've had a really bad toothache since last night, it's getting worse.\nassistant: I'm sorry to hear that. That sounds painful. Can I take your name and the best number to reach you on?\nuser: It's Dan Peters, this number is fine.\nassistant: Thank you Dan. Because this sounds urgent I'm going to put you through to our on-call dentist now.",
    channel: "phone",
  },
  {
    id: "c2",
    profileId: "sophie-dental",
    agentName: "Sophie",
    caller: "Hannah Miles",
    summary: "New patient wants a check-up and hygiene appointment next week.",
    outcome: "completed",
    startedAt: iso(95),
    durationLabel: "2m 40s",
    transcript:
      "assistant: Hello, thanks for calling RinseDental. How can I help?\nuser: Hi, I'd like to register as a new patient and book a check-up.\nassistant: Lovely, we're taking on new patients. Would next Tuesday at 10am or Thursday at 2:30pm suit you?\nuser: Thursday works.\nassistant: Perfect, you're booked for Thursday at 2:30pm.",
    channel: "phone",
  },
  {
    id: "c3",
    profileId: "sophie-dental",
    agentName: "Sophie",
    caller: "+44 7700 900123",
    summary: "Asked whether the practice offers Invisalign and rough pricing.",
    outcome: "sms replied",
    startedAt: iso(300),
    durationLabel: "-",
    transcript:
      "Customer (SMS): Do you do Invisalign? How much is it roughly?\nYes, we offer Invisalign. Treatment starts from £1,800 depending on your case. Would you like to book a free consultation?",
    channel: "sms",
  },
  {
    id: "c4",
    profileId: "maya-property",
    agentName: "Maya",
    caller: "tenant@flat12.co.uk",
    summary: "Tenant reporting a boiler fault, no hot water since Monday.",
    outcome: "email replied",
    startedAt: iso(1400),
    durationLabel: "-",
    transcript:
      "--- Their message ---\nHi, our boiler stopped working on Monday and we have no hot water. Flat 12, Marley House. Can someone come out?\n--- WiseCall reply ---\nThanks for letting us know, and sorry about the boiler. I've logged this as urgent for Flat 12, Marley House, and our maintenance team will contact you today to arrange access.",
    channel: "email",
  },
  {
    id: "c5",
    profileId: "sophie-dental",
    agentName: "Sophie",
    caller: "+44 7802 555341",
    summary: "Complaint about being charged twice for a hygiene appointment.",
    outcome: "caller_stop",
    startedAt: iso(2900),
    durationLabel: "4m 05s",
    transcript:
      "assistant: Hello, thanks for calling RinseDental.\nuser: I've been charged twice for my hygiene appointment last week and I'm not happy about it.\nassistant: I'm really sorry about that. I've noted the details and flagged this to our practice manager as a priority — you'll get a call back today with the refund arranged.",
    channel: "phone",
  },
  {
    id: "c6",
    profileId: "maya-property",
    agentName: "Maya",
    caller: "James O'Connor",
    summary: "Landlord asking about a free valuation for a 3-bed semi in Headingley.",
    outcome: "whatsapp replied",
    startedAt: iso(4300),
    durationLabel: "-",
    transcript:
      "Customer (WhatsApp): Hi, I'm thinking of letting out my 3-bed in Headingley. Do you do free valuations?\nWe do — valuations are free and take about 30 minutes. Shall I book one for this week? We have Wednesday 3pm or Friday 11am available.",
    channel: "whatsapp",
  },
];

const contacts: Contact[] = [
  {
    id: "p1",
    profileId: "sophie-dental",
    agentName: "Sophie",
    phone: "+44 7911 123456",
    email: "",
    name: "Dan Peters",
    company: "",
    callbackPhone: "",
    firstSeen: iso(60 * 24 * 20),
    lastSeen: iso(24),
    callCount: 3,
    emailCount: 0,
    aiSummary: "Existing patient. Called with severe toothache, transferred to on-call dentist.",
    notes: "",
  },
  {
    id: "p2",
    profileId: "maya-property",
    agentName: "Maya",
    phone: "",
    email: "tenant@flat12.co.uk",
    name: "Flat 12 – Marley House",
    company: "",
    callbackPhone: "",
    firstSeen: iso(60 * 24 * 90),
    lastSeen: iso(1400),
    callCount: 1,
    emailCount: 4,
    aiSummary: "Tenant at Marley House. Recent boiler fault logged as urgent maintenance.",
    notes: "",
  },
];

const insights: DashboardInsights = {
  range: "7d",
  generatedAt: new Date().toISOString(),
  hasAnyCalls: true,
  totalCalls: 42,
  analysedCalls: 40,
  pendingAnalysis: 0,
  missedOrEscalated: 3,
  sentiment: { positive: 28, neutral: 9, negative: 3 },
  urgentCount: 4,
  complaintCount: 1,
  leadCount: 7,
  bookingCount: 12,
  conversionRate: 45,
  topReasons: [
    { label: "Book an appointment", count: 16 },
    { label: "Emergency / urgent issue", count: 6 },
    { label: "Pricing questions", count: 5 },
    { label: "Opening hours", count: 4 },
    { label: "Reschedule or cancel", count: 3 },
  ],
  unansweredQuestions: [
    { callId: "c3", caller: "+44 7700 900123", detail: "Do you offer 0% finance on Invisalign?", startedAt: iso(300) },
  ],
  opportunities: [
    { callId: "c6", caller: "James O'Connor", detail: "Landlord wants a free valuation for a 3-bed semi in Headingley.", startedAt: iso(4300) },
    { callId: "c2", caller: "Hannah Miles", detail: "New patient registered — offer the new patient plan.", startedAt: iso(95) },
  ],
  attention: [
    { callId: "c5", caller: "+44 7802 555341", kind: "complaint", detail: "Charged twice for a hygiene appointment, expects a refund call today.", startedAt: iso(2900) },
    { callId: "c1", caller: "+44 7911 123456", kind: "urgent", detail: "Severe toothache, transferred to on-call dentist.", startedAt: iso(24) },
    { callId: "c3", caller: "+44 7700 900123", kind: "unanswered", detail: "Asked about 0% finance on Invisalign — not in the knowledge base.", startedAt: iso(300) },
  ],
  summary:
    "A busy week: 42 conversations across phone, WhatsApp, SMS and email, with 12 bookings won and 7 new leads. Emergency appointments were the biggest urgent theme, and one billing complaint needs a call back today.",
};

export default function PreviewPage() {
  return (
    <CustomerAgentWorkspace
      callLogs={callLogs}
      contacts={contacts}
      userEmail="demo@rinsedental.co.uk"
      planName="Growth"
      initialInsights={insights}
      analysisEnabled
      trial={{ used: 7, cap: 20, blocked: false }}
    />
  );
}
