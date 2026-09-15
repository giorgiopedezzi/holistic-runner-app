/**
 * services/identity.service.ts
 * Orchestrates the internal user + external-identity domain (HRA-348):
 * registration-gated login resolution, session issuance/rotation/revocation,
 * and security-event recording. HTTP-agnostic — never throws ApiProblem;
 * http/auth-context.ts is the one place that reduces a failure to the
 * uniform 401 (AC12).
 */
import type { PostgresDatabase } from "../db/postgres.ts";
import { clientQueryable } from "../db/query.ts";
import type { UserRow } from "../db.ts";
import { isRegistrationAllowed, type RegistrationMode } from "../domain/identity/registration-gate.ts";
import { isAccountUsable } from "../domain/identity/authorization.ts";
import { isValidIanaTimeZone } from "../domain/plan-timezone.ts";
import {
  computeSessionExpiry, encodeSessionCookieValue, decodeSessionCookieValue,
  isSessionExpired, issueSessionCredentials, secretMatches,
} from "../domain/identity/session-lifecycle.ts";
import type { IdentityRepo, ProfileUpdate } from "../repositories/identity.repo.ts";

export interface RegistrationGateConfig { mode: RegistrationMode; founderAllowlist: readonly string[] }
export interface SessionLifetimeConfig { idleSeconds: number; absoluteSeconds: number }

export interface ExternalLoginInput { issuer: string; subject: string; provider: string | null; email: string | null }

export type LoginResolution =
  | { outcome: "authenticated"; user: UserRow }
  | { outcome: "registration_denied" }
  | { outcome: "account_unusable"; user: UserRow };

export interface ValidSessionIdentity { userId: string; role: UserRow["role"]; sessionId: string }

export function createIdentityService(db: PostgresDatabase, identity: IdentityRepo) {
  const transaction = <T>(work: (repo: IdentityRepo) => Promise<T>) => db.transaction(client => work(identity.withDb(clientQueryable(client))));

  async function resolveExternalLogin(login: ExternalLoginInput, gate: RegistrationGateConfig): Promise<LoginResolution> {
    const existing = await identity.findExternalIdentity(login.issuer, login.subject);

    if (existing) {
      // AC3: a provider email change updates non-authoritative metadata only,
      // never the user row or ownership.
      await identity.touchExternalIdentityEmail(login.issuer, login.subject, login.email);
      const user = await identity.getUserById(existing.user_id);
      if (!user) throw new Error("identity.service: external identity references a missing user");
      if (!isAccountUsable(user.status)) {
        await identity.recordSecurityEvent({ eventType: "login_denied_account_status", userId: user.id, externalIssuer: login.issuer, externalSubject: login.subject, detail: user.status });
        return { outcome: "account_unusable", user };
      }
      await identity.recordSecurityEvent({ eventType: "login_success", userId: user.id, externalIssuer: login.issuer, externalSubject: login.subject, detail: null });
      return { outcome: "authenticated", user };
    }

    // AC4: no auto-linking/merging by email — an unknown (issuer, subject)
    // is only ever a candidate for a brand-new user, never attached to an
    // existing one just because the email matches.
    if (!isRegistrationAllowed({ mode: gate.mode, founderAllowlist: gate.founderAllowlist, email: login.email })) {
      await identity.recordSecurityEvent({ eventType: "login_denied_registration_closed", userId: null, externalIssuer: login.issuer, externalSubject: login.subject, detail: null });
      return { outcome: "registration_denied" };
    }

    const user = await transaction(repo => repo.createUserWithExternalIdentity(login));
    await identity.recordSecurityEvent({ eventType: "login_success", userId: user.id, externalIssuer: login.issuer, externalSubject: login.subject, detail: "registered" });
    return { outcome: "authenticated", user };
  }

  // AC1's "validated IANA profile timezone" — enforced here, the one place
  // that writes it, rather than as a DB CHECK (Postgres has no IANA-aware
  // constraint; domain/plan-timezone.ts's isValidIanaTimeZone is the same
  // check plan_instances.schedule_timezone already relies on).
  async function updateProfile(userId: string, profile: ProfileUpdate): Promise<UserRow> {
    if (profile.timezone !== null && !isValidIanaTimeZone(profile.timezone)) {
      throw new Error(`identity.service: '${profile.timezone}' is not a valid IANA timezone`);
    }
    const user = await identity.updateProfile(userId, profile);
    if (!user) throw new Error("identity.service: updateProfile targeted a missing user");
    return user;
  }

  // Issues a fresh session and, when `previousSessionId` names a real
  // session, revokes it in the same call — the fixation-prevention rotation
  // AC7 requires on every successful authentication. Returns the raw cookie
  // value; the caller (http layer) is responsible for setting it, never for
  // persisting or logging it.
  async function rotateSession(userId: string, lifetime: SessionLifetimeConfig, previousSessionId: string | null): Promise<string> {
    const now = new Date();
    if (previousSessionId) {
      await identity.revokeSession(previousSessionId, now);
      await identity.recordSecurityEvent({ eventType: "session_rotated", userId, externalIssuer: null, externalSubject: null, detail: null });
    }
    const credentials = issueSessionCredentials();
    const { idleExpiresAt, absoluteExpiresAt } = computeSessionExpiry(now, lifetime.idleSeconds, lifetime.absoluteSeconds);
    await identity.insertSession({ id: credentials.id, userId, secretHash: credentials.secretHash, idleExpiresAt, absoluteExpiresAt });
    return encodeSessionCookieValue(credentials);
  }

  async function revokeSessionByCookie(cookieValue: string): Promise<void> {
    const parsed = decodeSessionCookieValue(cookieValue);
    if (!parsed) return;
    const session = await identity.getSession(parsed.id);
    if (!session || !secretMatches(parsed.secret, session.secret_hash)) return;
    await identity.revokeSession(parsed.id, new Date());
    await identity.recordSecurityEvent({ eventType: "session_revoked", userId: session.user_id, externalIssuer: null, externalSubject: null, detail: "logout" });
  }

  async function revokeOtherSessions(userId: string, currentSessionId: string): Promise<void> {
    await identity.revokeOtherSessions(userId, currentSessionId, new Date());
    await identity.recordSecurityEvent({ eventType: "other_sessions_revoked", userId, externalIssuer: null, externalSubject: null, detail: "current_session_retained" });
  }

  // Recent sign-in is the approved protection for destructive self-service
  // actions. It is intentionally checked server-side against opaque session
  // state, never supplied by a browser field or a client clock.
  async function requireRecentAuthentication(userId: string, sessionId: string | null): Promise<boolean> {
    if (!sessionId) return false;
    const session = await identity.getSession(sessionId);
    return session?.user_id === userId && !session.revoked_at && Date.now() - new Date(session.created_at).getTime() <= 5 * 60_000;
  }

  // The session half of the request-identity boundary (AC6/AC8/AC11/AC12).
  // Returns null for EVERY failure mode (unknown id, secret mismatch,
  // expired, revoked, disabled account) — callers must not distinguish
  // between them in what they expose to the client.
  async function validateSessionCookie(cookieValue: string, idleSeconds: number): Promise<ValidSessionIdentity | null> {
    const parsed = decodeSessionCookieValue(cookieValue);
    if (!parsed) return null;
    const session = await identity.getSession(parsed.id);
    if (!session) return null;
    if (!secretMatches(parsed.secret, session.secret_hash)) return null;
    const now = new Date();
    if (isSessionExpired({ idleExpiresAt: new Date(session.idle_expires_at), absoluteExpiresAt: new Date(session.absolute_expires_at), revokedAt: session.revoked_at ? new Date(session.revoked_at) : null }, now)) return null;
    const user = await identity.getUserById(session.user_id);
    if (!user || !isAccountUsable(user.status)) return null;
    // Idle renewal — never past the session's own absolute boundary.
    const idleExpiresAt = new Date(Math.min(now.getTime() + idleSeconds * 1000, new Date(session.absolute_expires_at).getTime()));
    await identity.touchSessionLastSeen(session.id, now, idleExpiresAt);
    return { userId: user.id, role: user.role, sessionId: session.id };
  }

  return { resolveExternalLogin, updateProfile, rotateSession, revokeSessionByCookie, revokeOtherSessions, requireRecentAuthentication, validateSessionCookie };
}
export type IdentityService = ReturnType<typeof createIdentityService>;
