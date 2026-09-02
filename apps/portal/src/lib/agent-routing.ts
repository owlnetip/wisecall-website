import { isGuestRoutingNumber, isGuestTestAgentMetadata } from "./guest-test-agent";

export type ResolvedRoutingProvider = "telnyx" | "mor_openai" | "mor_sip" | null;
export type ResolvedRoutingStatus = "unprovisioned" | "pending" | "live";

export type ResolvedRouting = {
  provider: ResolvedRoutingProvider;
  number: string;
  status: ResolvedRoutingStatus;
  telnyxApplicationId?: string;
  sipRoute?: string;
  openaiVoice?: string;
};

const UNPROVISIONED: ResolvedRouting = { provider: null, number: "", status: "unprovisioned" };

function asProvider(value: unknown): ResolvedRoutingProvider {
  if (value === "telnyx" || value === "mor_openai" || value === "mor_sip") return value;
  return null;
}

function extraFields(r: Record<string, unknown>): Pick<
  ResolvedRouting,
  "telnyxApplicationId" | "sipRoute" | "openaiVoice"
> {
  return {
    telnyxApplicationId:
      typeof r.telnyxApplicationId === "string" ? r.telnyxApplicationId : undefined,
    sipRoute: typeof r.sipRoute === "string" ? r.sipRoute : undefined,
    openaiVoice: typeof r.openaiVoice === "string" ? r.openaiVoice : undefined,
  };
}

function liveTelnyx(number: string): ResolvedRouting {
  return { provider: "telnyx", number, status: "live" };
}

function isGuestRoute(opts: {
  metadata: Record<string, unknown> | null;
  provider: unknown;
  status: unknown;
  number: string;
}): boolean {
  if (isGuestTestAgentMetadata(opts.metadata)) return true;
  if (opts.provider === "guest_test" || opts.status === "test") return true;
  return isGuestRoutingNumber(opts.number);
}

// A real inbound DDI the customer can publish. Guest +4455 keys and empty
// values do not count — otherwise the agents list looks "assigned" while
// Routing still asks them to assign a number.
export function isCustomerDdi(value: string): boolean {
  const number = value.trim();
  return number.startsWith("+") && !isGuestRoutingNumber(number);
}

export function displayAgentPhoneNumber(
  routing: { number: string; status: string },
  opts?: { guestTest?: boolean },
): string {
  if (routing.status === "live" && isCustomerDdi(routing.number)) return routing.number;
  if (routing.status === "pending") return "Setting up…";
  if (opts?.guestTest) return "Test call only";
  return "Number pending";
}

// Provider-agnostic routing for the portal. Guest test keys and status "test"
// are not live DDIs. If metadata.routing is missing or not live, a real
// telnyx_number still counts as live so list and detail stay in sync.
export function resolveAgentRouting(input: {
  telnyxNumber?: string | null;
  metadata?: Record<string, unknown> | null;
}): ResolvedRouting {
  const metadata =
    input.metadata && typeof input.metadata === "object" && !Array.isArray(input.metadata)
      ? input.metadata
      : null;
  const telnyx = typeof input.telnyxNumber === "string" ? input.telnyxNumber.trim() : "";
  const realTelnyx = isCustomerDdi(telnyx) ? telnyx : "";
  const raw = metadata?.routing;

  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const r = raw as Record<string, unknown>;
    const number = typeof r.number === "string" ? r.number.trim() : "";
    const extra = extraFields(r);

    if (isGuestRoute({ metadata, provider: r.provider, status: r.status, number })) {
      return realTelnyx ? liveTelnyx(realTelnyx) : UNPROVISIONED;
    }

    if (r.status === "pending") {
      return {
        provider: asProvider(r.provider) ?? "telnyx",
        number: isCustomerDdi(number) ? number : "",
        status: "pending",
        ...extra,
      };
    }

    // A stored customer DDI is live even if status was left stale — that is
    // what the agents list already showed, and Routing must match it.
    if (isCustomerDdi(number)) {
      return {
        provider: asProvider(r.provider) ?? "telnyx",
        number,
        status: "live",
        ...extra,
      };
    }

    if (realTelnyx) return liveTelnyx(realTelnyx);

    return {
      provider: asProvider(r.provider),
      number: "",
      status: "unprovisioned",
      ...extra,
    };
  }

  if (realTelnyx) return liveTelnyx(realTelnyx);
  return UNPROVISIONED;
}
