import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { smsSegments } from "./sms-segments.ts";

Deno.test("GSM-7 texts: 160 single, 153 per part", () => {
  assertEquals(smsSegments("Hello"), 1);
  assertEquals(smsSegments("a".repeat(160)), 1);
  assertEquals(smsSegments("a".repeat(161)), 2);
  assertEquals(smsSegments("a".repeat(306)), 2);
  assertEquals(smsSegments("a".repeat(307)), 3);
  assertEquals(smsSegments("£".repeat(160)), 1);
  assertEquals(smsSegments("€".repeat(80)), 1); // extension chars count double
  assertEquals(smsSegments("€".repeat(81)), 2);
});

Deno.test("Unicode texts (emoji, curly quotes): 70 single, 67 per part", () => {
  assertEquals(smsSegments("Still here! 😊"), 1);
  assertEquals(smsSegments("’".repeat(70)), 1);
  assertEquals(smsSegments("’".repeat(71)), 2);
  assertEquals(smsSegments("’".repeat(134)), 2);
  assertEquals(smsSegments("’".repeat(135)), 3);
});

Deno.test("empty is zero", () => {
  assertEquals(smsSegments(""), 0);
});
