import test from "node:test";
import assert from "node:assert/strict";
import { routeConfirmedSalesforceReply, replyPhoneDigits } from "../../../../supabase/functions/_shared/salesforce-sms-inbound-router";

const binding = { id: "binding", salesforce_record_id: "003000000000001AAA" };
test("unbound number stays on receptionist path without callback", async () => {
  assert.equal(await routeConfirmedSalesforceReply({ fromNumber: "07825395792", findBinding: async () => null, deliver: async () => { throw new Error("must not call"); }, recordFailure: async () => { throw new Error("must not call"); } }), false);
});
test("confirmed binding suppresses receptionist on delivery success, failure, and exceptions", async () => {
  for (const mode of ["success", "failed", "exception"]) {
    const failures: string[] = [];
    assert.equal(await routeConfirmedSalesforceReply({ fromNumber: "+447825395792", findBinding: async digits => { assert.equal(digits,"447825395792"); return binding; }, deliver: async () => { if(mode === "exception") throw new Error("private credential"); return { delivered: mode === "success", status: mode === "success" ? 200 : 502 }; }, recordFailure: async (_binding,_digits,reason) => { failures.push(reason); } }), true);
    assert.equal(failures.length, mode === "success" ? 0 : 1);
    assert.ok(!failures.join().includes("private credential"));
  }
});
test("lookup and durable logging errors fail closed", async () => {
  await assert.rejects(routeConfirmedSalesforceReply({ fromNumber: "07825395792", findBinding: async () => { throw new Error("database unavailable"); }, deliver: async () => ({delivered:true,status:200}), recordFailure: async () => {} }), /database unavailable/);
  await assert.rejects(routeConfirmedSalesforceReply({ fromNumber: "07825395792", findBinding: async () => binding, deliver: async () => ({delivered:false,status:502}), recordFailure: async () => { throw new Error("log unavailable"); } }), /log unavailable/);
});
test("reply lookup normalises UK forms", () => {
  for(const phone of ["07825395792","00447825395792","447825395792","+447825395792"]) assert.equal(replyPhoneDigits(phone),"447825395792");
});
