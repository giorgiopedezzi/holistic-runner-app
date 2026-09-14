/**
 * domain/identity/types.ts
 * Shared shapes for the internal user + external-identity domain (HRA-348).
 * Pure types only — no I/O. AccountStatus/UserRole live in db.ts (the row
 * shape is canonical); re-exported here so domain modules import one place.
 */
export type { AccountStatus, UserRole } from "../../db.ts";

// Closed set — deliberately excludes any field shaped like a credential,
// provider token, or training payload (AC13).
export type SecurityEventType =
  | "login_success"
  | "login_denied_registration_closed"
  | "login_denied_invalid_token"
  | "login_denied_account_status"
  | "session_rotated"
  | "session_revoked"
  | "logout";

export interface SecurityEventInput {
  eventType: SecurityEventType;
  userId: string | null;
  externalIssuer: string | null;
  externalSubject: string | null;
  detail: string | null;
}
