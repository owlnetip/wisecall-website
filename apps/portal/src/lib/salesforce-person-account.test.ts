import test from "node:test";
import assert from "node:assert/strict";
import { buildPhoneSosl, parseSalesforceSearchRecords, decideSalesforceSms } from "./salesforce-sms";

const account = { attributes: { type: "Account" }, Id: "001Q100000eKrhOIAS", IsPersonAccount: true, PersonContactId: "003000000000001AAA", Name: "Luke Turner", Phone: "07825 395792", OwnerId: "005d3000002EFfZAAW" };
const digits = "447825395792";

test("Person Account phone lookup uses its linked Contact, never Account Id as WhoId", () => {
  const [record] = parseSalesforceSearchRecords([account], digits);
  assert.equal(record.id, account.PersonContactId);
  assert.equal(record.objectType, "Contact");
  assert.equal(record.personAccountId, account.Id);
  assert.equal(decideSalesforceSms({ matches: [record], binding: null }).status, "confirm_reply_route");
});
test("Person Account and its Contact are one candidate, unrelated Lead remains a duplicate", () => {
  const contact = { ...account, attributes: { type: "Contact" }, Id: account.PersonContactId };
  const lead = { ...account, attributes: { type: "Lead" }, Id: "00Q000000000001AAA" };
  for (const records of [[account, contact, lead], [contact, account, lead]]) {
    const matches = parseSalesforceSearchRecords(records, digits);
    assert.equal(matches.length, 2);
    assert.equal(decideSalesforceSms({ matches, binding: null }).status, "confirm_duplicate");
  }
});
test("business Accounts and nonmatching Person Accounts do not become Contacts", () => {
  assert.deepEqual(parseSalesforceSearchRecords([{ ...account, IsPersonAccount: false }, { ...account, Phone: "07700900999" }], digits), []);
});
test("matching Person Account without valid linked Contact fails closed", () => {
  for (const PersonContactId of [null, account.Id]) {
    assert.throws(() => parseSalesforceSearchRecords([{ ...account, PersonContactId }], digits), /no accessible linked Contact/);
  }
});
test("search includes Account.Phone and restricts to Person Accounts", () => {
  assert.match(buildPhoneSosl(digits), /Account\(Id,Name,Phone,IsPersonAccount,PersonContactId/);
  assert.match(buildPhoneSosl(digits), /WHERE IsPersonAccount = true/);
});
