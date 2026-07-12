import assert from "node:assert/strict";
import test from "node:test";
import { getDialogFocusIndex } from "./dialog-focus";

test("cycles focus forwards within a dialog", () => {
  assert.equal(getDialogFocusIndex(-1, 3, "forward"), 0);
  assert.equal(getDialogFocusIndex(0, 3, "forward"), 1);
  assert.equal(getDialogFocusIndex(2, 3, "forward"), 0);
});

test("cycles focus backwards within a dialog", () => {
  assert.equal(getDialogFocusIndex(2, 3, "backward"), 1);
  assert.equal(getDialogFocusIndex(0, 3, "backward"), 2);
  assert.equal(getDialogFocusIndex(-1, 3, "backward"), 2);
});

test("handles a dialog with no focusable controls", () => {
  assert.equal(getDialogFocusIndex(0, 0, "forward"), -1);
});
