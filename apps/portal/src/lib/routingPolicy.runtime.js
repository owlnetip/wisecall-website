// routingPolicy.runtime.js, synced from wisecall-edge/src/lib/routingPolicy.js
// Run: npm run sync:portal (from wisecall-edge/) or node scripts/sync-runtime-libs.mjs

// Call screening & transfer policies — mirrors apps/portal/src/lib/routing-policy.ts

const DEFAULT_CALL_SCREENING = {
  salesPolicy: "field",
  spamPolicy: "politely_end",
  namedPersonPolicy: "confirm_caller",
};

const TRANSFER_MODES = ["immediate", "confirm_caller", "ask_client", "message_only"];
const SALES_POLICIES = ["field", "qualify_and_message", "transfer", "politely_decline"];
const SPAM_POLICIES = ["politely_end", "message_only", "block"];

function oneOf(value, allowed, fallback) {
  return typeof value === "string" && allowed.includes(value) ? value : fallback;
}

function normaliseTransferMode(value) {
  return oneOf(value, TRANSFER_MODES, "confirm_caller");
}

function readCallScreening(metadata) {
  const raw = metadata?.call_screening;
  if (!raw || typeof raw !== "object") return { ...DEFAULT_CALL_SCREENING };
  return {
    salesPolicy: oneOf(raw.salesPolicy ?? raw.sales_policy, SALES_POLICIES, "field"),
    spamPolicy: oneOf(raw.spamPolicy ?? raw.spam_policy, SPAM_POLICIES, "politely_end"),
    namedPersonPolicy: oneOf(
      raw.namedPersonPolicy ?? raw.named_person_policy,
      TRANSFER_MODES,
      "confirm_caller",
    ),
  };
}

function modeLabel(mode) {
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

function salesLines(policy) {
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

function spamLines(policy) {
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

function buildRoutingPolicyBlock({ screening, contacts } = {}) {
  const s = screening ?? DEFAULT_CALL_SCREENING;
  const list = (contacts ?? []).filter((c) => (c.name ?? "").trim());

  const lines = [
    "[CALL ROUTING & SCREENING]",
    "Follow these rules for who gets put through, who is screened, and how sales/spam are handled.",
    "",
    "Named person requests:",
    `• Default when someone asks for a person by name: ${modeLabel(s.namedPersonPolicy)}.`,
  ];

  if (list.length) {
    lines.push("• Routing contacts (match on name or keywords):");
    for (const c of list) {
      const mode = normaliseTransferMode(c.transferMode ?? s.namedPersonPolicy);
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
  for (const l of salesLines(s.salesPolicy)) lines.push(`• ${l}`);
  for (const l of spamLines(s.spamPolicy)) lines.push(`• ${l}`);

  lines.push(
    "",
    "General:",
    "• Genuine customers and emergencies always take priority over sales screening.",
    "• If unsure whether a call is spam, ask one clarifying question, then apply the stricter spam rule if it still looks unwanted.",
    "• Never invent that someone is available; if ask-client mode applies and you cannot confirm, take a message.",
  );

  return lines.join("\n");
}

function buildRoutingPolicySection(metadata) {
  if (!metadata || typeof metadata !== "object") {
    return buildRoutingPolicyBlock({
      screening: DEFAULT_CALL_SCREENING,
      contacts: [],
    });
  }
  const contacts = Array.isArray(metadata.routing_contacts)
    ? metadata.routing_contacts
    : [];
  return buildRoutingPolicyBlock({
    screening: readCallScreening(metadata),
    contacts,
  });
}

module.exports = {
  DEFAULT_CALL_SCREENING,
  normaliseTransferMode,
  readCallScreening,
  buildRoutingPolicyBlock,
  buildRoutingPolicySection,
};
