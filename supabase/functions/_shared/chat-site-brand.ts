// One chat agent serving several websites, each with its own brand.
//
// profile.metadata.chat_sites = {
//   "yorkshirepropertybuyers.co.uk": {
//     brand_name: "Yorkshire Property Buyers",      // required; replaces the business name
//     assistant_name: "Betty",                       // optional; defaults to the agent's chat name
//     greeting, accent_color, background_color, logo_url, logo_mode,
//     font_family, font_stylesheet, launcher_label,  // optional; see wisecall-live-chat GET
//     chat_instructions,                             // optional; replaces the agent's chat instructions
//   },
// }
//
// The site is the page's hostname: the exact host, its www form, or any
// subdomain; the longest key wins. A matched site replaces the agent's brand
// identity (name, logo, colours, font, greeting) rather than inheriting it, so
// one brand's wordmark never shows on another's site. Hosts with no entry keep
// the agent's own settings. Only look and wording change: the profile id,
// knowledge base, routing and notification emails are untouched.

export type ChatSite = Record<string, unknown> & { brand_name: string };

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hostOf(pageUrl: unknown): string | null {
  try {
    return new URL(String(pageUrl || "")).hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export function chatSiteForPageUrl(metadata: unknown, pageUrl: unknown): { host: string; site: ChatSite } | null {
  if (!isPlainObject(metadata) || !isPlainObject(metadata.chat_sites)) return null;
  const host = hostOf(pageUrl);
  if (!host) return null;
  const sites = metadata.chat_sites;
  const key = Object.keys(sites)
    .map((k) => k.trim().toLowerCase().replace(/^www\./, ""))
    .filter((k) => k && (host === k || host.endsWith(`.${k}`)))
    .sort((a, b) => b.length - a.length)[0];
  if (!key) return null;
  const raw = Object.entries(sites).find(([k]) => k.trim().toLowerCase().replace(/^www\./, "") === key)?.[1];
  if (!isPlainObject(raw)) return null;
  const brandName = String(raw.brand_name || "").replace(/\s+/g, " ").trim().slice(0, 80);
  if (!brandName) return null;
  return { host: key, site: { ...raw, brand_name: brandName } };
}

const text = (value: unknown, max: number): string | undefined => {
  const s = String(value ?? "").replace(/\s+/g, " ").trim();
  return s && s.length <= max ? s : undefined;
};

// Returns the profile as this site's visitors should see it (a copy); the
// original is returned as-is when the page is not a configured site.
export function applySiteBranding<T extends Record<string, any>>(profile: T, pageUrl: unknown): T & { site_branded?: boolean } {
  const match = chatSiteForPageUrl(profile?.metadata, pageUrl);
  if (!match) return profile;
  const { site } = match;
  const base = profile.metadata as Record<string, unknown>;
  const brand = site.brand_name;
  const assistant = text(site.assistant_name, 80) || text(base.chat_assistant_name, 80) || profile.receptionist_name || "WiseCall";

  const metadata: Record<string, unknown> = { ...base };
  // Identity fields come only from the site entry.
  for (const key of [
    "chat_greeting",
    "chat_accent_color",
    "chat_background_color",
    "chat_logo_url",
    "chat_logo_mode",
    "chat_font_family",
    "chat_font_stylesheet",
  ]) delete metadata[key];
  metadata.chat_assistant_name = assistant;
  metadata.chat_greeting = text(site.greeting, 300) || `Hi, I'm ${assistant}, ${brand}'s AI Assistant. How can I help today?`;
  if (text(site.accent_color, 20)) metadata.chat_accent_color = text(site.accent_color, 20);
  if (text(site.background_color, 20)) metadata.chat_background_color = text(site.background_color, 20);
  if (text(site.logo_url, 500)) metadata.chat_logo_url = text(site.logo_url, 500);
  if (text(site.logo_mode, 20)) metadata.chat_logo_mode = text(site.logo_mode, 20);
  if (text(site.font_family, 160)) metadata.chat_font_family = text(site.font_family, 160);
  if (text(site.font_stylesheet, 500)) metadata.chat_font_stylesheet = text(site.font_stylesheet, 500);
  if (text(site.launcher_label, 40)) metadata.chat_launcher_label = text(site.launcher_label, 40);

  const own = typeof site.chat_instructions === "string" ? site.chat_instructions.trim() : "";
  const override =
    `On this website you are ${assistant}, the AI Assistant for ${brand}. Introduce yourself as ${assistant} from ${brand} ` +
    `and refer to the company as ${brand}. Ignore any other company or brand name in the instructions and knowledge below; ` +
    `never say you work for a different brand.`;
  metadata.chat_instructions = [override, own || (typeof base.chat_instructions === "string" ? base.chat_instructions.trim() : "")]
    .filter(Boolean)
    .join("\n\n");

  return { ...profile, business_name: brand, metadata, site_branded: true };
}

// The page the visitor is on. Widgets send page_url; older cached copies do not,
// so fall back to the browser's own Referer/Origin header on the request.
export function pageUrlFromRequest(req: Request, bodyPageUrl?: unknown): string {
  const sent = String(bodyPageUrl || "").trim();
  if (sent) return sent;
  return req.headers.get("referer") || req.headers.get("origin") || "";
}
