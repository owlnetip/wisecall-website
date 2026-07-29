/**
 * Digital Negotiator — trainable rules, qualification, and weekend digest helpers.
 * Rules live on profile metadata.negotiator_rules; enquiries in wisecall_enquiries.
 */

export type EnquiryPartyRole = "buyer" | "tenant" | "vendor" | "landlord" | "other";

export type EnquiryStatus =
  | "new"
  | "qualifying"
  | "qualified"
  | "viewing_requested"
  | "confirmed"
  | "handed_to_negotiator"
  | "closed_lost"
  | "closed_won";

export type EnquirySource =
  | "phone"
  | "whatsapp"
  | "sms"
  | "email"
  | "web"
  | "manual"
  | "analysis";

export type EnquiryRow = {
  id: string;
  profile_id: string;
  contact_id: string | null;
  property_id: string | null;
  viewing_id: string | null;
  call_log_id: string | null;
  party_role: EnquiryPartyRole;
  status: EnquiryStatus;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  budget_min: number | null;
  budget_max: number | null;
  budget_text: string | null;
  areas: string[];
  beds_min: number | null;
  property_types: string[];
  move_timeline: string | null;
  financing: string | null;
  has_property_to_sell: boolean | null;
  chain_position: string | null;
  listing_interest: string | null;
  listing_ref: string | null;
  summary: string | null;
  needs_human: boolean;
  human_reason: string | null;
  source: EnquirySource;
  created_at: string;
  updated_at: string;
};

/** Agency-trainable behaviour (Greenhouse-style Trigger → Goal → System). */
export type NegotiatorRules = {
  tone: string;
  brandNotes: string;
  qualificationRequired: boolean;
  requiredFields: string[];
  bookViewingWhenQualified: boolean;
  escalateKeywords: string[];
  neverSay: string[];
  alwaysAskVendorOpportunity: boolean;
  outOfHoursMode: "full" | "qualify_only" | "message_only";
  handoffMessage: string;
};

export const DEFAULT_NEGOTIATOR_RULES: NegotiatorRules = {
  tone: "Warm, professional, and efficient — like a senior branch negotiator, not a chatbot.",
  brandNotes: "",
  qualificationRequired: true,
  requiredFields: ["name", "phone", "budget", "area", "beds", "timeline"],
  bookViewingWhenQualified: true,
  escalateKeywords: [
    "offer",
    "solicitor",
    "gazump",
    "complaint",
    "legal",
    "price negotiation",
    "counter offer",
  ],
  neverSay: [
    "guaranteed sale",
    "definitely get that price",
    "we can beat any offer",
    "ignore the EPC",
  ],
  alwaysAskVendorOpportunity: true,
  outOfHoursMode: "full",
  handoffMessage:
    "I'll make sure a negotiator picks this up first thing — you'll get a call or text from the branch.",
};

const REQUIRED_FIELD_OPTIONS = [
  "name",
  "phone",
  "budget",
  "area",
  "beds",
  "timeline",
  "financing",
  "chain",
] as const;

export function defaultNegotiatorRules(): NegotiatorRules {
  return { ...DEFAULT_NEGOTIATOR_RULES, requiredFields: [...DEFAULT_NEGOTIATOR_RULES.requiredFields] };
}

function strList(value: unknown, max = 20): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === "string")
    .map((v) => v.trim())
    .filter(Boolean)
    .slice(0, max);
}

export function normaliseNegotiatorRules(raw: unknown): NegotiatorRules {
  const base = defaultNegotiatorRules();
  if (!raw || typeof raw !== "object") return base;
  const r = raw as Record<string, unknown>;

  const requiredFields = strList(r.requiredFields, 12).filter((f) =>
    (REQUIRED_FIELD_OPTIONS as readonly string[]).includes(f),
  );

  const outOfHours =
    r.outOfHoursMode === "qualify_only" ||
    r.outOfHoursMode === "message_only" ||
    r.outOfHoursMode === "full"
      ? r.outOfHoursMode
      : base.outOfHoursMode;

  return {
    tone: typeof r.tone === "string" && r.tone.trim() ? r.tone.trim().slice(0, 500) : base.tone,
    brandNotes:
      typeof r.brandNotes === "string" ? r.brandNotes.trim().slice(0, 1000) : base.brandNotes,
    qualificationRequired: r.qualificationRequired !== false,
    requiredFields: requiredFields.length ? requiredFields : base.requiredFields,
    bookViewingWhenQualified: r.bookViewingWhenQualified !== false,
    escalateKeywords: strList(r.escalateKeywords, 30),
    neverSay: strList(r.neverSay, 30),
    alwaysAskVendorOpportunity: r.alwaysAskVendorOpportunity !== false,
    outOfHoursMode: outOfHours,
    handoffMessage:
      typeof r.handoffMessage === "string" && r.handoffMessage.trim()
        ? r.handoffMessage.trim().slice(0, 400)
        : base.handoffMessage,
  };
}

/** Prompt block injected at runtime and into the estate template. */
export function formatNegotiatorRulesForPrompt(rules: NegotiatorRules): string {
  const lines = [
    "[DIGITAL NEGOTIATOR RULES — follow these exactly]",
    `Tone: ${rules.tone}`,
  ];
  if (rules.brandNotes.trim()) {
    lines.push(`Brand notes: ${rules.brandNotes.trim()}`);
  }
  lines.push(
    rules.qualificationRequired
      ? `Qualification: required before booking. Capture: ${rules.requiredFields.join(", ")}.`
      : "Qualification: optional — book when the caller is ready.",
  );
  lines.push(
    rules.bookViewingWhenQualified
      ? "When qualified for a viewing, call request_viewing (do not invent owner numbers)."
      : "Do not book viewings automatically — capture details and hand to the branch.",
  );
  if (rules.alwaysAskVendorOpportunity) {
    lines.push(
      "Vendor opportunity: if the caller is a buyer/tenant, briefly ask whether they also have a property to sell or let (valuation lead).",
    );
  }
  lines.push(`Out-of-hours mode: ${rules.outOfHoursMode}.`);
  if (rules.escalateKeywords.length) {
    lines.push(
      `Escalate / hand to human negotiator (do not price-negotiate) when the caller mentions: ${rules.escalateKeywords.join(", ")}.`,
    );
  }
  if (rules.neverSay.length) {
    lines.push(`Never say: ${rules.neverSay.map((s) => `"${s}"`).join("; ")}.`);
  }
  lines.push(`Handoff line: ${rules.handoffMessage}`);
  lines.push(
    "After capturing qualification, call the log_enquiry tool so the branch sees it in Monday's results.",
  );
  return lines.join("\n");
}

export function enquiryStatusLabel(status: EnquiryStatus | string): string {
  switch (status) {
    case "new":
      return "New";
    case "qualifying":
      return "Qualifying";
    case "qualified":
      return "Qualified";
    case "viewing_requested":
      return "Viewing requested";
    case "confirmed":
      return "Viewing confirmed";
    case "handed_to_negotiator":
      return "With negotiator";
    case "closed_lost":
      return "Closed";
    case "closed_won":
      return "Won";
    default:
      return status;
  }
}

export function partyRoleLabel(role: EnquiryPartyRole | string): string {
  switch (role) {
    case "buyer":
      return "Buyer";
    case "tenant":
      return "Tenant";
    case "vendor":
      return "Vendor";
    case "landlord":
      return "Landlord";
    default:
      return "Other";
  }
}

/** Friday 18:00 local → Monday 09:00 local (Europe/London default for UK agencies). */
export function weekendDigestWindow(
  now = new Date(),
  timeZone = "Europe/London",
): { from: Date; to: Date; label: string } {
  // Work in London calendar days via formatter
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value]),
  ) as Record<string, string>;
  const y = Number(parts.year);
  const m = Number(parts.month);
  const d = Number(parts.day);

  // Approximate: build a UTC date for "today" noon London and walk back to Friday
  const utcGuess = new Date(Date.UTC(y, m - 1, d, 12, 0, 0));
  const weekday = utcGuess.getUTCDay(); // 0 Sun … 6 Sat — close enough with noon anchor
  // Days since Friday (5)
  const daysSinceFriday = (weekday + 7 - 5) % 7;
  const friday = new Date(utcGuess);
  friday.setUTCDate(friday.getUTCDate() - daysSinceFriday);

  // Friday 18:00 London ≈ Friday 17:00 UTC (BST) or 18:00 UTC (GMT) — use 17:00 UTC as mid
  // Prefer explicit offset via temporal-less approach: store as ISO from constructed local.
  const from = londonWallTimeToUtc(
    friday.getUTCFullYear(),
    friday.getUTCMonth() + 1,
    friday.getUTCDate(),
    18,
    0,
    timeZone,
  );
  const monday = new Date(friday);
  monday.setUTCDate(monday.getUTCDate() + 3);
  const to = londonWallTimeToUtc(
    monday.getUTCFullYear(),
    monday.getUTCMonth() + 1,
    monday.getUTCDate(),
    9,
    0,
    timeZone,
  );

  // If "now" is before this weekend's Friday 18:00, show previous weekend
  if (now.getTime() < from.getTime()) {
    const prevFriday = new Date(friday);
    prevFriday.setUTCDate(prevFriday.getUTCDate() - 7);
    const prevMonday = new Date(prevFriday);
    prevMonday.setUTCDate(prevMonday.getUTCDate() + 3);
    return {
      from: londonWallTimeToUtc(
        prevFriday.getUTCFullYear(),
        prevFriday.getUTCMonth() + 1,
        prevFriday.getUTCDate(),
        18,
        0,
        timeZone,
      ),
      to: londonWallTimeToUtc(
        prevMonday.getUTCFullYear(),
        prevMonday.getUTCMonth() + 1,
        prevMonday.getUTCDate(),
        9,
        0,
        timeZone,
      ),
      label: "Last weekend",
    };
  }

  return { from, to, label: "This weekend" };
}

/** Convert a wall-clock time in `timeZone` to a UTC Date (best-effort without libs). */
function londonWallTimeToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): Date {
  // Binary search UTC instant whose zoned parts match
  let lo = Date.UTC(year, month - 1, day - 1, 0, 0, 0);
  let hi = Date.UTC(year, month - 1, day + 1, 23, 59, 59);
  const target = `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}`;
  for (let i = 0; i < 40; i++) {
    const mid = Math.floor((lo + hi) / 2);
    const zoned = formatZoned(new Date(mid), timeZone);
    if (zoned < target) lo = mid + 1;
    else hi = mid;
  }
  return new Date(lo);
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function formatZoned(d: Date, timeZone: string): string {
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = Object.fromEntries(fmt.formatToParts(d).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

export type NegotiatorDigest = {
  viewersBooked: number;
  pendingOwner: number;
  valuations: number;
  qualifiedBuyers: number;
  needsHuman: number;
  enquiries: EnquiryRow[];
  windowFrom: string;
  windowTo: string;
  label: string;
};

export function buildDigestCounts(input: {
  viewings: { status: string; created_at: string }[];
  enquiries: EnquiryRow[];
  from: Date;
  to: Date;
  label: string;
}): NegotiatorDigest {
  const { from, to, label } = input;
  const inWindow = (iso: string) => {
    const t = new Date(iso).getTime();
    return t >= from.getTime() && t <= to.getTime();
  };

  const viewings = input.viewings.filter((v) => inWindow(v.created_at));
  const enquiries = input.enquiries.filter((e) => inWindow(e.created_at));

  return {
    viewersBooked: viewings.filter((v) => v.status === "confirmed").length,
    pendingOwner: viewings.filter((v) => v.status === "pending_owner" || v.status === "requested")
      .length,
    valuations: enquiries.filter(
      (e) => e.party_role === "vendor" || e.party_role === "landlord",
    ).length,
    qualifiedBuyers: enquiries.filter(
      (e) =>
        (e.party_role === "buyer" || e.party_role === "tenant") &&
        (e.status === "qualified" ||
          e.status === "viewing_requested" ||
          e.status === "confirmed"),
    ).length,
    needsHuman: enquiries.filter((e) => e.needs_human).length,
    enquiries,
    windowFrom: from.toISOString(),
    windowTo: to.toISOString(),
    label,
  };
}
