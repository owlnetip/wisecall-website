// UK mobiles as typed on /setup: 07… or +44… → E.164.
// Same shape the homepage demo already accepts (07XXXXXXXXX / 447XXXXXXXXX).

const UK_MOBILE_DIGITS = /^447\d{9}$/;

export function toE164UkMobile(input: string): string | null {
  let digits = input.trim().replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length === 11) digits = `44${digits.slice(1)}`;
  if (digits.length === 10 && digits.startsWith("7")) digits = `44${digits}`;
  if (!UK_MOBILE_DIGITS.test(digits)) return null;
  return `+${digits}`;
}
