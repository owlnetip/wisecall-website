import assert from "node:assert/strict";
import { test } from "node:test";
import type { User } from "@supabase/supabase-js";
import { isAdmin } from "./admin";

function authUser({
  appRole,
  userRole,
}: {
  appRole?: string;
  userRole?: string;
}): User {
  return {
    app_metadata: appRole ? { role: appRole } : {},
    user_metadata: userRole ? { role: userRole } : {},
    email: "member@example.com",
  } as User;
}

test("accepts a server-controlled app metadata admin role", () => {
  assert.equal(isAdmin(authUser({ appRole: "admin" })), true);
});

test("does not trust a user-controlled metadata admin role", () => {
  assert.equal(isAdmin(authUser({ userRole: "admin" })), false);
});
