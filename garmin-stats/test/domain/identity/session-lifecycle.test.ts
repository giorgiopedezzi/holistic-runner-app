/**
 * test/domain/identity/session-lifecycle.test.ts (HRA-348 AC6/AC7)
 * Opaque session credentials, cookie encode/decode, and expiry — pure, no I/O.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  computeSessionExpiry, decodeSessionCookieValue, encodeSessionCookieValue,
  hashSecret, isSessionExpired, issueSessionCredentials, secretMatches,
} from "../../../src/domain/identity/session-lifecycle.ts";

test("issueSessionCredentials returns a distinct id and secret each time, and the secret is never the stored hash", () => {
  const a = issueSessionCredentials();
  const b = issueSessionCredentials();
  assert.notEqual(a.id, b.id);
  assert.notEqual(a.secret, b.secret);
  assert.notEqual(a.secret, a.secretHash);
  assert.equal(a.secretHash, hashSecret(a.secret));
});

test("secretMatches is true only for the exact secret that produced the hash", () => {
  const credentials = issueSessionCredentials();
  assert.equal(secretMatches(credentials.secret, credentials.secretHash), true);
  assert.equal(secretMatches("wrong-secret", credentials.secretHash), false);
});

test("cookie value round-trips through encode/decode", () => {
  const credentials = issueSessionCredentials();
  const cookieValue = encodeSessionCookieValue(credentials);
  const decoded = decodeSessionCookieValue(cookieValue);
  assert.deepEqual(decoded, { id: credentials.id, secret: credentials.secret });
});

test("decodeSessionCookieValue rejects a value with no separator, an empty id, or an empty secret", () => {
  assert.equal(decodeSessionCookieValue("no-separator-here"), null);
  assert.equal(decodeSessionCookieValue(".secret-with-no-id"), null);
  assert.equal(decodeSessionCookieValue("id-with-no-secret."), null);
});

test("computeSessionExpiry sets idle from `now` and absolute from `absoluteStart` independently", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const absoluteStart = new Date("2025-12-31T20:00:00Z"); // an earlier session's original start
  const { idleExpiresAt, absoluteExpiresAt } = computeSessionExpiry(now, 1800, 43200, absoluteStart);
  assert.equal(idleExpiresAt.toISOString(), "2026-01-01T00:30:00.000Z");
  assert.equal(absoluteExpiresAt.toISOString(), "2026-01-01T08:00:00.000Z"); // 12h after absoluteStart, not `now`
});

test("isSessionExpired is false while within both idle and absolute windows and not revoked", () => {
  const now = new Date("2026-01-01T00:10:00Z");
  const session = { idleExpiresAt: new Date("2026-01-01T00:30:00Z"), absoluteExpiresAt: new Date("2026-01-01T12:00:00Z"), revokedAt: null };
  assert.equal(isSessionExpired(session, now), false);
});

test("isSessionExpired is true once idle expiry passes, even before absolute expiry", () => {
  const now = new Date("2026-01-01T00:31:00Z");
  const session = { idleExpiresAt: new Date("2026-01-01T00:30:00Z"), absoluteExpiresAt: new Date("2026-01-01T12:00:00Z"), revokedAt: null };
  assert.equal(isSessionExpired(session, now), true);
});

test("isSessionExpired is true once absolute expiry passes, even if idle was just renewed", () => {
  const now = new Date("2026-01-01T12:01:00Z");
  const session = { idleExpiresAt: new Date("2026-01-01T12:30:00Z"), absoluteExpiresAt: new Date("2026-01-01T12:00:00Z"), revokedAt: null };
  assert.equal(isSessionExpired(session, now), true);
});

test("isSessionExpired is true when revoked, regardless of either window", () => {
  const now = new Date("2026-01-01T00:10:00Z");
  const session = { idleExpiresAt: new Date("2026-01-01T00:30:00Z"), absoluteExpiresAt: new Date("2026-01-01T12:00:00Z"), revokedAt: new Date("2026-01-01T00:05:00Z") };
  assert.equal(isSessionExpired(session, now), true);
});
