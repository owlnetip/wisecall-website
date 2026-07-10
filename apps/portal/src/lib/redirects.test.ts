import assert from "node:assert/strict";
import { test } from "node:test";
import { safeInternalRedirect } from "./redirects";

test("keeps internal paths, queries and fragments", () => {
  assert.equal(safeInternalRedirect("/dashboard?view=inbox#latest"), "/dashboard?view=inbox#latest");
});

test("rejects external and malformed redirect targets", () => {
  for (const target of [
    "https://example.com",
    "//example.com",
    "/\\example.com",
    "/%5Cexample.com",
    "/%2F%2Fexample.com",
    "%2F%2Fexample.com",
  ]) {
    assert.equal(safeInternalRedirect(target), "/dashboard");
  }
});
