/**
 * test/domain/identity/registration-gate.test.ts (HRA-348 AC5)
 * isRegistrationAllowed — pure, no I/O.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isRegistrationAllowed } from "../../../src/domain/identity/registration-gate.ts";

test("open mode allows any unknown identity to register, with or without an email", () => {
  assert.equal(isRegistrationAllowed({ mode: "open", founderAllowlist: [], email: "anyone@example.com" }), true);
  assert.equal(isRegistrationAllowed({ mode: "open", founderAllowlist: [], email: null }), true);
});

test("founders_only mode denies an identity with no email", () => {
  assert.equal(isRegistrationAllowed({ mode: "founders_only", founderAllowlist: ["founder@example.com"], email: null }), false);
});

test("founders_only mode denies an identity whose email is not on the allowlist", () => {
  assert.equal(isRegistrationAllowed({ mode: "founders_only", founderAllowlist: ["founder@example.com"], email: "stranger@example.com" }), false);
});

test("founders_only mode allows an identity whose email is on the allowlist, case/whitespace-insensitively", () => {
  assert.equal(isRegistrationAllowed({ mode: "founders_only", founderAllowlist: ["Founder@Example.com"], email: " founder@example.com " }), true);
});

test("founders_only mode denies when the allowlist is empty", () => {
  assert.equal(isRegistrationAllowed({ mode: "founders_only", founderAllowlist: [], email: "founder@example.com" }), false);
});
