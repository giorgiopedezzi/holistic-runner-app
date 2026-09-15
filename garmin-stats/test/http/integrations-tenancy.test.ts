/**
 * test/http/integrations-tenancy.test.ts (HRA-352)
 * HTTP-boundary coverage for the integration routes: unauthenticated access
 * is rejected, and a second authenticated owner's status/disconnect calls
 * never see or touch the founder's provider connection. Token rows are
 * seeded directly (exchangeCode needs a live provider call — covered
 * separately by withings-tenancy.test.ts / strava-tenancy.test.ts with a
 * mocked fetch) so this file stays focused on the HTTP/ownership boundary.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createIdentityRepo } from "../../src/repositories/identity.repo.ts";
import { createIdentityService } from "../../src/services/identity.service.ts";
import { encryptToken } from "../../src/domain/token-crypto.ts";
import { FOUNDER_USER_ID } from "../../src/db/founder.ts";
import { startTestServer } from "../helpers/server.ts";

const SESSION = { idleSeconds: 1800, absoluteSeconds: 43200 };
const KEY = process.env.INTEGRATION_TOKEN_ENCRYPTION_KEY!;

async function seedToken(db: Awaited<ReturnType<typeof startTestServer>>["db"], userId: string, table: "withings_tokens" | "strava_tokens", providerAccountId: string) {
  await db.run(
    `INSERT INTO ${table} (user_id, access_token, refresh_token, expires_at, scope, provider_account_id) VALUES ($1,$2,$3,$4,$5,$6)`,
    [userId, encryptToken("access", KEY), encryptToken("refresh", KEY), Math.floor(Date.now() / 1000) + 3600, "scope", providerAccountId],
  );
}

test("every integration route rejects an unauthenticated caller", async () => {
  const server = await startTestServer();
  try {
    for (const path of [
      "/api/v1/withings/status", "/api/v1/withings/login-url",
      "/api/v1/strava/status", "/api/v1/strava/login-url",
      "/api/v1/sync/withings", "/api/v1/sync/strava", "/api/v1/sync/garmin",
    ]) {
      const response = await server.api(path, { headers: { cookie: "" } });
      assert.equal(response.status, 401, path);
    }
    const disconnectA = await server.api("/api/v1/withings/connection", { method: "DELETE", headers: { cookie: "" } });
    assert.equal(disconnectA.status, 401);
    const disconnectB = await server.api("/api/v1/strava/connection", { method: "DELETE", headers: { cookie: "" } });
    assert.equal(disconnectB.status, 401);
  } finally { await server.close(); }
});

test("a second owner's status/disconnect never sees or touches the founder's connection", async () => {
  const server = await startTestServer();
  try {
    await seedToken(server.db, FOUNDER_USER_ID, "withings_tokens", "founder-withings-account");
    await seedToken(server.db, FOUNDER_USER_ID, "strava_tokens", "founder-strava-account");

    const identity = createIdentityService(server.db, createIdentityRepo(server.db));
    const login = await identity.resolveExternalLogin(
      { issuer: "https://idp.example.com/", subject: "tenant-b-integrations", provider: "test", email: "tenant-b@example.com" },
      { mode: "open", founderAllowlist: [] },
    );
    assert.equal(login.outcome, "authenticated");
    if (login.outcome !== "authenticated") return;
    const cookie = await identity.rotateSession(login.user.id, SESSION, null);
    const headers = { cookie: `__Host-runsfree_session=${cookie}` };

    const withingsStatus = await server.api("/api/v1/withings/status", { headers });
    assert.equal(withingsStatus.status, 200);
    assert.deepEqual(withingsStatus.json, { present: false, valid: false });

    const stravaStatus = await server.api("/api/v1/strava/status", { headers });
    assert.equal(stravaStatus.status, 200);
    assert.deepEqual(stravaStatus.json, { present: false, valid: false });

    // Disconnecting as the second owner must never remove the founder's row.
    const disconnectWithings = await server.api("/api/v1/withings/connection", { method: "DELETE", headers });
    assert.equal(disconnectWithings.status, 200);
    assert.deepEqual(disconnectWithings.json, { disconnected: false });
    const founderWithings = await server.db.get("SELECT 1 FROM withings_tokens WHERE user_id = $1", [FOUNDER_USER_ID]);
    assert.ok(founderWithings);

    const founderStatus = await server.api("/api/v1/withings/status");
    assert.equal((founderStatus.json as { present: boolean }).present, true);
  } finally { await server.close(); }
});

test("disconnect removes only the calling owner's own connection and reports it truthfully", async () => {
  const server = await startTestServer();
  try {
    await seedToken(server.db, FOUNDER_USER_ID, "strava_tokens", "founder-strava-account");
    const before = await server.api("/api/v1/strava/status");
    assert.equal((before.json as { present: boolean }).present, true);

    const disconnected = await server.api("/api/v1/strava/connection", { method: "DELETE" });
    assert.equal(disconnected.status, 200);
    assert.deepEqual(disconnected.json, { disconnected: true });

    const after = await server.api("/api/v1/strava/status");
    assert.deepEqual(after.json, { present: false, valid: false });
  } finally { await server.close(); }
});

test("a malformed Strava callback (missing/invalid state) fails safely without a 500 and without exposing which check failed", async () => {
  const server = await startTestServer();
  try {
    const missing = await server.api("/api/v1/strava/callback", { headers: { cookie: "" } });
    assert.equal(missing.status, 200); // renders an HTML failure page, not a JSON error
    assert.match(missing.text, /Authentication failed/);

    const guessed = await server.api("/api/v1/strava/callback?code=abc&state=guessed-state-value", { headers: { cookie: "" } });
    assert.equal(guessed.status, 200);
    assert.match(guessed.text, /invalid, expired, or already used/);
  } finally { await server.close(); }
});
