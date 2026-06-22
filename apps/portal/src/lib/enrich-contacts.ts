import type { CallLog } from "@/lib/agents";
import type { Contact } from "@/lib/contacts";
import { extractContactNameFromLogs } from "@/lib/extract-contact-name";

function callerMatchesContact(contact: Contact, caller: string): boolean {
  const normalizedCaller = caller.trim();
  if (!normalizedCaller) return false;

  const phoneKey = contact.phone.replace(/\s/g, "");
  if (phoneKey && normalizedCaller.replace(/\s/g, "") === phoneKey) return true;

  const emailKey = contact.email.toLowerCase();
  if (emailKey && normalizedCaller.toLowerCase() === emailKey) return true;

  return false;
}

export type EnrichedContact = Contact & {
  /** True when the displayed name was inferred from call history, not stored on the row. */
  nameInferred?: boolean;
};

/** Fill missing contact names from matching call log transcripts/summaries. */
export function enrichContactsWithNames(
  contacts: Contact[],
  callLogs: CallLog[],
): EnrichedContact[] {
  return contacts.map((contact) => {
    if (contact.name.trim()) return contact;

    const related = callLogs.filter((log) => callerMatchesContact(contact, log.caller));
    const inferred = extractContactNameFromLogs(related);
    if (!inferred) return contact;

    return {
      ...contact,
      name: inferred,
      nameInferred: true,
    };
  });
}

/** Contacts that gained a name via inference and should be persisted. */
export function contactsNeedingNameBackfill(
  original: Contact[],
  enriched: EnrichedContact[],
): { id: string; name: string }[] {
  const originalById = new Map(original.map((c) => [c.id, c]));
  const updates: { id: string; name: string }[] = [];

  for (const contact of enriched) {
    if (!contact.nameInferred || !contact.name.trim()) continue;
    const before = originalById.get(contact.id);
    if (before && !before.name.trim()) {
      updates.push({ id: contact.id, name: contact.name.trim() });
    }
  }

  return updates;
}
