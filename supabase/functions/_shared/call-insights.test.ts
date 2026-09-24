import { assertEquals } from "https://deno.land/std@0.224.0/assert/mod.ts";
import { cleanName, spokenDigits, verifiedCallbackNumber } from "./call-insights.ts";

Deno.test("reads numbers the caller spoke as words", () => {
  assertEquals(spokenDigits("Nine six seven one six one four two eight"), "967161428");
  assertEquals(spokenDigits("oh seven nine six seven"), "07967");
  assertEquals(spokenDigits("seven double two four"), "7224");
  assertEquals(spokenDigits("triple eight one"), "8881");
  assertEquals(spokenDigits("call me on 07967 161428 please"), "07967161428");
  assertEquals(spokenDigits("it's confidential"), "");
});

Deno.test("only keeps a callback number the caller actually said", () => {
  const spoken = "user: my number is oh seven nine six seven one six one four two eight";
  assertEquals(verifiedCallbackNumber("07967161428", spoken), "07967161428");
  assertEquals(verifiedCallbackNumber("7967161428", spoken), "07967161428");
  assertEquals(verifiedCallbackNumber("+447967161428", spoken), "07967161428");
  // A number that was never spoken, including the calling line, is dropped.
  assertEquals(verifiedCallbackNumber("07123456789", spoken), "");
  assertEquals(verifiedCallbackNumber("+441482690288", spoken), "");
  assertEquals(verifiedCallbackNumber("", spoken), "");
});

Deno.test("rejects a conversation fragment posing as a name", () => {
  assertEquals(cleanName("Alana Shaw"), "Alana Shaw");
  assertEquals(cleanName("Mr Simons"), "Mr Simons");
  assertEquals(cleanName("Can I Speak To"), "");
  assertEquals(cleanName("A Legal Matter"), "");
  assertEquals(cleanName("Thanks For"), "");
  assertEquals(cleanName("the caller did not give a name at all"), "");
});
