/**
 * repositories/identity.repo.ts
 * Data access for the internal user + external-identity domain (HRA-348):
 * users, external_identities, sessions, user_entitlements, security_events.
 * `withDb` follows the same transaction-rebind convention as the other repos
 * (e.g. body.repo.ts) — services run multi-statement writes inside
 * db.transaction(client => repo.withDb(clientQueryable(client)).…).
 */
import { randomUUID } from "node:crypto";
import type { Queryable } from "../db/query.ts";
import type {
  ExternalIdentityRow, SecurityEventRow, SessionRow, UserEntitlementRow, UserRow,
} from "../db.ts";

const USER_COLUMNS = "id, display_name, locale, unit_system, timezone, status, role, created_at, updated_at";
const IDENTITY_COLUMNS = "id, user_id, issuer, subject, provider, email_at_link_time, created_at, updated_at";
const SESSION_COLUMNS = "id, user_id, secret_hash, created_at, last_seen_at, idle_expires_at, absolute_expires_at, revoked_at";

export interface NewExternalLogin { issuer: string; subject: string; provider: string | null; email: string | null }
export interface NewSession { id: string; userId: string; secretHash: string; idleExpiresAt: Date; absoluteExpiresAt: Date }
export interface ProfileUpdate { displayName: string | null; locale: string | null; unitSystem: "metric" | "imperial" | null; timezone: string | null }

export function createIdentityRepo(db: Queryable) {
  const repo = {
    // ── users ──────────────────────────────────────────────────────────
    getUserById: (id: string) => db.get<UserRow>(`SELECT ${USER_COLUMNS} FROM users WHERE id = $1`, [id]),

    // Whole-row replace of the profile fields (AC1) — validation (e.g.
    // isValidIanaTimeZone) is the caller's (services/identity.service.ts)
    // responsibility; this layer only persists.
    updateProfile: (userId: string, profile: ProfileUpdate) =>
      db.get<UserRow>(
        `UPDATE users SET display_name = $1, locale = $2, unit_system = $3, timezone = $4, updated_at = now() WHERE id = $5 RETURNING ${USER_COLUMNS}`,
        [profile.displayName, profile.locale, profile.unitSystem, profile.timezone, userId],
      ),

    // ── external identities (AC2: unique by (issuer, subject) — the only
    // authoritative lookup key; never by email) ─────────────────────────
    findExternalIdentity: (issuer: string, subject: string) =>
      db.get<ExternalIdentityRow>(`SELECT ${IDENTITY_COLUMNS} FROM external_identities WHERE issuer = $1 AND subject = $2`, [issuer, subject]),

    // Creates a brand-new internal user + its first external identity in one
    // statement pair. Callers MUST run this inside a transaction (via withDb)
    // — a user with no external identity, or vice versa, is never valid.
    async createUserWithExternalIdentity(login: NewExternalLogin): Promise<UserRow> {
      const userId = randomUUID();
      const user = await db.get<UserRow>(`INSERT INTO users (id) VALUES ($1) RETURNING ${USER_COLUMNS}`, [userId]);
      if (!user) throw new Error("identity.repo: user insert did not return a row");
      await db.run("INSERT INTO user_settings (user_id) VALUES ($1)", [userId]);
      await db.run(
        "INSERT INTO external_identities (user_id, issuer, subject, provider, email_at_link_time) VALUES ($1, $2, $3, $4, $5)",
        [userId, login.issuer, login.subject, login.provider, login.email],
      );
      return user;
    },

    // Refreshes non-authoritative metadata only (AC3: a provider email change
    // never touches the user row or changes ownership).
    touchExternalIdentityEmail: (issuer: string, subject: string, email: string | null) =>
      db.run("UPDATE external_identities SET email_at_link_time = $1, updated_at = now() WHERE issuer = $2 AND subject = $3", [email, issuer, subject]),

    // ── sessions (AC6/AC7) ────────────────────────────────────────────────
    insertSession: (session: NewSession) =>
      db.run(
        "INSERT INTO sessions (id, user_id, secret_hash, idle_expires_at, absolute_expires_at) VALUES ($1, $2, $3, $4, $5)",
        [session.id, session.userId, session.secretHash, session.idleExpiresAt.toISOString(), session.absoluteExpiresAt.toISOString()],
      ),
    getSession: (id: string) => db.get<SessionRow>(`SELECT ${SESSION_COLUMNS} FROM sessions WHERE id = $1`, [id]),
    touchSessionLastSeen: (id: string, lastSeenAt: Date, idleExpiresAt: Date) =>
      db.run("UPDATE sessions SET last_seen_at = $1, idle_expires_at = $2 WHERE id = $3", [lastSeenAt.toISOString(), idleExpiresAt.toISOString(), id]),
    revokeSession: (id: string, revokedAt: Date) => db.run("UPDATE sessions SET revoked_at = $1 WHERE id = $2 AND revoked_at IS NULL", [revokedAt.toISOString(), id]),
    revokeOtherSessions: (userId: string, currentSessionId: string, revokedAt: Date) => db.run(
      "UPDATE sessions SET revoked_at = $1 WHERE user_id = $2 AND id <> $3 AND revoked_at IS NULL",
      [revokedAt.toISOString(), userId, currentSessionId],
    ),

    // ── entitlements (AC9: distinct from role) ───────────────────────────
    listEntitlements: (userId: string) => db.all<UserEntitlementRow>("SELECT user_id, entitlement, granted_at FROM user_entitlements WHERE user_id = $1", [userId]),
    hasEntitlement: async (userId: string, entitlement: string) => (await db.get<{ present: boolean }>(
      "SELECT EXISTS (SELECT 1 FROM user_entitlements WHERE user_id = $1 AND entitlement = $2) AS present",
      [userId, entitlement],
    ))?.present ?? false,
    grantEntitlement: (userId: string, entitlement: string) =>
      db.run("INSERT INTO user_entitlements (user_id, entitlement) VALUES ($1, $2) ON CONFLICT (user_id, entitlement) DO NOTHING", [userId, entitlement]),

    // ── security events (AC13) ───────────────────────────────────────────
    recordSecurityEvent: (event: { eventType: string; userId: string | null; externalIssuer: string | null; externalSubject: string | null; detail: string | null }) =>
      db.run(
        "INSERT INTO security_events (event_type, user_id, external_issuer, external_subject, detail) VALUES ($1, $2, $3, $4, $5)",
        [event.eventType, event.userId, event.externalIssuer, event.externalSubject, event.detail],
      ),
    listSecurityEvents: (userId: string) => db.all<SecurityEventRow>("SELECT id, event_type, user_id, external_issuer, external_subject, detail, created_at FROM security_events WHERE user_id = $1 ORDER BY created_at ASC", [userId]),
  };
  return { ...repo, withDb: (query: Queryable) => createIdentityRepo(query) };
}
export type IdentityRepo = ReturnType<typeof createIdentityRepo>;
