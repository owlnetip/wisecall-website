export type TransferRoutingProvider = "telnyx" | "mor_sip" | "mor_openai" | string | null;

/**
 * UK national dial string (07… / 01…) for MOR SIP transfers.
 * Telnyx Voice required E.164 (+44…). Owlnet MOR accepts a leading-0 national
 * number on the SIP INVITE, including mobiles as 07XXXXXXXXX.
 */
export function toUkNationalDialString(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return trimmed;

  let digits = trimmed.replace(/[^\d]/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("44") && digits.length >= 11) {
    return `0${digits.slice(2)}`;
  }
  if (digits.startsWith("0")) return digits;
  return trimmed;
}

export function formatTransferPhoneForProvider(
  phone: string,
  provider: TransferRoutingProvider | undefined,
): string {
  const trimmed = phone.trim();
  if (!trimmed) return trimmed;
  if (provider === "mor_sip") return toUkNationalDialString(trimmed);
  return trimmed;
}

export function formatRoutingContactsForProvider<
  T extends { phone?: string; transfer?: boolean },
>(contacts: T[], provider: TransferRoutingProvider | undefined): T[] {
  return contacts.map((contact) => ({
    ...contact,
    phone: formatTransferPhoneForProvider(contact.phone ?? "", provider),
  }));
}
