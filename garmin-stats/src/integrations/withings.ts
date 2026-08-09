/**
 * withings-auth.ts
 * Shared OAuth2 logic for Withings: building the login URL, exchanging an
 * auth code for tokens, refreshing, and reporting token status. Used by
 * auth-withings.ts (CLI flow), sync-withings.ts (token refresh during sync),
 * and server.ts (in-app login button + status check).
 */

import type { DatabaseSync } from "node:sqlite";
import type { Config } from "../config.ts";
import type { WithingsTokenRow } from "../db.ts";

const AUTH_URL  = "https://account.withings.com/oauth2_user/authorize2";
const TOKEN_URL = "https://wbsapi.withings.net/v2/oauth2";
export const WITHINGS_SCOPE = "user.metrics,user.activity,user.sleepevents";

export function getAuthUrl(config: Config, state: string): string {
  const url = new URL(AUTH_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id",     config.withings.client_id);
  url.searchParams.set("redirect_uri",  config.withings.redirect_uri);
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

function saveToken(db: DatabaseSync, body: TokenBody): void {
  const expires_at = Math.floor(Date.now() / 1000) + body.expires_in;
  db.prepare(`
    INSERT INTO withings_tokens (id, access_token, refresh_token, expires_at, scope)
    VALUES (1, $at, $rt, $ea, $sc)
    ON CONFLICT(id) DO UPDATE SET
      access_token=$at, refresh_token=$rt, expires_at=$ea, scope=$sc, updated_at=datetime('now')
  `).run({ $at: body.access_token, $rt: body.refresh_token, $ea: expires_at, $sc: body.scope });
}

export async function exchangeCode(config: Config, db: DatabaseSync, code: string): Promise<void> {
  const body = await requestToken(new URLSearchParams({
    action: "requesttoken", grant_type: "authorization_code",
    client_id: config.withings.client_id, client_secret: config.withings.client_secret,
    code, redirect_uri: config.withings.redirect_uri,
  }));
  saveToken(db, body);
}

async function refreshToken(config: Config, db: DatabaseSync, token: WithingsTokenRow): Promise<string> {
  const body = await requestToken(new URLSearchParams({
    action: "requesttoken", grant_type: "refresh_token",
    client_id: config.withings.client_id, client_secret: config.withings.client_secret,
    refresh_token: token.refresh_token,
  }));
  saveToken(db, body);
  return body.access_token;
}

export function loadToken(db: DatabaseSync): WithingsTokenRow | undefined {
  return db.prepare("SELECT * FROM withings_tokens WHERE id = 1").get() as WithingsTokenRow | undefined;
}

export async function getValidToken(config: Config, db: DatabaseSync): Promise<string> {
  const token = loadToken(db);
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
export async function getTokenStatus(config: Config, db: DatabaseSync): Promise<WithingsStatus> {
  const token = loadToken(db);
  if (!token) return { present: false, valid: false };

  const secondsLeft = token.expires_at - Math.floor(Date.now() / 1000);
  if (secondsLeft > 300) {
    return { present: true, valid: true, expiresAt: token.expires_at, scope: token.scope ?? undefined };
  }

  try {
    await refreshToken(config, db, token);
    const fresh = loadToken(db)!;
    return { present: true, valid: true, expiresAt: fresh.expires_at, scope: fresh.scope ?? undefined };
  } catch (e) {
    return { present: true, valid: false, error: e instanceof Error ? e.message : String(e) };
  }
}
