import assert from "node:assert/strict";
import test from "node:test";
import {
  formatRoutingContactsForProvider,
  formatTransferPhoneForProvider,
  toUkNationalDialString,
} from "./transfer-phone";

test("converts E.164 UK mobiles and landlines to 0… national", () => {
  assert.equal(toUkNationalDialString("+447958740689"), "07958740689");
  assert.equal(toUkNationalDialString("+44 7545 069699"), "07545069699");
  assert.equal(toUkNationalDialString("441135221606"), "01135221606");
  assert.equal(toUkNationalDialString("00447958740689"), "07958740689");
});

test("leaves already-national UK numbers alone", () => {
  assert.equal(toUkNationalDialString("07958740689"), "07958740689");
  assert.equal(toUkNationalDialString("0113 522 1606"), "01135221606");
});

test("MOR SIP transfer phones use 07 format; Telnyx stays as stored", () => {
  assert.equal(formatTransferPhoneForProvider("+447958740689", "mor_sip"), "07958740689");
  assert.equal(formatTransferPhoneForProvider("+447958740689", "telnyx"), "+447958740689");
});

test("formats routing contact phones for MOR without dropping other fields", () => {
  const [contact] = formatRoutingContactsForProvider(
    [{ id: "rhys", phone: "+447958740689", transfer: true, keywords: ["keys"] }],
    "mor_sip",
  );
  assert.equal(contact.phone, "07958740689");
  assert.equal(contact.transfer, true);
  assert.deepEqual(contact.keywords, ["keys"]);
});
