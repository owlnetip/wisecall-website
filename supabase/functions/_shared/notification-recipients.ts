// Shared inbox resolution for call / chat / action-item emails.
// Keep in sync with apps/portal/src/lib/notification-recipients.ts.

export function asEmailList(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item).trim()).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map((item) => item.trim()).filter(Boolean);
  }
  return [];
}

export function uniqueEmails(values: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const value of values) {
    const email = value.trim();
    const key = email.toLowerCase();
    if (!email || seen.has(key)) continue;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
    seen.add(key);
    out.push(email);
  }
  return out;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export function contactRouteKey(contact: { id?: string; name?: string }): string {
  const name = String(contact.name || "").trim();
  return slugify(name).replace(/-/g, "_") || String(contact.id || "");
}

export type TransferHint = {
  route_key?: string;
  label?: string;
};

export function defaultInboxEmails(metadata: Record<string, unknown>): string[] {
  return uniqueEmails([
    ...asEmailList(metadata.default_routing_email),
    ...asEmailList(metadata.notification_emails),
    ...asEmailList(metadata.fallback_email),
  ]);
}

function routingContacts(metadata: Record<string, unknown>): Array<Record<string, unknown>> {
  const raw = metadata.routing_contacts;
  if (!Array.isArray(raw)) return [];
  return raw.filter((item) => item && typeof item === "object") as Array<
    Record<string, unknown>
  >;
}

function contactNotifyEmails(
  contact: Record<string, unknown>,
  defaultInbox: string[],
): string[] {
  if (contact.notify !== true) return [];
  if (contact.useDefaultEmail === true) return defaultInbox.slice(0, 1);
  return uniqueEmails(asEmailList(contact.email));
}

function matchesTransfer(
  contact: Record<string, unknown>,
  transfer?: TransferHint | null,
): boolean {
  if (!transfer) return false;
  const routeKey = String(transfer.route_key || "").trim().toLowerCase();
  const label = String(transfer.label || "").trim().toLowerCase();
  const id = String(contact.id || "").trim().toLowerCase();
  const name = String(contact.name || "").trim().toLowerCase();
  const key = contactRouteKey({
    id: String(contact.id || ""),
    name: String(contact.name || ""),
  }).toLowerCase();
  if (routeKey && (routeKey === id || routeKey === key)) return true;
  if (label && label === name) return true;
  return false;
}

export function callSummaryRecipients(
  metadata: Record<string, unknown>,
  transfer?: TransferHint | null,
): string[] {
  const inbox = defaultInboxEmails(metadata);
  const contacts = routingContacts(metadata);
  const matched: string[] = [];
  const notifyAll: string[] = [];

  for (const contact of contacts) {
    const emails = contactNotifyEmails(contact, inbox);
    notifyAll.push(...emails);
    if (matchesTransfer(contact, transfer)) matched.push(...emails);
  }

  const configured = uniqueEmails([...inbox, ...matched]);
  if (configured.length) return configured;
  return uniqueEmails(notifyAll);
}
