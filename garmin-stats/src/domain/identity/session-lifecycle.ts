/**
 * domain/identity/session-lifecycle.ts
 * Opaque session credentials (AC6) and expiry/fixation rules (AC7). Pure
 * crypto/date logic, no I/O — persistence lives in repositories/identity.repo.ts.
 *
 * A session is a (id, secret) pair: `id` is a non-secret lookup key, `secret`
 * is a high-entropy verifier the caller holds (cookie) and the server never
 * stores raw — only `hashSecret(secret)` is persisted, so a DB read alone
 * never yields a reusable session credential.
 */
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";

export interface IssuedSessionCredentials {
  id: string;
  secret: string;
  secretHash: string;
}

export function issueSessionCredentials(): IssuedSessionCredentials {
  const id = randomUUID();
  const secret = randomBytes(32).toString("base64url");
  return { id, secret, secretHash: hashSecret(secret) };
}

export function hashSecret(secret: string): string {
  return createHash("sha256").update(secret).digest("hex");
}

// Constant-time comparison of two equal-length SHA-256 hex digests. A
// caller-supplied secret never determines timing of the hash lookup itself
// (`id` is looked up first, non-secret) — this only guards the final compare.
export function secretMatches(secret: string, secretHash: string): boolean {
  const candidate = Buffer.from(hashSecret(secret), "hex");
  const expected = Buffer.from(secretHash, "hex");
  if (candidate.length !== expected.length) return false;
  return timingSafeEqual(candidate, expected);
}

const SESSION_COOKIE_SEPARATOR = ".";

export function encodeSessionCookieValue(credentials: Pick<IssuedSessionCredentials, "id" | "secret">): string {
  return `${credentials.id}${SESSION_COOKIE_SEPARATOR}${credentials.secret}`;
}

export function decodeSessionCookieValue(value: string): { id: string; secret: string } | null {
  const separatorIndex = value.indexOf(SESSION_COOKIE_SEPARATOR);
  if (separatorIndex <= 0) return null;
  const id = value.slice(0, separatorIndex);
  const secret = value.slice(separatorIndex + 1);
  if (!id || !secret) return null;
  return { id, secret };
}

export interface SessionExpiry {
  idleExpiresAt: Date;
  absoluteExpiresAt: Date;
}

// `absoluteStart` defaults to `now` (a fresh session); pass the ORIGINAL
// session's absolute start when rotating, so idle renewal can never push the
// absolute boundary further out (AC7 — rotation isn't a way to outlive the
// 12h absolute lifetime).
export function computeSessionExpiry(now: Date, idleSeconds: number, absoluteSeconds: number, absoluteStart: Date = now): SessionExpiry {
  return {
    idleExpiresAt: new Date(now.getTime() + idleSeconds * 1000),
    absoluteExpiresAt: new Date(absoluteStart.getTime() + absoluteSeconds * 1000),
  };
}

export function isSessionExpired(session: { idleExpiresAt: Date; absoluteExpiresAt: Date; revokedAt: Date | null }, now: Date): boolean {
  if (session.revokedAt) return true;
  if (now.getTime() > session.idleExpiresAt.getTime()) return true;
  if (now.getTime() > session.absoluteExpiresAt.getTime()) return true;
  return false;
}
