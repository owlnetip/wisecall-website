// Call screening & transfer policies for voice agents.
// Stored on wisecall_profiles.metadata (call_screening + per-contact transferMode).
// The edge runtime injects a prompt block from the same rules (routingPolicy.js).

export type TransferMode =
  | "immediate" // put through straight away when caller asks for this person
  | "confirm_caller" // confirm caller details, then transfer (default)
  | "ask_client" // check with the contact first whether they want the call
  | "message_only"; // never live-transfer; take a message / email summary

export type SalesPolicy =
  | "field" // AI fields the sales pitch politely and gathers info
  | "qualify_and_message" // short qualify, then message the team
  | "transfer" // transfer to a matching sales contact when possible
  | "politely_decline"; // decline cold sales and end politely

export type SpamPolicy =
  | "politely_end" // recognise spam/robocalls and end politely
  | "message_only" // take a brief message only, never transfer
  | "block"; // refuse and end the call quickly

export type NamedPersonPolicy = TransferMode;

export type CallScreening = {
  salesPolicy: SalesPolicy;
  spamPolicy: SpamPolicy;
  /** Default when a caller asks for someone by name and no contact-level mode is set. */
  namedPersonPolicy: NamedPersonPolicy;
};

export const DEFAULT_CALL_SCREENING: CallScreening = {
  salesPolicy: "field",
  spamPolicy: "politely_end",
  namedPersonPolicy: "confirm_caller",
};

const TRANSFER_MODES: TransferMode[] = [
  "immediate",
  "confirm_caller",
  "ask_client",
  "message_only",
];
const SALES_POLICIES: SalesPolicy[] = [
  "field",
  "qualify_and_message",
  "transfer",
  "politely_decline",
];
const SPAM_POLICIES: SpamPolicy[] = ["politely_end", "message_only", "block"];

function oneOf<T extends string>(value: unknown, allowed: T[], fallback: T): T {
  return typeof value === "string" && allowed.includes(value as T)
    ? (value as T)
    : fallback;
}

export function normaliseTransferMode(value: unknown): TransferMode {
  return oneOf(value, TRANSFER_MODES, "confirm_caller");
}

export function readCallScreening(
  metadata: Record<string, unknown> | null | undefined,
): CallScreening {
  const raw = metadata?.call_screening;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CALL_SCREENING };
  const r = raw as Record<string, unknown>;
  return {
    salesPolicy: oneOf(r.salesPolicy ?? r.sales_policy, SALES_POLICIES, "field"),
    spamPolicy: oneOf(r.spamPolicy ?? r.spam_policy, SPAM_POLICIES, "politely_end"),
    namedPersonPolicy: oneOf(
      r.namedPersonPolicy ?? r.named_person_policy,
      TRANSFER_MODES,
      "confirm_caller",
    ),
  };
}

export type RoutingContactForPolicy = {
  name: string;
  phone?: string;
  keywords?: string[];
  transfer?: boolean;
  transferMode?: TransferMode;
};

function modeLabel(mode: TransferMode): string {
  switch (mode) {
    case "immediate":
      return "put through immediately (minimal intake)";
    case "ask_client":
      return "ask the contact first whether they want the call";
    case "message_only":
      return "take a message only — do not live-transfer";
    default:
      return "confirm caller details, then transfer";
  }
}

function salesLines(policy: SalesPolicy): string[] {
  switch (policy) {
    case "qualify_and_message":
      return [
        "Sales / vendors: briefly qualify (company, product, why they called), then take a message for the team. Do not transfer live sales pitches unless the caller is clearly an existing supplier the business asked for.",
      ];
    case "transfer":
      return [
        "Sales / vendors: if a sales routing contact matches, follow that contact's transfer mode. Otherwise take a short message with company and callback number.",
      ];
    case "politely_decline":
      return [
        "Sales / cold pitches: politely decline. Say the business is not taking sales calls on this line, offer to note their company name if useful, then end the call warmly.",
      ];
    default:
      return [
        "Sales / vendors: field the call yourself. Answer basic questions if you can from business knowledge, capture company + offering + callback, and offer to pass a summary to the team. Do not put cold sales through to staff unless a matching routing contact explicitly allows transfer.",
      ];
  }
}

function spamLines(policy: SpamPolicy): string[] {
  switch (policy) {
    case "message_only":
      return [
        "Spam / robocalls / scam-like calls: do not transfer. Take at most a one-line note, then end politely.",
      ];
    case "block":
      return [
        "Spam / robocalls / scam-like calls: refuse firmly and end quickly. Never share staff numbers, never transfer, never confirm personal details.",
      ];
    default:
      return [
        "Spam / robocalls / scam-like calls: recognise early, stay brief, politely end the call. Never transfer spam.",
      ];
  }
}

/** Prompt block injected at call start so the model follows screening & transfer rules. */
export function buildRoutingPolicyBlock(options: {
  screening?: CallScreening | null;
  contacts?: RoutingContactForPolicy[] | null;
}): string | null {
  const screening = options.screening ?? DEFAULT_CALL_SCREENING;
  const contacts = (options.contacts ?? []).filter((c) => (c.name ?? "").trim());

  const lines: string[] = [
    "[CALL ROUTING & SCREENING]",
    "Follow these rules for who gets put through, who is screened, and how sales/spam are handled.",
    "",
    "Named person requests:",
    `• Default when someone asks for a person by name: ${modeLabel(screening.namedPersonPolicy)}.`,
  ];

  if (contacts.length) {
    lines.push("• Routing contacts (match on name or keywords):");
    for (const c of contacts) {
      const mode = normaliseTransferMode(c.transferMode ?? screening.namedPersonPolicy);
      const kws = (c.keywords ?? []).filter(Boolean).slice(0, 8);
      const kwBit = kws.length ? ` keywords: ${kws.join(", ")}.` : "";
      const transferOff = c.transfer === false || mode === "message_only";
      if (transferOff) {
        lines.push(
          `  – ${c.name.trim()}: message / notify only — do not live-transfer.${kwBit}`,
        );
      } else if (mode === "immediate") {
        lines.push(
          `  – ${c.name.trim()}: if the caller asks for them (or matches keywords), put them through straight away. Still take their name if unknown; skip long intake.${kwBit}`,
        );
      } else if (mode === "ask_client") {
        lines.push(
          `  – ${c.name.trim()}: do NOT put through immediately. Tell the caller you will check if ${c.name.trim()} is available. Attempt transfer only as an availability check; if they cannot take it, take a full message and promise a callback.${kwBit}`,
        );
      } else {
        lines.push(
          `  – ${c.name.trim()}: confirm caller name, callback number and reason, then transfer.${kwBit}`,
        );
      }
    }
  } else {
    lines.push(
      "• No named routing contacts configured — for “can I speak to someone?”, take a message unless a fallback transfer number is set in your instructions.",
    );
  }

  lines.push("", "Sales & spam:");
  lines.push(...salesLines(screening.salesPolicy).map((l) => `• ${l}`));
  lines.push(...spamLines(screening.spamPolicy).map((l) => `• ${l}`));

  lines.push(
    "",
    "General:",
    "• Genuine customers and emergencies always take priority over sales screening.",
    "• If unsure whether a call is spam, ask one clarifying question, then apply the stricter spam rule if it still looks unwanted.",
    "• Never invent that someone is available; if ask-client mode applies and you cannot confirm, take a message.",
  );

  return lines.join("\n");
}
