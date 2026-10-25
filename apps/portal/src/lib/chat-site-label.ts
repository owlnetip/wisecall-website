// Which website a web chat came from, for the inbox label and filter.
//
// A chat stores the page the visitor was on (metadata.page_url, later
// last_page_url). The label is, in order: the matching metadata.chat_sites
// brand_name on the agent, the agent's business name when the page is on the
// agent's own website, otherwise the bare hostname. Chats with no recorded page
// (older widget) get no label.

function plain(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function hostOf(url: unknown): string | null {
  const raw = String(url || "").trim();
  if (!raw) return null;
  try {
    return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

function within(host: string, site: string): boolean {
  return host === site || host.endsWith(`.${site}`);
}

export function chatSiteLabel(
  logMetadata: Record<string, unknown> | null | undefined,
  profile: { businessName?: string | null; metadata?: Record<string, unknown> | null } | undefined,
): string {
  const host = hostOf(logMetadata?.page_url) || hostOf(logMetadata?.last_page_url);
  if (!host) return "";

  const sites = plain(profile?.metadata?.chat_sites);
  if (sites) {
    const hit = Object.keys(sites)
      .map((key) => ({ key, site: hostOf(key) }))
      .filter((entry): entry is { key: string; site: string } => Boolean(entry.site) && within(host, entry.site as string))
      .sort((a, b) => b.site.length - a.site.length)[0];
    const brand = hit ? String(plain(sites[hit.key])?.brand_name || "").trim() : "";
    if (brand) return brand;
  }

  const own = hostOf(profile?.metadata?.website);
  if (own && within(host, own) && profile?.businessName) return profile.businessName;
  return host;
}
