/**
 * strava-auth.ts
 * Shared OAuth2 logic for Strava: building the login URL, exchanging an auth
 * code for tokens, refreshing, and reporting token status. Structural mirror
 * of withings-auth.ts — same shape, adapted for Strava's token response
 * (expires_at given directly instead of expires_in, refresh_token rotates on
 * every refresh and must be re-persisted each time).
 *
 * HRA-352: every function is explicitly owner-scoped (`userId`) — no lookup
 * ever falls back to "whichever row is in the table". Access/refresh tokens
 * are encrypted at rest (domain/token-crypto.ts) and decrypted only for the
 * caller that needs the live value; the encrypted column value is never
 * logged.
 */

import type { Queryable } from "../db/query.ts";
import { requireStravaConfig, requireIntegrationEncryptionConfig, type Config } from "../config.ts";
import { encryptToken, safeDecryptToken } from "../domain/token-crypto.ts";
import { isProviderAccountConflict, ProviderAccountConflictError } from "./provider-account-conflict.ts";
import { invalidatePendingOauthStates } from "../http/oauth.ts";
import type { StravaTokenRow } from "../db.ts";

const AUTH_URL  = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
const DEAUTHORIZE_URL = "https://www.strava.com/oauth/deauthorize";
export const STRAVA_SCOPE = "activity:read_all";

export function getAuthUrl(config: Config, state: string): string {
  const { client_id, redirect_uri } = requireStravaConfig(config);
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id",     client_id);
  url.searchParams.set("redirect_uri",  redirect_uri);
  url.searchParams.set("scope",         STRAVA_SCOPE);
  url.searchParams.set("state",         state);
  url.searchParams.set("approval_prompt", "auto");
  return url.toString();
}

// `athlete` is only present on an authorization_code exchange, never on a
// refresh — the provider account id it carries must be preserved across
// refreshes, not overwritten with null (see saveToken's COALESCE).
interface TokenBody { access_token: string; refresh_token: string; expires_at: number; athlete?: { id: number }; }

async function requestToken(params: URLSearchParams): Promise<TokenBody> {
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
  if (!res.ok) throw new Error(`Strava token error (status ${res.status}): ${await res.text()}`);
  return await res.json() as TokenBody;
}

async function saveToken(db: Queryable, userId: string, config: Config, body: TokenBody): Promise<void> {
  const { key } = requireIntegrationEncryptionConfig(config);
  const providerAccountId = body.athlete?.id != null ? String(body.athlete.id) : null;
  try {
    await db.run(`
      INSERT INTO strava_tokens (user_id, access_token, refresh_token, expires_at, scope, provider_account_id)
      VALUES ($1, $2, $3, $4, $5, $6)
      ON CONFLICT (user_id) DO UPDATE SET
        access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token, expires_at=EXCLUDED.expires_at,
        scope=EXCLUDED.scope, provider_account_id=COALESCE(EXCLUDED.provider_account_id, strava_tokens.provider_account_id),
        updated_at=now()
    `, [userId, encryptToken(body.access_token, key), encryptToken(body.refresh_token, key), body.expires_at, STRAVA_SCOPE, providerAccountId]);
  } catch (error) {
    if (isProviderAccountConflict(error, "idx_strava_tokens_provider_account")) throw new ProviderAccountConflictError();
    throw error;
  }
}

export async function exchangeCode(config: Config, db: Queryable, userId: string, code: string): Promise<void> {
  const { client_id, client_secret } = requireStravaConfig(config);
  const body = await requestToken(new URLSearchParams({
    client_id, client_secret,
    code, grant_type: "authorization_code",
  }));
  await saveToken(db, userId, config, body);
}

// Strava rotates the refresh token on every use (unlike Withings, which
// reuses the same one for a while) — the new one from the response must
// always be persisted, or the next refresh will fail with an invalid token.
async function refreshToken(config: Config, db: Queryable, userId: string, token: StravaTokenRow): Promise<string> {
  const { key } = requireIntegrationEncryptionConfig(config);
  const { client_id, client_secret } = requireStravaConfig(config);
  const body = await requestToken(new URLSearchParams({
    client_id, client_secret,
    refresh_token: safeDecryptToken(token.refresh_token, key), grant_type: "refresh_token",
  }));
  await saveToken(db, userId, config, body);
  return body.access_token;
}

export function loadToken(db: Queryable, userId: string): Promise<StravaTokenRow | undefined> {
  return db.get<StravaTokenRow>(
    "SELECT user_id, access_token, refresh_token, expires_at, scope, provider_account_id FROM strava_tokens WHERE user_id = $1",
    [userId],
  );
}

export async function getValidToken(config: Config, db: Queryable, userId: string): Promise<string> {
  const { key } = requireIntegrationEncryptionConfig(config);
  const token = await loadToken(db, userId);
  if (!token) throw new Error("No Strava connection for this account. Connect it from the dashboard first.");
  return (token.expires_at - Math.floor(Date.now() / 1000) < 300)
    ? refreshToken(config, db, userId, token) : safeDecryptToken(token.access_token, key);
}

// A running sync job's connection-active checkpoint (HRA-352 follow-up) —
// see withings.ts's isConnectionActive for the full rationale.
export function isConnectionActive(db: Queryable, userId: string): Promise<boolean> {
  return db.get("SELECT 1 FROM strava_tokens WHERE user_id = $1", [userId]).then(row => row !== undefined);
}

export interface StravaStatus {
  present:    boolean;
  valid:      boolean;
  expiresAt?: number;
  scope?:     string;
  error?:     string;
}

// Same reasoning as Withings' getTokenStatus: a token that isn't near expiry
// is assumed valid without a network call; near/past expiry is only
// knowable by actually trying to refresh it.
export async function getTokenStatus(config: Config, db: Queryable, userId: string): Promise<StravaStatus> {
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

// Disconnect (HRA-352): best-effort remote revocation via Strava's own
// deauthorize endpoint, then always remove the local credential regardless
// of whether the remote call succeeded — a failed remote revoke must never
// leave the local connection looking active. Never touches imported
// activities. Also invalidates any login flow this owner started but never
// completed for this provider — see withings.ts's disconnect() for why.
export async function disconnect(config: Config, db: Queryable, userId: string): Promise<boolean> {
  const { key } = requireIntegrationEncryptionConfig(config);
  const token = await loadToken(db, userId);
  if (token) {
    try {
      await fetch(DEAUTHORIZE_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ access_token: safeDecryptToken(token.access_token, key) }).toString(),
      });
    } catch { /* best-effort — local revocation below is what actually matters */ }
  }
  const deleted = await db.run("DELETE FROM strava_tokens WHERE user_id = $1", [userId]);
  await invalidatePendingOauthStates(db, userId, "strava");
  return deleted > 0;
}
