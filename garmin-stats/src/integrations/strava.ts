/**
 * strava-auth.ts
 * Shared OAuth2 logic for Strava: building the login URL, exchanging an auth
 * code for tokens, refreshing, and reporting token status. Structural mirror
 * of withings-auth.ts — same shape, adapted for Strava's token response
 * (expires_at given directly instead of expires_in, refresh_token rotates on
 * every refresh and must be re-persisted each time).
 */

import type { DatabaseSync } from "node:sqlite";
import { requireStravaConfig, type Config } from "../config.ts";
import type { StravaTokenRow } from "../db.ts";

const AUTH_URL  = "https://www.strava.com/oauth/authorize";
const TOKEN_URL = "https://www.strava.com/oauth/token";
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

interface TokenBody { access_token: string; refresh_token: string; expires_at: number; }

async function requestToken(params: URLSearchParams): Promise<TokenBody> {
  const res = await fetch(TOKEN_URL, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: params.toString() });
  if (!res.ok) throw new Error(`Strava token error (status ${res.status}): ${await res.text()}`);
  return await res.json() as TokenBody;
}

function saveToken(db: DatabaseSync, body: TokenBody): void {
  db.prepare(`
    INSERT INTO strava_tokens (id, access_token, refresh_token, expires_at, scope)
    VALUES (1, $at, $rt, $ea, $sc)
    ON CONFLICT(id) DO UPDATE SET
      access_token=$at, refresh_token=$rt, expires_at=$ea, scope=$sc, updated_at=datetime('now')
  `).run({ $at: body.access_token, $rt: body.refresh_token, $ea: body.expires_at, $sc: STRAVA_SCOPE });
}

export async function exchangeCode(config: Config, db: DatabaseSync, code: string): Promise<void> {
  const { client_id, client_secret } = requireStravaConfig(config);
  const body = await requestToken(new URLSearchParams({
    client_id, client_secret,
    code, grant_type: "authorization_code",
  }));
  saveToken(db, body);
}

// Strava rotates the refresh token on every use (unlike Withings, which
// reuses the same one for a while) — the new one from the response must
// always be persisted, or the next refresh will fail with an invalid token.
async function refreshToken(config: Config, db: DatabaseSync, token: StravaTokenRow): Promise<string> {
  const { client_id, client_secret } = requireStravaConfig(config);
  const body = await requestToken(new URLSearchParams({
    client_id, client_secret,
    refresh_token: token.refresh_token, grant_type: "refresh_token",
  }));
  saveToken(db, body);
  return body.access_token;
}

export function loadToken(db: DatabaseSync): StravaTokenRow | undefined {
  return db.prepare("SELECT * FROM strava_tokens WHERE id = 1").get() as StravaTokenRow | undefined;
}

export async function getValidToken(config: Config, db: DatabaseSync): Promise<string> {
  const token = loadToken(db);
  if (!token) throw new Error("No Strava token. Log in via the dashboard first.");
  return (token.expires_at - Math.floor(Date.now() / 1000) < 300)
    ? refreshToken(config, db, token) : token.access_token;
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
export async function getTokenStatus(config: Config, db: DatabaseSync): Promise<StravaStatus> {
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
