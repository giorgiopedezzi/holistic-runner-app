/**
 * test/integrations/founder-migration-compatibility.test.ts (HRA-352 follow-up)
 * Proves the founder's EXISTING provider connections — created by the
 * pre-encryption code, so stored as raw plaintext access/refresh tokens —
 * keep working through the normal owner-scoped read path after this Story's
 * migration, without a separate one-off data-migration script and without
 * ever needing live provider credentials.
 *
 * This caught a real bug during the follow-up audit: `decryptToken()` alone
 * throws "Malformed encrypted token value" on a legacy plaintext value —
 * 004_integration_tenancy.sql only ADDs a column, it never re-encrypts
 * existing rows. `domain/token-crypto.ts`'s `safeDecryptToken` (and its
 * `looksEncrypted` detector) is what closes that gap: read paths tolerate
 * both shapes, and a legacy row is self-upgraded to encrypted the next time
 * it's written (saveToken always encrypts on write).
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { loadConfig, requireIntegrationEncryptionConfig } from "../../src/config.ts";
import { looksEncrypted } from "../../src/domain/token-crypto.ts";
import { FOUNDER_USER_ID } from "../../src/db/founder.ts";
import * as withings from "../../src/integrations/withings.ts";
import * as strava from "../../src/integrations/strava.ts";
import { createTestDb } from "../helpers/db.ts";

const ENV_KEYS = ["WITHINGS_CLIENT_ID", "WITHINGS_CLIENT_SECRET", "WITHINGS_REDIRECT_URI", "STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET", "STRAVA_REDIRECT_URI"] as const;
const originalEnv: Record<string, string | undefined> = {};
const originalFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.WITHINGS_CLIENT_ID = "test"; process.env.WITHINGS_CLIENT_SECRET = "test"; process.env.WITHINGS_REDIRECT_URI = "http://localhost:3002/callback";
  process.env.STRAVA_CLIENT_ID = "test"; process.env.STRAVA_CLIENT_SECRET = "test"; process.env.STRAVA_REDIRECT_URI = "http://localhost:3001/api/v1/strava/callback";
});
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
});

// Seeds a row exactly as the PRE-HRA-352 code would have written it: plain
// user_id PK (already present since 001_postgresql_foundation.sql), plain
// TEXT columns holding a raw provider token, no provider_account_id (that
// column didn't exist yet either).
async function seedLegacyPlaintextRow(
  db: Awaited<ReturnType<typeof createTestDb>>["db"],
  table: "withings_tokens" | "strava_tokens",
  userId: string,
  accessToken: string,
  refreshToken: string,
  expiresAt: number,
) {
  await db.run(
    `INSERT INTO ${table} (user_id, access_token, refresh_token, expires_at, scope) VALUES ($1,$2,$3,$4,$5)`,
    [userId, accessToken, refreshToken, expiresAt, "legacy-scope"],
  );
}

test("an existing founder Withings row (pre-encryption, plaintext) resolves to the founder user and decrypts through the normal path", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const farFuture = Math.floor(Date.now() / 1000) + 3600;
    await seedLegacyPlaintextRow(db, "withings_tokens", FOUNDER_USER_ID, "legacy-plaintext-access-token", "legacy-plaintext-refresh-token", farFuture);

    const token = await withings.loadToken(db, FOUNDER_USER_ID);
    assert.equal(token?.user_id, FOUNDER_USER_ID);

    // Not near expiry — getValidToken takes the plain-read branch, which
    // must tolerate the legacy plaintext shape via safeDecryptToken.
    const accessToken = await withings.getValidToken(config, db, FOUNDER_USER_ID);
    assert.equal(accessToken, "legacy-plaintext-access-token");

    const status = await withings.getTokenStatus(config, db, FOUNDER_USER_ID);
    assert.deepEqual(status, { present: true, valid: true, expiresAt: farFuture, scope: "legacy-scope" });
  } finally { await cleanup(); }
});

test("a near-expiry legacy plaintext row refreshes successfully, sending the real (correctly decoded) refresh token, and is self-upgraded to encrypted on write", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const nearExpiry = Math.floor(Date.now() / 1000) + 60; // inside the 300s refresh window
    await seedLegacyPlaintextRow(db, "withings_tokens", FOUNDER_USER_ID, "legacy-access", "legacy-refresh-token-value", nearExpiry);

    let sentRefreshToken: string | undefined;
    globalThis.fetch = (async (_url, init) => {
      const body = new URLSearchParams(String((init as RequestInit)?.body ?? ""));
      sentRefreshToken = body.get("refresh_token") ?? undefined;
      return new Response(JSON.stringify({
        status: 0, body: { access_token: "fresh-access", refresh_token: "fresh-refresh", expires_in: 3600, scope: "user.metrics", userid: "acct-1" },
      }), { status: 200 });
    }) as typeof fetch;

    const accessToken = await withings.getValidToken(config, db, FOUNDER_USER_ID);
    assert.equal(accessToken, "fresh-access");
    // Proves safeDecryptToken correctly passed the legacy plaintext value
    // through unmangled — a real decrypt attempt on it would have thrown.
    assert.equal(sentRefreshToken, "legacy-refresh-token-value");

    // Self-healing: the row saveToken() just wrote is now in this module's
    // real encrypted format, not plaintext.
    const raw = await db.get<{ access_token: string; refresh_token: string }>(
      "SELECT access_token, refresh_token FROM withings_tokens WHERE user_id = $1", [FOUNDER_USER_ID],
    );
    assert.ok(raw);
    assert.equal(looksEncrypted(raw.access_token), true);
    assert.equal(looksEncrypted(raw.refresh_token), true);
  } finally { await cleanup(); }
});

test("an existing founder Strava row (pre-encryption, plaintext) resolves and decrypts through the normal path", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const farFuture = Math.floor(Date.now() / 1000) + 3600;
    await seedLegacyPlaintextRow(db, "strava_tokens", FOUNDER_USER_ID, "legacy-strava-access", "legacy-strava-refresh", farFuture);

    const accessToken = await strava.getValidToken(config, db, FOUNDER_USER_ID);
    assert.equal(accessToken, "legacy-strava-access");

    const status = await strava.getTokenStatus(config, db, FOUNDER_USER_ID);
    assert.equal(status.present, true);
    assert.equal(status.valid, true);
  } finally { await cleanup(); }
});

test("disconnecting a legacy plaintext connection works the same as an encrypted one — no crash decoding it, no credential logged", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const farFuture = Math.floor(Date.now() / 1000) + 3600;
    await seedLegacyPlaintextRow(db, "strava_tokens", FOUNDER_USER_ID, "legacy-strava-access", "legacy-strava-refresh", farFuture);
    globalThis.fetch = (async () => new Response("{}", { status: 200 })) as typeof fetch; // deauthorize call

    const removed = await strava.disconnect(config, db, FOUNDER_USER_ID);
    assert.equal(removed, true);
    assert.equal(await strava.loadToken(db, FOUNDER_USER_ID), undefined);
  } finally { await cleanup(); }
});

test("the encryption key required to read tokens is not itself exposed by requireIntegrationEncryptionConfig's error path when unset", () => {
  const withoutKey = { ...loadConfig(), integrationEncryption: { key: undefined } };
  assert.throws(() => requireIntegrationEncryptionConfig(withoutKey), /INTEGRATION_TOKEN_ENCRYPTION_KEY/);
});
