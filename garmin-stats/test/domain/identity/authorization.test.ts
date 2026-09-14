/**
 * test/domain/identity/authorization.test.ts (HRA-348 AC8/AC10)
 * isAccountUsable / ownsResource — pure, no I/O.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isAccountUsable, ownsResource } from "../../../src/domain/identity/authorization.ts";

test("isAccountUsable is true only for 'active'", () => {
  assert.equal(isAccountUsable("active"), true);
  assert.equal(isAccountUsable("disabled"), false);
  assert.equal(isAccountUsable("deletion_pending"), false);
});

test("ownsResource is true only when the identity's user id equals the resource's owner id", () => {
  assert.equal(ownsResource("user-1", "user-1"), true);
  assert.equal(ownsResource("user-1", "user-2"), false);
});

// AC10: an admin identity gets no special path through this check — role is
// not even a parameter, so there is no way to bypass ownership with it.
test("ownsResource has no role parameter to bypass ownership with — an admin's own id still fails against another user's resource", () => {
  const adminUserId = "admin-1";
  const someoneElsesResourceOwnerId = "user-99";
  assert.equal(ownsResource(adminUserId, someoneElsesResourceOwnerId), false);
});
