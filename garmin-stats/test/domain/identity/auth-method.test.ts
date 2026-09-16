import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAuthenticationMethod } from "../../../src/domain/identity/auth-method.ts";

test("normalizes only supported authentication methods for UI exposure", () => {
  assert.equal(normalizeAuthenticationMethod("google-oauth2"), "google");
  assert.equal(normalizeAuthenticationMethod("email"), "email");
});

test("never exposes unknown provider metadata", () => {
  assert.equal(normalizeAuthenticationMethod("auth0"), null);
  assert.equal(normalizeAuthenticationMethod("google-oauth2|raw-subject"), null);
  assert.equal(normalizeAuthenticationMethod(null), null);
});
