import assert from "node:assert/strict";
import { test } from "node:test";
import { parseViewingReply, viewingStatusLabel } from "./viewing-bookings";

test("parses owner approve replies", () => {
  assert.equal(parseViewingReply("YES"), "approve");
  assert.equal(parseViewingReply("yes please"), "approve");
  assert.equal(parseViewingReply("Confirm"), "approve");
});

test("parses ok as still-ok intent", () => {
  assert.equal(parseViewingReply("OK"), "ok");
  assert.equal(parseViewingReply("still ok"), "ok");
});

test("parses decline and change", () => {
  assert.equal(parseViewingReply("NO"), "decline");
  assert.equal(parseViewingReply("can't"), "decline");
  assert.equal(parseViewingReply("CHANGE"), "change");
  assert.equal(parseViewingReply("please reschedule"), "change");
});

test("unknown free text falls through to AI", () => {
  assert.equal(parseViewingReply("what time again?"), "unknown");
  assert.equal(parseViewingReply(""), "unknown");
});

test("status labels are human readable", () => {
  assert.equal(viewingStatusLabel("pending_owner"), "Waiting on owner");
  assert.equal(viewingStatusLabel("confirmed"), "Confirmed");
});
