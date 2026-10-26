// SMS segment count, as carriers and Vonage bill it.
// GSM-7: 160 chars in one SMS, 153 per part when split (extension chars count 2).
// Anything outside GSM-7 (emoji, curly quotes, most accents) → UCS-2: 70 / 67.
const GSM_BASIC =
  "@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà";
const GSM_EXTENDED = "^{}\\[~]|€\f";

export function smsSegments(text: string): number {
  const value = String(text || "");
  if (!value) return 0;
  let gsmLength = 0;
  let gsm = true;
  for (const ch of value) {
    if (GSM_BASIC.includes(ch)) gsmLength += 1;
    else if (GSM_EXTENDED.includes(ch)) gsmLength += 2;
    else { gsm = false; break; }
  }
  if (gsm) return gsmLength <= 160 ? 1 : Math.ceil(gsmLength / 153);
  const units = [...value].reduce((n, ch) => n + (ch.codePointAt(0)! > 0xffff ? 2 : 1), 0);
  return units <= 70 ? 1 : Math.ceil(units / 67);
}
