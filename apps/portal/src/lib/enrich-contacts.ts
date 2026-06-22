import type { CallLog } from "@/lib/agents";
import type { Contact } from "@/lib/contacts";
import { extractContactNameFromLogs } from "@/lib/extract-contact-name";
import { extractCallerDetailsFromCall } from "@/lib/extract-caller-details";

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
  nameInferred?: boolean;
  detailsInferred?: boolean;
};

/** Fill missing contact fields from matching call log transcripts/summaries. */
export function enrichContactsWithNames(
  contacts: Contact[],
  callLogs: CallLog[],
): EnrichedContact[] {
  return contacts.map((contact) => {
    const related = callLogs.filter((log) => callerMatchesContact(contact, log.caller));
    let next: EnrichedContact = { ...contact };
    let changed = false;

    if (!contact.name.trim()) {
      const inferred = extractContactNameFromLogs(related);
      if (inferred) {
        next = { ...next, name: inferred, nameInferred: true };
        changed = true;
      }
    }

    if (!contact.company.trim() || !contact.callbackPhone.trim()) {
      for (const log of related) {
        const details = extractCallerDetailsFromCall(log);
        if (!next.company.trim() && details.company) {
          next = { ...next, company: details.company, detailsInferred: true };
          changed = true;
        }
        if (!next.callbackPhone.trim() && details.callbackPhone) {
          next = { ...next, callbackPhone: details.callbackPhone, detailsInferred: true };
          changed = true;
        }
        if (next.company.trim() && next.callbackPhone.trim()) break;
      }
    }

    return changed ? next : contact;
  });
}

export type ContactBackfillPatch = {
  id: string;
  name?: string;
  company?: string;
  callbackPhone?: string;
};

/** Contacts with newly inferred fields that should be persisted. */
export function contactsNeedingNameBackfill(
  original: Contact[],
  enriched: EnrichedContact[],
): ContactBackfillPatch[] {
  const originalById = new Map(original.map((c) => [c.id, c]));
  const updates: ContactBackfillPatch[] = [];

  for (const contact of enriched) {
    const before = originalById.get(contact.id);
    if (!before) continue;

    const patch: ContactBackfillPatch = { id: contact.id };
    if (contact.nameInferred && contact.name.trim() && !before.name.trim()) {
      patch.name = contact.name.trim();
    }
    if (contact.company.trim() && !before.company.trim()) {
      patch.company = contact.company.trim();
    }
    if (contact.callbackPhone.trim() && !before.callbackPhone.trim()) {
      patch.callbackPhone = contact.callbackPhone.trim();
    }
    if (patch.name || patch.company || patch.callbackPhone) updates.push(patch);
  }

  return updates;
}
