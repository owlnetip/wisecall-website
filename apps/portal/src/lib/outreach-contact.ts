/** Resolve which name/email to use for outreach when enriched owner data exists. */

export function emailDomain(email: string): string {
  const at = email.lastIndexOf("@");
  return at >= 0 ? email.slice(at + 1).trim().toLowerCase() : "";
}

export function websiteHost(website: string | null | undefined): string {
  const raw = (website ?? "").trim();
  if (!raw) return "";
  try {
    const host = new URL(raw.startsWith("http") ? raw : `https://${raw}`).hostname.toLowerCase();
    return host.startsWith("www.") ? host.slice(4) : host;
  } catch {
    return "";
  }
}

export function emailMatchesWebsite(
  email: string,
  website: string | null | undefined,
): boolean {
  const domain = emailDomain(email);
  const host = websiteHost(website);
  if (!domain || !host) return false;
  return domain === host || domain.endsWith(`.${host}`) || host.endsWith(`.${domain}`);
}

export type ProspectContactFields = {
  contactName: string | null;
  email: string | null;
  phone?: string | null;
  ownerName: string | null;
  ownerEmail: string | null;
  website: string | null;
};

export type ResolvedProspectContact = {
  name: string;
  email: string;
  /** True when seed/enriched owner overrides mismatched stored contact fields. */
  usedEnrichedOwner: boolean;
};

export type SeedContactFields = {
  contact_name?: string;
  owner_name?: string;
  email?: string;
  owner_email?: string;
  phone?: string;
};

/** Best-known contact from seed then enriched owner merge fields. */
export function canonicalProspectContact(
  p: ProspectContactFields,
  seed?: SeedContactFields | null,
): { name: string; email: string } | null {
  const name = (seed?.owner_name || seed?.contact_name || p.ownerName || "").trim();
  const email = (seed?.owner_email || seed?.email || p.ownerEmail || "").trim();
  if (!email) return null;
  if (p.website && !emailMatchesWebsite(email, p.website)) return null;
  return { name, email };
}

/** Stored contact email belongs to a different practice than this record's website. */
export function hasWrongDomainContactEmail(p: ProspectContactFields): boolean {
  const contactEmail = (p.email ?? "").trim();
  if (!contactEmail || !p.website) return false;
  return !emailMatchesWebsite(contactEmail, p.website);
}

function storedDiffersFromCanonical(
  p: ProspectContactFields,
  canonical: { name: string; email: string },
): boolean {
  const contactName = (p.contactName ?? "").trim();
  const contactEmail = (p.email ?? "").trim().toLowerCase();
  return contactName !== canonical.name || contactEmail !== canonical.email.toLowerCase();
}

/** Prefer seed/enriched owner when stored contact differs (wrong domain or wrong address on right domain). */
export function resolveProspectContact(
  p: ProspectContactFields,
  seed?: SeedContactFields | null,
): ResolvedProspectContact {
  const contactName = (p.contactName ?? "").trim();
  const contactEmail = (p.email ?? "").trim();
  const canonical = canonicalProspectContact(p, seed);

  if (canonical && storedDiffersFromCanonical(p, canonical)) {
    return { name: canonical.name, email: canonical.email, usedEnrichedOwner: true };
  }

  return {
    name: contactName || canonical?.name || (p.ownerName ?? "").trim(),
    email: contactEmail || canonical?.email || (p.ownerEmail ?? "").trim(),
    usedEnrichedOwner: false,
  };
}

export function hasProspectContactMismatch(
  p: ProspectContactFields,
  seed?: SeedContactFields | null,
): boolean {
  if (hasWrongDomainContactEmail(p)) return true;
  const canonical = canonicalProspectContact(p, seed);
  return Boolean(canonical && storedDiffersFromCanonical(p, canonical));
}

/** Build a repair patch from seed + enriched owner data. Returns null when no fix is needed/possible. */
export function buildProspectContactRepair(
  p: ProspectContactFields & { firstEmailSentAt?: string | null },
  seed?: SeedContactFields | null,
): { contact_name?: string; email?: string; phone?: string } | null {
  if (p.firstEmailSentAt) return null;

  const canonical = canonicalProspectContact(p, seed);
  if (!canonical || !storedDiffersFromCanonical(p, canonical)) return null;

  const seedPhone = (seed?.phone || "").trim();
  const patch: { contact_name?: string; email?: string; phone?: string } = {};

  if (canonical.name && (p.contactName ?? "").trim() !== canonical.name) {
    patch.contact_name = canonical.name;
  }
  if (canonical.email && (p.email ?? "").trim().toLowerCase() !== canonical.email.toLowerCase()) {
    patch.email = canonical.email;
  }
  if (seedPhone && (p.phone ?? "").trim() !== seedPhone) {
    patch.phone = seedPhone;
  }

  return Object.keys(patch).length ? patch : null;
}
