import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import {
  LIVE_EDGE_BASE_URL,
  buildMorSipDialTexml,
  buildPstnDialTexml,
  buildSipUri,
  buildStreamTexml,
  buildUnavailableTexml,
  morDidFromMetadata,
  normalizeE164,
  resolveEdgeBaseUrl,
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

Deno.test("resolveEdgeBaseUrl skips the Bicom PBX host", () => {
  assertEquals(resolveEdgeBaseUrl("https://18.171.233.209.sslip.io"), LIVE_EDGE_BASE_URL);
  assertEquals(resolveEdgeBaseUrl("https://13.40.127.21.sslip.io"), LIVE_EDGE_BASE_URL);
  assertEquals(resolveEdgeBaseUrl(""), LIVE_EDGE_BASE_URL);
  assertEquals(resolveEdgeBaseUrl("https://18.132.149.25.sslip.io/"), LIVE_EDGE_BASE_URL);
});

Deno.test("stream TeXML connects a bidirectional websocket to /media", () => {
  const xml = buildStreamTexml(
    "https://13.40.127.21.sslip.io",
    "wisecall",
    "+447700900000",
    "+441135221606",
    "PCMA",
  );
  if (!xml.includes("<Connect>")) throw new Error("expected Connect");
  if (!xml.includes("<Stream")) throw new Error("expected Stream");
  if (!xml.includes("wss://13.40.127.21.sslip.io/media")) throw new Error("expected media websocket");
  if (!xml.includes("profile_slug=wisecall")) throw new Error("expected profile slug");
  if (xml.includes("<Dial")) throw new Error("stream path must not Dial");
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
