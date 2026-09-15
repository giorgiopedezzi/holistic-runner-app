/**
 * withings-auth.ts
 * Shared OAuth2 logic for Withings: building the login URL, exchanging an
 * auth code for tokens, refreshing, and reporting token status. Used by
 * jobs/withings-login.ts (CLI flow), jobs/sync-withings.ts (token refresh
 * during sync), and controllers/integrations.controller.ts (in-app login
 * button + status check).
 *
 * HRA-352: every function is explicitly owner-scoped (`userId`) — no lookup
 * ever falls back to "whichever row is in the table". Access/refresh tokens
 * are encrypted at rest (domain/token-crypto.ts) and decrypted only for the
 * caller that needs the live value; the encrypted column value is never
 * logged.
 */

import type { Queryable } from "../db/query.ts";
import { requireWithingsConfig, requireIntegrationEncryptionConfig, type Config } from "../config.ts";
import { encryptToken, decryptToken } from "../domain/token-crypto.ts";
import { isProviderAccountConflict, ProviderAccountConflictError } from "./provider-account-conflict.ts";
import type { WithingsTokenRow } from "../db.ts";

const AUTH_URL  = "https://account.withings.com/oauth2_user/authorize2";
const TOKEN_URL = "https://wbsapi.withings.net/v2/oauth2";
export const WITHINGS_SCOPE = "user.metrics,user.activity,user.sleepevents";

export function getAuthUrl(config: Config, state: string): string {
  const { client_id, redirect_uri } = requireWithingsConfig(config);
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id",     client_id);
  url.searchParams.set("redirect_uri",  redirect_uri);
  url.searchParams.set("scope",         WITHINGS_SCOPE);
  url.searchParams.set("state",         state);
  return url.toString();
}

// Withings' token response includes `userid` — the provider's own stable
// account id, captured once at exchange time and preserved across refreshes
// (Withings' refresh response doesn't repeat it).
interface TokenBody { access_token: string; refresh_token: string; expires_in: number; scope: string; userid?: number | string; }

async function requestToken(params: URLSearchParams): Promise<TokenBody> {
  const res  = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
  const json = await res.json() as { status: number; body: TokenBody };
  if (json.status !== 0) throw new Error(`Withings token error (status ${json.status})`);
  return json.body;
}

async function saveToken(db: Queryable, userId: string, config: Config, body: TokenBody): Promise<void> {
  const { key } = requireIntegrationEncryptionConfig(config);
  const expires_at = Math.floor(Date.now() / 1000) + body.expires_in;
  const providerAccountId = body.userid != null ? String(body.userid) : null;
  try {
    await db.run(`
      INSERT INTO withings_tokens (user_id, access_token, refresh_token, expires_at, scope, provider_account_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id) DO UPDATE SET
        access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token, expires_at=EXCLUDED.expires_at,
        scope=EXCLUDED.scope, provider_account_id=COALESCE(EXCLUDED.provider_account_id, withings_tokens.provider_account_id),
        updated_at=now()
    `, [userId, encryptToken(body.access_token, key), encryptToken(body.refresh_token, key), expires_at, body.scope, providerAccountId]);
  } catch (error) {
    if (isProviderAccountConflict(error, "idx_withings_tokens_provider_account")) throw new ProviderAccountConflictError();
    throw error;
  }
}

export async function exchangeCode(config: Config, db: Queryable, userId: string, code: string): Promise<void> {
  const { client_id, client_secret, redirect_uri } = requireWithingsConfig(config);
  const body = await requestToken(new URLSearchParams({
    action: "requesttoken", grant_type: "authorization_code",
    client_id, client_secret,
    code, redirect_uri,
  }));
  await saveToken(db, userId, config, body);
}

async function refreshToken(config: Config, db: Queryable, userId: string, token: WithingsTokenRow): Promise<string> {
  const { key } = requireIntegrationEncryptionConfig(config);
  const { client_id, client_secret } = requireWithingsConfig(config);
  const body = await requestToken(new URLSearchParams({
    action: "requesttoken", grant_type: "refresh_token",
    client_id, client_secret,
    refresh_token: decryptToken(token.refresh_token, key),
  }));
  await saveToken(db, userId, config, body);
  return body.access_token;
}

export function loadToken(db: Queryable, userId: string): Promise<WithingsTokenRow | undefined> {
  return db.get<WithingsTokenRow>(
    "SELECT user_id, access_token, refresh_token, expires_at, scope, provider_account_id FROM withings_tokens WHERE user_id = $1",
    [userId],
  );
}

export async function getValidToken(config: Config, db: Queryable, userId: string): Promise<string> {
  const { key } = requireIntegrationEncryptionConfig(config);
  const token = await loadToken(db, userId);
  if (!token) throw new Error("No Withings connection for this account. Connect it from the dashboard first.");
  return (token.expires_at - Math.floor(Date.now() / 1000) < 300)
    ? refreshToken(config, db, userId, token) : decryptToken(token.access_token, key);
}

export interface WithingsStatus {
  present:    boolean;
  valid:      boolean;
  expiresAt?: number;
  scope?:     string;
  error?:     string;
}

// present = a token row exists at all. valid = it (still) works. A token
// that isn't near expiry is assumed valid without a network call; one that
// is near/past expiry is only knowable by actually trying to refresh it —
// success means valid (and persists the refreshed token), failure (e.g. a
// revoked refresh token) means invalid.
export async function getTokenStatus(config: Config, db: Queryable, userId: string): Promise<WithingsStatus> {
  const token = await loadToken(db, userId);
  if (!token) return { present: false, valid: false };

  const secondsLeft = token.expires_at - Math.floor(Date.now() / 1000);
  if (secondsLeft > 300) {
    return { present: true, valid: true, expiresAt: token.expires_at, scope: token.scope ?? undefined };
  }

  try {
    await refreshToken(config, db, userId, token);
    const fresh = (await loadToken(db, userId))!;
    return { present: true, valid: true, expiresAt: fresh.expires_at, scope: fresh.scope ?? undefined };
  } catch (e) {
    return { present: true, valid: false, error: e instanceof Error ? e.message : String(e) };
  }
}

// Disconnect (HRA-352): Withings has no public per-app token-revocation
// endpoint, so this is local-only — remove the stored credential so no
// future sync/job can use it. Never touches imported activities/body data.
export async function disconnect(db: Queryable, userId: string): Promise<boolean> {
  const deleted = await db.run("DELETE FROM withings_tokens WHERE user_id = $1", [userId]);
  return deleted > 0;
}
