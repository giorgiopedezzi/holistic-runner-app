/**
 * withings-auth.ts
 * Shared OAuth2 logic for Withings: building the login URL, exchanging an
 * auth code for tokens, refreshing, and reporting token status. Used by
 * auth-withings.ts (CLI flow), sync-withings.ts (token refresh during sync),
 * and server.ts (in-app login button + status check).
 */

import type { Queryable } from "../db/query.ts";
import { requireWithingsConfig, type Config } from "../config.ts";
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

interface TokenBody { access_token: string; refresh_token: string; expires_in: number; scope: string; }

async function requestToken(params: URLSearchParams): Promise<TokenBody> {
  const res  = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
  const json = await res.json() as { status: number; body: TokenBody };
  if (json.status !== 0) throw new Error(`Withings token error (status ${json.status})`);
  return json.body;
}

async function saveToken(db: Queryable, body: TokenBody): Promise<void> {
  const expires_at = Math.floor(Date.now() / 1000) + body.expires_in;
  await db.run(`
    INSERT INTO withings_tokens (user_id, access_token, refresh_token, expires_at, scope)
    VALUES ((SELECT id FROM users ORDER BY created_at LIMIT 1), $1, $2, $3, $4)
    ON CONFLICT (user_id) DO UPDATE SET
      access_token=EXCLUDED.access_token, refresh_token=EXCLUDED.refresh_token, expires_at=EXCLUDED.expires_at, scope=EXCLUDED.scope, updated_at=now()
  `, [body.access_token, body.refresh_token, expires_at, body.scope]);
}

export async function exchangeCode(config: Config, db: Queryable, code: string): Promise<void> {
  const { client_id, client_secret, redirect_uri } = requireWithingsConfig(config);
  const body = await requestToken(new URLSearchParams({
    action: "requesttoken", grant_type: "authorization_code",
    client_id, client_secret,
    code, redirect_uri,
  }));
  await saveToken(db, body);
}

async function refreshToken(config: Config, db: Queryable, token: WithingsTokenRow): Promise<string> {
  const { client_id, client_secret } = requireWithingsConfig(config);
  const body = await requestToken(new URLSearchParams({
    action: "requesttoken", grant_type: "refresh_token",
    client_id, client_secret,
    refresh_token: token.refresh_token,
  }));
  await saveToken(db, body);
  return body.access_token;
}

export function loadToken(db: Queryable): Promise<WithingsTokenRow | undefined> {
  return db.get<WithingsTokenRow>("SELECT 1 AS id, access_token, refresh_token, expires_at, scope FROM withings_tokens ORDER BY updated_at DESC LIMIT 1");
}

export async function getValidToken(config: Config, db: Queryable): Promise<string> {
  const token = await loadToken(db);
  if (!token) throw new Error("No token. Run: npm run auth:withings");
  return (token.expires_at - Math.floor(Date.now() / 1000) < 300)
    ? refreshToken(config, db, token) : token.access_token;
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
export async function getTokenStatus(config: Config, db: Queryable): Promise<WithingsStatus> {
  const token = await loadToken(db);
  if (!token) return { present: false, valid: false };

  const secondsLeft = token.expires_at - Math.floor(Date.now() / 1000);
  if (secondsLeft > 300) {
    return { present: true, valid: true, expiresAt: token.expires_at, scope: token.scope ?? undefined };
  }

  try {
    await refreshToken(config, db, token);
    const fresh = (await loadToken(db))!;
    return { present: true, valid: true, expiresAt: fresh.expires_at, scope: fresh.scope ?? undefined };
  } catch (e) {
    return { present: true, valid: false, error: e instanceof Error ? e.message : String(e) };
  }
}
