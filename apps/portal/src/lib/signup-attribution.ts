// First-touch trial attribution carried from wisecall.io onto app.wisecall.io/setup.
//
// The marketing site appends src, lp, utm_source, utm_medium and utm_campaign.
// Known src values (stored unchanged):
//   paid_google, paid_meta, paid_other, organic_google, organic_bing,
//   organic_other, referral, direct.
//
// Unknown src is stored as-is when it is a short token of letters, digits,
// underscores and hyphens (lowercased, capped at 64 characters). Anything else
// — spaces, emails, phone numbers, URLs — is bucketed as "other" so a weekly
// SQL group-by stays clean and the column never holds PII. Click ids
// (gclid, fbclid, msclkid) are not read.
//
// lp is a path only (/trades/plumbers). Query strings and fragments are
// dropped. utm_* values that contain @ or other non-token characters are
// dropped. First touch wins: an existing cookie, localStorage value, or
// wisecall_billing.signup_attribution is never overwritten.

export const SIGNUP_ATTRIBUTION_COOKIE = "wc_signup_attr";
export const SIGNUP_ATTRIBUTION_STORAGE_KEY = "wc_signup_attr";
export const SIGNUP_ATTRIBUTION_MAX_AGE_SECONDS = 60 * 60 * 24 * 90;
export const SIGNUP_ATTRIBUTION_PARAM = "attr";

export const KNOWN_SIGNUP_SOURCES = [
  "paid_google",
  "paid_meta",
  "paid_other",
  "organic_google",
  "organic_bing",
  "organic_other",
  "referral",
  "direct",
] as const;

const SRC_MAX = 64;
const LP_MAX = 200;
const UTM_MAX = 100;
const STORED_MAX = 800;
const OTHER_SOURCE = "other";

const SRC_TOKEN = /^[a-z0-9_-]+$/;
const UTM_TOKEN = /^[a-z0-9][a-z0-9._+-]*$/;
const LP_PATH = /^\/[a-z0-9/_\-.~]*$/i;

export type SignupAttribution = {
  src?: string;
  lp?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
};

type SearchInput =
  | URLSearchParams
  | Record<string, string | string[] | undefined | null>;

function firstString(value: string | string[] | undefined | null): string {
  if (Array.isArray(value)) return value[0] ?? "";
  return value ?? "";
}

function readParam(input: SearchInput, key: string): string {
  if (typeof URLSearchParams !== "undefined" && input instanceof URLSearchParams) {
    return input.get(key) ?? "";
  }
  return firstString((input as Record<string, string | string[] | undefined | null>)[key]);
}

export function sanitizeSignupSource(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (!SRC_TOKEN.test(trimmed)) return OTHER_SOURCE;
  return trimmed.slice(0, SRC_MAX);
}

export function sanitizeSignupLandingPath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let value = raw.trim();
  if (!value) return null;
  try {
    value = decodeURIComponent(value);
  } catch {
    return null;
  }
  if (value.includes("%")) {
    try {
      value = decodeURIComponent(value);
    } catch {
      return null;
    }
  }
  const hash = value.indexOf("#");
  if (hash >= 0) value = value.slice(0, hash);
  const query = value.indexOf("?");
  if (query >= 0) value = value.slice(0, query);
  if (!value.startsWith("/")) value = `/${value}`;
  if (value.includes("..") || value.includes("\\") || value.includes("@") || value.includes("//")) {
    return null;
  }
  if (!LP_PATH.test(value)) return null;
  return value.slice(0, LP_MAX);
}

export function sanitizeSignupUtm(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed || trimmed.length > UTM_MAX) return null;
  if (trimmed.includes("@") || /[\s\u0000-\u001f]/.test(trimmed)) return null;
  if (!UTM_TOKEN.test(trimmed)) return null;
  return trimmed;
}

export function attributionFromSearchParams(input: SearchInput): SignupAttribution | null {
  const attribution: SignupAttribution = {};
  const src = sanitizeSignupSource(readParam(input, "src"));
  const lp = sanitizeSignupLandingPath(readParam(input, "lp"));
  const utmSource = sanitizeSignupUtm(readParam(input, "utm_source"));
  const utmMedium = sanitizeSignupUtm(readParam(input, "utm_medium"));
  const utmCampaign = sanitizeSignupUtm(readParam(input, "utm_campaign"));
  if (src) attribution.src = src;
  if (lp) attribution.lp = lp;
  if (utmSource) attribution.utm_source = utmSource;
  if (utmMedium) attribution.utm_medium = utmMedium;
  if (utmCampaign) attribution.utm_campaign = utmCampaign;
  return Object.keys(attribution).length > 0 ? attribution : null;
}

export function serializeAttribution(attribution: SignupAttribution): string {
  const payload: SignupAttribution = {};
  if (attribution.src) payload.src = attribution.src;
  if (attribution.lp) payload.lp = attribution.lp;
  if (attribution.utm_source) payload.utm_source = attribution.utm_source;
  if (attribution.utm_medium) payload.utm_medium = attribution.utm_medium;
  if (attribution.utm_campaign) payload.utm_campaign = attribution.utm_campaign;
  return JSON.stringify(payload);
}

function attributionFromRecord(record: Record<string, unknown>): SignupAttribution | null {
  return attributionFromSearchParams({
    src: typeof record.src === "string" ? record.src : "",
    lp: typeof record.lp === "string" ? record.lp : "",
    utm_source: typeof record.utm_source === "string" ? record.utm_source : "",
    utm_medium: typeof record.utm_medium === "string" ? record.utm_medium : "",
    utm_campaign: typeof record.utm_campaign === "string" ? record.utm_campaign : "",
  });
}

export function parseStoredAttribution(raw: unknown): SignupAttribution | null {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return attributionFromRecord(raw as Record<string, unknown>);
  }
  if (typeof raw !== "string") return null;
  const trimmed = raw.trim();
  if (!trimmed || trimmed.length > STORED_MAX) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  return attributionFromRecord(parsed as Record<string, unknown>);
}

// Cookie / localStorage / account column: the value already stored wins.
export function firstTouchAttribution(
  existing: SignupAttribution | null,
  incoming: SignupAttribution | null,
): SignupAttribution | null {
  return existing ?? incoming ?? null;
}

export function chooseAttribution(cookieRaw: unknown, formOrLinkRaw: unknown): SignupAttribution | null {
  return firstTouchAttribution(parseStoredAttribution(cookieRaw), parseStoredAttribution(formOrLinkRaw));
}

// Returns the cookie value to set, or null when the existing first touch stands
// or the request has nothing worth storing.
export function resolveFirstTouchCookie(
  existingCookie: string | undefined,
  searchParams: URLSearchParams,
): string | null {
  if (parseStoredAttribution(existingCookie)) return null;
  const incoming = attributionFromSearchParams(searchParams);
  if (!incoming) return null;
  return serializeAttribution(incoming);
}

export function rememberStoredAttribution(
  existingRaw: string | null,
  incoming: SignupAttribution | null,
): string | null {
  const chosen = firstTouchAttribution(parseStoredAttribution(existingRaw), incoming);
  return chosen ? serializeAttribution(chosen) : null;
}

export function isSignupAttributionSchemaMissing(error: {
  code?: string | null;
  message?: string | null;
}): boolean {
  const code = String(error.code ?? "");
  const message = String(error.message ?? "").toLowerCase();
  const mentionsColumn = message.includes("signup_attribution") || message.includes("signup_at");
  if (!mentionsColumn) return false;
  return (
    code === "42703" ||
    code === "PGRST204" ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("could not find")
  );
}
