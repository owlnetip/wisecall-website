"use client";

import { useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpen,
  Bot,
  Check,
  ChevronRight,
  CirclePlus,
  CreditCard,
  Grid2X2,
  History,
  KeyRound,
  Library,
  Mail,
  MessageSquareText,
  MoreHorizontal,
  Phone,
  Plus,
  Save,
  Search,
  Settings2,
  Sparkles,
  UserRound,
  UsersRound,
  X,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

type View = "home" | "assistants" | "detail";
type DetailTab = "behaviour" | "technical";

type Assistant = {
  id: string;
  name: string;
  businessName: string;
  industry: string;
  phoneNumber: string;
  status: "Live" | "Setup" | "Review";
  receptionistName: string;
  prompt: string;
  website: string;
  timezone: string;
  fallbackEmail: string;
  transferNumber: string;
  calls: number;
  cost: string;
};

const initialAssistants: Assistant[] = [
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
    website: "https://rinsedental.example",
    timezone: "Europe/London",
    fallbackEmail: "reception@rinsedental.example",
    transferNumber: "+44 113 522 1606",
    calls: 14,
    cost: "GBP 0.21",
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
    website: "https://thehomecloud.example",
    timezone: "Europe/London",
    fallbackEmail: "hello@thehomecloud.example",
    transferNumber: "+44 113 522 1666",
    calls: 11,
    cost: "GBP 0.18",
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
    website: "https://northlinelegal.example",
    timezone: "Europe/London",
    fallbackEmail: "intake@northlinelegal.example",
    transferNumber: "+44 113 522 2277",
    calls: 0,
    cost: "GBP 0.00",
  },
];

const navSections = [
  {
    title: "",
    items: [{ view: "home" as const, label: "Home", icon: Grid2X2 }],
  },
  {
    title: "Contents",
    items: [
      { view: "assistants" as const, label: "Assistants", icon: Bot },
      { view: "assistants" as const, label: "Knowledge Base", icon: Library },
      { view: "assistants" as const, label: "Phone Numbers", icon: Phone },
      { view: "home" as const, label: "Call History", icon: History },
    ],
  },
  {
    title: "Admin",
    items: [
      { view: "home" as const, label: "Payments", icon: CreditCard },
      { view: "home" as const, label: "API Keys", icon: KeyRound },
      { view: "home" as const, label: "Users", icon: UsersRound },
    ],
  },
];

const abilityRows = [
  {
    icon: MessageSquareText,
    title: "Answer Questions",
    body: "Answer FAQs from the knowledge base.",
    enabled: true,
  },
  {
    icon: Phone,
    title: "Transfer Calls",
    body: "Forward calls to your team or phone numbers.",
    enabled: true,
  },
  {
    icon: Mail,
    title: "Send Email",
    body: "Send call summaries and follow-up details.",
    enabled: false,
  },
  {
    icon: Sparkles,
    title: "Custom Prompt / Instructions",
    body: "Control behaviour, tone and edge cases.",
    enabled: true,
    prompt: true,
  },
  {
    icon: MessageSquareText,
    title: "Send SMS",
    body: "Text callers with confirmations or links.",
    enabled: false,
  },
  {
    icon: BookOpen,
    title: "Book Appointments",
    body: "Connect a booking flow for callers.",
    enabled: false,
  },
  {
    icon: Settings2,
    title: "Webhooks",
    body: "Send events into CRM and automation tools.",
    enabled: false,
  },
];

export function CustomerAgentWorkspace() {
  const [assistants, setAssistants] = useState(initialAssistants);
  const [selectedId, setSelectedId] = useState(initialAssistants[0].id);
  const [view, setView] = useState<View>("assistants");
  const [detailTab, setDetailTab] = useState<DetailTab>("behaviour");
  const [searchTerm, setSearchTerm] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [promptOpen, setPromptOpen] = useState(false);
  const [newAssistantName, setNewAssistantName] = useState("");
  const [saved, setSaved] = useState(false);

  const selectedAssistant =
    assistants.find((assistant) => assistant.id === selectedId) ?? assistants[0];

  const filteredAssistants = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    if (!query) {
      return assistants;
    }

    return assistants.filter((assistant) =>
      [
        assistant.name,
        assistant.businessName,
        assistant.industry,
        assistant.phoneNumber,
      ]
        .join(" ")
        .toLowerCase()
        .includes(query),
    );
  }, [assistants, searchTerm]);

  const totalCalls = assistants.reduce((total, assistant) => total + assistant.calls, 0);

  function updateSelected(patch: Partial<Assistant>) {
    setAssistants((currentAssistants) =>
      currentAssistants.map((assistant) =>
        assistant.id === selectedAssistant.id ? { ...assistant, ...patch } : assistant,
      ),
    );
  }

  function createAssistant() {
    const cleanName = newAssistantName.trim() || "New Assistant";
    const id = `${cleanName.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${Date.now()}`;
    const assistant: Assistant = {
      id,
      name: cleanName,
      businessName: "New business",
      industry: "General",
      phoneNumber: "Number pending",
      status: "Setup",
      receptionistName: cleanName,
      prompt:
        "Answer calls clearly, capture the caller's details and route anything urgent to the team.",
      website: "",
      timezone: "Europe/London",
      fallbackEmail: "",
      transferNumber: "",
      calls: 0,
      cost: "GBP 0.00",
    };

    setAssistants((currentAssistants) => [assistant, ...currentAssistants]);
    setSelectedId(id);
    setView("detail");
    setDetailTab("behaviour");
    setCreateOpen(false);
    setNewAssistantName("");
  }

  function save() {
    setSaved(true);
    window.setTimeout(() => setSaved(false), 1600);
  }

  return (
    <div className="min-h-screen bg-[#e9efed] px-0 py-0 text-[#111716] lg:px-6 lg:py-6">
      <div className="mx-auto flex min-h-screen max-w-[1540px] overflow-hidden bg-white shadow-[0_24px_90px_rgba(17,23,22,0.14)] lg:min-h-[calc(100vh-48px)] lg:rounded-[22px] lg:border lg:border-black/10">
        <aside className="hidden w-[280px] flex-shrink-0 flex-col border-r border-black/10 bg-[#f7f8f7] md:flex">
          <div className="flex h-[72px] items-center px-8">
            <span className="text-2xl font-black tracking-normal">
              Wise<span className="text-[#148b8e]">Call</span>
            </span>
          </div>
          <nav className="flex-1 space-y-8 px-5 py-6">
            {navSections.map((section) => (
              <div key={section.title || "home"} className="space-y-2">
                {section.title && (
                  <p className="px-4 text-sm font-semibold text-[#7a8582]">{section.title}</p>
                )}
                {section.items.map((item) => (
                  <button
                    type="button"
                    key={`${section.title}-${item.label}`}
                    onClick={() => {
                      setView(item.view);
                      if (item.label === "Assistants") {
                        setView("assistants");
                      }
                    }}
                    className={`flex w-full items-center gap-3 rounded-lg px-4 py-3 text-left text-sm font-bold transition ${
                      (item.label === "Assistants" && view !== "home") ||
                      (item.label === "Home" && view === "home")
                        ? "bg-[#eaeeee] text-[#111716]"
                        : "text-[#5e6966] hover:bg-[#eef2f1] hover:text-[#111716]"
                    }`}
                  >
                    <item.icon className="h-5 w-5" />
                    {item.label}
                  </button>
                ))}
              </div>
            ))}
          </nav>
          <div className="m-5 rounded-[18px] border border-black/10 bg-white p-5 text-center">
            <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-[#ddfbfc] text-[#148b8e]">
              <UserRound className="h-6 w-6" />
            </div>
            <p className="text-sm font-bold">Need setup help?</p>
            <button
              type="button"
              className="mt-3 rounded-lg border border-black/10 px-4 py-2 text-sm font-bold text-[#148b8e] transition hover:bg-[#f7f8f7]"
            >
              Book support
            </button>
          </div>
        </aside>

        <main className="min-w-0 flex-1 bg-white">
          <header className="flex h-[72px] items-center justify-between border-b border-black/10 px-5 lg:px-8">
            <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[#7a8582]">
              <span>Home</span>
              {view !== "home" && (
                <>
                  <ChevronRight className="h-4 w-4" />
                  <span>Assistants</span>
                </>
              )}
              {view === "detail" && (
                <>
                  <ChevronRight className="h-4 w-4" />
                  <span className="truncate">{selectedAssistant.name}</span>
                </>
              )}
            </div>
            <div className="flex h-9 w-9 items-center justify-center rounded-full border border-black/10 text-sm font-black">
              LT
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

            {view === "assistants" && (
              <AssistantsList
                assistants={filteredAssistants}
                searchTerm={searchTerm}
                onSearch={setSearchTerm}
                onCreate={() => setCreateOpen(true)}
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
                onBack={() => setView("assistants")}
                onTabChange={setDetailTab}
                onChange={updateSelected}
                onPrompt={() => setPromptOpen(true)}
                onSave={save}
              />
            )}
          </div>
        </main>
      </div>

      {createOpen && (
        <CreateAssistantModal
          value={newAssistantName}
          onChange={setNewAssistantName}
          onClose={() => setCreateOpen(false)}
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

      <div className="grid gap-5 xl:grid-cols-[1.8fr_1fr]">
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

        <section className="rounded-[18px] border border-black/10 bg-white p-6">
          <h2 className="text-2xl font-black">Credit</h2>
          <p className="mt-1 text-[#7a8582]">Available balance</p>
          <div className="mx-auto mt-10 flex h-44 w-44 items-center justify-center rounded-full border-[14px] border-[#e3e8e6] border-t-[#41c9ce]">
            <div className="text-center">
              <p className="text-3xl font-black">GBP 99</p>
              <p className="mt-1 text-sm text-[#7a8582]">available</p>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

function AssistantsList({
  assistants,
  searchTerm,
  onSearch,
  onCreate,
  onOpen,
}: {
  assistants: Assistant[];
  searchTerm: string;
  onSearch: (value: string) => void;
  onCreate: () => void;
  onOpen: (assistantId: string) => void;
}) {
  return (
    <div>
      <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-4xl font-black">Assistants</h1>
          <p className="mt-2 text-[#66716e]">Create and manage the agents on your account.</p>
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
        <div className="grid grid-cols-[1fr_210px_130px_70px] border-b border-black/10 bg-[#fbfcfc] px-5 py-4 text-sm font-bold text-[#66716e] max-md:hidden">
          <span>Name</span>
          <span>Phone Number</span>
          <span>Status</span>
          <span />
        </div>
        {assistants.length > 0 ? (
          <div className="divide-y divide-black/10">
            {assistants.map((assistant) => (
              <button
                type="button"
                key={assistant.id}
                onClick={() => onOpen(assistant.id)}
                className="grid w-full gap-4 px-5 py-5 text-left transition hover:bg-[#f7f8f7] md:grid-cols-[1fr_210px_130px_70px]"
              >
                <span>
                  <span className="block font-black">{assistant.name}</span>
                  <span className="mt-1 block text-sm text-[#66716e]">
                    {assistant.businessName} - {assistant.industry}
                  </span>
                </span>
                <span className="font-mono text-sm text-[#66716e]">{assistant.phoneNumber}</span>
                <span>
                  <StatusPill status={assistant.status} />
                </span>
                <span className="flex items-center justify-end">
                  <ChevronRight className="h-5 w-5 text-[#7a8582]" />
                </span>
              </button>
            ))}
          </div>
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
  onBack,
  onTabChange,
  onChange,
  onPrompt,
  onSave,
}: {
  assistant: Assistant;
  tab: DetailTab;
  saved: boolean;
  onBack: () => void;
  onTabChange: (tab: DetailTab) => void;
  onChange: (patch: Partial<Assistant>) => void;
  onPrompt: () => void;
  onSave: () => void;
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
          <h1 className="text-4xl font-black">Edit &apos;{assistant.name}&apos;</h1>
        </div>
        <button
          type="button"
          className="flex h-10 w-10 items-center justify-center rounded-lg transition hover:bg-[#f2f4f3]"
          aria-label="More actions"
        >
          <MoreHorizontal className="h-5 w-5" />
        </button>
      </div>

      <div className="mb-8 flex border-b border-black/10">
        {(["behaviour", "technical"] as DetailTab[]).map((item) => (
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
          <button
            type="button"
            className="flex w-full items-center justify-between rounded-[14px] border border-black/10 bg-white px-5 py-4 text-left transition hover:bg-[#f7f8f7]"
          >
            <span className="flex items-center gap-3">
              <Bot className="h-5 w-5 text-[#148b8e]" />
              <span className="font-black">Essentials</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="rounded-full border border-black/10 px-3 py-1 text-sm font-bold">
                {assistant.name}
              </span>
              <ChevronRight className="h-5 w-5 text-[#7a8582]" />
            </span>
          </button>

          <div className="pt-2">
            <p className="mb-3 px-1 text-sm font-bold text-[#7a8582]">Abilities</p>
            <div className="space-y-3">
              {abilityRows.slice(0, 3).map((row) => (
                <AbilityRow key={row.title} {...row} />
              ))}
            </div>
          </div>

          <div className="pt-4">
            <p className="mb-3 px-1 text-sm font-bold text-[#7a8582]">Advanced Abilities</p>
            <div className="space-y-3">
              {abilityRows.slice(3).map((row) => (
                <AbilityRow
                  key={row.title}
                  {...row}
                  onClick={row.prompt ? onPrompt : undefined}
                />
              ))}
            </div>
          </div>
        </div>
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
              className="inline-flex items-center gap-2 rounded-lg bg-[#111716] px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130]"
            >
              {saved ? <Check className="h-4 w-4" /> : <Save className="h-4 w-4" />}
              {saved ? "Saved" : "Save changes"}
            </button>
          </div>
        </div>
      )}
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
  value,
  onChange,
  onClose,
  onCreate,
}: {
  value: string;
  onChange: (value: string) => void;
  onClose: () => void;
  onCreate: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4">
      <div className="w-full max-w-xl rounded-[18px] bg-white p-7 shadow-2xl">
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
        <Field label="Name" value={value} onChange={onChange} autoFocus />
        <div className="mt-6 flex justify-end gap-3">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-[#f2f4f3] px-5 py-3 text-sm font-black transition hover:bg-[#e7ebe9]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onCreate}
            className="rounded-lg bg-[#111716] px-5 py-3 text-sm font-black text-white transition hover:bg-[#263130]"
          >
            Create Assistant
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 px-4">
      <div className="flex h-[78vh] w-full max-w-4xl flex-col overflow-hidden rounded-[18px] bg-white shadow-2xl">
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
