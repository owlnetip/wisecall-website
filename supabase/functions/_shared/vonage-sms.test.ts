import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  extractInboundSms,
  inboundWebhookUrl,
  normaliseE164,
  smsLookupKeys,
} from "./vonage-sms.ts";

Deno.test("normaliseE164 always prefixes + after stripping non-digits", () => {
  assertEquals(normaliseE164("447401234567"), "+447401234567");
  assertEquals(normaliseE164("+44 7401 234567"), "+447401234567");
  assertEquals(normaliseE164(""), "");
});

Deno.test("smsLookupKeys covers E.164, national 07, and bare 44 forms", () => {
  const keys = smsLookupKeys("447401234567");
  assertEquals(keys.includes("+447401234567"), true);
  assertEquals(keys.includes("447401234567"), true);
  assertEquals(keys.includes("07401234567"), true);

  const fromNational = smsLookupKeys("07401234567");
  assertEquals(fromNational.includes("+447401234567"), true);
  assertEquals(fromNational.includes("447401234567"), true);
});

Deno.test("extractInboundSms reads legacy Vonage GET query params", () => {
  const parsed = extractInboundSms({
    msisdn: "447700900000",
    to: "447401234567",
    text: "Hi there",
    messageId: "abc",
  });
  assertEquals(parsed, {
    from: "447700900000",
    to: "447401234567",
    text: "Hi there",
    messageId: "abc",
  });
});

Deno.test("extractInboundSms reads Messages API JSON and nested content", () => {
  const flat = extractInboundSms({
    from: "447700900000",
    to: "447401234567",
    text: "Opening hours?",
    message_uuid: "uuid-1",
  });
  assertEquals(flat?.text, "Opening hours?");
  assertEquals(flat?.messageId, "uuid-1");

  const nested = extractInboundSms({
    message: {
      from: { number: "447700900000" },
      to: { number: "447401234567" },
      content: { type: "text", text: "Can I book?" },
      message_uuid: "uuid-2",
    },
  });
  assertEquals(nested, {
    from: "447700900000",
    to: "447401234567",
    text: "Can I book?",
    messageId: "uuid-2",
  });
});

Deno.test("extractInboundSms returns null when the payload is a health check", () => {
  assertEquals(extractInboundSms({ apikey: "anon" }), null);
  assertEquals(extractInboundSms({ to: "447401234567" }), null);
});

Deno.test("inboundWebhookUrl appends the anon key so Vonage GET health checks pass the gateway", () => {
  assertEquals(
    inboundWebhookUrl("https://example.supabase.co"),
    "https://example.supabase.co/functions/v1/wisecall-sms-inbound",
  );
  assertEquals(
    inboundWebhookUrl("https://example.supabase.co/", "anon-key"),
    "https://example.supabase.co/functions/v1/wisecall-sms-inbound?apikey=anon-key",
  );
});
