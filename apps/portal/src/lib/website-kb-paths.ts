const DENTAL_PATHS = [
  "/fees/",
  "/fees",
  "/private-fees/",
  "/treatment-fees/",
  "/pricing/",
  "/prices/",
  "/treatments/",
  "/services/",
  "/locations/",
  "/about-us/",
  "/about/",
] as const;

const GENERAL_PATHS = ["/pricing/", "/prices/", "/fees/", "/services/", "/about/", "/contact/"] as const;

export function isDentalKnowledgeContext(templateId?: string | null, industry?: string | null): boolean {
  if (templateId === "dentally") return true;
  return /\b(dental|dentist|dentistry|dentally|hygienist|orthodont\w*)\b/i.test(industry ?? "");
}

function normalizeWebsiteUrl(input: string): string | null {
  let url = input.trim();
  if (!url) return null;
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try {
    const parsed = new URL(url);
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString();
  } catch {
    return null;
  }
}

function normalizeComparableUrl(input: string): string {
  try {
    const parsed = new URL(input);
    parsed.hash = "";
    parsed.search = "";
    let path = parsed.pathname.replace(/\/+$/, "") || "/";
    return `${parsed.origin.toLowerCase()}${path}`;
  } catch {
    return input.trim().toLowerCase().replace(/\/+$/, "");
  }
}

/** Canonical homepage URL with trailing slash. */
export function websiteHomeUrl(input: string): string | null {
  const normalized = normalizeWebsiteUrl(input);
  if (!normalized) return null;
  const parsed = new URL(normalized);
  return `${parsed.origin}/`;
}

/** Ordered unique URLs to ingest for an agent website (homepage first). */
export function buildWebsiteKnowledgeUrls(
  input: string,
  opts: { templateId?: string | null; industry?: string | null; maxUrls?: number } = {},
): string[] {
  const home = websiteHomeUrl(input);
  if (!home) return [];

  const origin = new URL(home).origin;
  const paths = isDentalKnowledgeContext(opts.templateId, opts.industry) ? DENTAL_PATHS : GENERAL_PATHS;
  const maxUrls = opts.maxUrls ?? 10;
  const seen = new Set<string>();
  const urls: string[] = [];

  const push = (candidate: string) => {
    const key = normalizeComparableUrl(candidate);
    if (seen.has(key)) return;
    seen.add(key);
    urls.push(candidate);
  };

  push(home);
  for (const path of paths) {
    if (urls.length >= maxUrls) break;
    try {
      push(new URL(path, origin).toString());
    } catch {
      // Ignore malformed combinations.
    }
  }

  return urls.slice(0, maxUrls);
}

export function normalizeKnowledgeSourceUrl(input: string): string {
  return normalizeComparableUrl(input);
}
