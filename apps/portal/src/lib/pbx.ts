// Shared PBX/SIP constants + types. Kept out of the "use server" actions module
// (which may only export async functions) so both the server actions and the
// client card can import them.

// PBX types the SIP bridge has an adapter for. Labels + the transport each one
// usually registers over (the UI pre-selects this; the user can still override).
export const PBX_TYPES = [
  { value: "portsip", label: "PortSIP / OwlnetPBX", defaultTransport: "udp" },
  { value: "3cx", label: "3CX", defaultTransport: "tls" },
  { value: "yeastar", label: "Yeastar", defaultTransport: "udp" },
  { value: "bicom", label: "Bicom PBXware", defaultTransport: "udp" },
  { value: "mor", label: "MOR", defaultTransport: "udp" },
  { value: "generic", label: "Other SIP PBX", defaultTransport: "udp" },
] as const;

export const SIP_TRANSPORTS = ["udp", "tcp", "tls"] as const;

// Public IP the SIP bridge registers from / advertises in SDP. The PBX must
// allow registrations from this address (and route the extension's calls to it).
export const SIP_BRIDGE_PUBLIC_IP = "18.134.170.162";

export type PbxType = (typeof PBX_TYPES)[number]["value"];
export type SipTransport = (typeof SIP_TRANSPORTS)[number];

export type SipEndpoint = {
  pbxType: PbxType;
  transport: SipTransport;
  sipDomain: string;
  sipProxy: string;
  sipUsername: string;
  hasPassword: boolean;
  isEnabled: boolean;
};

export type SipRegistrationStatus = {
  state: "unknown" | "registering" | "registered" | "failed" | "disabled";
  lastError: string | null;
  lastSuccessAt: string | null;
  expiresAt: string | null;
  contact: string | null;
};

export type SipEndpointResult = {
  ok: boolean;
  endpoint: SipEndpoint | null;
  status: SipRegistrationStatus | null;
  error?: string;
};

export type SipMutationResult = { ok: boolean; error?: string };

export function isPbxType(value: string): value is PbxType {
  return PBX_TYPES.some((t) => t.value === value);
}

export function isTransport(value: string): value is SipTransport {
  return (SIP_TRANSPORTS as readonly string[]).includes(value);
}
