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
  /** True when enriched owner overrides mismatched stored contact fields. */
  usedEnrichedOwner: boolean;
};

export type SeedContactFields = {
  contact_name?: string;
  owner_name?: string;
  email?: string;
  owner_email?: string;
  phone?: string;
};

/** Stored contact email belongs to a different practice than this record's website. */
export function hasWrongDomainContactEmail(p: ProspectContactFields): boolean {
  const contactEmail = (p.email ?? "").trim();
  if (!contactEmail || !p.website) return false;
  return !emailMatchesWebsite(contactEmail, p.website);
}

/** Prefer enriched owner when their email matches the practice website but stored contact does not. */
export function resolveProspectContact(p: ProspectContactFields): ResolvedProspectContact {
  const contactName = (p.contactName ?? "").trim();
  const contactEmail = (p.email ?? "").trim();
  const ownerName = (p.ownerName ?? "").trim();
  const ownerEmail = (p.ownerEmail ?? "").trim();

  const contactDomainOk = Boolean(contactEmail && emailMatchesWebsite(contactEmail, p.website));
  const ownerDomainOk = Boolean(ownerEmail && emailMatchesWebsite(ownerEmail, p.website));

  const storedDiffersFromOwner =
    contactName !== ownerName || contactEmail.toLowerCase() !== ownerEmail.toLowerCase();

  if (ownerName && ownerEmail && ownerDomainOk && storedDiffersFromOwner && !contactDomainOk) {
    return { name: ownerName, email: ownerEmail, usedEnrichedOwner: true };
  }

  return {
    name: contactName || ownerName,
    email: contactEmail || ownerEmail,
    usedEnrichedOwner: false,
  };
}

export function hasProspectContactMismatch(p: ProspectContactFields): boolean {
  return resolveProspectContact(p).usedEnrichedOwner || hasWrongDomainContactEmail(p);
}

/** Build a repair patch from seed + enriched owner data. Returns null when no fix is needed/possible. */
export function buildProspectContactRepair(
  p: ProspectContactFields & { firstEmailSentAt?: string | null },
  seed?: SeedContactFields | null,
): { contact_name?: string; email?: string; phone?: string } | null {
  if (p.firstEmailSentAt) return null;
  if (!hasProspectContactMismatch(p)) return null;

  const seedName = (seed?.owner_name || seed?.contact_name || "").trim();
  const seedEmail = (seed?.owner_email || seed?.email || "").trim();
  const seedPhone = (seed?.phone || "").trim();
  const resolved = resolveProspectContact(p);

  const name = seedName || resolved.name;
  const email = seedEmail || resolved.email;
  if (!name && !email) return null;
  if (email && p.website && !emailMatchesWebsite(email, p.website)) return null;

  const patch: { contact_name?: string; email?: string; phone?: string } = {};
  if (name && (p.contactName ?? "").trim() !== name) patch.contact_name = name;
  if (email && (p.email ?? "").trim().toLowerCase() !== email.toLowerCase()) patch.email = email;
  if (seedPhone && hasWrongDomainContactEmail(p) && (p.phone ?? "").trim() !== seedPhone) {
    patch.phone = seedPhone;
  }

  return Object.keys(patch).length ? patch : null;
}
