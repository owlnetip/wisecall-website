import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  buildMorSipDialTexml,
  buildPstnDialTexml,
  buildSipUri,
  buildUnavailableTexml,
  morDidFromMetadata,
  normalizeE164,
} from "./texml.ts";

Deno.test("normalizeE164 prefixes +", () => {
  assertEquals(normalizeE164("441135222277"), "+441135222277");
  assertEquals(normalizeE164("+44 113 522 2277"), "+441135222277");
});

Deno.test("unavailable TeXML speaks then hangs up instead of silent drop", () => {
  const xml = buildUnavailableTexml("Sorry, the WiseCall demo is temporarily unavailable.");
  if (!xml.includes("<Say")) throw new Error("expected spoken apology");
  if (!xml.includes("<Hangup/>")) throw new Error("expected hangup");
});

Deno.test("MOR SIP TeXML dials the bridge instead of streaming a dead websocket", () => {
  const xml = buildMorSipDialTexml({
    sipUri: "sip:wca123@54.38.148.116",
    username: "wca123",
    password: "secret",
    callerId: "+441135221606",
  });
  if (!xml.includes("<Dial")) throw new Error("expected Dial");
  if (!xml.includes("sip:wca123@54.38.148.116")) throw new Error("expected SIP URI");
  assertEquals(buildSipUri({ username: "wca123", domain: "sip.owlnet.io", proxy: "54.38.148.116" }), "sip:wca123@54.38.148.116");
});

Deno.test("PSTN Dial TeXML bridges onto the MOR DDI", () => {
  const xml = buildPstnDialTexml({
    number: "441135515465",
    callerId: "+441135221606",
  });
  if (!xml.includes("<Number>+441135515465</Number>")) throw new Error("expected E.164 MOR DDI");
  if (!xml.includes('callerId="+441135221606"')) throw new Error("expected caller id");
});

Deno.test("morDidFromMetadata prefers the pool DID over the public Telnyx number", () => {
  assertEquals(
    morDidFromMetadata({
      routing: { morDid: "441135515465", number: "+441135222277" },
    }),
    "+441135515465",
  );
  assertEquals(morDidFromMetadata({ routing: { number: "+441135222277" } }), "");
});
