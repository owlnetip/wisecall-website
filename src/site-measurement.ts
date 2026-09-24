// First-touch source for organic measurement.
//
// Consent: the marketing site has no cookie banner and no consent manager.
// privacy-policy.html section 9 says the site uses essential cookies plus
// Microsoft Clarity (loaded only when NEXT_PUBLIC_CLARITY_PROJECT_ID is set).
// This script does not set a cookie and does not store personal data, gclid,
// or fbclid. It keeps a source label, the landing path, and utm_source /
// utm_medium / utm_campaign (when the landing URL had them) in sessionStorage
// for the visit. Vercel Web Analytics was already injected on every page.

export const ATTRIBUTION_KEY = 'wisecall_ft';

export const SOURCES = [
  'paid_google',
  'paid_meta',
  'paid_other',
  'organic_google',
  'organic_bing',
  'organic_other',
  'referral',
  'direct',
] as const;

export type Source = (typeof SOURCES)[number];

export type Attribution = {
  src: Source;
  lp: string;
  utm_source: string;
  utm_medium: string;
  utm_campaign: string;
};

export type CtaPosition = 'hero' | 'inline' | 'footer' | 'sticky';

const POSITIONS = new Set<CtaPosition>(['hero', 'inline', 'footer', 'sticky']);
const PAID_MEDIUMS = new Set(['cpc', 'ppc', 'paid']);
const GOOGLE_ADS_SOURCES = new Set(['google_ads', 'adwords']);
const META_SOURCES = new Set(['facebook', 'instagram', 'meta', 'fb', 'ig']);
const UTM_KEYS = ['utm_source', 'utm_medium', 'utm_campaign'] as const;

type TrackFn = (
  name: string,
  properties?: Record<string, string | number | boolean | null | undefined>,
) => void;

function clip(value: string, max = 200): string {
  const trimmed = value.trim();
  return trimmed.length > max ? trimmed.slice(0, max) : trimmed;
}

function isSource(value: string): value is Source {
  return (SOURCES as readonly string[]).includes(value);
}

export function referrerHost(referrer: string): string {
  if (!referrer) return '';
  try {
    return new URL(referrer).hostname.toLowerCase().replace(/\.$/, '');
  } catch {
    return '';
  }
}

export function isInternalHost(host: string, pageHost: string): boolean {
  if (!host) return true;
  const h = host.toLowerCase();
  const page = pageHost.toLowerCase();
  if (page && (h === page || h.endsWith(`.${page}`))) return true;
  if (h === 'wisecall.io' || h.endsWith('.wisecall.io')) return true;
  if (h === 'localhost' || h.endsWith('.localhost') || h === '127.0.0.1') return true;
  return false;
}

export function isGoogleHost(host: string): boolean {
  return /(^|\.)google\./i.test(host);
}

// Search, News, and Images. mail.google.com, docs.google.com and other product hosts are referrals.
export function isGoogleSearchHost(host: string): boolean {
  return /^(www\.)?google\.[a-z]{2,3}(?:\.[a-z]{2})?$/i.test(host);
}

export function isGoogleNewsOrImagesHost(host: string): boolean {
  return /^(news|images)\.google\.[a-z]{2,3}(?:\.[a-z]{2})?$/i.test(host);
}

// Android Google app search. The referrer is not an https host.
const GOOGLE_QUICKSEARCH_APP = 'android-app://com.google.android.googlequicksearchbox';

export function isGoogleQuickSearchApp(referrer: string): boolean {
  const value = referrer.trim().toLowerCase();
  if (!value.startsWith(GOOGLE_QUICKSEARCH_APP)) return false;
  const next = value.charAt(GOOGLE_QUICKSEARCH_APP.length);
  return next === '' || next === '/' || next === '?' || next === '#';
}

export function isBingHost(host: string): boolean {
  return host === 'bing.com' || host.endsWith('.bing.com');
}

function hostIs(host: string, name: string): boolean {
  return host === name || host.endsWith(`.${name}`);
}

export function isYandexHost(host: string): boolean {
  return /(^|\.)yandex\./i.test(host);
}

export function isOtherSearchHost(host: string): boolean {
  return (
    hostIs(host, 'duckduckgo.com') ||
    hostIs(host, 'yahoo.com') ||
    hostIs(host, 'yahoo.co.uk') ||
    hostIs(host, 'ecosia.org') ||
    hostIs(host, 'search.brave.com') ||
    hostIs(host, 'startpage.com') ||
    isYandexHost(host)
  );
}

export function classifyVisit({
  search = '',
  referrer = '',
  pageHost = '',
  pathname = '/',
}: {
  search?: string;
  referrer?: string;
  pageHost?: string;
  pathname?: string;
}): Attribution {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const utmSource = clip(params.get('utm_source') || '');
  const utmMedium = clip(params.get('utm_medium') || '');
  const utmCampaign = clip(params.get('utm_campaign') || '');
  const sourceLower = utmSource.toLowerCase();
  const mediumLower = utmMedium.toLowerCase();
  const gclid = (params.get('gclid') || '').trim();
  const gbraid = (params.get('gbraid') || '').trim();
  const wbraid = (params.get('wbraid') || '').trim();
  const fbclid = (params.get('fbclid') || '').trim();
  const msclkid = (params.get('msclkid') || '').trim();
  const paidMedium = PAID_MEDIUMS.has(mediumLower);

  let src: Source;
  if (
    gclid ||
    gbraid ||
    wbraid ||
    (paidMedium && sourceLower === 'google') ||
    GOOGLE_ADS_SOURCES.has(sourceLower)
  ) {
    src = 'paid_google';
  } else if (fbclid || META_SOURCES.has(sourceLower)) {
    src = 'paid_meta';
  } else if (msclkid || (paidMedium && sourceLower === 'bing')) {
    src = 'paid_other';
  } else {
    const host = referrerHost(referrer);
    if (isGoogleQuickSearchApp(referrer)) src = 'organic_google';
    else if (!host || isInternalHost(host, pageHost)) src = 'direct';
    else if (isGoogleSearchHost(host) || isGoogleNewsOrImagesHost(host)) src = 'organic_google';
    else if (isBingHost(host)) src = 'organic_bing';
    else if (isOtherSearchHost(host)) src = 'organic_other';
    else src = 'referral';
  }

  const lp = pathname && pathname.startsWith('/') ? pathname : `/${pathname || ''}`;
  return {
    src,
    lp,
    utm_source: utmSource,
    utm_medium: utmMedium,
    utm_campaign: utmCampaign,
  };
}

export function parseAttribution(raw: string | null): Attribution | null {
  if (!raw) return null;
  try {
    const data = JSON.parse(raw) as Partial<Attribution>;
    if (!data || typeof data.src !== 'string' || !isSource(data.src)) return null;
    if (typeof data.lp !== 'string' || !data.lp.startsWith('/')) return null;
    return {
      src: data.src,
      lp: data.lp,
      utm_source: typeof data.utm_source === 'string' ? data.utm_source : '',
      utm_medium: typeof data.utm_medium === 'string' ? data.utm_medium : '',
      utm_campaign: typeof data.utm_campaign === 'string' ? data.utm_campaign : '',
    };
  } catch {
    return null;
  }
}

export function isTrialSetupHref(href: string, base = 'https://wisecall.io'): boolean {
  try {
    const url = new URL(href, base);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    return url.hostname === 'app.wisecall.io' && path === '/setup' && url.searchParams.get('trial') === 'calls';
  } catch {
    return false;
  }
}

export function buildTrialUrl(href: string, attribution: Attribution, base = 'https://wisecall.io'): string | null {
  if (!isTrialSetupHref(href, base)) return null;
  const url = new URL(href, base);
  const next = new URLSearchParams();
  next.set('trial', 'calls');
  next.set('src', attribution.src);
  next.set('lp', attribution.lp);
  for (const key of UTM_KEYS) {
    const value = attribution[key];
    if (value) next.set(key, value);
  }
  for (const [key, value] of url.searchParams) {
    if (!next.has(key)) next.append(key, value);
  }
  url.search = next.toString();
  return url.toString();
}

export function isCallAvaTryHref(href: string, base = 'https://wisecall.io'): boolean {
  try {
    const url = new URL(href, base);
    const path = url.pathname.replace(/\/+$/, '') || '/';
    if (path !== '/try') return false;
    const host = url.hostname.toLowerCase();
    const pageHost = new URL(base).hostname.toLowerCase();
    if (!host) return true;
    if (pageHost && (host === pageHost || host.endsWith(`.${pageHost}`))) return true;
    if (host === 'wisecall.io' || host.endsWith('.wisecall.io')) return true;
    if (host === 'localhost' || host.endsWith('.localhost') || host === '127.0.0.1') return true;
    return false;
  } catch {
    return false;
  }
}

export function isCallAvaClick(href: string, label = '', base = 'https://wisecall.io'): boolean {
  if (isAvaTelHref(href)) return true;
  if (!isCallAvaTryHref(href, base)) return false;
  const text = label.replace(/\s+/g, ' ').trim().toLowerCase();
  return text === 'call ava' || text.startsWith('call ava:') || text.startsWith('call ava ');
}

export function isAvaTelHref(href: string): boolean {
  if (!href || !/^tel:/i.test(href)) return false;
  let digits = href.replace(/^tel:/i, '').split(/[?;]/)[0] || '';
  try {
    digits = decodeURIComponent(digits);
  } catch {
    // keep the raw tel value
  }
  digits = digits.replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  if (digits.startsWith('0')) digits = `44${digits.slice(1)}`;
  return digits === '441135222277';
}

export function ctaPosition(el: Element): CtaPosition {
  const explicit = el.getAttribute('data-cta-position');
  if (explicit && POSITIONS.has(explicit as CtaPosition)) return explicit as CtaPosition;
  if (el.closest('footer')) return 'footer';
  if (el.closest('#mobileStickyCta')) return 'sticky';
  let node: Element | null = el.parentElement;
  while (node && node !== document.body) {
    const cls = typeof node.className === 'string' ? node.className : '';
    if (/(?:^|\s)(?:fixed|sticky)(?:\s|$)/.test(cls)) return 'sticky';
    node = node.parentElement;
  }
  const main = document.querySelector('main') || document.body;
  const first = main.querySelector('section');
  const section = el.closest('section');
  if ((section && first && section === first) || el.closest('#live-demo')) return 'hero';
  return 'inline';
}

function rewriteTrialLinks(root: ParentNode, attribution: Attribution, base: string): void {
  root.querySelectorAll('a[href]').forEach((node) => {
    const anchor = node as HTMLAnchorElement;
    const href = anchor.getAttribute('href');
    if (!href) return;
    const next = buildTrialUrl(href, attribution, base);
    if (next) anchor.setAttribute('href', next);
  });
}

let started = false;

export function initSiteMeasurement(options: { track?: TrackFn } = {}): Attribution | null {
  if (started || typeof window === 'undefined') return null;
  started = true;

  const { track } = options;
  let attribution = parseAttribution(readStorage());
  if (!attribution) {
    attribution = classifyVisit({
      search: window.location.search,
      referrer: document.referrer,
      pageHost: window.location.hostname,
      pathname: window.location.pathname || '/',
    });
    writeStorage(attribution);
  }

  const base = window.location.href;
  const stored = attribution;

  const start = () => {
    rewriteTrialLinks(document, stored, base);
    document.addEventListener('click', onClick, true);
  };

  function onClick(event: Event) {
    const anchor = anchorFromEvent(event);
    if (!anchor) return;
    const href = anchor.getAttribute('href') || '';
    const page = window.location.pathname || '/';
    const position = ctaPosition(anchor);
    const src = stored.src;
    if (isTrialSetupHref(href, base)) {
      const next = buildTrialUrl(href, stored, base);
      if (next) anchor.setAttribute('href', next);
      safeTrack(track, 'trial_cta_click', { page, position, src });
      return;
    }
    if (isCallAvaClick(href, anchor.textContent || '', base)) {
      safeTrack(track, 'call_ava_click', { page, position, src });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }

  return stored;
}

function readStorage(): string | null {
  try {
    return window.sessionStorage.getItem(ATTRIBUTION_KEY);
  } catch {
    return null;
  }
}

function writeStorage(attribution: Attribution): void {
  try {
    window.sessionStorage.setItem(ATTRIBUTION_KEY, JSON.stringify(attribution));
  } catch {
    // Private mode can block sessionStorage. The visit still classifies in memory.
  }
}

function anchorFromEvent(event: Event): HTMLAnchorElement | null {
  const target = event.target;
  if (target instanceof Element) {
    const found = target.closest('a[href]');
    return found instanceof HTMLAnchorElement ? found : null;
  }
  if (target instanceof Node && target.parentElement) {
    const found = target.parentElement.closest('a[href]');
    return found instanceof HTMLAnchorElement ? found : null;
  }
  return null;
}

function safeTrack(
  track: TrackFn | undefined,
  name: string,
  properties: Record<string, string>,
): void {
  if (!track) return;
  try {
    track(name, properties);
  } catch {
    // A failed analytics call must not stop the link.
  }
}
