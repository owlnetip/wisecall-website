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

export function defaultSignalingPort(transport: SipTransport): number {
  return transport === "tls" ? 5061 : 5060;
}

// Split "pbx.example.com:5061" or "[::1]:5061" into host + optional port.
export function parseSipHostPort(input: string): { host: string; port?: number } {
  const value = input.trim();
  if (!value) return { host: "" };

  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(value);
  if (v6) {
    return { host: v6[1], port: v6[2] ? Number(v6[2]) : undefined };
  }

  const idx = value.lastIndexOf(":");
  if (idx > 0 && /^\d+$/.test(value.slice(idx + 1))) {
    return { host: value.slice(0, idx), port: Number(value.slice(idx + 1)) };
  }

  return { host: value };
}

// Normalise what we store in wisecall_sip_endpoints so the SIP bridge opens
// REGISTER on the right port. TLS must not stay on 5060; bare hosts get the
// transport default (5060 UDP/TCP, 5061 TLS).
export function normalizeSipEndpointAddress(input: {
  sipDomain: string;
  sipProxy?: string;
  transport: SipTransport;
}): { sipDomain: string; sipProxy: string } {
  const source = input.sipDomain.trim() || input.sipProxy?.trim() || "";
  const { host, port: explicitPort } = parseSipHostPort(source);
  if (!host) return { sipDomain: "", sipProxy: "" };

  let port = explicitPort;
  if (port === 5060 && input.transport === "tls") {
    port = 5061;
  }
  if (!port) {
    port = defaultSignalingPort(input.transport);
  }

  const sipDomain = host;
  const sipProxy = `${host}:${port}`;
  return { sipDomain, sipProxy };
}

// Rebuild a friendly PBX address for the form from stored host + proxy.
export function formatSipHostPortForDisplay(
  sipDomain: string,
  sipProxy: string,
  transport: SipTransport,
): string {
  const parsed = parseSipHostPort(sipProxy || sipDomain);
  if (!parsed.host) return sipDomain;
  const port = parsed.port ?? defaultSignalingPort(transport);
  if (transport === "tls" || port !== defaultSignalingPort("udp")) {
    return `${parsed.host}:${port}`;
  }
  return parsed.host;
}
