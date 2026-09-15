/**
 * http/oauth.ts
 * Server-side OAuth `state` handling (HRA-352 AC3/AC4), backed by the
 * `oauth_states` table instead of the old in-memory `{withings, strava}`
 * singleton — a single shared nullable string could only ever remember one
 * pending login at a time, for whichever user happened to click last, and
 * carried no owner binding at all. A state token here is minted only for an
 * already-authenticated user, bound to (user, provider, redirect_uri),
 * single-use, and expiring — the callback derives its owner strictly from
 * this row, never from a client-supplied value (AC4).
 */
import { randomBytes } from "node:crypto";
import type { Queryable } from "../db/query.ts";

const STATE_BYTES = 32; // 256 bits — cryptographically strong per AC3
const STATE_TTL_MINUTES = 10;

export type OauthProvider = "withings" | "strava";

export async function createOauthState(db: Queryable, userId: string, provider: OauthProvider, redirectUri: string): Promise<string> {
  const token = randomBytes(STATE_BYTES).toString("base64url");
  await db.run(
    `INSERT INTO oauth_states (token, user_id, provider, redirect_uri, expires_at) VALUES ($1, $2, $3, $4, now() + make_interval(mins => $5))`,
    [token, userId, provider, redirectUri, STATE_TTL_MINUTES],
  );
  return token;
}

// Single-use, atomic consume: every failure mode (missing token, wrong
// provider, expired, already consumed — i.e. replayed) collapses to the same
// `null` outcome, mirroring http/auth-context.ts's unauthorized() collapse —
// never distinguishable by a caller, so a replay attempt learns nothing.
export async function consumeOauthState(db: Queryable, token: string, provider: OauthProvider): Promise<{ userId: string } | null> {
  const row = await db.get<{ user_id: string }>(
    `UPDATE oauth_states SET consumed_at = now()
     WHERE token = $1 AND provider = $2 AND consumed_at IS NULL AND expires_at > now()
     RETURNING user_id`,
    [token, provider],
  );
  return row ? { userId: row.user_id } : null;
}

export function oauthCallbackPage(title: string, message: string, autoClose: boolean): string {
  return `<html><body style="font-family:sans-serif;padding:2rem"><h2>${title}</h2><p>${message}</p></body>${autoClose ? "<script>window.close()</script>" : ""}</html>`;
}
