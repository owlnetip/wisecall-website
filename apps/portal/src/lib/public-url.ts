import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export class PublicUrlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PublicUrlError";
  }
}

export type HostResolver = (
  hostname: string,
) => Promise<Array<{ address: string; family: number }>>;

const blockedIpv4 = new BlockList();
for (const [network, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
] as const) {
  blockedIpv4.addSubnet(network, prefix, "ipv4");
}

const publicIpv6 = new BlockList();
publicIpv6.addSubnet("2000::", 3, "ipv6");

const blockedIpv6 = new BlockList();
for (const [network, prefix] of [
  ["2001:db8::", 32],
  ["2001:10::", 28],
  ["fc00::", 7],
  ["fe80::", 10],
  ["ff00::", 8],
  ["::ffff:0:0", 96],
] as const) {
  blockedIpv6.addSubnet(network, prefix, "ipv6");
}

const blockedHostSuffixes = [
  ".arpa",
  ".example",
  ".home",
  ".internal",
  ".invalid",
  ".lan",
  ".local",
  ".localhost",
  ".onion",
  ".test",
];

function cleanHostname(hostname: string): string {
  return hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, "")
    .replace(/\.$/, "");
}

export function isPublicNetworkAddress(address: string): boolean {
  const clean = cleanHostname(address).replace(/%[^%]+$/, "");
  const family = isIP(clean);
  if (family === 4) return !blockedIpv4.check(clean, "ipv4");
  if (family === 6) {
    return publicIpv6.check(clean, "ipv6") && !blockedIpv6.check(clean, "ipv6");
  }
  return false;
}

function isBlockedHostname(hostname: string): boolean {
  if (!hostname || hostname === "localhost") return true;
  if (!hostname.includes(".") && isIP(hostname) === 0) return true;
  return blockedHostSuffixes.some(
    (suffix) => hostname === suffix.slice(1) || hostname.endsWith(suffix),
  );
}

const defaultResolver: HostResolver = async (hostname) =>
  lookup(hostname, { all: true, verbatim: true });

export async function assertPublicHttpUrl(
  value: string | URL,
  resolver: HostResolver = defaultResolver,
): Promise<URL> {
  let url: URL;
  try {
    url = value instanceof URL ? new URL(value) : new URL(value);
  } catch {
    throw new PublicUrlError("Enter a valid public website address.");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new PublicUrlError("Use a public HTTP or HTTPS website address.");
  }
  if (url.username || url.password) {
    throw new PublicUrlError("Website addresses cannot include a username or password.");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new PublicUrlError("Use a website on the standard HTTP or HTTPS port.");
  }

  const hostname = cleanHostname(url.hostname);
  if (isBlockedHostname(hostname)) {
    throw new PublicUrlError("Use a public website address, not a local or private address.");
  }

  if (isIP(hostname)) {
    if (!isPublicNetworkAddress(hostname)) {
      throw new PublicUrlError("Use a public website address, not a local or private address.");
    }
    return url;
  }

  let addresses: Array<{ address: string; family: number }>;
  try {
    addresses = await resolver(hostname);
  } catch {
    throw new PublicUrlError("We couldn't find that website address.");
  }
  if (addresses.length === 0) {
    throw new PublicUrlError("We couldn't find that website address.");
  }
  if (addresses.some(({ address }) => !isPublicNetworkAddress(address))) {
    throw new PublicUrlError("Use a public website address, not a local or private address.");
  }

  return url;
}

export async function fetchPublicHttpUrl(
  initialUrl: string | URL,
  init: RequestInit = {},
  options: {
    resolver?: HostResolver;
    fetcher?: typeof fetch;
    maxRedirects?: number;
  } = {},
): Promise<Response> {
  const resolver = options.resolver ?? defaultResolver;
  const fetcher = options.fetcher ?? fetch;
  const maxRedirects = options.maxRedirects ?? 5;
  let current = await assertPublicHttpUrl(initialUrl, resolver);

  for (let redirectCount = 0; redirectCount <= maxRedirects; redirectCount += 1) {
    const response = await fetcher(current, { ...init, redirect: "manual" });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;

    const location = response.headers.get("location");
    await response.body?.cancel();
    if (!location) throw new PublicUrlError("The website returned an invalid redirect.");
    if (redirectCount === maxRedirects) {
      throw new PublicUrlError("The website redirected too many times.");
    }
    current = await assertPublicHttpUrl(new URL(location, current), resolver);
  }

  throw new PublicUrlError("The website redirected too many times.");
}

export async function readResponseText(
  response: Response,
  maxBytes = 2_000_000,
): Promise<string> {
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > maxBytes) {
    throw new PublicUrlError("That webpage is too large to read safely.");
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let text = "";

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new PublicUrlError("That webpage is too large to read safely.");
    }
    text += decoder.decode(value, { stream: true });
  }

  return text + decoder.decode();
}
