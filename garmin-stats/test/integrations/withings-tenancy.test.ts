/**
 * test/integrations/withings-tenancy.test.ts (HRA-352 AC1/AC2/AC5)
 * Mocks global fetch (same convention as plan-template-ai.test.ts) so the
 * owner-scoping, at-rest encryption, and provider-account conflict behavior
 * of integrations/withings.ts can be verified without a real Withings call.
 */
import { test, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { loadConfig } from "../../src/config.ts";
import { exchangeCode, loadToken, getTokenStatus, disconnect } from "../../src/integrations/withings.ts";
import { ProviderAccountConflictError } from "../../src/integrations/provider-account-conflict.ts";
import { createTestDb } from "../helpers/db.ts";

const ENV_KEYS = ["WITHINGS_CLIENT_ID", "WITHINGS_CLIENT_SECRET", "WITHINGS_REDIRECT_URI"] as const;
const originalEnv: Record<string, string | undefined> = {};
const originalFetch = globalThis.fetch;

beforeEach(() => {
  for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
  process.env.WITHINGS_CLIENT_ID = "test-client";
  process.env.WITHINGS_CLIENT_SECRET = "test-secret";
  process.env.WITHINGS_REDIRECT_URI = "http://localhost:3002/callback";
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (originalEnv[key] === undefined) delete process.env[key];
    else process.env[key] = originalEnv[key];
  }
  globalThis.fetch = originalFetch;
});

function mockTokenExchange(userid: string, accessToken = "access-1", refreshToken = "refresh-1") {
  globalThis.fetch = (async () => new Response(JSON.stringify({
    status: 0,
    body: { access_token: accessToken, refresh_token: refreshToken, expires_in: 3600, scope: "user.metrics", userid },
  }), { status: 200 })) as typeof fetch;
}

async function makeUser(db: Awaited<ReturnType<typeof createTestDb>>["db"]): Promise<string> {
  const id = randomUUID();
  await db.run("INSERT INTO users (id) VALUES ($1)", [id]);
  return id;
}

test("each owner's token is stored and read back independently — no cross-owner visibility", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userA = await makeUser(db);
    const userB = await makeUser(db);

    mockTokenExchange("withings-account-A", "access-a");
    await exchangeCode(config, db, userA, "code-a");
    mockTokenExchange("withings-account-B", "access-b");
    await exchangeCode(config, db, userB, "code-b");

    const tokenA = await loadToken(db, userA);
    const tokenB = await loadToken(db, userB);
    assert.ok(tokenA && tokenB);
    assert.notEqual(tokenA.access_token, tokenB.access_token);
    assert.equal(tokenA.provider_account_id, "withings-account-A");
    assert.equal(tokenB.provider_account_id, "withings-account-B");
  } finally { await cleanup(); }
});

test("access/refresh tokens are stored encrypted, not as plaintext", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userId = await makeUser(db);
    mockTokenExchange("withings-account-1", "the-real-access-token", "the-real-refresh-token");
    await exchangeCode(config, db, userId, "code");

    const raw = await db.get<{ access_token: string; refresh_token: string }>(
      "SELECT access_token, refresh_token FROM withings_tokens WHERE user_id = $1", [userId],
    );
    assert.ok(raw);
    assert.notEqual(raw.access_token, "the-real-access-token");
    assert.notEqual(raw.refresh_token, "the-real-refresh-token");

    const status = await getTokenStatus(config, db, userId);
    assert.equal(status.present, true);
    assert.equal(status.valid, true);
  } finally { await cleanup(); }
});

test("a provider account already linked to a different owner is rejected, not silently reassigned or duplicated", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userA = await makeUser(db);
    const userB = await makeUser(db);

    mockTokenExchange("shared-withings-account");
    await exchangeCode(config, db, userA, "code-a");

    mockTokenExchange("shared-withings-account");
    await assert.rejects(() => exchangeCode(config, db, userB, "code-b"), ProviderAccountConflictError);

    // userA's connection is untouched and userB has no connection at all —
    // no reassignment, no duplicate row.
    const tokenA = await loadToken(db, userA);
    const tokenB = await loadToken(db, userB);
    assert.equal(tokenA?.provider_account_id, "shared-withings-account");
    assert.equal(tokenB, undefined);
  } finally { await cleanup(); }
});

test("re-linking the SAME owner's own already-connected account is idempotent, not a conflict", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userId = await makeUser(db);
    mockTokenExchange("withings-account-1", "access-1");
    await exchangeCode(config, db, userId, "code-1");
    mockTokenExchange("withings-account-1", "access-2");
    await exchangeCode(config, db, userId, "code-2");

    const token = await loadToken(db, userId);
    assert.equal(token?.provider_account_id, "withings-account-1");
  } finally { await cleanup(); }
});

test("disconnect removes only the calling owner's credential", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userA = await makeUser(db);
    const userB = await makeUser(db);
    mockTokenExchange("account-a");
    await exchangeCode(config, db, userA, "code-a");
    mockTokenExchange("account-b");
    await exchangeCode(config, db, userB, "code-b");

    const removed = await disconnect(db, userA);
    assert.equal(removed, true);
    assert.equal(await loadToken(db, userA), undefined);
    assert.ok(await loadToken(db, userB));
  } finally { await cleanup(); }
});

test("a token status check for an owner with no connection never falls back to another owner's row", async () => {
  const { db, cleanup } = await createTestDb();
  try {
    const config = loadConfig();
    const userWithToken = await makeUser(db);
    const userWithoutToken = await makeUser(db);
    mockTokenExchange("account-1");
    await exchangeCode(config, db, userWithToken, "code");

    const status = await getTokenStatus(config, db, userWithoutToken);
    assert.deepEqual(status, { present: false, valid: false });
  } finally { await cleanup(); }
});
